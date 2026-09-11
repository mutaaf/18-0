/**
 * The controls.
 *
 * Everything here writes to `chrome.storage.local` and nothing else: the
 * content script listens for changes and re-places the card, so there is one
 * direction of travel and no state to keep in step between two documents. The
 * only message sent is for the two things storage cannot answer -- which rows
 * exist on the page right now, and "let me click one".
 */

const enabled = document.getElementById('enabled');
const matchUi = document.getElementById('matchUi');
const rowSelect = document.getElementById('row');
const rowNote = document.getElementById('rowNote');
const pick = document.getElementById('pick');
const placement = document.getElementById('placement');
const whereLabel = document.getElementById('whereLabel');
const statsNote = document.getElementById('stats');
const resetStats = document.getElementById('resetStats');
const openOptions = document.getElementById('openOptions');

/** The gap below the last row, which no row can name. */
const END = '__end';

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Ask the page what rows it has, and offer them the way the current placement
 * uses them.
 *
 * A tile goes *in* a row, so the options are rows. A band goes in a *gap*, and
 * a gap is named by the row underneath it -- "Above JUST FOR YOU" -- because
 * "JUST FOR YOU" on its own would be ambiguous about which side of it the band
 * lands on. The last gap has no row below it and is named separately.
 */
async function loadRows(selected, mode) {
  const tab = await activeTab();
  if (!tab?.id) return;
  let rows = [];
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'rows' });
    rows = reply?.rows ?? [];
  } catch {
    rowNote.textContent = 'Open espn.com/watch to choose';
    rowSelect.disabled = true;
    pick.disabled = true;
    return;
  }

  const header = mode === 'header';
  rowSelect.replaceChildren();
  whereLabel.childNodes[0].nodeValue = header ? 'Gap' : 'Row';

  const first = document.createElement('option');
  first.value = '';
  first.textContent = header ? 'Above the first row' : 'First row';
  rowSelect.appendChild(first);

  // De-duplicated: two rows can share a heading, and a picker with the same
  // word three times is a picker nobody can use.
  const seen = new Set();
  for (const label of rows) {
    if (seen.has(label)) continue;
    seen.add(label);
    const option = document.createElement('option');
    option.value = label;
    const shown = label.length > 24 ? `${label.slice(0, 23)}\u2026` : label;
    option.textContent = header ? `Above ${shown}` : shown;
    rowSelect.appendChild(option);
  }

  if (header) {
    const end = document.createElement('option');
    end.value = END;
    end.textContent = 'Below the last row';
    rowSelect.appendChild(end);
  }

  if (selected && (seen.has(selected) || selected === END)) rowSelect.value = selected;
  rowNote.textContent = header
    ? `${seen.size + 1} gap${seen.size === 0 ? '' : 's'} on this page`
    : `${seen.size} row${seen.size === 1 ? '' : 's'} on this page`;
  pick.textContent = header ? 'Pick the row below it' : 'Pick a row on the page';
}

chrome.storage.local.get(EZ_DEFAULTS, (stored) => {
  enabled.checked = stored.enabled;
  matchUi.checked = stored.matchUi;
  placement.value = stored.placement;
  void loadRows(stored.row, stored.placement);
});

placement.addEventListener('change', () => {
  // The stored position is dropped: "above the third row" and "in the third
  // row" are different places, and carrying one over as the other silently
  // moves the thing somebody just placed.
  chrome.storage.local.set({ placement: placement.value, row: null });
  void loadRows(null, placement.value);
});

enabled.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: enabled.checked });
});

matchUi.addEventListener('change', () => {
  chrome.storage.local.set({ matchUi: matchUi.checked });
});

rowSelect.addEventListener('change', () => {
  chrome.storage.local.set({ row: rowSelect.value || null });
});

pick.addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'pick' });
    // The popup has to close, or the click that chooses a row lands on the
    // popup instead of the page.
    window.close();
  } catch {
    pick.textContent = 'Open espn.com/watch first';
  }
});


// --- what the card has been worth ------------------------------------------

/** `754` -> `12m 34s`. Minutes first, because that is the unit a pitch uses. */
function clock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function loadStats() {
  const tab = await activeTab();
  if (!tab?.id) return;
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'stats' });
    const s = reply?.stats;
    if (!s) return;
    statsNote.textContent =
      `${clock(s.watchSeconds)} watched · ${clock(s.playSeconds)} played · `
      + `${s.impressions} shown, ${s.opens} opened`;
  } catch {
    statsNote.textContent = 'Counted while you are on espn.com/watch';
  }
}

void loadStats();

resetStats.addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'resetStats' });
    statsNote.textContent = 'Nothing counted yet';
  } catch {
    // Not an ESPN tab; nothing to reset.
  }
});

openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());
