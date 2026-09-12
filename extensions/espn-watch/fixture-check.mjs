/**
 * Runs `fixture.html` in headless Chrome and checks what the card did.
 *
 *   node extensions/espn-watch/fixture-check.mjs
 *
 * The extension's one real risk is a feedback loop: it inserts a card, the page
 * mutates because of it, and it reacts to its own mutation. That is not visible
 * in a code review and it is not visible in a single screenshot either -- it
 * looks like a card that flickers and cannot be clicked. So the fixture samples
 * the DOM over three seconds and this asserts on what it saw, not on what it
 * ended up with.
 *
 * Headless Chrome rather than jsdom because the row detection is entirely about
 * layout: `getBoundingClientRect` is the whole algorithm, and jsdom returns
 * zeroes for all of it.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
].find((p) => existsSync(p));

if (!CHROME) {
  console.error('No Chrome found. This test needs a real layout engine.');
  process.exit(2);
}

const fixture = resolve(import.meta.dirname, 'fixture.html');
/**
 * A profile per run, rather than one shared between them.
 *
 * Chrome does not always exit under `--virtual-time-budget` -- which the
 * timeout below already treats as a normal ending -- and a process still
 * holding the profile makes the *next* launch exit 21 with nothing on stdout.
 * That reads as "the extension is broken" and is a lock, and it has cost more
 * time in this repo than any real failure the harness has ever found. A
 * directory per run cannot be contended.
 */
const profiles = resolve(import.meta.dirname, '.fixture-profile');
mkdirSync(profiles, { recursive: true });
let runs = 0;

/**
 * Chrome prints the DOM and then, with `--virtual-time-budget`, does not always
 * exit. That is not a failure -- the output we want has already been written --
 * so the timeout is treated as a normal ending and the partial output is used.
 * Waiting for a clean exit meant a check that hung instead of reporting.
 *
 * **The DOM goes to a file, not down a pipe**, and that is the whole reason
 * this stopped hanging. `execFileSync`'s timeout kills the process it started;
 * it does not close a pipe a surviving *helper* process still holds open, and
 * Chrome always has several. So the timeout fired, Chrome went away, and the
 * call sat on a pipe nobody would ever write to again -- a run that produced no
 * output and never returned, which is worse than either a pass or a fail. A
 * file is written by whoever is still alive and read after they are all gone.
 */
function dumpDom(query = '', extra = [], url = null) {
  const args = [
    '--headless',
    '--disable-gpu',
    // A fresh profile per run costs nothing only if Chrome is told not to treat
    // it as a new installation: first-run setup, component updates and default
    // browser checks are all work whose result is thrown away here.
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-update',
    '--disable-background-networking',
    `--user-data-dir=${profiles}/run-${(runs += 1)}`,
    '--virtual-time-budget=9000',
    '--window-size=1280,900',
    /*
     * **The fixture is offline, and must be unable to wait.**
     *
     * It opens the panel, and the panel's frame points at the real embed.
     * Virtual time pauses while a fetch is outstanding, so on a machine where
     * that request hangs rather than refuses, the page never goes idle, the
     * report is never written and the harness times out with nothing on stdout
     * -- a test that hangs instead of failing. Refusing to resolve any host at
     * all makes the frame fail immediately and states what the fixture is:
     * every file it needs sits beside it.
     */
    '--host-resolver-rules=MAP * ~NOTFOUND',
    ...extra,
    '--dump-dom',
    url ?? `file://${fixture}${query}`,
  ];
  const out = `${profiles}/run-${runs}.html`;
  let handle;
  try {
    handle = openSync(out, 'w');
    execFileSync(CHROME, args, {
      stdio: ['ignore', handle, 'ignore'],
      timeout: 60_000,
      killSignal: 'SIGKILL',
    });
  } catch {
    // Killed on the timeout, or exited non-zero having already written. Both
    // are read the same way: whatever reached the file is the answer.
  } finally {
    if (handle !== undefined) closeSync(handle);
  }
  return existsSync(out) ? readFileSync(out, 'utf8') : '';
}

/**
 * The popup, run as a page, with the extension API stubbed.
 *
 * Built from `popup.html` itself rather than from a copy, because a copy of the
 * markup is a copy that stops matching the thing it is standing in for. The
 * stub counts what the popup asks the page for, which is the whole point: the
 * popup used to ask for the row list the moment it opened, and answering means
 * measuring every rail on a watch page. Opening the menu to flip one switch
 * paid for a page scan nobody asked for, and on a page that was busy the menu
 * took *minutes*.
 */
