/**
 * The options page.
 *
 * Fields are addressed by the setting they hold -- an input with
 * `id="copy.tileTitle"` writes `copy.tileTitle` -- so adding a copy field is a
 * line of HTML and nothing here. The alternative is a list of field names in
 * two places that drift apart, which is how an options page ends up saving
 * something the card never reads.
 *
 * The path is walked rather than split into two levels, which is what the slot
 * fields need: `slots.topRight.image` is three deep and is still one line of
 * HTML.
 */

const IDENTITY_KEY = 'identity';

// Selects too, since a slot's type is one. They were inputs only, and the first
// slot select saved nothing at all -- silently, because a field the collector
// never sees is a field with no error to report.
const fields = [...document.querySelectorAll('input[id], select[id]')];
const savedNote = document.getElementById('saved');
const note = document.getElementById('note');
const linkState = document.getElementById('linkState');

/** The image fields, which are the only ones that become a `src`. */
const imageFields = fields.filter((field) => /(^sponsorLogo$|\.image$)/.test(field.id));

/** `copy.tileTitle` -> the value at that path, from the defaults if unset. */
function read(settings, path) {
  return path.split('.').reduce((at, key) => at?.[key], settings);
}

function write(target, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const parent = keys.reduce((at, key) => (at[key] ??= {}), target);
  parent[last] = value;
}

function show(settings) {
  for (const field of fields) {
    const value = read(settings, field.id);
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value ?? '';
  }
  for (const id of Object.keys(URL_NOTES)) sayWhatItDoes(id);
}

function collect() {
  const next = {};
  for (const field of fields) {
    if (field.type === 'checkbox') write(next, field.id, field.checked);
    // Stored as a number, because the card clamps it and `'76' < 24` is false
    // for the wrong reason. An emptied field keeps the default rather than
    // becoming a zero-width logo.
    else if (field.type === 'number') write(next, field.id, ezNumber(field.value, Number(field.min), Number(field.max), read(EZ_DEFAULTS, field.id)));
    // Held to the board's shape on the way in, so a name that would be
    // rejected later is rejected here, where there is a line saying why.
    else if (field.id === 'handle') write(next, field.id, ezHandle(field.value));
    else write(next, field.id, field.value.trim());
  }
  return next;
}

/**
 * What each URL field will do, said on the page.
 *
 * Both of the ways a URL field fails are silent on the card: an empty call to
 * action draws no link, and a mistyped one draws no link either. The options
 * page is the only place that can tell the difference between "off" and "typed
 * wrong", so it does -- the alternative is a dead button, or worse, nothing and
 * no explanation.
 */
const URL_NOTES = {
  'copy.ctaUrl': {
    empty: 'Empty: no call to action on the tile, the band or the panel.',
    bad: 'Not a link. It has to start with https:// or http:// — nothing will be shown.',
    ok: (url) => `Opens ${url} in a new tab.`,
  },
  handle: {
    empty: 'No name set.',
    bad: 'Not a name the board will take. 2 to 32 characters, starting and ending with a letter or a digit.',
    ok: (name) => `Kept as “${name}”. Nothing reads it yet — see below.`,
  },
  sponsorLogo: {
    empty: '',
    bad: 'Not usable. An https:// address, or a file this extension ships — no sponsor logo will be shown.',
    ok: () => '',
  },
};

function sayWhatItDoes(id) {
  const note = document.querySelector(`[data-note="${id}"]`);
  const field = document.getElementById(id);
  if (!note || !field) return;
  const notes = URL_NOTES[id];
  const raw = field.value.trim();
  // A name is checked by its own rule; everything else here is a URL.
  const value = id === 'handle' ? ezHandle(raw) : ezUrl(raw);
  note.classList.toggle('bad', Boolean(raw) && !value);
  note.textContent = !raw
    ? notes.empty
    : value
      ? notes.ok(typeof value === 'string' ? value : value.href)
      : notes.bad;
}

for (const id of Object.keys(URL_NOTES)) {
  document.getElementById(id)?.addEventListener('input', () => sayWhatItDoes(id));
}

function flash() {
  savedNote.classList.add('on');
  setTimeout(() => savedNote.classList.remove('on'), 1200);
}

/**
 * Says which image paths the card will refuse.
 *
 * Saving them anyway is deliberate: the card validates before it uses anything,
 * so a bad path is inert, and an options page that silently discards what
 * somebody typed is one they retype the same thing into. This is the only place
 * that can explain *why* nothing appeared.
 */
function checkImages() {
  const bad = imageFields.filter((field) => field.value.trim() && !ezUrl(field.value));
  for (const field of imageFields) field.classList.toggle('bad', bad.includes(field));
  note.textContent = bad.length
    ? `${bad.length === 1 ? 'One image is' : `${bad.length} images are`} not an https:// address or a file this extension ships, and will not be drawn.`
    : '';
}

chrome.storage.local.get(EZ_DEFAULTS, (stored) => {
  show(ezSettings(stored));
  checkImages();
});

for (const field of imageFields) field.addEventListener('input', checkImages);

document.getElementById('save').addEventListener('click', () => {
  checkImages();
  chrome.storage.local.set(collect(), flash);
});

document.getElementById('reset').addEventListener('click', () => {
  // Only the fields on this page. Placement and the row live in the popup, and
  // "restore defaults" here should not move somebody's card.
  const restore = {};
  for (const field of fields) write(restore, field.id, read(EZ_DEFAULTS, field.id));
  chrome.storage.local.set(restore, () => {
    show(ezSettings(restore));
    checkImages();
    flash();
  });
});

// --- the ESPN link ---------------------------------------------------------

function renderIdentity(identity) {
  if (identity?.linked) {
    linkState.innerHTML = '';
    linkState.append(
      document.createTextNode('Linked as '),
      Object.assign(document.createElement('b'), { textContent: identity.id.slice(0, 16) + '…' }),
      document.createTextNode(
        ` since ${new Date(identity.at).toLocaleDateString()}. That value is a hash, not your identifier.`,
      ),
    );
  } else if (identity?.declined) {
    linkState.textContent = 'Not linked. You declined; the game will not ask again.';
  } else {
    linkState.textContent = 'Not linked. You will be asked once, the next time you open the game.';
  }
}

chrome.storage.local.get({ [IDENTITY_KEY]: null }, (got) => renderIdentity(got[IDENTITY_KEY]));

document.getElementById('unlink').addEventListener('click', () => {
  // Removed rather than flagged: leaving the salt behind would let a later link
  // be joined to this one, which is the thing unlinking is supposed to prevent.
  chrome.storage.local.remove(IDENTITY_KEY, () => renderIdentity(null));
});
