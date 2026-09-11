/**
 * Puts a playable 18-0 card into a row on ESPN's Watch page.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ROW IS FOUND STRUCTURALLY
 * ---------------------------------------------------------------------------
 *
 * The page is a React app with generated class names, so anything matching on
 * `.WatchShelf__row` works until the next deploy and then fails silently -- the
 * card simply never appears and there is nothing to debug. What does not change
 * is the *shape* of a carousel: a container whose children are several boxes of
 * near-identical width, laid out in a line, wider than the viewport or
 * scrollable. That is what this looks for, and it is why the picker names rows
 * by their visible heading rather than by a selector.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS OBSERVED RATHER THAN INJECTED ONCE
 * ---------------------------------------------------------------------------
 *
 * Rows arrive after the first paint, re-render on navigation, and React will
 * happily throw away a child it did not create. So the observer re-checks, but
 * on a debounce and against a cheap guard: if our card is still in the row we
 * chose, nothing is queried at all. A MutationObserver that re-scans the
 * document on every mutation of a page like this one is a page that janks.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE TWO OF EVERYTHING
 * ---------------------------------------------------------------------------
 *
 * The tile and the band can both be on at once, so each is its own element with
 * its own id, its own remembered parent and its own stored position. They are
 * not two views of one card: "in the third row" and "above the third row" are
 * different places, and a single `row` setting standing for both silently moved
 * whichever one was not being looked at.
 */

const TILE_ID = 'eighteen-zero-card';
const BAND_ID = 'eighteen-zero-band';
/** Both placements, for the many places that mean "anything of ours". */
const OURS = new Set([TILE_ID, BAND_ID]);
const OURS_SELECTOR = `#${TILE_ID}, #${BAND_ID}`;
const PANEL_ID = 'eighteen-zero-panel';
const EMBED_URL = 'https://18-0.co/embed';

/** Heights the frame is given, by the screen the game says it is on. */
const FRAME_HEIGHT = { entry: 232, play: 620, result: 760 };

let settings = ezSettings(null);
let picking = false;

// ---------------------------------------------------------------------------
// Finding rows
// ---------------------------------------------------------------------------

/**
 * Every carousel on the page, in document order.
 *
 * Cheap on purpose: one pass over a bounded candidate set rather than a walk of
 * the whole tree. Anything with fewer than three similar children is not a row.
 */
function findRows() {
  const found = [];

  for (const node of document.querySelectorAll('ul, ol, div, section')) {
    // **Our own card is never part of the measurement.** It used to be, and
    // that was the whole bug: inserting the card changed the row's first child,
    // the row then measured differently, sometimes failed its own test, and the
    // card moved to whichever row now sorted first -- where the same thing
    // happened again. The card flickered between the top two rows at the
    // debounce interval and could not be clicked, because it was being
    // destroyed and rebuilt under the pointer.
    const kids = [...node.children].filter(
      (c) => !OURS.has(c.id) && c.getBoundingClientRect().width > 80,
    );
    if (kids.length < 3) continue;

    const boxes = kids.slice(0, 6).map((c) => c.getBoundingClientRect());
    const first = boxes[0];
    if (first.height < 60 || first.height > 420) continue;

    // Laid out in a line, tested by vertical *overlap* rather than by a shared
    // top edge. These rails are `align-items: center`, so a tile with a
    // three-line caption sits higher than one with a single line and the tops
    // disagree by tens of pixels -- a row is children side by side on the same
    // line, which is what this asks.
    const inLine = boxes.every((b) => {
      const overlap = Math.min(b.bottom, first.bottom) - Math.max(b.top, first.top);
      return overlap > Math.min(b.height, first.height) * 0.5;
    });
    const evenWidth = boxes.every((b) => Math.abs(b.width - first.width) < 24);
    if (!inLine || !evenWidth) continue;

    // **The children advance across the page.** Everything above is also true
    // of a stack of overlays -- a tile's artwork, its gradient and its link
    // cover the same box, share a top edge and are the same width -- and that
    // is what made this find three hundred and one "rows" on the real page and
    // offer the picker a list of programme titles. A row's children start where
    // the previous one ended; an overlay starts where its sibling started.
    const advances = boxes.every((b, i) => i === 0 || b.left >= boxes[i - 1].right - 2);
    if (!advances) continue;

    found.push({ node, label: labelFor(node), tile: kids[0] });
  }

  return found;
}

