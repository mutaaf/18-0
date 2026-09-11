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
 */

const HOST_ID = 'eighteen-zero-card';
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
      (c) => c.id !== HOST_ID && c.getBoundingClientRect().width > 80,
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
  // Walk up a few levels looking for the section heading that precedes it.
  let scope = node;
  for (let depth = 0; depth < 4 && scope; depth++) {
    let sibling = scope.previousElementSibling;
    while (sibling) {
      const text = (sibling.textContent || '').trim();
      if (text && text.length < 60) return text.split('\n')[0].trim();
      sibling = sibling.previousElementSibling;
    }
    const heading = scope.querySelector?.('h1, h2, h3');
    if (heading?.textContent?.trim()) return heading.textContent.trim();
    scope = scope.parentElement;
  }
  const label = (node.getAttribute('aria-label') || '').trim();
  return label || 'Row';
}

function chosenRow(rows) {
  if (!rows.length) return null;
  if (settings.row === null || settings.row === END) return rows[0];
  return rows.find((r) => r.label === settings.row) ?? rows[0];
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
const STATS_KEY = 'stats';

let stats = { watchSeconds: 0, playSeconds: 0, impressions: 0, opens: 0, since: null };
let ticker = null;

function loadStats(then) {
  chrome.storage.local.get({ [STATS_KEY]: null }, (got) => {
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
  chrome.storage.local.set({ [STATS_KEY]: stats });
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
  if (!tile) return { width: 232, height: 130, total: 190, radius: 6, marginLeft: 0, marginRight: 12 };
  const box = tile.getBoundingClientRect();
  const style = getComputedStyle(tile);
  return {
    width: Math.round(box.width),
    height: artHeight(tile, box.width),
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
 */
function artHeight(tile, width) {
  let best = 0;
  for (const el of tile.querySelectorAll('*')) {
    const b = el.getBoundingClientRect();
    if (b.width < width * 0.85 || b.height < 24) continue;
    const ratio = b.width / b.height;
    if (ratio < 1.45 || ratio > 2.2) continue;
    if (b.height > best) best = b.height;
  }
  // Nothing plausible: 16:9 of the width is what these rows are.
  return Math.round(best || (width * 9) / 16);
}

function buildCard(shape) {
  const card = document.createElement('div');
  card.id = HOST_ID;
  card.className = `ez-card${settings.matchUi ? ' ez-match' : ''}`;
  card.style.setProperty('--ez-w', `${shape.width}px`);
  card.style.setProperty('--ez-h', `${shape.height}px`);
  card.style.setProperty('--ez-r', `${shape.radius}px`);
  card.style.setProperty('--ez-th', `${shape.total}px`);
  card.style.setProperty('--ez-ml', `${shape.marginLeft}px`);
  card.style.setProperty('--ez-mr', `${shape.marginRight}px`);

  const say = (key) => ezFill(settings.copy[key], settings.sponsor);

  // Built rather than interpolated. Every string below is typed by whoever
  // configured the extension, and dropping user text into `innerHTML` inside
  // somebody else's page is how a sponsor name becomes a script tag.
  const art = el('button', 'ez-art');
  art.type = 'button';
  art.setAttribute('aria-label', `${say('tileTitle')}. ${say('tileButton')}.`);
  art.append(
    el('span', 'ez-weave', '', { 'aria-hidden': 'true' }),
    mark(),
    el('span', 'ez-tag', say('tileButton')),
  );
  if (say('tileBadge')) art.append(el('span', 'ez-badge', say('tileBadge')));
  if (settings.sponsor && settings.sponsorBanner) art.append(sponsorStrip());

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
 */
let placedIn = null;


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
function buildHeader() {
  const band = document.createElement('div');
  band.id = HOST_ID;
  band.className = `ez-band${settings.matchUi ? ' ez-match' : ''}`;
  const say = (key) => ezFill(settings.copy[key], settings.sponsor);

  const text = el('div', 'ez-band-text');
  if (say('bandKicker')) text.append(el('p', 'ez-band-kicker', say('bandKicker')));
  text.append(el('p', 'ez-band-title', say('bandTitle')));
  if (say('bandSubtitle')) text.append(el('p', 'ez-band-sub', say('bandSubtitle')));
  if (settings.sponsor && settings.sponsorBanner) text.append(sponsorStrip());

  const go = el('button', 'ez-band-go', say('bandButton'));
  go.type = 'button';

  band.append(el('span', 'ez-weave', '', { 'aria-hidden': 'true' }), text, go);

  go.addEventListener('click', openPanel);
  countImpression();
  return band;
}

/**
 * The shelf a row belongs to — the block that also holds its heading.
 *
 * The band goes *before* this, so it sits between one row and the next rather
 * than between a heading and the rail it labels.
 */
/**
 * How far a shelf's heading is inset from the container the band goes in.
 *
 * Returns null when there is no heading to line up with, in which case the
 * stylesheet's own margin stands -- a band that guesses an alignment is worse
 * than one that keeps a consistent default.
 */
function headingInset(shelf, container) {
  const heading = shelf.querySelector('h1, h2, h3');
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

/** The last shelf on the page, for the gap that has no row beneath it. */
function lastShelf() {
  const rows = findRows();
  if (!rows.length) return null;
  return shelfOf(rows[rows.length - 1].node);
}

function shelfOf(node) {
  let el = node;
  for (let depth = 0; depth < 6 && el.parentElement; depth++) {
    el = el.parentElement;
    if (el.querySelector('h1, h2, h3')) return el;
  }
  return node.parentElement ?? node;
}

function place() {
  if (!settings.enabled) return removeCard();

  const existing = document.getElementById(HOST_ID);

  // Still where we put it, and that row is still on the page: done. No
  // querying, no measuring, no work at all -- which matters, because this runs
  // behind a MutationObserver on a page that never stops re-rendering.
  if (existing && placedIn?.isConnected && existing.parentElement === placedIn) return;

  // The row we chose is gone (a re-render replaced it), or we have never
  // placed. Either way the question is worth asking again -- and it is asked
  // with the card out of the document, so the measurements describe the page
  // rather than describing our own effect on it.
  removeCard();
  placedIn = null;

  const row = chosenRow(findRows());
  if (!row) return;

  if (settings.placement === 'header') {
    // The band goes in a *gap*, and a gap is named by the row below it -- which
    // is why the picker says "Above JUST FOR YOU" rather than naming a row. The
    // last gap has no row below it, so it is named separately.
    const anchor = settings.row === END ? lastShelf() : shelfOf(row.node);
    if (!anchor) return;
    placedIn = anchor.parentElement;
    if (!placedIn) return;
    const band = buildHeader();
    // Aligned to the heading it sits between rather than to a number. The
    // shelves here are inset 24px, not the 32 a first guess used, and that
    // inset moves with the viewport -- so it is read off the real heading.
    const inset = headingInset(anchor, placedIn);
    if (inset !== null) {
      band.style.marginLeft = `${inset}px`;
      band.style.marginRight = `${inset}px`;
    }
    placedIn.insertBefore(band, settings.row === END ? anchor.nextElementSibling : anchor);
    return;
  }

  placedIn = row.node;
  // **Second, not first.** The first slot of these carousels sits under the
  // left edge of a `SECTION.overflow-hidden` and moves as the rail scrolls, so
  // a card placed there is clipped -- measured at x=-4 on a fresh load and
  // x=-110 a moment later, which is what "it flashes and I cannot click it"
  // looked like from the outside. The second slot is fully on screen at every
  // scroll position a page arrives in.
  const after = row.node.children[0];
  row.node.insertBefore(buildCard(shapeFrom(row.tile)), after?.nextElementSibling ?? null);
}

function removeCard() {
  document.getElementById(HOST_ID)?.remove();
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function openPanel() {
  if (document.getElementById(PANEL_ID)) return;
  countOpen();

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

  yes.addEventListener('click', async () => {
    await ezGrantIdentity();
    row.replaceChildren(el('p', 'ez-consent-done', 'Linked. Your seasons can rank on the shared board.'));
  });
  no.addEventListener('click', async () => {
    await chrome.storage.local.set({ [EZ_IDENTITY_KEY]: { linked: false, declined: true, at: Date.now() } });
    row.remove();
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

function setPicking(on) {
  picking = on;
  document.body.classList.toggle('ez-picking', on);
  if (on) document.addEventListener('click', onPick, true);
  else document.removeEventListener('click', onPick, true);
}

function onPick(event) {
  const rows = findRows();
  const hit = rows.find((r) => r.node.contains(event.target));
  if (!hit) return;
  event.preventDefault();
  event.stopPropagation();
  settings.row = hit.label;
  chrome.storage.local.set({ row: hit.label });
  setPicking(false);
  removeCard();
  placedIn = null;
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
    if (record.target?.id === HOST_ID || record.target?.closest?.(`#${HOST_ID}`)) return false;
    const ours = (nodes) => [...nodes].every((n) => n.id === HOST_ID);
    if (record.addedNodes.length && ours(record.addedNodes)) return false;
    if (record.removedNodes.length && ours(record.removedNodes)) return false;
    return true;
  });
}

chrome.storage.local.get(EZ_DEFAULTS, (stored) => {
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
  // A settings change is the one time the card *should* move, so the remembered
  // row is dropped rather than defended.
  removeCard();
  placedIn = null;
  place();
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === 'rows') {
    respond({ rows: findRows().map((r) => r.label), placement: settings.placement });
    return true;
  }
  if (message?.type === 'stats') {
    flushStats();
    respond({ stats });
    return true;
  }
  if (message?.type === 'resetStats') {
    stats = { watchSeconds: 0, playSeconds: 0, impressions: 0, opens: 0, since: Date.now() };
    chrome.storage.local.set({ [STATS_KEY]: stats });
    respond({ ok: true });
    return true;
  }
  if (message?.type === 'pick') {
    setPicking(true);
    respond({ ok: true });
  }
  return undefined;
});