function popupReport() {
  const dir = import.meta.dirname;
  const stub = `
<base href="file://${dir}/">
<script>
window.__asked = [];
window.__err = [];
addEventListener('error', (e) => window.__err.push(e.message));
addEventListener('unhandledrejection', (e) => window.__err.push(String(e.reason)));
const later = (v) => new Promise((r) => setTimeout(() => r(v), 0));
window.chrome = {
  storage: {
    local: {
      get: (d, cb) => { const v = { ...d }; if (cb) { setTimeout(() => cb(v), 0); return; } return later(v); },
      set: (_v, cb) => { if (cb) { setTimeout(cb, 0); return; } return later(); },
      remove: (_k, cb) => { if (cb) { setTimeout(cb, 0); return; } return later(); },
    },
    onChanged: { addListener: () => {} },
  },
  runtime: { id: 'fx', getURL: (p) => p, openOptionsPage: () => {} },
  tabs: {
    query: () => later([{ id: 1 }]),
    sendMessage: (_id, m) => { window.__asked.push(m.type); return later({ rows: ['Live now', 'Just for you'], stats: null }); },
  },
};
setTimeout(() => {
  const row = document.getElementById('row');
  const before = { asked: [...window.__asked], options: row.options.length, note: document.getElementById('rowNote').textContent };
  // What a person does: the pointer arrives, then the list opens.
  row.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
  setTimeout(() => {
    document.title = JSON.stringify({
      before,
      after: {
        asked: [...window.__asked],
        options: row.options.length,
        note: document.getElementById('rowNote').textContent,
        gapOptions: document.getElementById('gap').options.length,
      },
      errors: window.__err,
      drawn: { enabled: document.getElementById('enabled').checked, pick: !document.getElementById('pickRow').disabled },
    });
  }, 600);
}, 900);
</script>
`;
  const out = `${profiles}/popup-fixture.html`;
  writeFileSync(out, readFileSync(resolve(dir, 'popup.html'), 'utf8').replace('<script src="config.js">', stub + '<script src="config.js">'));
  const dom = dumpDom('', [], `file://${out}`);
  const title = dom.match(/<title>(.*?)<\/title>/s)?.[1];
  try {
    return JSON.parse(title.replace(/&quot;/g, '"'));
  } catch {
    console.error('The popup fixture did not report. Title was:', title);
    return null;
  }
}

function run(query = '', extra = []) {
  const dom = dumpDom(query, extra);
  const title = dom.match(/<title>(.*?)<\/title>/s)?.[1];
  try {
    return JSON.parse(title.replace(/&quot;/g, '"'));
  } catch {
    console.error(`The fixture did not report for "${query || 'the default'}". Title was:`, title);
    process.exit(1);
  }
}

const report = run();

/** The order the fixture reports the four slots in. */
const EZ_ORDER = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

/**
 * The shipped defaults, read out of `config.js` rather than restated here.
 * A check that hardcodes what it is checking is a check that agrees with
 * itself.
 */
const CONFIG = (() => {
  const scope = {};
  new Function('globalThis', readFileSync(resolve(import.meta.dirname, 'config.js'), 'utf8')).call(scope, scope);
  return scope;
})();