/** The heading a human would use for this row, or a fallback. */
function labelFor(node) {
  // Walk up looking for the section heading that precedes it. Six levels
  // because that is how deep the live page wraps a rail before the section
  // that labels it -- outer, two anonymous divs, wrapper, section.
  let scope = node;
  for (let depth = 0; depth < 6 && scope; depth++) {
    let sibling = scope.previousElementSibling;
    while (sibling) {
      const text = (sibling.textContent || '').trim();
      if (text && text.length < 60) return text.split('\n')[0].trim();
      sibling = sibling.previousElementSibling;
    }
    // **Not any heading -- one outside the rail.** A programme title is an
    // `h3` on this page, so asking for the first heading in scope names the row
    // after whatever happens to be in its first tile.
    const heading = [...(scope.querySelectorAll?.('h1, h2, h3') ?? [])].find(
      (h) => !node.contains(h) && (h.textContent || '').trim(),
    );
    if (heading) return heading.textContent.trim();
    scope = scope.parentElement;
  }
  const label = (node.getAttribute('aria-label') || '').trim();
  return label || 'Row';
}

/**
 * The row a stored setting names, or the first one.
 *
 * The label is passed in rather than read off `settings`, because the tile and
 * the band store different ones and a shared read is how the band ended up
 * following the tile's row around.
 */
function chosenRow(rows, label) {
  if (!rows.length) return null;
  if (label === null || label === undefined || label === END) return rows[0];
  return rows.find((r) => r.label === label) ?? rows[0];
}


// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * Minutes watched, minutes played, and how often the card was seen.
 *
 * Counted in one-second ticks against three conditions, all of which have to
 * hold: the tab is visible, the page is not hidden, and the thing being counted
 * is actually happening. A timer that keeps running in a background tab reports
 * an afternoon of engagement for a window somebody forgot about, which is worse
 * than reporting nothing.
 *
 * Watch time is "a video on this page is playing". Play time is "the game is
 * open in front of them". Neither is a guess about attention, and both are
 * written where only this browser can read them -- see the note in `config.js`.
 */

/**
 * Is the extension still behind this script?
 *
 * Reloading an extension does not reload the pages it is already running in.
 * The old content script stays in the DOM with a `chrome` object whose context
 * is gone, and every call through it throws `Extension context invalidated`.
 *
 * That is how "the panel does not pop up any more" happens: the card is still
 * on the page, the click handler still fires, and the first thing it did was
 * record the open -- which threw, so the panel was never built. A counter must
 * never be the reason a control stops working.
 */
function alive() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

/** Storage that cannot throw into a caller that has something better to do. */
const store = {
  get(defaults, then) {
    if (!alive()) return then(defaults);
    try {
      chrome.storage.local.get(defaults, (got) => then(got ?? defaults));
    } catch {
      then(defaults);
    }
  },
  set(values) {
    if (!alive()) return;
    try {
      chrome.storage.local.set(values);
    } catch {
      // The page outlived the extension. Nothing to do and nothing to break.
    }
  },
};

const STATS_KEY = 'stats';

let stats = { watchSeconds: 0, playSeconds: 0, impressions: 0, opens: 0, since: null };
let ticker = null;

function loadStats(then) {
  store.get({ [STATS_KEY]: null }, (got) => {
    stats = got[STATS_KEY] ?? { ...stats, since: Date.now() };
    then?.();
  });
}

/** Written on a debounce: a storage write every second is a write nobody needs. */
let statsDirty = false;
function saveStats() {
  statsDirty = true;
}

function flushStats() {
  if (!statsDirty) return;
  statsDirty = false;
  store.set({ [STATS_KEY]: stats });
}

function watching() {
  if (!settings.countWatch) return false;
  for (const video of document.querySelectorAll('video')) {
    if (!video.paused && !video.ended && video.readyState > 2) return true;
  }
  return false;
}

function playing() {
  return settings.countPlay && Boolean(document.getElementById(PANEL_ID));
}

function startCounting() {
  if (ticker) return;
  loadStats();
  ticker = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    let moved = false;
    if (watching()) { stats.watchSeconds++; moved = true; }
    if (playing()) { stats.playSeconds++; moved = true; }
    if (moved) saveStats();
  }, 1000);
  // Five seconds of counting is worth one write.
  setInterval(flushStats, 5000);
  window.addEventListener('pagehide', flushStats);
  document.addEventListener('visibilitychange', flushStats);
}

function countImpression() {
  stats.impressions++;
  saveStats();
}

