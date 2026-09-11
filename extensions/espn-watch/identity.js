/**
 * Linking an ESPN sign-in to a game result, with permission and not otherwise.
 *
 * ---------------------------------------------------------------------------
 * WHAT SWID IS, AND WHY THIS IS CAREFUL
 * ---------------------------------------------------------------------------
 *
 * SWID is the identifier ESPN sets for a signed-in fan. It is stable, it is
 * unique to a person, and it is readable from any script running on the page --
 * which makes it trivial to take and exactly the sort of thing that should not
 * be taken quietly. A persistent unique identifier is personal data whatever it
 * is called, and "we could read it" has never been the same question as "we may
 * hold it".
 *
 * So:
 *
 *   - **Nothing happens without an explicit yes.** Default off, asked once, in
 *     plain words, with what it is for stated before the button rather than
 *     underneath it.
 *   - **The raw value is never stored or sent.** What is kept is a SHA-256 of
 *     the SWID with a per-install random salt, which is stable enough to be the
 *     same fan tomorrow and useless to anybody who ever sees it -- including us.
 *     It cannot be turned back into a SWID, and it cannot be matched against
 *     anybody else's copy of the same fan.
 *   - **It is revocable, and revoking deletes.** Turning it off removes the
 *     derived id and the salt, so the next yes produces a different id and
 *     nothing links the two.
 *
 * This is a demo extension loaded unpacked. If it ever became something people
 * install from a store, this would need a privacy policy naming it and a lawful
 * basis, and the salt would need to not be the only thing standing between a
 * hash and a rainbow table of every SWID in circulation.
 */

const EZ_IDENTITY_KEY = 'identity';

/** The cookie ESPN sets, in the form `{XXXXXXXX-...}`. */
function ezReadSwid() {
  try {
    const match = document.cookie.match(/(?:^|;\s*)SWID=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/** Whether there is anything to link: a signed-in fan on this page. */
function ezSwidPresent() {
  return Boolean(ezReadSwid());
}

async function ezHash(value, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Records consent and derives the id.
 *
 * Returns the stored identity, or null when there was no SWID to read -- which
 * is what a signed-out visitor gets, and is not an error.
 */
async function ezGrantIdentity() {
  const swid = ezReadSwid();
  if (!swid) return null;

  const salt = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const identity = {
    linked: true,
    at: Date.now(),
    salt,
    // Prefixed so a stray value in a log is recognisable as ours and as a
    // digest rather than as somebody's actual identifier.
    id: `ezf_${await ezHash(swid, salt)}`,
  };

  await chrome.storage.local.set({ [EZ_IDENTITY_KEY]: identity });
  return identity;
}

/** Forgets it. The salt goes too, so a later yes cannot be joined to this one. */
async function ezRevokeIdentity() {
  await chrome.storage.local.remove(EZ_IDENTITY_KEY);
}

async function ezIdentity() {
  const got = await chrome.storage.local.get({ [EZ_IDENTITY_KEY]: null });
  return got[EZ_IDENTITY_KEY];
}

if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, {
    EZ_IDENTITY_KEY,
    ezReadSwid,
    ezSwidPresent,
    ezGrantIdentity,
    ezRevokeIdentity,
    ezIdentity,
  });
}
