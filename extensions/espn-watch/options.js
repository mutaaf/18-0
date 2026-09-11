/**
 * The options page.
 *
 * Fields are addressed by the setting they hold -- an input with
 * `id="copy.tileTitle"` writes `copy.tileTitle` -- so adding a copy field is a
 * line of HTML and nothing here. The alternative is a list of field names in
 * two places that drift apart, which is how an options page ends up saving
 * something the card never reads.
 */

const IDENTITY_KEY = 'identity';

const fields = [...document.querySelectorAll('input[id]')];
const savedNote = document.getElementById('saved');
const linkState = document.getElementById('linkState');

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
}

function collect() {
  const next = {};
  for (const field of fields) {
    write(next, field.id, field.type === 'checkbox' ? field.checked : field.value.trim());
  }
  return next;
}

function flash() {
  savedNote.classList.add('on');
  setTimeout(() => savedNote.classList.remove('on'), 1200);
}

chrome.storage.local.get(EZ_DEFAULTS, (stored) => show(ezSettings(stored)));

document.getElementById('save').addEventListener('click', () => {
  chrome.storage.local.set(collect(), flash);
});

document.getElementById('reset').addEventListener('click', () => {
  // Only the fields on this page. Placement and the row live in the popup, and
  // "restore defaults" here should not move somebody's card.
  const restore = {};
  for (const field of fields) write(restore, field.id, read(EZ_DEFAULTS, field.id));
  chrome.storage.local.set(restore, () => {
    show(ezSettings(restore));
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