let failures = 0;
const check = (what, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

/**
 * The four corners, as what landed in each and where it actually is.
 *
 * The quadrant is the assertion that matters. A named cell is only worth having
 * if switching one slot off leaves the others where they were, and the way that
 * breaks -- auto-placement sliding the next slot into the empty cell -- leaves
 * every class name exactly as it was. So this measures.
 */
function checkCorners(where, slots) {
  const want = [
    ['top left', 'ez-slot-logo', false, false],
    ['top right', 'ez-slot-image', true, false],
    ['bottom left', 'ez-slot-pill', false, true],
  ];
  for (const [corner, type, right, bottom] of want) {
    const got = slots?.[want.findIndex((w) => w[0] === corner)];
    check(
      `${where}: the ${corner} corner holds its ${type.replace('ez-slot-', '')}`,
      got?.type === type && got.right === right && got.bottom === bottom,
      got ? `${got.type} at ${got.bottom ? 'bottom' : 'top'} ${got.right ? 'right' : 'left'}` : 'nothing there',
    );
  }
  // The bottom-right corner is the sponsor, and there is no sponsor by default.
  // An empty corner is left out rather than laid out: a box with nothing in it
  // still claims a row's height and pushes the pill off the artwork.
  check(`${where}: and leaves the unsponsored corner out`, slots?.[3] === null);
}

/**
 * The same four slots in the strip, where a quadrant means nothing.
 *
 * The band is one row, so "bottom left" is not below anything -- it is second
 * along. The invariant a named cell buys is unchanged and is what is asserted
 * here: the slots appear in the order they were configured, so switching one
 * off cannot slide its neighbour into a place nobody chose. Checking the
 * quadrant here was checking the tile's geometry against the band's, which is
 * how it came back saying the pill was in the top left -- true, and not the
 * question.
 */
function checkStrip(slots, ends) {
  const drawn = slots.filter(Boolean);
  check('band: it draws two ends, not four corners', drawn.length === 2, `${drawn.length} drawn`);
  // Both ends have to *draw* on a fresh install. The sponsor corner renders
  // nothing until a sponsor is set, and an end that is empty by default is a
  // band with one end -- a logo with a paragraph after it.
  const left = slots[EZ_ORDER.indexOf(ends.left)];
  const right = slots[EZ_ORDER.indexOf(ends.right)];
  check(`band: the left end is ${ends.left}`, Boolean(left), left?.type ?? 'nothing');
  check(`band: the right end is ${ends.right}`, Boolean(right), right?.type ?? 'nothing');
  check(
    'band: and the left one is actually on the left',
    Boolean(left) && Boolean(right) && left.x < right.x,
    `${left?.x} < ${right?.x}`,
  );
}

console.log('\n18-0 ON WATCH — THE CARD IN A ROW');
console.log('='.repeat(56));

check('exactly one card ends up on the page', report.cards === 1, `${report.cards}`);
check('and there was never more than one', report.maxCards === 1, `peaked at ${report.maxCards}`);
// The flicker, stated as the thing it actually was: the card living in more
// than one row over the life of the page.
check(
  'it stayed in a single row the whole time',
  report.distinctParents === 1,
  `${report.distinctParents} row(s) held it`,
);
// The flicker, measured as the thing it actually was. A card bouncing between
// two rows visits only two parents, so counting parents alone would miss it --
// what it does a lot of is *move*.
check('and never moved once placed', report.moves === 0, `${report.moves} move(s)`);
check('it landed in the first row', report.inFirstRow === true);
// Four rails on the fixture page. Anything more means the detector is counting
// tiles -- which it did on the real page, offering a picker 301 "rows" of
// programme titles.
// Three rails exist when the script first runs; two more arrive later.
check('it found rails, not tiles', report.rowsFound === 3, `${report.rowsFound} row(s)`);
check('its button is present', report.clickable === true);
// Placed, but placed where somebody can reach it: the first slot of a real
// carousel is clipped by the shelf's edge.
check('it sits fully on screen', report.onScreenX >= 0, `x=${report.onScreenX}`);
// These rails centre their children, and our card is shorter than a tile with
// three lines of caption -- so it was being centred and its artwork sat fifteen
// pixels below every other thumbnail in the row.
check(
  'its artwork lines up with the row',
  report.artTopDelta !== null && Math.abs(report.artTopDelta) <= 1,
  report.artTopDelta === null ? 'nothing to measure' : `${report.artTopDelta}px off`,
);
// A tile that does not move while its neighbours lift is the tell that it was
// put there by something else. Both of these are read out of the page's own
// stylesheets rather than chosen, so this asserts the fixture's values exactly.
check(
  'it moves on the row\'s clock',
  report.motion === '0.14s cubic-bezier(0.2, 0.8, 0.2, 1)',
  `--ez-motion: ${report.motion || 'unset'}`,
);
check(
  'and lifts the way the row lifts',
  report.lift === 'scale(1.07)',
  `--ez-lift: ${report.lift || 'unset'}`,
);
check('no band was placed', report.bands === 0, `${report.bands}`);

// The headline is the tile's one drop -- see the `image` renderer -- so the
// top-right corner here is the image on its own.
checkCorners('tile', report.slots);

/*
 * The logo, and the shine.
 *
 * The treatment is CSS, so what is worth asserting is the two things that go
 * silently wrong. A gloss with no mask is a rectangle of light over a
 * transparent PNG -- a pane of glass in front of the card rather than light on
 * the mark -- and it looks deliberate enough that nobody files it. An asset the
 * size it is drawn at looks correct on the machine it was built on and soft on
 * every retina screen.
 */
console.log('\nTHE LOGO');
{
  const logo = report.tileLogo;
  check('the tile carries a logo', Boolean(logo), logo ? logo.src : 'none');
  check('it defaults to the crest that ships here', logo?.src === 'icons/crest.png', `${logo?.src}`);
  check(
    'the artwork is bigger than the slot, so it is crisp at 2x',
    Boolean(logo) && logo.natural >= logo.width * 2,
    `${logo?.natural}px asset in a ${logo?.width}px slot`,
  );
  check('the shine is masked with the logo itself', logo?.masked === true);
  check('and lights it rather than covering it', logo?.blend === 'screen', `mix-blend-mode: ${logo?.blend}`);
  check('the mark is lifted off the artwork', logo?.lifted === true, 'drop-shadow on the slot');
  check('and tilted above it', logo?.tilted === true, 'a transform on the slot');
  // It used to replace the wordmark, because there was one corner and two
  // things wanting it. There are four corners now and the two marks are two of
  // them -- the wordmark top left, the crest top right -- so what is checked is
  // that both are drawn, which is the arrangement that was asked for.
  check('and the wordmark keeps its own corner', logo?.wordmark === true);
}

/*
 * Reduce Motion, driven for real rather than read.
 *
 * The requirement is the awkward half of the preference: the shine has to
 * *settle*, not vanish. A media query that turns the whole treatment off is the
 * easy thing to write and it leaves somebody who asked for less movement
 * looking at a flat sticker, so what is asserted is that the movement is gone
 * and the light is still there.
 */
const still = run('', ['--force-prefers-reduced-motion']);

console.log('\nWITH REDUCE MOTION');
check('the logo is still drawn', Boolean(still.tileLogo));
check('the tilt is gone', still.tileLogo?.tilted === false, `transform ${still.tileLogo?.tilted ? 'still applied' : 'none'}`);
check('the highlight is not', still.tileLogo?.sweeping === true, 'the gloss still has its gradient');
check('and it is still lit and shadowed', still.tileLogo?.lifted === true);
check('the card is still placed once and left alone', still.cards === 1 && still.moves === 0);

console.log('\nTHE CALL TO ACTION');
{
  const cta = report.tileCta;
  check('the tile carries one', Boolean(cta), cta ? `"${cta.text}"` : 'none');
  check('it points at the configured link', cta?.href === 'https://18-0.co/', `${cta?.href}`);
  check('it opens in a new tab', cta?.target === '_blank');
  // Without `noopener` the page it opens gets a handle on the ESPN tab it came
  // from; `noreferrer` because that site has no business knowing which page it
  // was clicked on.
  check(
    'with noopener and noreferrer',
    Boolean(cta) && cta.rel.includes('noopener') && cta.rel.includes('noreferrer'),
    `rel="${cta?.rel}"`,
  );
  // The tile's play action is a `<button>` covering the whole artwork. A link
  // inside it would open the panel *and* follow the link on the same click.
  check('and it is outside the play button, not inside it', cta?.insideButton === false);
}

/*
 * The sponsor token, checked directly because it is pure and because its whole
 * job is what happens when there is *no* sponsor: leaving "Presented by" with
 * nothing after it, or a dangling separator, is worse than having no line.
 */
/*
 * A reloaded extension leaves its old content script in every open page with a
 * `chrome` object whose context is gone. Everything through it throws -- and
 * `openPanel` used to record the open *before* building the panel, so the card
 * stayed on the page, the click still fired, and nothing happened.
 *
 * **Worth knowing what this does and does not fail on.** Moving `countOpen()`
 * back to the top of `openPanel` no longer breaks it, because `store` now
 * refuses to touch a dead context at all -- put the ordering back *and* take
 * that guard away, which is the code as it stood when the bug existed, and the
 * panel check goes red. The ordering is belt to the guard's braces, and this
 * asserts the behaviour rather than either mechanism, so it stays honest if one
 * of them is ever removed on purpose.
 *
 * What it fails on today is the newer version of the same mistake: a slot's
 * bundled image is resolved with `chrome.runtime.getURL`, which a reloaded
 * extension does not have. Unguarded, that throws inside `buildCard` and all
 * three of these go red together -- no card, no control, no panel.
 */
console.log('\nWITH THE EXTENSION CONTEXT GONE');
{
  const deadDom = dumpDom('?dead=1');
  const deadTitle = deadDom.match(/<title>(.*?)<\/title>/s)?.[1];
  let dead;
  try {
    dead = JSON.parse(deadTitle.replace(/&quot;/g, '"'));
  } catch {
    dead = null;
  }
  // Placement must not depend on artwork. A bundled slot image is resolved with
  // `chrome.runtime.getURL`, which is exactly what a reloaded extension no
  // longer has -- so an unguarded call there throws inside `buildCard` and the
  // card never reaches the row at all.
  check('the card is still placed', dead?.cards === 1, `${dead?.cards}`);
  // Reported separately from the panel so a probe whose selector has gone stale
  // fails here rather than quietly asserting nothing about the panel.
  check('its control is still there', dead?.deadControl === true);
  check('and clicking it still opens the panel', dead?.deadPanel === true);
}

console.log('\nSPONSOR COPY');
{
  const src = readFileSync(resolve(import.meta.dirname, 'config.js'), 'utf8');
  const scope = {};
  new Function('globalThis', `${src}`).call(scope, scope);
  const { ezFill, ezUrl, ezNumber, ezSettings, EZ_DEFAULTS } = scope;

  const cases = [
    ['Presented by {sponsor}', 'A Brand', 'Presented by A Brand'],
    ['Presented by {sponsor}', '', ''],
    ['Seven spins · {sponsor}', '', 'Seven spins'],
    ['{sponsor} · Seven spins', '', 'Seven spins'],
    // The trailing comma goes too: a dangling separator is the thing this is
    // for, not something to preserve.
    ['18-0, with {sponsor}', '', '18-0'],
    ['Play a season', '', 'Play a season'],
    ['{sponsor}', 'Brand', 'Brand'],
  ];
  for (const [input, sponsor, want] of cases) {
    const got = ezFill(input, sponsor);
    check(
      `"${input}" + ${sponsor ? `"${sponsor}"` : 'no sponsor'}`,
      got === want,
      `got "${got}"`,
    );
  }

  // Every default must survive having no sponsor, which is the shipping state.
  const empty = Object.entries(EZ_DEFAULTS.copy)
    .filter(([key]) => key !== 'sponsorLine')
    .filter(([, text]) => !ezFill(text, '').trim());
  check('every default reads with no sponsor set', empty.length === 0, empty.map(([k]) => k).join(', '));

  /*
   * `placement` was one setting meaning "tile or band"; it is now two flags and
   * two positions. An install that stored `header` must still come back as a
   * band in the gap it chose, or the rename reads as the extension forgetting.
   */
  const migrated = ezSettings({ placement: 'header', row: 'Live now' });
  check('a stored `header` still means a band', migrated.placeBand === true && migrated.placeTile === false);
  check('and its row is read as a gap', migrated.gap === 'Live now' && migrated.row === null, `gap=${migrated.gap}`);
  const tile = ezSettings({ placement: 'tile', row: 'Live now' });
  check('a stored `tile` still means a tile', tile.placeTile === true && tile.placeBand === false);
  check('and its row is still a row', tile.row === 'Live now' && tile.gap === null, `row=${tile.row}`);
  // Retired rather than deleted: the popup writes `placement: null` the first
  // time it is touched, and from then on the flags are the only truth.
  const retired = ezSettings({ placement: null, placeTile: false, placeBand: true });
  check('a retired `placement` does not override the flags', retired.placeTile === false && retired.placeBand === true);

  /*
   * The URLs, which are typed into a field and then become an `href`, a `src`
   * and a CSS `url()`.
   *
   * `javascript:` in the call to action is the hole: an href on espn.com built
   * from a value we did not write. It is refused by parsing rather than by
   * pattern, because a blocklist is a list somebody adds `vbscript:` to later.
   */
  console.log('\nURLS');
  for (const hostile of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)  ',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox',
    'chrome-extension://abc/x.png',
    'not a url',
    '',
    '   ',
  ]) {
    check(`refused: ${JSON.stringify(hostile)}`, ezUrl(hostile) === null, `got ${JSON.stringify(ezUrl(hostile))}`);
  }
  check('an https link survives', ezUrl('https://18-0.co/x?a=1')?.href === 'https://18-0.co/x?a=1');
  check('an http link survives', ezUrl(' http://example.test/ ')?.href === 'http://example.test/');
  // The logo's shine is a CSS mask built as `url("…")` around this value, so the
  // quote that would close it early has to be gone before it gets there.
  check(
    'a quote in a URL cannot close a CSS url()',
    !ezUrl('https://18-0.co/a") ;background:red;x:("').href.includes('"'),
    ezUrl('https://18-0.co/a") ;background:red;x:("').href,
  );
  check('the shipped call to action is a real link', ezUrl(EZ_DEFAULTS.copy.ctaUrl)?.kind === 'remote');
  // An emptied number field is not a zero: a zero-width logo is invisible and
  // reads as the image having failed to load.
  check('an emptied number field falls back', ezNumber('', 24, 240, 76) === 76);
  check('and a silly one is clamped', ezNumber('9000', 24, 240, 76) === 240 && ezNumber('1', 24, 240, 76) === 24);

  /*
   * `sponsorBanner` and `tileBadge` were the two settings the slot model
   * absorbed: "draw the sponsor line" is the bottom-right slot's own `show`,
   * and the corner badge was the top-right corner's line of type. Both have to
   * keep meaning what they meant, or the model reads as the extension losing
   * somebody's configuration.
   */
  const quiet = ezSettings({ sponsorBanner: false });
  check('a stored `sponsorBanner: false` hides the sponsor slot', quiet.slots.bottomRight.show === false);
  const loud = ezSettings({ sponsorBanner: false, slots: { bottomRight: { show: true } } });
  check('and a stored slot is the newer answer', loud.slots.bottomRight.show === true);
  const badged = ezSettings({ copy: { tileBadge: 'Live' } });
  check('a stored `tileBadge` becomes the headline', badged.copy.tileHeadline === 'Live', badged.copy.tileHeadline);

  // A slot written with one key touched must not arrive without a type.
  const partial = ezSettings({ slots: { topLeft: { show: false } } });
  check('a half-written slot keeps its type', partial.slots.topLeft.type === 'logoImage' && partial.slots.topLeft.show === false);
  // Positions are fixed. A fifth name is a corner nothing lays out.
  const extra = ezSettings({ slots: { middle: { type: 'pill', show: true } } });
  check('and an unknown corner is dropped', !('middle' in extra.slots));
}

