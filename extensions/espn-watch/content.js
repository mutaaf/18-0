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

let settings = { row: null, matchUi: true, enabled: true };
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
  const rows = [];
  const seen = new Set();

  for (const node of document.querySelectorAll('ul, ol, div, section')) {
    if (seen.has(node)) continue;
    const kids = [...node.children].filter((c) => c.getBoundingClientRect().width > 80);
    if (kids.length < 3) continue;

    const boxes = kids.slice(0, 6).map((c) => c.getBoundingClientRect());
    const first = boxes[0];
    if (first.height < 60 || first.height > 420) continue;

    // Laid out in a line: every child shares a top edge, and widths agree.
    const inLine = boxes.every((b) => Math.abs(b.top - first.top) < 8);
    const evenWidth = boxes.every((b) => Math.abs(b.width - first.width) < 24);
    if (!inLine || !evenWidth) continue;

    seen.add(node);
    rows.push({ node, label: labelFor(node), tile: kids[0] });
  }
  return rows;
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
  if (settings.row === null) return rows[0];
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
  const art = tile.querySelector('img, picture, video');
  const artBox = art?.getBoundingClientRect();
  return {
    width: Math.round(box.width),
    // The artwork, not the whole tile: a Watch tile is a thumbnail with two
    // lines of caption under it, and matching the total height would put our
    // card's bottom edge level with their text.
    height: Math.round(artBox?.height || box.height),
    radius: parseInt(style.borderRadius, 10) || 6,
  };
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

function place() {
  if (!settings.enabled) return removeCard();

  const existing = document.getElementById(HOST_ID);
  const rows = findRows();
  const row = chosenRow(rows);
  if (!row) return;

  // The cheap guard: already in the right row, nothing to do.
  if (existing && existing.parentElement === row.node) return;

  removeCard();
  const card = buildCard(shapeFrom(row.tile));
  row.node.insertBefore(card, row.node.firstElementChild);
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

chrome.storage.local.get({ row: null, matchUi: true, enabled: true }, (stored) => {
  settings = { ...settings, ...stored };
  place();

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  // A single-page app changes the view without a load event.
  window.addEventListener('popstate', schedule);
});

chrome.storage.onChanged.addListener((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
  removeCard();
  place();
});

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === 'rows') {
    respond({ rows: findRows().map((r) => r.label) });
    return true;
  }
  if (message?.type === 'pick') {
    setPicking(true);
    respond({ ok: true });
  }
  return undefined;
});