function countOpen() {
  stats.opens++;
  saveStats();
  flushStats();
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------


/** A styled element with text, without reaching for innerHTML. */
function el(tag, className, text = '', attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** The wordmark, which is the one piece of markup that is genuinely ours. */
function mark() {
  const span = el('span', 'ez-mark', '18');
  span.append(el('span', 'ez-dash', '-'), document.createTextNode('0'));
  return span;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** `el`, for the other namespace. `createElement('rect')` renders nothing. */
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * The ground: a field, drawn the way the game draws one.
 *
 * This used to be a navy gradient with a pinstripe over it, and beside real
 * broadcast thumbnails that reads as a box somebody has not finished. The app's
 * own `Field` is chalk on a dark ground -- yard lines, hash ticks, mowing
 * stripes at one per cent -- and the same marks at this size give the card
 * something to be a picture *of*.
 *
 * No gradients and no `<defs>`: a gradient needs an id, and a fixed id resolves
 * against the whole document, so a second card would silently blank the first.
 * The ground itself stays in CSS, where the two looks can disagree about it.
 *
 * The viewBox is the card's real pixel size, so nothing is scaled and a
 * one-pixel line stays one pixel. The band passes a nominal wide box instead
 * and crops, because its width is the shelf's and is not known until it lands.
 */
function fieldArt(w, h) {
  const svg = svgEl('svg', {
    class: 'ez-turf',
    viewBox: `0 0 ${w} ${h}`,
    preserveAspectRatio: 'xMidYMid slice',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const chalk = (attrs) => svg.append(svgEl('rect', { fill: '#ffffff', ...attrs }));

  // **Spaced in pixels, not in tenths.** A fixed ten lines put them 23px apart
  // on the tile and 120px apart across the band, and at 120px they stop reading
  // as a field and start reading as stripes somebody drew on a panel. The two
  // placements have to be the same picture at two sizes.
  const count = Math.max(6, Math.round(w / 24));
  const yard = w / count;
  const mid = Math.round(count / 2);

  for (let i = 0; i < count; i += 10) {
    chalk({ x: i * yard, y: 0, width: yard * 5, height: h, opacity: 0.016 });
  }
  for (let i = 1; i < count; i++) {
    // Midfield is the one line a broadcast draws heavier.
    chalk({ x: Math.round(i * yard), y: 0, width: 1, height: h, opacity: i === mid ? 0.2 : 0.085 });
  }
  // Hash marks at a fixed pitch for the same reason the lines are.
  const hash = Math.max(yard, 40);
  for (let x = hash / 2; x < w; x += hash) {
    for (const y of [h * 0.34, h * 0.62]) {
      chalk({ x: Math.round(x), y: Math.round(y), width: 1, height: 5, opacity: 0.075 });
    }
  }
  for (const y of [Math.round(h * 0.13), Math.round(h * 0.87)]) {
    chalk({ x: 0, y, width: w, height: 1, opacity: 0.06 });
  }
  return svg;
}

/**
 * The season, as eighteen marks along the bottom edge.
 *
 * Seventeen in chalk and the eighteenth in gold, because gold is what the app
 * reserves for the perfect record and this is the only place the card spends
 * it. It is the one piece of the artwork that says what the game is without
 * needing a sentence to do it, and it survives being shrunk to a strip.
 */
function ladder() {
  const strip = el('span', 'ez-ladder', '', { 'aria-hidden': 'true' });
  for (let i = 0; i < 18; i++) strip.append(el('i', i === 17 ? 'ez-tick ez-chase' : 'ez-tick'));
  return strip;
}

/**
 * The sponsorship line, and a logo if one is configured.
 *
 * Its own element rather than more words in the title, because a sponsor that
 * is part of a sentence cannot be turned off without rewriting the sentence --
 * and the first thing anybody does with this is try it both ways.
 */
function sponsorStrip() {
  const strip = el('span', 'ez-sponsor');
  if (settings.sponsorLogo) {
    const logo = el('img', 'ez-sponsor-logo');
    logo.src = settings.sponsorLogo;
    logo.alt = '';
    logo.referrerPolicy = 'no-referrer';
    strip.append(logo);
  }
  const line = ezFill(settings.copy.sponsorLine, settings.sponsor);
  if (line) strip.append(el('span', 'ez-sponsor-text', line));
  return strip;
}

/**
 * Copies a neighbour's shape, when asked to.
 *
 * "Match the UI" is about *fitting the row* -- the same box, the same corner,
 * the same caption block underneath -- not about pretending to be an ESPN
 * programme. The card keeps the game's name and mark either way; what changes is
 * whether it sits in the row like a tile or announces itself like an advert.
 */
function shapeFrom(tile) {
  if (!tile) {
    return { width: 232, height: 130, total: 190, radius: 6, marginLeft: 0, marginRight: 12, motion: null, lift: null };
  }
  const box = tile.getBoundingClientRect();
  const style = getComputedStyle(tile);
  const art = artOf(tile);
  return {
    width: Math.round(box.width),
    height: Math.round(art?.getBoundingClientRect().height || (box.width * 9) / 16),
    // How the row behaves under a pointer, copied for the same reason the box
    // is. A tile that does not move while its neighbours lift is the tell that
    // it was put there by something else.
    motion: timingFrom(art ?? tile),
    lift: hoverLift(tile),
    // The tile's *whole* height, which our card matches. These rails are
    // `align-items: center`, so two boxes only line up if they are the same
    // height -- and both put their artwork at the top. Forcing `flex-start`
    // instead looked right where our card was shorter and wrong where it was
    // taller, because then ours defined the line and pushed the tiles down.
    total: Math.round(box.height),
    radius: parseInt(style.borderRadius, 10) || 6,
    // **Copied, not guessed.** This rail has no `gap` at all -- the gutter is
    // the tiles' own margin -- so a hardcoded 12px gave our card no space on
    // its left and twice as much on its right. Whatever the row spaces its
    // children with, we use the same.
    marginLeft: parseFloat(style.marginLeft) || 0,
    marginRight: parseFloat(style.marginRight) || 0,
  };
}

/**
 * How tall the thumbnail is, as opposed to the whole tile.
 *
 * A Watch tile is a 16:9 thumbnail with two lines of caption under it, so
 * matching the tile's full height would put our card's bottom edge level with
 * their text. The first version asked for `img, picture, video` and got a
 * `<picture>` measuring 300x19 -- a lazy-loaded image that had not resolved yet
 * -- which is why the card rendered as a thin strip with its artwork squashed
 * into it.
 *
 * So it is found by shape instead of by tag: the widest thing in the tile whose
 * proportions are a thumbnail's. That rejects the unresolved picture at 15.8:1
 * and the tile wrappers at 1.25:1, and finds the figure at 1.78:1 regardless of
 * what it is made of -- these are sometimes a background image rather than an
 * `<img>` at all.
 *
 * Returned as the element rather than as a height, because the thumbnail is
 * also the thing carrying the row's hover transition -- the tile around it
 * usually transitions nothing.
 */
function artOf(tile) {
  const width = tile.getBoundingClientRect().width;
  let best = null;
  for (const node of tile.querySelectorAll('*')) {
    const b = node.getBoundingClientRect();
    if (b.width < width * 0.85 || b.height < 24) continue;
    const ratio = b.width / b.height;
    if (ratio < 1.45 || ratio > 2.2) continue;
    if (!best || b.height > best.getBoundingClientRect().height) best = node;
  }
  return best;
}

/**
 * The first item of a comma-separated CSS list.
 *
 * `transition-timing-function` reports `cubic-bezier(0.4, 0, 0.2, 1)`, which
 * has commas inside it -- splitting on every comma produced `cubic-bezier(0.4`,
 * an invalid declaration, and a card that snapped instead of moving.
 */
function firstValue(list) {
  const match = String(list ?? '').match(/^\s*([a-z-]+\([^()]*\)|[^,]+)/i);
  return match ? match[1].trim() : '';
}

/**
 * How long a neighbour takes, and on what curve.
 *
 * Read off the real tile rather than chosen. A hardcoded 200ms ease next to a
 * row that moves in 120ms reads as a heavier, slower thing than everything
 * around it, which is exactly the tell that it is not one of them.
 *
 * Only the timing is taken, not the shorthand: a row whose tiles transition
 * `opacity` and nothing else would hand us a transition list with no
 * `transform` in it and our lift would jump.
 */
function timingFrom(node) {
  const style = getComputedStyle(node);
  const duration = firstValue(style.transitionDuration);
  if (!duration || duration === '0s') return null;
  return `${duration} ${firstValue(style.transitionTimingFunction) || 'ease'}`;
}

/**
 * The transform a neighbour takes on hover.
 *
 * `getComputedStyle` cannot answer this -- a `:hover` rule is not in the
 * computed style of an element nobody is pointing at -- so the stylesheets are
 * read instead, for a hover rule that describes this tile or something inside
 * it. `cssRules` throws on a cross-origin sheet, which is most of a CDN's, so a
 * sheet that will not open is skipped rather than fatal.
 *
 * Budgeted, because this walks rules rather than elements: the Watch page ships
 * tens of thousands and a full walk is not something to do behind a
 * MutationObserver. It runs only when a placement is being resolved.
 */
function hoverLift(tile) {
  let budget = 4000;

  const search = (rules) => {
    for (const rule of rules) {
      if (budget-- < 0) return null;
      if (rule.cssRules) {
        const nested = search(rule.cssRules);
        if (nested) return nested;
      }
      const selector = rule.selectorText;
      if (!selector || !selector.includes(':hover')) continue;
      const transform = rule.style?.transform;
      if (!transform || transform === 'none') continue;
      if (describes(tile, selector)) return transform;
    }
    return null;
  };

  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const found = search(rules);
    if (found) return found;
  }
  return null;
}

/** Does a `:hover` selector describe this tile, or something inside it? */
function describes(tile, selector) {
  // The hover state is dropped and what is left is asked of the tile and its
  // subtree, because the rule fires when the tile is pointed at whichever of
  // them it actually styles. A selector the browser will not parse -- a vendor
  // pseudo-class, say -- is not one of ours.
  const plain = selector.replace(/:hover/g, '');
  return plain.split(',').some((part) => {
    const sel = part.trim();
    if (!sel) return false;
    try {
      return tile.matches(sel) || tile.querySelector(sel) !== null;
    } catch {
      return false;
    }
  });
}

function buildCard(shape) {
  const card = document.createElement('div');
  card.id = TILE_ID;
  card.className = `ez-card${settings.matchUi ? ' ez-match' : ''}`;
  card.style.setProperty('--ez-w', `${shape.width}px`);
  card.style.setProperty('--ez-h', `${shape.height}px`);
  card.style.setProperty('--ez-r', `${shape.radius}px`);
  card.style.setProperty('--ez-th', `${shape.total}px`);
  card.style.setProperty('--ez-ml', `${shape.marginLeft}px`);
  card.style.setProperty('--ez-mr', `${shape.marginRight}px`);
  if (shape.motion) card.style.setProperty('--ez-motion', shape.motion);
  if (shape.lift) card.style.setProperty('--ez-lift', shape.lift);

  const say = (key) => ezFill(settings.copy[key], settings.sponsor);

  // Built rather than interpolated. Every string below is typed by whoever
  // configured the extension, and dropping user text into `innerHTML` inside
  // somebody else's page is how a sponsor name becomes a script tag.
  const art = el('button', 'ez-art');
  art.type = 'button';
  art.setAttribute('aria-label', `${say('tileTitle')}. ${say('tileButton')}.`);
  art.append(
    fieldArt(shape.width, shape.height),
    el('span', 'ez-sheen', '', { 'aria-hidden': 'true' }),
    mark(),
    el('span', 'ez-tag', say('tileButton')),
  );
  if (say('tileBadge')) art.append(el('span', 'ez-badge', say('tileBadge')));
  if (settings.sponsor && settings.sponsorBanner) art.append(sponsorStrip());
  art.append(ladder());

  card.append(art, el('p', 'ez-title', say('tileTitle')), el('p', 'ez-meta', say('tileSubtitle')));

  art.addEventListener('click', openPanel);
  countImpression();
  return card;
}

/**
 * Where the card went last time.
 *
 * **The card is placed once and then left alone.** This is the fix for it
 * flickering between the top two rows and being impossible to click, and it is
 * deliberately a stronger guarantee than "find the right row each time".
 *
 * Re-resolving on every pass means the answer has to be stable on every pass,
 * and it is not: a carousel is a list inside a scroller inside a section, all
 * three can look like a row, and inserting the card changes the measurements
 * that decide between them. So the card moves, which changes the measurements,
 * which moves the card. Anything that re-derives a position from a page it is
 * also modifying can do this, and no amount of tuning the heuristic fixes it --
 * the heuristic is not the problem, asking it twice is.
 *
 * So: resolve once, remember the node, and only look again when that node has
 * actually left the document. A React re-render replacing the shelf is the one
 * case that should move the card, and it is the one case this re-resolves for.
 *
 * One entry per placement, held separately. The two are in different parts of
 * the page and are replaced at different times; a shared memo would re-resolve
 * -- and therefore move -- the one that was perfectly happy where it was.
 */
const placed = { tile: null, band: null };

const ID_OF = { tile: TILE_ID, band: BAND_ID };

/** Is this placement still exactly where we put it? */
function settledAt(which) {
  const node = document.getElementById(ID_OF[which]);
  return Boolean(node && placed[which]?.isConnected && node.parentElement === placed[which]);
}

function removeAt(which) {
  document.getElementById(ID_OF[which])?.remove();
  placed[which] = null;
}

/** Everything of ours off the page, for the toggle that leaves it untouched. */
function removeBoth() {
  removeAt('tile');
  removeAt('band');
}


/**
 * The other placement: a band between the rows rather than a card inside one.
 *
 * A tile competes with fifteen thumbnails for a glance. A band does not -- it
 * gets the full width of the shelf and the reading position a section heading
 * has, which is the right shape when the game is the point rather than one more
 * thing on offer.
 *
 * Matched, it borrows the heading's own typography: these pages set their
 * section labels in small, wide, uppercase type, and a band that shouts in a
 * column of those reads as an advert no matter what it says.
 */
function buildBand(motion) {
  const band = document.createElement('div');
  band.id = BAND_ID;
  band.className = `ez-band${settings.matchUi ? ' ez-match' : ''}`;
  if (motion) band.style.setProperty('--ez-motion', motion);
  const say = (key) => ezFill(settings.copy[key], settings.sponsor);

  const text = el('div', 'ez-band-text');
  if (say('bandKicker')) text.append(el('p', 'ez-band-kicker', say('bandKicker')));
  text.append(el('p', 'ez-band-title', say('bandTitle')));
  if (say('bandSubtitle')) text.append(el('p', 'ez-band-sub', say('bandSubtitle')));
  if (settings.sponsor && settings.sponsorBanner) text.append(sponsorStrip());

  const go = el('button', 'ez-band-go', say('bandButton'));
  go.type = 'button';

  // A nominal box rather than the real one: the band is as wide as the shelf,
  // which is not known until it is in the document, and `slice` crops a wide
  // field rather than stretching the yard lines into stripes.
  band.append(fieldArt(1200, 96), text, go, ladder());

  go.addEventListener('click', openPanel);
  countImpression();
  return band;
}

/**
 * The shelf block a row belongs to -- the child of the container that holds
 * every shelf, so inserting before it lands between two rows.
 *
 * **Not "the first ancestor with a heading in it".** That is what this asked
 * before, and on the real page it answers `DIV.Carousel__Outer`, which contains
 * *ten* headings -- the tile titles. The band was inserted inside the carousel,
 * between a section label and the rail it labels, and the alignment was then
 * measured against a programme name.
 *
 * What is actually true, measured by climbing from the rail: every wrapper from
 * the rail up to the shelf contains exactly one rail, and the first ancestor
 * that contains several is the container of all the shelves. So the shelf is
 * the last element on that climb still holding one rail. That is structural in
 * the same way `findRows` is, and it does not care what a heading is or where
 * one lives.
 *
 * The rails are passed in rather than re-derived: this is called from `place`,
 * which has just computed them, and asking a page a second question it has
 * already answered is how the card used to move.
 */
function shelfOf(node, rails) {
  const holds = (candidate) => rails.reduce((n, rail) => n + (candidate.contains(rail) ? 1 : 0), 0);

  let el = node;
  // Six deep on espn.com; the headroom is for a page that wraps one more time.
  for (let depth = 0; depth < 12; depth++) {
    const parent = el.parentElement;
    if (!parent) break;
    if (holds(el) === 1 && holds(parent) > 1) return el;
    if (parent === document.body || parent === document.documentElement) break;
    el = parent;
  }
  // One rail on the whole page: nothing above it holds several, so the answer
  // is simply the outermost wrapper that is still about this row.
  return el;
}

/**
 * The label above a shelf -- the section heading, not a programme name.
 *
 * The distinguishing fact is that it is outside the rail: the tile titles that
 * used to be found instead are all inside one. Asking for the first `h2` in the
 * shelf finds whichever comes first in document order, and on a shelf whose
 * heading sits after its rail in the source that is a tile.
 */
function shelfHeading(shelf, rails) {
  for (const heading of shelf.querySelectorAll('h1, h2, h3')) {
    if (rails.some((rail) => rail.contains(heading))) continue;
    if ((heading.textContent || '').trim()) return heading;
  }
  return null;
}

/**
 * How far a shelf's heading is inset from the container the band goes in.
 *
 * Returns null when there is no heading to line up with, in which case the
 * stylesheet's own margin stands -- a band that guesses an alignment is worse
 * than one that keeps a consistent default.
 */
function headingInset(shelf, container, rails) {
  const heading = shelfHeading(shelf, rails);
  if (!heading) return null;
  const h = heading.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  const inset = Math.round(h.left - c.left);
  // A heading that is centred, or one we have mismeasured, should not push the
  // band halfway across the page.
  return inset >= 0 && inset < c.width / 3 ? inset : null;
}

/** The sentinel for the gap below the last row. */
const END = '__end';

/**
 * Both placements, each resolved at most once.
 *
 * The two are independent all the way down: separate guards, separate memos,
 * separate stored positions. Only a placement that actually needs resolving is
 * taken out of the document before the measurement, so turning the band on does
 * not lift a tile that was already sitting happily in its row -- taking it out
 * and putting it back is a *move*, which is the thing all of this exists to
 * prevent.
 */
function place() {
  if (!settings.enabled) return removeBoth();

  if (!settings.placeTile) removeAt('tile');
  if (!settings.placeBand) removeAt('band');

  const needTile = settings.placeTile && !settledAt('tile');
  const needBand = settings.placeBand && !settledAt('band');
  // Still where we put them: done. No querying, no measuring, no work at all --
  // which matters, because this runs behind a MutationObserver on a page that
  // never stops re-rendering.
  if (!needTile && !needBand) return;

  if (needTile) removeAt('tile');
  if (needBand) removeAt('band');

  const rows = findRows();
  if (!rows.length) return;

  if (needTile) insertTile(rows);
  if (needBand) insertBand(rows);
}

function insertTile(rows) {
  const row = chosenRow(rows, settings.row);
  if (!row) return;
  placed.tile = row.node;
  // **Second, not first.** The first slot of these carousels sits under the
  // left edge of a `SECTION.overflow-hidden` and moves as the rail scrolls, so
  // a card placed there is clipped -- measured at x=-4 on a fresh load and
  // x=-110 a moment later, which is what "it flashes and I cannot click it"
  // looked like from the outside. The second slot is fully on screen at every
  // scroll position a page arrives in.
  const after = row.node.children[0];
  row.node.insertBefore(buildCard(shapeFrom(row.tile)), after?.nextElementSibling ?? null);
}

function insertBand(rows) {
  // The band goes in a *gap*, and a gap is named by the row below it -- which
  // is why the picker says "Above JUST FOR YOU" rather than naming a row. The
  // last gap has no row below it, so it is named separately.
  const atEnd = settings.gap === END;
  const row = atEnd ? rows[rows.length - 1] : chosenRow(rows, settings.gap);
  if (!row) return;

  const rails = rows.map((r) => r.node);
  const shelf = shelfOf(row.node, rails);
  const into = shelf.parentElement;
  if (!into) return;

  placed.band = into;
  const band = buildBand(timingFrom(artOf(row.tile) ?? row.tile));
  // Aligned to the heading it sits between rather than to a number. The shelves
  // here are inset 24px, not the 32 a first guess used, and that inset moves
  // with the viewport -- so it is read off the real heading.
  const inset = headingInset(shelf, into, rails);
  if (inset !== null) {
    band.style.marginLeft = `${inset}px`;
    band.style.marginRight = `${inset}px`;
  }
  into.insertBefore(band, atEnd ? shelf.nextElementSibling : shelf);
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function openPanel() {
  if (document.getElementById(PANEL_ID)) return;

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'ez-panel';
  panel.innerHTML = `
    <div class="ez-sheet" role="dialog" aria-label="18-0">
      <div class="ez-sheet-head">
        <span class="ez-sheet-mark">18<span class="ez-dash">-</span>0</span>
        <button class="ez-close" type="button" aria-label="Close">&times;</button>
      </div>
      <iframe class="ez-frame" title="18-0" src="${EMBED_URL}"
        allow="clipboard-write" referrerpolicy="no-referrer"></iframe>
      <p class="ez-note">Added by the 18-0 browser extension. Not part of ESPN.</p>
    </div>
  `;

  const close = () => {
    panel.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  panel.querySelector('.ez-close').addEventListener('click', close);
  panel.addEventListener('click', (e) => { if (e.target === panel) close(); });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(panel);
  // After it is on screen, never before: see `alive()`.
  countOpen();

  // Asked after the panel is up, so the game is already loading behind it and
  // the question is not the first thing between somebody and playing.
  void consentRow().then((row) => {
    if (!row) return;
    const sheet = panel.querySelector('.ez-sheet');
    const frame = panel.querySelector('.ez-frame');
    if (sheet && frame) sheet.insertBefore(row, frame);
  });
}


/**
 * The one-time ask, inside the panel and above the game.
 *
 * Shown only when there is a SWID to read -- a signed-out visitor is asked
 * nothing, because there is nothing to consent to -- and only until it has been
 * answered either way. Declining is a real answer and is not asked again.
 */
async function consentRow() {
  const existing = await ezIdentity();
  if (existing?.linked || existing?.declined) return null;
  if (!ezSwidPresent()) return null;

  const row = el('div', 'ez-consent');
  row.append(
    el('p', 'ez-consent-title', 'Link your ESPN account?'),
    el(
      'p',
      'ez-consent-body',
      'Your seasons would carry your ESPN identity so they can rank on a shared '
        + 'leaderboard. Your identifier is hashed on this device and never stored '
        + 'or sent as-is. You can undo this any time in the extension options.',
    ),
  );

  const actions = el('div', 'ez-consent-actions');
  const yes = el('button', 'ez-consent-yes', 'Link my account');
  yes.type = 'button';
  const no = el('button', 'ez-consent-no', 'Not now');
  no.type = 'button';

  yes.addEventListener('click', () => {
    row.replaceChildren(el('p', 'ez-consent-done', 'Linked. Your seasons can rank on the shared board.'));
    void ezGrantIdentity().catch(() => {});
  });
  no.addEventListener('click', () => {
    // Removed first. Recording the decline is bookkeeping, and a dead extension
    // context must not leave the prompt on screen after it has been answered.
    row.remove();
    store.set({ [EZ_IDENTITY_KEY]: { linked: false, declined: true, at: Date.now() } });
  });

  actions.append(yes, no);
  row.append(actions);
  return row;
}

/**
 * The frame asking for a different height.
 *
 * Origin-checked before anything is read. A page can post whatever it likes to
 * its own window, and a message shaped like ours from anywhere else is exactly
 * what this check is for -- even though the worst it could do is resize a box.
 */
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://18-0.co') return;
  const screen = event.data?.source === '18-0' ? event.data.screen : null;
  if (!screen || !(screen in FRAME_HEIGHT)) return;
  const frame = document.querySelector(`#${PANEL_ID} .ez-frame`);
  if (frame) frame.style.height = `${FRAME_HEIGHT[screen]}px`;
});

// ---------------------------------------------------------------------------
// Picking a row by clicking it
// ---------------------------------------------------------------------------

/** Which placement the click is choosing for: 'tile' or 'band'. */
function setPicking(which) {
  picking = which;
  document.body.classList.toggle('ez-picking', Boolean(which));
  if (which) document.addEventListener('click', onPick, true);
  else document.removeEventListener('click', onPick, true);
}

function onPick(event) {
  const rows = findRows();
  const hit = rows.find((r) => r.node.contains(event.target));
  if (!hit) return;
  event.preventDefault();
  event.stopPropagation();
  // The tile stores which row it is *in*; the band stores which row it is
  // *above*. One key holding both is what made choosing a gap move the tile.
  const key = picking === 'band' ? 'gap' : 'row';
  const which = picking === 'band' ? 'band' : 'tile';
  settings[key] = hit.label;
  store.set({ [key]: hit.label });
  setPicking(null);
  removeAt(which);
  place();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

let pending = null;
function schedule() {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    place();
  }, 400);
}

/**
 * Did anything happen that was not us?
 *
 * Inserting the card is itself a mutation, so an observer that reacts to every
 * record re-runs on its own work. Cheap to answer and it halves the wake-ups on
 * a page that re-renders as much as this one.
 */
function theirs(records) {
  return records.some((record) => {
    if (OURS.has(record.target?.id) || record.target?.closest?.(OURS_SELECTOR)) return false;
    const ours = (nodes) => [...nodes].every((n) => OURS.has(n.id));
    if (record.addedNodes.length && ours(record.addedNodes)) return false;
    if (record.removedNodes.length && ours(record.removedNodes)) return false;
    return true;
  });
}

store.get(EZ_DEFAULTS, (stored) => {
  settings = ezSettings(stored);
  startCounting();
  place();

  new MutationObserver((records) => {
    if (theirs(records)) schedule();
  }).observe(document.body, { childList: true, subtree: true });
  // A single-page app changes the view without a load event.
  window.addEventListener('popstate', schedule);
});

chrome.storage.onChanged.addListener((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
  if (changes.copy) settings.copy = { ...EZ_DEFAULTS.copy, ...changes.copy.newValue };
  // A settings change is the one time a placement *should* move -- but only the
  // one that was changed. Rebuilding both means a tile that nobody touched is
  // destroyed and recreated because somebody picked a gap for the band.
  const touched = (keys) => keys.some((key) => key in changes);
  if (touched(['row', 'placeTile', 'matchUi', 'copy', 'sponsor', 'sponsorLogo', 'sponsorBanner'])) removeAt('tile');
  if (touched(['gap', 'placeBand', 'matchUi', 'copy', 'sponsor', 'sponsorLogo', 'sponsorBanner'])) removeAt('band');
  place();
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === 'rows') {
    respond({ rows: findRows().map((r) => r.label) });
    return true;
  }
  if (message?.type === 'stats') {
    flushStats();
    respond({ stats });
    return true;
  }
  if (message?.type === 'resetStats') {
    stats = { watchSeconds: 0, playSeconds: 0, impressions: 0, opens: 0, since: Date.now() };
    store.set({ [STATS_KEY]: stats });
    respond({ ok: true });
    return true;
  }
  if (message?.type === 'pick') {
    setPicking(message.for === 'band' ? 'band' : 'tile');
    respond({ ok: true });
  }
  return undefined;
});