/*
 * The one thing between a typed string and a `src` or an `href`.
 *
 * Checked as a table because it is pure and because the interesting cases are
 * all the ones somebody would not think to try: a scheme that is not a scheme
 * until it is, an authority-relative URL that looks like a path, and a bundled
 * path that climbs out of the folder.
 */
console.log('\nCONFIGURED URLS');
{
  const src = readFileSync(resolve(import.meta.dirname, 'config.js'), 'utf8');
  const scope = {};
  new Function('globalThis', `${src}`).call(scope, scope);
  const { ezUrl } = scope;

  const allowed = [
    ['https://example.com/logo.png', 'remote'],
    ['http://example.com/logo.png', 'remote'],
    ['  https://example.com/logo.png  ', 'remote'],
    ['icons/crest.png', 'bundled'],
  ];
  for (const [input, kind] of allowed) {
    check(`"${input.trim()}" is a ${kind} image`, ezUrl(input)?.kind === kind, `${ezUrl(input)?.kind}`);
  }

  const refused = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:image/svg+xml,<svg onload=alert(1)>',
    // No scheme, and still not ours: this is `//host/path`, which inherits the
    // page's scheme and fetches from somebody else entirely.
    '//evil.example/logo.png',
    '/absolute/path.png',
    '../../manifest.json',
    'icons/../../manifest.json',
  ];
  for (const input of refused) {
    check(`"${input}" is refused`, ezUrl(input) === null, `${JSON.stringify(ezUrl(input))}`);
  }
}

