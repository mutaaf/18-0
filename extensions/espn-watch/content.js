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

let settings = { row: null, matchUi: true, enabled: true, placement: 'tile' };
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

    // Laid out in a line: every child shares a top edge, and widths agree.
    const inLine = boxes.every((b) => Math.abs(b.top - first.top) < 8);
    const evenWidth = boxes.every((b) => Math.abs(b.width - first.width) < 24);
    if (!inLine || !evenWidth) continue;

    found.push({ node, label: labelFor(node), tile: kids[0] });
  }

  // Innermost only. A carousel is usually a list inside a wrapper inside a
  // section, and all three can pass the test above -- which gave the picker the
  // same row three times and made "the first row" mean whichever of the three
  // happened to be measured first.
  return found.filter((row) => !found.some((other) => other !== row && row.node.contains(other.node)));
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
// The card
// ---------------------------------------------------------------------------

/**
 * Copies a neighbour's shape, when asked to.
 *
 * "Match the UI" is about *fitting the row* -- the same box, the same corner,
 * the same caption block underneath -- not about pretending to be an ESPN
 * programme. The card keeps the game's name and mark either way; what changes is
 * whether it sits in the row like a tile or announces itself like an advert.
 */
function shapeFrom(tile) {
  if (!tile) return { width: 232, height: 130, radius: 6 };
  const box = tile.getBoundingClientRect();
  const style = getComputedStyle(tile);
  return {
    width: Math.round(box.width),
    height: artHeight(tile, box.width),
    radius: parseInt(style.borderRadius, 10) || 6,
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

  card.innerHTML = `
    <button class="ez-art" type="button" aria-label="Play 18-0, a pro football history game">
      <span class="ez-weave" aria-hidden="true"></span>
      <span class="ez-mark">18<span class="ez-dash">-</span>0</span>
      <span class="ez-tag">Play a season</span>
      <span class="ez-badge">Interactive</span>
    </button>
    <p class="ez-title">18-0 — build the perfect roster</p>
    <p class="ez-meta">Seven spins · Plays here</p>
  `;

  card.querySelector('.ez-art').addEventListener('click', openPanel);
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
  band.innerHTML = `
    <span class="ez-weave" aria-hidden="true"></span>
    <div class="ez-band-text">
      <p class="ez-band-kicker">Play</p>
      <p class="ez-band-title">18<span class="ez-dash">-</span>0 — build the perfect roster</p>
      <p class="ez-band-sub">Seven spins, sixty years of pro football, one undefeated season.</p>
    </div>
    <button class="ez-band-go" type="button">Play a season</button>
  `;
  band.querySelector('.ez-band-go').addEventListener('click', openPanel);
  return band;
}

/**
 * The shelf a row belongs to — the block that also holds its heading.
 *
 * The band goes *before* this, so it sits between one row and the next rather
 * than between a heading and the rail it labels.
 */
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
    if (settings.row === END) placedIn.insertBefore(buildHeader(), anchor.nextElementSibling);
    else placedIn.insertBefore(buildHeader(), anchor);
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

chrome.storage.local.get({ row: null, matchUi: true, enabled: true, placement: 'tile' }, (stored) => {
  settings = { ...settings, ...stored };
  place();

  new MutationObserver((records) => {
    if (theirs(records)) schedule();
  }).observe(document.body, { childList: true, subtree: true });
  // A single-page app changes the view without a load event.
  window.addEventListener('popstate', schedule);
});

chrome.storage.onChanged.addListener((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
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
  if (message?.type === 'pick') {
    setPicking(true);
    respond({ ok: true });
  }
  return undefined;
});
