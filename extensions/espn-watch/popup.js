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
const statsNote = document.getElementById('stats');
const resetStats = document.getElementById('resetStats');
const openOptions = document.getElementById('openOptions');

/**
 * The two placements, each with its own switch, its own position and its own
 * picker.
 *
 * A table rather than two copies of the same code: they differ in four strings
 * and in which key they write, and the version that had a branch per difference
 * grew one that was only right for the tile.
 */
const PLACEMENTS = [
  {
    which: 'tile',
    flag: 'placeTile',
    key: 'row',
    // A tile goes *in* a row, so the options are rows.
    name: (label) => label,
    firstOption: 'First row',
    counted: (n) => `${n} row${n === 1 ? '' : 's'} on this page`,
    pickLabel: 'Pick a row on the page',
    end: false,
  },
  {
    which: 'band',
    flag: 'placeBand',
    key: 'gap',
    // A band goes in a *gap*, and a gap is named by the row underneath it --
    // because "JUST FOR YOU" on its own is ambiguous about which side of it the
    // band lands on. The last gap has no row below it and is named separately.
    name: (label) => `Above ${label}`,
    firstOption: 'Above the first row',
    counted: (n) => `${n + 1} gap${n === 0 ? '' : 's'} on this page`,
    pickLabel: 'Pick the row below it',
    end: true,
  },
];

/** The gap below the last row, which no row can name. */
const END = '__end';

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Everything about one placement, found by convention from its name. */
function parts(placement) {
  return {
    box: document.getElementById(placement.flag),
    where: document.getElementById(`${placement.which}Where`),
    select: document.getElementById(placement.key),
    note: document.getElementById(`${placement.key}Note`),
    pick: document.getElementById(placement.which === 'band' ? 'pickGap' : 'pickRow'),
  };
}

/**
 * The rows on the page, asked for once and offered to both pickers.
 *
 * Timed out, because `sendMessage` to a content script that never answers does
 * not reject -- it waits. On a watch page mid-render, answering means measuring
 * every candidate rail on it, and the popup sat blank for as long as that took
 * and forever if the script's context had been invalidated by a reload. A
 * picker that says "open espn.com/watch" is wrong in a way somebody can act on;
 * a popup that shows nothing is not.
 */
async function pageRows() {
  const tab = await activeTab();
  if (!tab?.id) return null;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tab.id, { type: 'rows' }).then((reply) => reply?.rows ?? []),
      new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
  } catch {
    return null;
  }
}

function fillPicker(placement, rows, selected) {
  const { select, note, pick } = parts(placement);
  if (rows === null) {
    note.textContent = 'Open espn.com/watch to choose';
    select.disabled = true;
    pick.disabled = true;
    return;
  }

  // Both were disabled while the page was being asked; the answer is here.
  select.disabled = false;
  pick.disabled = false;

  select.replaceChildren();
  const first = document.createElement('option');
  first.value = '';
  first.textContent = placement.firstOption;
  select.appendChild(first);

  // De-duplicated: two rows can share a heading, and a picker with the same
  // word three times is a picker nobody can use.
  const seen = new Set();
  for (const label of rows) {
    if (seen.has(label)) continue;
    seen.add(label);
    const option = document.createElement('option');
    option.value = label;
    const shown = label.length > 24 ? `${label.slice(0, 23)}\u2026` : label;
    option.textContent = placement.name(shown);
    select.appendChild(option);
  }

  if (placement.end) {
    const end = document.createElement('option');
    end.value = END;
    end.textContent = 'Below the last row';
    select.appendChild(end);
  }

  if (selected && (seen.has(selected) || selected === END)) select.value = selected;
  note.textContent = placement.counted(seen.size);
  pick.textContent = placement.pickLabel;
}

/**
 * The popup draws itself from storage, and only the row list waits.
 *
 * Every switch in here is answered by `chrome.storage.local`, which is local
 * and instant. The row list is the one thing that has to ask the page. Holding
 * the whole render behind that ask -- which is what this did -- meant the
 * popup opened *empty*, switches included, for as long as a busy watch page
 * took to measure its rails, and stayed empty when it never answered at all.
 * So: draw everything, then fill the two pickers when the page replies.
 */
chrome.storage.local.get(EZ_DEFAULTS, (stored) => {
  const settings = ezSettings(stored);
  enabled.checked = settings.enabled;
  matchUi.checked = settings.matchUi;

  for (const placement of PLACEMENTS) {
    const { box, where, select, pick } = parts(placement);
    box.checked = settings[placement.flag];
    where.hidden = !box.checked;
    waiting(placement);

    box.addEventListener('change', () => {
      where.hidden = !box.checked;
      // `placement: null` retires the setting these two flags replaced. Left
      // in storage it is read as a migration on every load and puts the flag
      // somebody just changed back where it was.
      chrome.storage.local.set({ [placement.flag]: box.checked, placement: null });
    });

    select.addEventListener('change', () => {
      chrome.storage.local.set({ [placement.key]: select.value || null });
    });

    pick.addEventListener('click', async () => {
      const tab = await activeTab();
      if (!tab?.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'pick', for: placement.which });
        // The popup has to close, or the click that chooses a row lands on
        // the popup instead of the page.
        window.close();
      } catch {
        pick.textContent = 'Open espn.com/watch first';
      }
    });
  }

  void pageRows().then((rows) => {
    for (const placement of PLACEMENTS) fillPicker(placement, rows, settings[placement.key]);
  });
});

/** What a picker says while the page is still being asked. */
function waiting(placement) {
  const { select, note, pick } = parts(placement);
  select.disabled = true;
  pick.disabled = true;
  note.textContent = 'Reading the page\u2026';
}

enabled.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: enabled.checked });
});

matchUi.addEventListener('change', () => {
  chrome.storage.local.set({ matchUi: matchUi.checked });
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