console.log(`  · card ${report.heights.card}px (min-height ${report.heights.minH}), anchor tile ${report.heights.anchorTile}px, tallest ${report.heights.tallestTile}px, top delta ${report.cardTopDelta}px`);

// The other placement, driven through the same fixture.
const band = run('?tile=0&band=1');

console.log('\nAS AN INLINE HEADER');
check('exactly one band', band.bands === 1, `${band.bands}`);
check('and there was never more than one', band.maxBands === 1, `peaked at ${band.maxBands}`);
check('it is a band, not a tile', band.isBand === true && band.cards === 0);
check('it never moved once placed', band.bandMoves === 0, `${band.bandMoves} move(s)`);
check('its button is present', band.bandClickable === true);
// The same four, built from the same model and laid out on a different grid.
// If the two ever stop agreeing, this is where it shows.
checkStrip(band.slots, CONFIG.EZ_DEFAULTS.bandSlots);
// The whole point of the placement: it sits in the gap above the row, not
// inside it and not below the rail it is introducing.
check('it sits above the first row', band.aboveFirstRow === true);
/*
 * **The gap is between two shelves, not inside one.**
 *
 * `shelfOf` used to answer with the first ancestor containing any heading, and
 * on the real page that is the carousel — which holds ten headings, all of them
 * programme titles. The band was inserted inside it, between the section label
 * and the rail that label introduces. It still "precedes the first rail", which
 * is why the old check passed on a band in entirely the wrong place, so these
 * three ask where it actually is.
 */
