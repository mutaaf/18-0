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
import { existsSync } from 'node:fs';
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
const profile = resolve(import.meta.dirname, '.fixture-profile');

/**
 * Chrome prints the DOM and then, with `--virtual-time-budget`, does not always
 * exit. That is not a failure -- the output we want is already on stdout -- so
 * the timeout is treated as a normal ending and the partial output is used.
 * Waiting for a clean exit meant a check that hung instead of reporting.
 */
function dumpDom(query = '') {
  const args = [
    '--headless',
    '--disable-gpu',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=9000',
    '--window-size=1280,900',
    '--dump-dom',
    `file://${fixture}${query}`,
  ];
  try {
    return execFileSync(CHROME, args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
    });
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.length > 0) return error.stdout;
    throw error;
  }
}

const dom = dumpDom();

const title = dom.match(/<title>(.*?)<\/title>/s)?.[1];
let report;
try {
  report = JSON.parse(title.replace(/&quot;/g, '"'));
} catch {
  console.error('The fixture did not report. Title was:', title);
  process.exit(1);
}

let failures = 0;
const check = (what, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
};

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
check('its button is present', report.clickable === true);
// Placed, but placed where somebody can reach it: the first slot of a real
// carousel is clipped by the shelf's edge.
check('it sits fully on screen', report.onScreenX >= 0, `x=${report.onScreenX}`);

// The other placement, driven through the same fixture.
const bandDom = dumpDom('?placement=header');
const bandTitle = bandDom.match(/<title>(.*?)<\/title>/s)?.[1];
let band;
try {
  band = JSON.parse(bandTitle.replace(/&quot;/g, '"'));
} catch {
  console.error('The header fixture did not report. Title was:', bandTitle);
  process.exit(1);
}

console.log('\nAS AN INLINE HEADER');
check('exactly one band', band.cards === 1, `${band.cards}`);
check('it is a band, not a tile', band.isBand === true);
check('it never moved once placed', band.moves === 0, `${band.moves} move(s)`);
// The whole point of the placement: it sits in the gap above the row, not
// inside it and not below the rail it is introducing.
check('it sits above the first row', band.aboveFirstRow === true);

console.log('='.repeat(56));
console.log(failures === 0 ? 'Both placements go in once and stay.' : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
