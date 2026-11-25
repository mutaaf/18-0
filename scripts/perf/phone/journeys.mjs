/**
 * Counts what the core journeys cost a player, in taps, on a phone-sized web
 * export -- the usability tables in docs/performance.md ("Usability") come
 * from here.
 *
 *   cd apps/mobile && EXPO_BASE_URL=/18-0 npx expo export -p web --output-dir ../../dist && cd ../..
 *   node scripts/perf/phone/journeys.mjs [dist] [--shots <dir>]
 *
 * Each journey is played the way a person would, from a fresh install, with
 * every tap counted and every scroll needed to reach the next control counted
 * separately. What it reports is not timing (web.mjs does that) but the shape
 * of the path: how many presses, how many scrolls, and the dead ends -- a
 * screen whose next action is not on the glass, or a button whose label does
 * not say what it will do.
 *
 * Nothing leaves the machine: every request that is not to the loopback server
 * is aborted. A ranked start therefore downgrades, which is the honest offline
 * path (invariant 3), and the switch is turned off first, as web.mjs does, so
 * the counts are for the game rather than for a server's timeout.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const root = resolve(import.meta.dirname, '../../..');
const dist = resolve(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? join(root, 'dist'));
const shotsAt = args.includes('--shots') ? resolve(args[args.indexOf('--shots') + 1]) : null;
if (shotsAt) mkdirSync(shotsAt, { recursive: true });

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No web export at ${dist}.`);
  process.exit(2);
}
const BASE = /src="(\/[^"]*?)\/_expo\//.exec(readFileSync(join(dist, 'index.html'), 'utf8'))?.[1] ?? '';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let path = url.pathname;
  if (BASE && (path === BASE || path.startsWith(`${BASE}/`))) path = path.slice(BASE.length) || '/';
  const file = join(dist, path);
  const target = existsSync(file) && statSync(file).isFile() ? file : join(dist, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
  res.end(readFileSync(target));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const HOME = `${ORIGIN}${BASE}/`;

const browser = await chromium.launch({ headless: true, args: ['--disable-webgl', '--disable-3d-apis'] });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
await context.route('**/*', (route) => (route.request().url().startsWith(ORIGIN) ? route.continue() : route.abort()));
// Casual from the start, through storage rather than a click on the switch: a
// click scrolls the page to the switch, which is a scroll no player made.
const CASUAL = JSON.stringify({ state: { preferRanked: false }, version: 0 });
const casual = (ctx) =>
  ctx.addInitScript((value) => {
    try {
      if (!localStorage.getItem('18-0.game')) localStorage.setItem('18-0.game', value);
    } catch {}
  }, CASUAL);
await casual(context);
const page = await context.newPage();

const journeys = {};
let current = null;
const begin = (name) => {
  current = { taps: 0, scrolls: 0, dead: [], trail: [] };
  journeys[name] = current;
};
const shot = async (name) => {
  if (shotsAt) await page.screenshot({ path: join(shotsAt, `${name}.png`) });
};
const first = (selector) => page.locator(selector).first();
const byLabel = (prefix) => first(`[role="button"][aria-label^="${prefix}"]:visible`);

/** On the glass now, without scrolling? */
async function onGlass(locator) {
  const box = await locator.boundingBox();
  if (!box) return false;
  return box.y >= 0 && box.y + box.height <= 852 && box.x >= 0 && box.x + box.width <= 393;
}

/** One tap, counting the scroll it took to reach the control. */
async function tap(locator, what) {
  await locator.waitFor({ state: 'visible', timeout: 30_000 });
  if (!(await onGlass(locator))) {
    current.scrolls += 1;
    current.trail.push(`scroll to ${what}`);
    await locator.scrollIntoViewIfNeeded();
  }
  const label = (await locator.getAttribute('aria-label')) ?? (await locator.innerText().catch(() => ''));
  current.trail.push(`tap ${what} [${label.slice(0, 60)}]`);
  current.taps += 1;
  await locator.click();
  await page.waitForTimeout(350);
}
const dead = (why) => current.dead.push(why);