check('it is a sibling of the shelves, not a child of one', band.bandParentIsPage === true);
check('it is outside the shelf it sits above', band.bandInsideShelf === false);
check('and above that shelf\'s own label', band.bandAboveLabel === true);
check(
  'it lines up with the section heading',
  band.bandLeftDelta !== null && Math.abs(band.bandLeftDelta) <= 1,
  band.bandLeftDelta === null ? 'nothing to measure' : `${band.bandLeftDelta}px off`,
);
// The mark, whatever it turned out to be: a configured image, or the wordmark
// the logo slot draws when no file is set. The band shows two ends and the
// crest is not one of them by default, so asking for an `<img>` here was asking
// for a corner the strip no longer has.
check('its left end carries the mark', band.slots?.[0]?.type === 'ez-slot-logo', `${band.slots?.[0]?.type}`);
// A strip between two rows: every line it grows is a line of somebody else's
// page it pushes down. The call to action shares the subtitle's line for the
// same reason the tile's does -- a line of its own cost the band a third of its
// height, which on a page of shelves is a band that has stopped being a strip.
check('it stays a strip', band.bandHeight !== null && band.bandHeight <= 120, `${band.bandHeight}px tall`);
// All four corners on one line. Two rows of them is what made it a panel.
check(
  'and nothing in it sits on anything else',
  Array.isArray(band.bandOverlaps) && band.bandOverlaps.length === 0,
  band.bandOverlaps?.length ? band.bandOverlaps.join(', ') : 'nothing overlaps',
);
// It is absolutely positioned, and a `position` set on every child of the band
// silently overrode it -- eighteen marks adrift in the middle of the strip.
check(
  'the eighteen marks run along its bottom edge',
  band.bandLadder !== null && band.bandLadder.wide <= 24 && band.bandLadder.fromBottom <= 14,
  band.bandLadder ? `${band.bandLadder.wide}px narrower, ${band.bandLadder.fromBottom}px up` : 'no ladder',
);
// Each end is a stack -- a thing and a line about it -- so they are centred on
// each other rather than sharing a top edge. What must stay true is that the
// band is one line of *ends*: two of them, level, not stacked down the strip.
check(
  'its two ends are level with each other',
  band.bandRows !== null && band.bandRows.n === 2 && band.bandRows.spread <= 24,
  `${band.bandRows?.n} end(s), ${band.bandRows?.spread}px apart vertically`,
);

