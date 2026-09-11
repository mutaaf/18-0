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
import { existsSync, readFileSync } from 'node:fs';
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

function run(query = '') {
  const dom = dumpDom(query);
  const title = dom.match(/<title>(.*?)<\/title>/s)?.[1];
  try {
    return JSON.parse(title.replace(/&quot;/g, '"'));
  } catch {
    console.error(`The fixture did not report for "${query || 'the default'}". Title was:`, title);
    process.exit(1);
  }
}

const report = run();

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
  const { ezFill, ezSettings, EZ_DEFAULTS } = scope;

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
checkCorners('band', band.slots);
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

// The retired setting, driven end to end: storage holding `header` and nothing
// else must still put a band on the page.
const legacy = run('?placement=header');
console.log('\nA STORED `PLACEMENT`');
check('`header` still places a band and no tile', legacy.bands === 1 && legacy.cards === 0, `${legacy.bands} band(s), ${legacy.cards} tile(s)`);

console.log('='.repeat(56));
console.log(failures === 0 ? 'Both placements go in once and stay.' : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
