/**
 * Measures where the pick screen's content actually lands, in a real phone
 * viewport, and fails if a player is not on screen when the spin stops.
 *
 *   pnpm verify:web && pnpm verify:fold
 *
 * The bug this exists for is not a bug any test in this repo can see. Every
 * piece of the play screen renders correctly on its own and every unit test
 * passes while the list of eligible players starts below the bottom of the
 * phone: a first-time player spins, is shown a hero, an era line and a field,
 * and has to scroll to discover that the game wants them to pick somebody. It
 * is a layout arithmetic failure -- the sum of what sits above the list against
 * a viewport height -- so it is invisible to anything that does not lay the
 * page out and measure it. `bottomBar` and `SHORT_VIEWPORT` are both there to
 * fix it, and nothing at all holds them to it.
 *
 * So this plays a real Scout season in headless Chrome, at the two heights that
 * matter, and reads `getBoundingClientRect()` off the field, the player rows and
 * the pinned bar:
 *
 *   393x852 -- a current phone, the screen the game is designed for.
 *   393x620 -- `FRAME_HEIGHT.play` in `extensions/espn-watch/content.js`, the
 *              height the extension's panel gives the play screen. The shortest
 *              viewport the game ever runs in, and the one that breaks first.
 *
 * What it asserts is that at a scroll position of zero the field is fully
 * visible above the pinned bar, the list starts above it, and at least one
 * *complete* player row is on screen -- the row you can read and press without
 * touching the scroll. And the other half of the same fault: that the bar,
 * which is pinned over the list, cannot permanently hide the last row.
 *
 * Three things it knows that cost other harnesses in this repo real time:
 *
 * 1. **A Chrome profile per run.** Chrome does not reliably exit under
 *    `--virtual-time-budget`, and a process still holding the profile makes the
 *    *next* launch exit 21 with nothing on stdout -- which reads as a broken
 *    app and is a lock. See `extensions/espn-watch/fixture-check.mjs`, which
 *    paid for it.
 * 2. **The DOM goes to a file, never down a pipe.** A timeout kills the process
 *    it started; it does not close a pipe a surviving Chrome *helper* still
 *    holds open, and the call then waits forever on output nobody will write. A
 *    check that hangs is worse than one that fails. The same file, for the same
 *    reason.
 * 3. **Nothing may resolve off this machine.** The export asks Google Fonts for
 *    a webfont, virtual time stops while that request is outstanding, and the
 *    page therefore never goes idle and never reports: a harness that produces
 *    nothing, on a machine whose only fault is that it has a network. Every file
 *    the page needs is served by the loopback server below, so every other host
 *    is refused outright.
 *
 * And the reason the page under test is in an iframe rather than in the window:
 * **headless Chrome clamps its own viewport to 500px wide.** `--window-size=393`
 * renders at 500 and crops, so a "phone width" run is a desktop render with the
 * right-hand side cut off -- see `docs/backlog.md`. An iframe is sized exactly,
 * and the first thing asserted below is that the frame really is 393 across.
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('No Chrome found. This check needs a real layout engine.');
  process.exit(2);
}

const root = resolve(import.meta.dirname, '../..');
const dist = resolve(process.argv[2] ?? join(root, 'dist'));

/**
 * The export is an input, not something this builds.
 *
 * `pnpm verify:web` is how a bundle is made in this repo and it takes minutes;
 * running it from here would mean a layout check that spends most of its time
 * being a build. But a check that silently measures last week's bundle is worse
 * than one that refuses to run, so the age of the export is compared against the
 * sources that produce it and a stale one is a refusal rather than a pass.
 */
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No web export at ${dist}.\n\n  pnpm verify:web\n`);
  process.exit(2);
}

async function newestSource(dir, newest = 0) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) newest = await newestSource(path, newest);
    else newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}

const exportedAt = statSync(join(dist, 'index.html')).mtimeMs;
const sourcedAt = Math.max(
  await newestSource(join(root, 'apps/mobile/app')),
  await newestSource(join(root, 'apps/mobile/src')),
  await newestSource(join(root, 'packages/domain/src')),
  await newestSource(join(root, 'packages/data/src')),
);
if (sourcedAt > exportedAt && !process.argv.includes('--allow-stale')) {
  const behind = sourcedAt - exportedAt;
  const minutes = Math.max(1, Math.round(behind / 6e4));
  const age = behind >= 3.6e6 ? `${(behind / 3.6e6).toFixed(1)} hours` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
  console.error(
    `The export at ${dist} is ${age} older than the app sources.\n` +
      'Measuring it would be measuring a screen nobody is shipping.\n\n  pnpm verify:web\n\n' +
      '(--allow-stale to measure it anyway.)',
  );
  process.exit(2);
}

/**
 * Where the app expects to be served from.
 *
 * `verify:web` exports with `EXPO_BASE_URL=/18-0`, which is the path it is
 * deployed under -- so the router matches on a pathname that starts with it and
 * serving the same files at the root gives a bundle that loads and then routes
 * to nothing. Read out of the built page rather than restated here, so an
 * export made without the variable is served at the root and still works.
 */
const BASE = /src="(\/[^"]*?)\/_expo\//.exec(readFileSync(join(dist, 'index.html'), 'utf8'))?.[1] ?? '';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/**
 * The harness page: an iframe of the exported app at an exact size, driven
 * through one real season, reporting into `document.title`.
 *
 * It is served from the same origin as the bundle, which is the whole reason it
 * can measure anything -- `contentDocument` on a cross-origin frame is a
 * security error, and `file://` frames are cross-origin to each other.
 *
 * The title is rewritten after every step rather than once at the end, so a run
 * that is cut short still says how far it got instead of reporting nothing.
 */