// The whole band is the target, not a pill in the corner of it.
{
  const h = band.bandHit;
  check('the band is one control', h?.buttons === 1, `${h?.buttons} button(s)`);
  check('and the control is the whole band', h?.covers === true, `${h?.size?.[0]}x${h?.size?.[1]} in ${h?.size?.[2]}x${h?.size?.[3]}`);
  const missed = Object.entries(h?.points ?? {}).filter(([, ok]) => !ok).map(([k]) => k);
  check('a click anywhere on it lands on that control', missed.length === 0, missed.length ? `missed: ${missed.join(', ')}` : 'every point');
  // The exception, and the reason the pill stopped being a button: two controls
  // stacked on one another fire twice on a single click.
  check('except the call to action, which is its own link', h?.onTheLink !== false, `${h?.onTheLink}`);
  check('and that link is not inside the button', h?.ctaInsideButton === false);
}
// A link beside the button rather than a second button: two pills side by side
// is two primary actions and a choice nobody asked to make.
check(
  'and a call to action that is a link, not a second button',
  Boolean(band.bandCta) && band.bandCta.target === '_blank' && band.bandCta.rel.includes('noopener'),
  band.bandCta ? `${band.bandCta.href} rel="${band.bandCta.rel}"` : 'none',
);

/*
 * Both at once, which is what the placements being independent is for.
 *
 * The thing worth checking is not that two elements exist — it is that neither
 * disturbed the other. They are resolved separately and remembered separately,
 * and the failure mode of getting that wrong is the tile being torn out and
 * rebuilt every time the band is re-placed, which is the flicker again.
 */
const both = run('?tile=1&band=1');

console.log('\nBOTH AT ONCE');
check('one tile and one band', both.cards === 1 && both.bands === 1, `${both.cards} tile(s), ${both.bands} band(s)`);
check('and never more than one of either', both.maxCards === 1 && both.maxBands === 1);
check('neither contains the other', both.tangled === false);
check('the tile never moved', both.moves === 0, `${both.moves} move(s)`);
check('the band never moved', both.bandMoves === 0, `${both.bandMoves} move(s)`);
check('the tile is still in the first row', both.inFirstRow === true);
check('the band is still in the gap above it', both.bandParentIsPage === true && both.bandInsideShelf === false);
check(
  'and the tile still lines up with the row',
  both.artTopDelta !== null && Math.abs(both.artTopDelta) <= 1,
  both.artTopDelta === null ? 'nothing to measure' : `${both.artTopDelta}px off`,
);

/*
 * The panel, and the two views it can hold.
 *
 * The board is a view on `/embed` rather than a second path, because `/embed`
 * is the only path on the site that may be framed -- `vercel.json` scopes
 * `frame-ancestors` to it. So what is checked is the exact URL: a board that
 * quietly moved to `/leaderboard` would open a panel that refuses to render
 * and there would be nothing in the extension to point at.
 *
 * The heights are the other half of the contract. `board` has to be in the
 * table or the frame's own message about which screen it is on is dropped by
 * the listener, and the panel stays whatever height it was.
 */
const panel = run('?panel=1');

console.log('\nTHE PANEL, AND THE BOARD');
check('the frame table names the board', panel.frameHeights?.board === 520, `board: ${panel.frameHeights?.board}`);
check(
  'and still names the game\'s own screens',
  panel.frameHeights?.entry === 232 && panel.frameHeights?.play === 620 && panel.frameHeights?.result === 760,
);
check('the header offers both views', JSON.stringify(panel.panel?.tabs) === '["Play","Leaderboard"]', JSON.stringify(panel.panel?.tabs));
check(
  'opening on the board loads the board',
  panel.panel?.openedOn === 'https://18-0.co/embed?view=board',
  `${panel.panel?.openedOn}`,
);
check('sized for it before the frame reports', panel.panel?.openedHeight === '520px', `${panel.panel?.openedHeight}`);
check('and the board is the selected view', panel.panel?.selected === 'Leaderboard');
check(
  'switching to Play changes the frame\'s src',
  panel.panel?.switchedOn === 'https://18-0.co/embed',
  `${panel.panel?.switchedOn}`,
);
check('and its height with it', panel.panel?.switchedHeight === '232px', `${panel.panel?.switchedHeight}`);
check('and moves the selection', panel.panel?.switchedSelected === 'Play');
check(
  'the panel carries the call to action too',
  Boolean(panel.panel?.cta) && panel.panel.cta.rel.includes('noopener'),
  panel.panel?.cta ? `${panel.panel.cta.href} rel="${panel.panel.cta.rel}"` : 'none',
);
// The frame going to the board on its own -- which is what the result screen's
// link does -- must move the header with it.
check(
  'the header follows the frame when it navigates itself',
  panel.panel?.afterSelfNav?.selected === 'Leaderboard',
  `${panel.panel?.afterSelfNav?.selected}`,
);
check(
  'and says so to a screen reader',
  JSON.stringify(panel.panel?.afterSelfNav?.aria) === '["false","true"]',
  JSON.stringify(panel.panel?.afterSelfNav?.aria),
);
// The highlight, and only the highlight. A framed page that could navigate the
// panel could put it somewhere nobody chose.
// The origin guard, exercised rather than assumed: any page may post to a
// window, and a message shaped like the frame's from anywhere else is exactly
// what that check is for.
check(
  'and a stranger saying the same thing is ignored',
  panel.panel?.afterStranger === 'Play',
  `${panel.panel?.afterStranger}`,
);
check(
  'without the message being able to navigate it',
  panel.panel?.afterSelfNav?.srcNow === panel.panel?.afterSelfNav?.src,
  `${panel.panel?.afterSelfNav?.srcNow}`,
);

