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

const DEFAULTS = { row: null, matchUi: true, enabled: true };

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Ask the page what rows it has. Fails quietly on a tab with no content script. */
async function loadRows(selected) {
  const tab = await activeTab();
  if (!tab?.id) return;
  let rows = [];
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'rows' });
    rows = reply?.rows ?? [];
  } catch {
    // Not an ESPN Watch tab, or the page has not finished loading.
    rowNote.textContent = 'Open espn.com/watch to choose';
    rowSelect.disabled = true;
    pick.disabled = true;
    return;
  }

  // De-duplicated: two rows can share a heading, and a picker with the same
  // word three times is a picker nobody can use.
  const seen = new Set();
  for (const label of rows) {
    if (seen.has(label)) continue;
    seen.add(label);
    const option = document.createElement('option');
    option.value = label;
    option.textContent = label.length > 30 ? `${label.slice(0, 29)}…` : label;
    rowSelect.appendChild(option);
  }

  if (selected && seen.has(selected)) rowSelect.value = selected;
  rowNote.textContent = `${seen.size} row${seen.size === 1 ? '' : 's'} on this page`;
}

chrome.storage.local.get(DEFAULTS, (stored) => {
  enabled.checked = stored.enabled;
  matchUi.checked = stored.matchUi;
  void loadRows(stored.row);
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