const HARNESS = `<!doctype html>
<meta charset="utf-8">
<title>pending</title>
<style>html,body{margin:0;background:#101010}iframe{border:0;display:block}</style>
<iframe id="f"></iframe>
<script>
const params = new URLSearchParams(location.search);
const W = Number(params.get('w') || 393);
const H = Number(params.get('h') || 852);
const SRC = params.get('src') || '/';
const R = { asked: { w: W, h: H }, steps: [] };
const post = () => { document.title = JSON.stringify(R); };
const step = (s) => { R.steps.push(s); post(); };
addEventListener('error', (e) => { R.error = R.error || ('threw: ' + e.message); post(); });
addEventListener('unhandledrejection', (e) => { R.error = R.error || ('rejected: ' + String(e.reason)); post(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => Math.round(n * 10) / 10;
const box = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right), h: round(r.height) };
};

(async () => {
  const f = document.getElementById('f');
  f.style.width = W + 'px';
  f.style.height = H + 'px';
  f.src = SRC;
  await new Promise((r) => { f.onload = r; });
  const w = f.contentWindow;
  const d = f.contentDocument;
  R.viewport = { w: w.innerWidth, h: w.innerHeight };
  step('loaded ' + SRC);

  const all = (sel) => Array.from(d.querySelectorAll(sel));
  const labelled = (test) => all('[role="button"],[role="switch"]').filter((e) => test(e.getAttribute('aria-label') || ''));
  const poll = async (fn, tries) => {
    for (let i = 0; i < (tries || 80); i++) {
      const got = fn();
      if (got) return got;
      await sleep(125);
    }
    return null;
  };
  const need = async (fn, what, tries) => {
    const got = await poll(fn, tries);
    if (!got) {
      R.error = 'timed out waiting for ' + what;
      R.seen = d.body.textContent.slice(0, 240);
      post();
    }
    return got;
  };
  // React Native Web's Pressable listens on the pointer events, and falls back
  // to the mouse ones. Both are sent because which of the two a control is
  // wired to is an implementation detail of whichever version is installed.
  const click = (el) => {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new w.MouseEvent(t, { bubbles: true, cancelable: true, view: w }));
    }
  };

  /*
   * Unranked, deliberately.
   *
   * A ranked season asks a server this harness refuses to resolve, the refusal
   * is (correctly) reported to the player as a line above the field, and that
   * line is a piece of layout no real first spin has. Measuring the fold with it
   * on the screen would be measuring a screen almost nobody sees.
   */
  const sw = await need(() => labelled((l) => l === 'Play for the leaderboard')[0], 'the ranked switch', 24);
  if (!sw) return;
  // By the word it renders rather than by \`aria-checked\`, which this switch
  // does not publish -- reading it returned null in both states, so the harness
  // silently never toggled anything and played every season ranked.
  const state = () => (/CASUAL/.test(sw.textContent) ? 'casual' : /RANKED/.test(sw.textContent) ? 'ranked' : 'unreadable');
  if (state() !== 'casual') { click(sw); await sleep(500); }
  R.ranked = state();
  if (R.ranked !== 'casual') {
    R.error = 'could not turn the ranked switch off; it reads ' + R.ranked;
    return post();
  }
  step('ranked ' + R.ranked);

  const scout = await need(() => labelled((l) => l.indexOf('Play Scout') === 0)[0], 'the Scout card');
  if (!scout) return;
  click(scout);
  step('started Scout');

  const spinButton = await need(() => labelled((l) => l === 'Spin the wheel')[0], 'the Spin button');
  if (!spinButton) return;
  click(spinButton);
  const landed = await need(() => (all('[aria-label^="Filter by"]').length > 0 ? true : null), 'the spin to land');
  if (!landed) return;
  // The rows arrive on a stagger -- Reveal, 24ms apart, 260ms each -- and a row
  // measured mid-entrance is a row measured ten pixels below where it lands.
  await sleep(1800);
  step('spun');

  R.notice = /will not be ranked/.test(d.body.textContent);

  // A player row, found by the only thing that describes one: the accessible
  // name the card builds out of a name, a position and a year.
  const rows = labelled((l) => /\\. (QB|RB|WR|TE|DEF)\\. \\d{4} /.test(l));
  if (rows.length === 0) {
    R.error = 'no player rows on the screen at all';
    R.seen = d.body.textContent.slice(0, 240);
    return post();
  }
  // The pressable is the inner control; the card around it is what is drawn and
  // what a player sees, so the card is what gets measured.
  const cards = rows.map((r) => r.parentElement);
  const last = cards[cards.length - 1];
  let list = cards[0];
  while (list && list !== d.body && !(list !== cards[0] && list.contains(last))) list = list.parentElement;
  if (cards.length === 1) list = cards[0].parentElement.parentElement;

  // The seven slots share one parent -- the formation -- and the field is the
  // box drawn around it, turf and all. Walked to rather than named, because a
  // class name here would be react-native-web's, not ours.
  const slots = labelled((l) => / slot\\./.test(l));
  let formation = slots[0];
  while (formation && !slots.every((s) => formation.contains(s))) formation = formation.parentElement;
  const field = formation ? formation.parentElement : null;

  // The pinned bar, from the search field up to whatever is actually pinned.
  let bar = d.querySelector('[aria-label="Search eligible players"]');
  while (bar && w.getComputedStyle(bar).position !== 'absolute') bar = bar.parentElement;

  let scroll = list;
  while (scroll && scroll !== d.body && !(/(auto|scroll)/.test(w.getComputedStyle(scroll).overflowY) && scroll.scrollHeight > scroll.clientHeight)) {
    scroll = scroll.parentElement;
  }
  if (scroll === d.body) scroll = null;

  R.found = {
    rows: cards.length,
    slots: slots.length,
    chips: all('[aria-label^="Filter by"]').length,
    fieldHasTurf: Boolean(field && field.querySelector('svg')),
    barHasChips: Boolean(bar && bar.querySelector('[aria-label^="Filter by"]')),
    listHoldsEveryRow: Boolean(list && list.contains(last)),
    scrolls: Boolean(scroll),
  };

  const barTop = bar ? bar.getBoundingClientRect().top : null;
  const boxes = cards.map(box);
  const whole = boxes
    .map((b, i) => ({ i: i, b: b }))
    .filter((r) => barTop !== null && r.b.top >= 0 && r.b.bottom <= barTop);

  // Everything below is the screen *at rest*: what is on it when the reel
  // stops, before anything has been scrolled or pressed.
  R.atRest = {
    scrollTop: scroll ? round(scroll.scrollTop) : null,
    field: box(field),
    list: box(list),
    bar: box(bar),
    rows: boxes.slice(0, 3),
    whole: whole.length,
    firstWhole: whole.length ? whole[0] : null,
    scrollHeight: scroll ? scroll.scrollHeight : null,
    clientHeight: scroll ? scroll.clientHeight : null,
    // The list is padded to clear the bar. This is the number that does it.
    padBottom: scroll && scroll.firstElementChild
      ? round(parseFloat(w.getComputedStyle(scroll.firstElementChild).paddingBottom) || 0)
      : null,
  };
  step('measured');

  /*
   * And the other end of the same question. The bar is drawn over the list, so
   * the content has to be long enough for the last row to be scrolled clear of
   * it -- a bar that permanently covers the last player is the same fault as a
   * list that starts below the fold, one row further down.
   */
  if (scroll) {
    scroll.scrollTop = scroll.scrollHeight;
    await sleep(400);
    R.end = { scrollTop: round(scroll.scrollTop), lastRow: box(last), bar: box(bar) };
  }

  R.done = true;
  post();
  // The app is torn out before the virtual clock is allowed to run on. Left
  // mounted, every remaining millisecond of the budget is animation frames
  // rendered at full cost for a page nobody is reading.
  f.remove();
})().catch((e) => { R.error = R.error || ('threw: ' + (e && e.message)); post(); });
</script>
`;

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/__fold') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(HARNESS);
    return;
  }
  let path = url.pathname;
  if (BASE && (path === BASE || path.startsWith(`${BASE}/`))) path = path.slice(BASE.length) || '/';
  const file = join(dist, path);
  // A single-page export: every route that is not a file is the app itself.
  const target = existsSync(file) && statSync(file).isFile() ? file : join(dist, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
  res.end(readFileSync(target));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;

const profiles = resolve(import.meta.dirname, '.fold-profile');
rmSync(profiles, { recursive: true, force: true });
mkdirSync(profiles, { recursive: true });
let runs = 0;

/**
 * One measurement, at one viewport height.
 *
 * Asynchronous on purpose, and not because of style: `execFileSync` blocks the
 * event loop, which would stop the very server Chrome is being asked to load
 * the app from. The stdio is still a file descriptor rather than a pipe, so
 * there is nothing left open for a surviving helper process to hold.
 */
async function measure(height) {
  const id = (runs += 1);
  const out = `${profiles}/run-${id}.html`;
  const handle = openSync(out, 'w');
  const args = [
    '--headless',
    '--disable-gpu',
    // A fresh profile costs nothing only if Chrome is told not to treat it as a
    // new installation: first-run setup, component updates and the default
    // browser check are all work whose result is thrown away here.
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-update',
    '--disable-background-networking',
    `--user-data-dir=${profiles}/run-${id}`,
    // Virtual, not wall-clock: the whole season is played out in a few seconds.
    '--virtual-time-budget=60000',
    // Comfortably larger than the tallest frame measured, so the frame is laid
    // out and painted rather than clipped -- and never 393, which Chrome would
    // silently widen to 500.
    '--window-size=900,1000',
    // Everything the page needs is on the loopback server. Anything else -- the
    // webfont the export asks for, most of all -- would hold virtual time open
    // and the run would report nothing at all.
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--dump-dom',
    `http://127.0.0.1:${port}/__fold?w=393&h=${height}&src=${encodeURIComponent(`${BASE}/`)}`,
  ];
  /**
   * The report is the ending, not the exit.
   *
   * Chrome writes the DOM when the virtual budget expires and then, reliably on
   * this machine, sits there forever -- so waiting for it to exit turned a four
   * second measurement into a two minute one, twice, and the only thing that
   * ended the run was the backstop timer. The dump is on disk seconds before
   * that. So the file is watched, and the moment it holds a finished report the
   * browser is killed: nothing is waited for that has already happened.
   */
  const readReport = () => {
    if (!existsSync(out)) return null;
    const title = /<title>(.*?)<\/title>/s.exec(readFileSync(out, 'utf8'))?.[1];
    if (!title) return null;
    try {
      const parsed = JSON.parse(title.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      return parsed.done || parsed.error ? parsed : null;
    } catch {
      // A dump caught halfway through being written. There will be another.
      return null;
    }
  };

  let report = null;
  try {
    await new Promise((done) => {
      const child = spawn(CHROME, args, { stdio: ['ignore', handle, 'ignore'] });
      const watch = setInterval(() => {
        report = readReport();
        if (report) child.kill('SIGKILL');
      }, 200);
      // The backstop, for a run that never reports at all: a browser that has
      // been given every chance and produced nothing is a failure to print, not
      // a reason to sit here.
      const timer = setTimeout(() => child.kill('SIGKILL'), 90_000);
      const finish = () => { clearInterval(watch); clearTimeout(timer); done(); };
      child.on('exit', finish);
      child.on('error', finish);
    });
  } finally {
    closeSync(handle);
  }

  // Once more after the process is gone, in case the dump landed between polls.
  report ??= readReport();
  if (report) return report;
  const title = existsSync(out) ? /<title>(.*?)<\/title>/s.exec(readFileSync(out, 'utf8'))?.[1] : null;
  return { error: `the harness did not report. Title was: ${title ?? '(no page)'}` };
}

let failures = 0;
const check = (what, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n18-0 — PLAYERS ABOVE THE FOLD');
console.log('='.repeat(64));
console.log(`  ${dist}  (served at ${BASE || '/'})`);

/** 852 is a current phone; 620 is `FRAME_HEIGHT.play` in the extension. */
for (const [height, what] of [[852, 'a phone'], [620, "the extension's play frame"]]) {
  console.log(`\nAT 393x${height} — ${what}`);
  const r = await measure(height);

  if (r.error || !r.done) {
    check('the harness played a season and reported', false, r.error ?? `stopped after: ${(r.steps ?? []).join(' · ')}`);
    if (r.seen) console.log(`    page read: ${JSON.stringify(r.seen)}`);
    continue;
  }

  // First, that the thing measured is the thing asked for. Headless Chrome
  // widening a narrow window to 500 is the failure that reads as a passing
  // check, because everything fits on a screen that is not the one being
  // claimed.
  check(
    'the frame is the size it was asked for',
    r.viewport.w === 393 && r.viewport.h === height,
    `${r.viewport.w}x${r.viewport.h}`,
  );
  check('a Scout season is on the screen', r.found.rows > 0 && r.found.slots === 7, `${r.found.rows} rows, ${r.found.slots} slots`);
  check('and it is not the ranked-refused variant', r.notice === false, r.notice ? 'a downgrade notice is on screen' : `ranked ${r.ranked}`);
  check('the boxes measured are the right boxes', r.found.fieldHasTurf && r.found.barHasChips && r.found.listHoldsEveryRow && r.found.scrolls);

  const { field, bar, list, rows, firstWhole } = r.atRest;

  // Nothing has been touched. Every number below is what a player is looking at
  // when the reel stops, not what they would see after a scroll.
  check('nothing has scrolled', r.atRest.scrollTop === 0, `scrollTop ${r.atRest.scrollTop}`);

  check(
    'the field is fully on screen',
    field !== null && field.top >= 0 && field.bottom <= bar.top,
    `field ${field?.top} → ${field?.bottom}, bar top ${bar?.top}`,
  );
  check(
    'the list of players starts on screen, above the bar',
    list !== null && bar !== null && list.top >= 0 && list.top < bar.top,
    `list top ${list?.top}, bar top ${bar?.top}`,
  );
  /*
   * The assertion the whole file is for. A list whose first row is half cut off
   * by the bar tells a player there is something below; a list whose first row
   * is entirely under it tells them nothing at all, which is the state this
   * screen was shipped in.
   */
  check(
    'and a whole player row is on it',
    firstWhole !== null,
    firstWhole
      ? `row ${firstWhole.i + 1}: ${firstWhole.b.top} → ${firstWhole.b.bottom}, clear of the bar at ${bar.top}`
      : `first row ${rows[0]?.top} → ${rows[0]?.bottom}, bar top ${bar?.top}`,
  );
  console.log(`    ${r.atRest.whole} whole row(s) above the fold · rows at ${rows.map((b) => `${b.top}→${b.bottom}`).join(', ')}`);

  // The other half of the same fault: the bar is drawn over the list, so the
  // content must be padded to clear it or the last player is permanently hidden
  // behind the search field.
  check(
    'the list is padded to clear the bar',
    r.atRest.padBottom !== null && bar !== null && r.atRest.padBottom >= bar.h,
    `padding ${r.atRest.padBottom}px, bar ${bar?.h}px tall`,
  );
  check(
    'so the last row can be scrolled clear of it',
    Boolean(r.end) && r.end.lastRow.bottom <= r.end.bar.top,
    r.end ? `last row ends at ${r.end.lastRow.bottom}, bar top ${r.end.bar.top}` : 'never scrolled',
  );
}

server.close();

console.log(`${'='.repeat(64)}`);
console.log(
  failures === 0
    ? 'A player can see a player, on both screens, without scrolling.'
    : `${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