// Opening it must not have disturbed the card underneath.
check('and the tile underneath never moved', panel.moves === 0 && panel.cards === 1, `${panel.moves} move(s), ${panel.cards} tile(s)`);

// The page taking one of ours over, and what happens next. `?steal=1` empties
// the band and moves the shelf into it, which is what React hydration did on
// espn.com.
const stolen = run('?band=1&tile=0&steal=1');
console.log('\nWHEN THE PAGE CLAIMS THE BAND');
check('the theft happened', stolen.steal?.ran === true);
// The one that matters most. Our node now holds espn.com's row, so `remove()`
// would take the Featured carousel off the page to fix our own layout bug.
check('espn.com keeps its row', stolen.steal?.shelfAlive >= 1, `${stolen.steal?.shelfAlive} shelf/shelves`);
check('the claimed node is left where it is', stolen.steal?.stillInPage === true);
check('and we stop claiming it', stolen.steal?.disowned === true);
check('there is a band again', stolen.steal?.bands === 1, `${stolen.steal?.bands}`);
check('with its own content in it', stolen.steal?.bandHasCopy === true);
check('and no shelf inside it', stolen.steal?.bandHoldsShelf === 0, `${stolen.steal?.bandHoldsShelf}`);

  /*
 * One slot switched off.
 *
 * This is the whole reason the corners name their own cells. With all four on,
 * auto-placement and named cells agree and neither can be told from the other --
 * switch one off and auto-placement slides the next one up, so the call to
 * action moves to the top right of a card nobody configured that way.
 */
const hidden = run('?off=topRight');

console.log('\nWITH A SLOT SWITCHED OFF');
check('the corner it was in is empty', hidden.slots?.[1] === null, JSON.stringify(hidden.slots?.[1]));
check(
  'and the others did not move up into it',
  hidden.slots?.[0]?.type === 'ez-slot-logo' && hidden.slots[0].right === false && hidden.slots[0].bottom === false
    && hidden.slots?.[2]?.type === 'ez-slot-pill' && hidden.slots[2].right === false && hidden.slots[2].bottom === true,
  JSON.stringify(hidden.slots),
);

// The menu, and what it costs to open it.
const popup = popupReport();
console.log('\nOPENING THE MENU');
if (!popup) {
  check('the popup reported', false);
} else {
  check('it draws without asking the page anything', popup.before.asked.length === 0, JSON.stringify(popup.before.asked));
  check('and says so rather than pretending to be loading', popup.before.note === 'Open to read the page', `"${popup.before.note}"`);
  check('the switches are already drawn', popup.drawn.enabled === true);
  // The one that does not need the list must not wait for it.
  check('and "pick a row" works before the page is read', popup.drawn.pick === true);
  check('the stored choice is the option it shows', popup.before.options === 1, `${popup.before.options} option(s)`);

  check('reaching for the picker is what asks', popup.after.asked.includes('rows'), JSON.stringify(popup.after.asked));
  check('and it asks once', popup.after.asked.filter((t) => t === 'rows').length === 1);
  check('the rows arrive', popup.after.options > 1, `${popup.after.options} option(s)`);
  // Both pickers share the one answer; a second request for the same rows is a
  // second page scan.
  check('and the other picker is filled from the same answer', popup.after.gapOptions > 1, `${popup.after.gapOptions} option(s)`);
  check('the note says what it found', /row/.test(popup.after.note), `"${popup.after.note}"`);
  check('and nothing threw', popup.errors.length === 0, JSON.stringify(popup.errors));
}

// The retired setting, driven end to end: storage holding `header` and nothing
// else must still put a band on the page.
const legacy = run('?placement=header');
console.log('\nA STORED `PLACEMENT`');
check('`header` still places a band and no tile', legacy.bands === 1 && legacy.cards === 0, `${legacy.bands} band(s), ${legacy.cards} tile(s)`);

console.log('='.repeat(56));
console.log(failures === 0 ? 'Both placements go in once and stay.' : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
