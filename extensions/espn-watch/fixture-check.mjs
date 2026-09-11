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
function dumpDom(query = '', extra = []) {
  const args = [
    '--headless',
    '--disable-gpu',
    `--user-data-dir=${profile}`,
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
  check('and it replaces the wordmark rather than crowding it', logo?.wordmark === false);
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
  check('the card is still placed', dead?.cards === 1, `${dead?.cards}`);
  // TODO: assert the panel still opens here. The probe needs a selector for
  // whatever the tile's control is, and the tile's markup is being rewritten --
  // a check pinned to the old class would pass by not finding anything.
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
    check(`refused: ${JSON.stringify(hostile)}`, ezUrl(hostile) === '', `got "${ezUrl(hostile)}"`);
  }
  check('an https link survives', ezUrl('https://18-0.co/x?a=1') === 'https://18-0.co/x?a=1');
  check('an http link survives', ezUrl(' http://example.test/ ') === 'http://example.test/');
  // The logo's shine is a CSS mask built as `url("…")` around this value, so the
  // quote that would close it early has to be gone before it gets there.
  check(
    'a quote in a URL cannot close a CSS url()',
    !ezUrl('https://18-0.co/a") ;background:red;x:("').includes('"'),
    ezUrl('https://18-0.co/a") ;background:red;x:("'),
  );
  check('the shipped call to action is a real link', ezUrl(EZ_DEFAULTS.copy.ctaUrl) !== '');
  // An emptied number field is not a zero: a zero-width logo is invisible and
  // reads as the image having failed to load.
  check('an emptied number field falls back', ezNumber('', 24, 240, 76) === 76);
  check('and a silly one is clamped', ezNumber('9000', 24, 240, 76) === 240 && ezNumber('1', 24, 240, 76) === 24);
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
check('it carries the logo too', band.bandLogo === true);
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

// The retired setting, driven end to end: storage holding `header` and nothing
// else must still put a band on the page.
const legacy = run('?placement=header');
console.log('\nA STORED `PLACEMENT`');
check('`header` still places a band and no tile', legacy.bands === 1 && legacy.cards === 0, `${legacy.bands} band(s), ${legacy.cards} tile(s)`);

console.log('='.repeat(56));
console.log(failures === 0 ? 'Both placements go in once and stay.' : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