async function waitForList() {
  await page.locator('[aria-label="Search eligible players"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
}

/** A pick from the list: the first row that can still go somewhere. */
async function pick() {
  const rows = page.locator('[role="button"][aria-label]');
  const i = await rows.evaluateAll((els) =>
    els.findIndex(
      (e) =>
        /\. (QB|RB|WR|TE|DEF)\. \d{4} /.test(e.getAttribute('aria-label') || '') &&
        !/Already on your roster/.test(e.getAttribute('aria-label') || '') &&
        e.getAttribute('aria-disabled') !== 'true',
    ),
  );
  await tap(rows.nth(i), 'a player');
  const add = page.locator('[aria-label^="Add "]:visible').first();
  if (await add.count()) {
    // Not a dead end: RB1 and RB2 (WR1, WR2) weigh differently, so which
    // slot is the player's decision (ROSTER_WEIGHTS in packages/domain).
    current.trail.push('a pick that fits two slots: which one is a real choice');
    await tap(add, 'the slot');
  }
}

try {
  // 1. First launch to the first spin -------------------------------------
  begin('first_launch_to_first_spin');
  await page.goto(HOME, { waitUntil: 'commit' });
  await byLabel('Play').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot('1-home');
  // What sits over the page on arrival, between a player and Play.
  for (const overlay of ['Dismiss', 'Not now', 'Close']) {
    if (await first(`[aria-label^="${overlay}"]:visible`).count()) dead(`an overlay on arrival (${overlay})`);
  }
  // The site leads with the download page (Showcase.web.tsx); its "Play in
  // the browser" is the way in on the glass. Native has no showcase.
  const site = page.getByRole('button', { name: /in the browser/ }).first();
  if ((await site.count()) && (await onGlass(site))) {
    await tap(site, 'Play in the browser');
    await page.locator('[aria-label="Search eligible players"]').waitFor({ timeout: 5000 }).catch(() => {});
  }
  if (!(await page.locator('[aria-label="Search eligible players"]').count())) {
    const quick = byLabel('Play ');
    if (!(await onGlass(quick))) dead('Play is below the fold on arrival');
    await tap(quick, 'Play');
  }
  await waitForList();
  await shot('1-first-spin');

  // 2. A whole season ------------------------------------------------------
  begin('a_season_seven_picks');
  for (let n = 1; n <= 7; n++) {
    if (n > 1) {
      await tap(first('[aria-label="Spin the wheel"]'), 'Spin');
      await waitForList();
    }
    await pick();
    if (n === 7) break;
  }
  await shot('2-roster-full');
  await tap(first('[aria-label="Reveal your result"]'), 'Reveal');
  await first('[aria-label="Build another roster"]').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await shot('2-result');

  // 3. The result to the next season ----------------------------------------
  begin('result_to_next_season');
  const again = first('[aria-label="Build another roster"]:visible');
  if (!(await onGlass(again))) dead('Build Another is below the fold on the result');
  await tap(again, 'Build Another');
  await waitForList();
  await shot('3-next-season');

  // Leave the season, the way a player does.
  begin('leave_a_season');
  await tap(first('[aria-label="Close game"]'), 'Close');
  await page.waitForTimeout(800);
  await shot('3-after-close');
  if (await byLabel('Resume').count()) current.trail.push('lands on the front page with Resume');

  // 4. Switching mode -------------------------------------------------------
  begin('switch_mode');
  if (await byLabel('Discard').count()) await first('[aria-label^="Discard"]').click(); // reset, not counted
  await page.waitForTimeout(500);
  await tap(byLabel('Play GM Mode.'), 'the GM Mode card');
  await waitForList();
  await shot('4-gm-mode');
  await tap(first('[aria-label="Close game"]'), 'Close');
  await page.waitForTimeout(500);
  if (await byLabel('Discard').count()) await first('[aria-label^="Discard"]').click();
  await page.waitForTimeout(500);
  const label = (await byLabel('Play ').getAttribute('aria-label')) ?? '';
  current.trail.push(`front page Play now says: ${label}`);

  // 5. Finding things --------------------------------------------------------
  for (const tab of ['My Stats', 'Challenges', 'Leaderboards', 'Games']) {
    begin(`find_${tab.replace(/\s/g, '_').toLowerCase()}`);
    const target = first(`[role="tab"][aria-label^="${tab}"]:visible`);
    if (!(await target.count())) dead(`no ${tab} in the navigation`);
    else await tap(target, tab);
    await page.waitForTimeout(1500);
    await shot(`5-${tab.replace(/\s/g, '-').toLowerCase()}`);
    // What the page asks for next, and whether it is on the glass.
    const buttons = await page.locator('[role="button"]:visible').evaluateAll((els) =>
      els
        .map((e) => ({ label: e.getAttribute('aria-label') || e.textContent || '', y: e.getBoundingClientRect().y }))
        .filter((b) => b.y >= 0 && b.y < 852)
        .map((b) => b.label.slice(0, 40)),
    );
    current.trail.push(`on the glass: ${buttons.slice(0, 8).join(' | ')}`);
    if (await page.getByText(/^Loading/).count()) dead(`${tab} is loading with nothing else to do`);
    await first('[role="tab"][aria-label^="Play"]:visible').click();
    await page.waitForTimeout(600);
  }

  // 5b. The dock's PLAY, pressed on the front page: the one control on every
  // screen that looks like a play button.
  begin('play_tab_on_the_front_page');
  await tap(first('[role="tab"][aria-label^="Play"]:visible'), 'the PLAY tab');
  await page.locator('[aria-label="Search eligible players"]').waitFor({ timeout: 5000 }).catch(() => {});
  if (await page.locator('[aria-label="Search eligible players"]').count()) {
    current.trail.push('a season started');
    await shot('5b-play-tab');
  } else dead('PLAY on the front page does nothing');

  // 6. Stats with nothing played: a fresh origin ------------------------------
  const fresh = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
  await casual(fresh);
  await fresh.route('**/*', (route) => (route.request().url().startsWith(ORIGIN) ? route.continue() : route.abort()));
  const blank = await fresh.newPage();
  begin('empty_stats_to_a_season');
  await blank.goto(`${ORIGIN}${BASE}/stats`, { waitUntil: 'commit' });
  await blank.locator('[role="button"][aria-label^="Play"]:visible').first().waitFor({ timeout: 60_000 });
  await blank.waitForTimeout(1200);
  if (shotsAt) await blank.screenshot({ path: join(shotsAt, '6-empty-stats.png') });
  current.taps += 1;
  const cta = blank.locator('[role="button"][aria-label^="Play"]:visible').first();
  current.trail.push(`tap [${await cta.getAttribute('aria-label')}]`);
  await cta.click();
  await blank.locator('[aria-label="Search eligible players"]').waitFor({ timeout: 8000 }).catch(() => {});
  if (!(await blank.locator('[aria-label="Search eligible players"]').count())) {
    dead('the empty state goes to the front page, not to a season');
    current.taps += 1;
    current.trail.push('tap Play again on the front page');
    await blank.locator('[role="button"][aria-label^="Play "]:visible').first().click();
    await blank.locator('[aria-label="Search eligible players"]').waitFor({ timeout: 30_000 });
  }
  await fresh.close();
} finally {
  await browser.close();
  server.close();
}

for (const [name, j] of Object.entries(journeys)) {
  console.log(`\n${name}: ${j.taps} taps, ${j.scrolls} scrolls, ${j.dead.length} dead ends`);
  for (const d of j.dead) console.log(`  dead end: ${d}`);
  for (const t of j.trail) console.log(`  ${t}`);
}
console.log(`\nJSON ${JSON.stringify(Object.fromEntries(Object.entries(journeys).map(([k, j]) => [k, { taps: j.taps, scrolls: j.scrolls, dead: j.dead }])))}`);
