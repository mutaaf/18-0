/**
 * Everything the card says, and everything it counts.
 *
 * Loaded into the content script, the popup and the options page, so all three
 * agree about what the defaults are. There is exactly one copy of them, because
 * the alternative is an options page that resets a field to a value the card
 * never used.
 *
 * ---------------------------------------------------------------------------
 * ATTRIBUTION IS MEASURED LOCALLY AND STAYS LOCAL
 * ---------------------------------------------------------------------------
 *
 * Watch time, play time, impressions and opens are counted in the browser and
 * written to `chrome.storage.local`. Nothing is sent anywhere, and there is no
 * endpoint to send it to. That is a deliberate default rather than an unfinished
 * feature: the numbers a pitch needs -- "this card was seen eleven times,
 * opened three, and held attention for four minutes against twenty-two minutes
 * of watching" -- are exactly as convincing measured on one machine, and
 * measuring them on one machine collects nothing about anybody.
 *
 * Turning that into a pipeline is a different decision with consent and
 * retention attached to it, and it is not one a default should make quietly.
 */

const EZ_DEFAULTS = {
  // Placement. The two are independent -- both on at once is a real and asked
  // for state -- and so are their positions: `row` is the row the tile sits
  // *in*, `gap` the row the band sits *above*. One key holding both meant
  // choosing where the band went silently moved the tile.
  enabled: true,
  matchUi: true,
  placeTile: true,
  placeBand: false,
  row: null,
  gap: null,

  /**
   * What `placeTile`/`placeBand` replaced.
   *
   * Kept as a default so a stored `'tile'` or `'header'` is still *read*, and
   * migrated in `ezSettings`. Without it an install that had the band selected
   * came back showing a tile, which looks like the extension forgetting rather
   * than like a rename. Retired -- written back as null -- the first time the
   * popup touches a placement.
   */
  placement: null,

  // Attribution
  countWatch: true,
  countPlay: true,

  // Sponsorship. Empty by default: a placeholder sponsor is a sponsor somebody
  // forgets to remove before a screenshot.
  sponsor: '',
  sponsorLogo: '',

  /**
   * What `slots.bottomRight.show` replaced.
   *
   * Kept as a default for the same reason `placement` is: a setting that is not
   * asked for out of storage cannot be migrated, and an install that had turned
   * the sponsor line off must not come back showing one. Read in `ezSettings`
   * and never written.
   */
  sponsorBanner: null,

  /**
   * The four corners of the artwork, as named, positioned, typed slots.
   *
   * A corner is a *place* and it does not move: `topLeft` is the top left in
   * both placements, which is the whole point of naming them -- the tile and
   * the band are one composition at two sizes, and they drifted apart while
   * each built its own corners. What stands in a corner is configuration, and
   * so is whether anything stands there at all.
   *
   * The types:
   *
   *   logoImage      the game's mark, with a tagline under it. Has something to
   *                  draw with no file configured -- the wordmark is markup --
   *                  which is why it is not just `image`.
   *   image          a configured file, with a headline beside it. Nothing to
   *                  draw unconfigured, so it renders only its line of copy.
   *   pill           the call to action. The placement's control in the band,
   *                  a label inside the tile's own control in the tile.
   *   sponsoredPill  the sponsor line and the sponsor's logo.
   *
   * The text each one shows is not here. It is in `copy` below, keyed by the
   * placement, because it is copy and the options page already edits copy.
   *
   * **No club or league mark is bundled or defaulted to.** The only image this
   * ships is our own crest. A slot pointed at somebody else's file is a local
   * choice made by whoever typed the path, which is exactly what the slot is
   * for -- see the licence note in the root README.
   */
  slots: {
    topLeft: { type: 'logoImage', show: true, image: '' },
    topRight: { type: 'image', show: true, image: 'icons/crest.png' },
    bottomLeft: { type: 'pill', show: true, image: '' },
    bottomRight: { type: 'sponsoredPill', show: true, image: '' },
  },

  /**
   * The call to action, which is never the primary action.
   *
   * The primary action is playing, everywhere the card appears. This is the
   * secondary one -- a link out to whatever the demo is meant to send people to
   * -- so it is a text link beside the copy rather than a second button
   * competing with the first.
   *
   * `cta` off keeps the URL configured but draws nothing, the same way
   * `sponsorBanner` does, because the first thing anybody does before a
   * screenshot is turn it off and the second is turn it back on. An empty
   * `copy.ctaUrl` also means nothing is drawn -- there is no dead button state.
   */
  cta: true,

  /**
   * The logo slot: an image, sized and faded.
   *
   * Empty is the game's own crest, which ships in `icons/`. It is configurable
   * precisely so somebody can point it at their own mark locally; what the repo
   * ships is ours, and nothing here may ever default to a club or league mark.
   *
   * Width is the tile's, in pixels, and the band uses the same. Opacity is
   * 10-100 rather than 0-1 because it is typed into a number field by a human.
   */
  /**
   * Retired. The logo was one image for both placements, switched on and off
   * and sized on its own; it is `slots.topLeft` now, which is the same image in
   * the same corner and can also be moved, retyped or turned off with the three
   * beside it. Read once in `ezSettings` so an install that pointed it
   * somewhere keeps pointing there. `logoWidth` and `logoOpacity` have no
   * counterpart: a corner is laid out by the grid, and a width that only one of
   * the four could take was a setting that looked broken in the other three.
   */
  logoOn: null,
  logo: null,

  /**
   * Every string the card can show.
   *
   * `{sponsor}` may appear in any of them. With no sponsor set the token and the
   * punctuation holding it are removed rather than left as an empty gap, so the
   * defaults read correctly in both states and nobody has to maintain two sets.
   */
  copy: {
    tileTitle: '18-0 — build the perfect roster',
    tileSubtitle: 'Seven spins · Plays here',
    tileButton: 'Play a season',
    // The two lines the slots carry: a tagline under the mark and a headline
    // beside the image. Keyed by placement like every other string here, so the
    // band can say something longer than a 300px tile has room for.
    tileTagline: 'Build · Play · Goat',
    tileHeadline: 'Can you go perfect?',

    bandKicker: 'Play',
    bandTitle: '18-0 — build the perfect roster',
    bandSubtitle: 'Seven spins, sixty years of pro football, one undefeated season.',
    bandButton: 'Play a season',
    bandTagline: 'Build · Play · Goat',
    bandHeadline: 'Can you go perfect?',

    sponsorLine: 'Presented by {sponsor}',

    // The call to action. A URL is a copy field like any other so that
    // `{sponsor}` works in it -- a campaign link usually wants the name in it.
    ctaLabel: 'How it works',
    ctaUrl: 'https://18-0.co/',
  },
};

/**
 * Fills `{sponsor}` in, or takes the phrase out.
 *
 * An unset sponsor must not leave "Presented by" hanging, or a double space, or
 * a dangling separator. So when there is nothing to substitute the token is
 * removed along with the dot, dash, pipe or "presented by" that introduced it,
 * and the result is trimmed.
 */
function ezFill(text, sponsor) {
  if (typeof text !== 'string') return '';
  if (sponsor) return text.replace(/\{sponsor\}/g, sponsor);
  return text
    // "Presented by {sponsor}" / "with {sponsor}" -> nothing
    .replace(/\b(presented\s+by|sponsored\s+by|with|from)\s*\{sponsor\}/gi, '')
    // " · {sponsor}" / " — {sponsor}" / " | {sponsor}"
    .replace(/\s*[·\-–—|,]\s*\{sponsor\}/g, '')
    .replace(/\{sponsor\}\s*[·\-–—|,]\s*/g, '')
    .replace(/\{sponsor\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim()
    // A string that was nothing but the sponsor leaves an empty separator.
    .replace(/^[·\-–—|,]\s*|\s*[·\-–—|,]$/g, '')
    .trim();
}

/** The types a slot may be. Anything else came out of storage and is not one. */
const EZ_SLOT_TYPES = ['logoImage', 'image', 'pill', 'sponsoredPill'];

/** The corners, in the order they are built. Fixed: a position is not a setting. */
const EZ_SLOT_NAMES = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

/**
 * A configured URL, classified, or null if it may not be used at all.
 *
 * Every path here is typed by whoever set the extension up and every one of
 * them ends on a `src` or an `href` inside somebody else's page. `javascript:`
 * on an href is the hole everybody names; `data:` on an img is the one they do
 * not. So this is an allowlist of two schemes rather than a list of what to
 * ban -- a denylist is one scheme away from being wrong, and there are more
 * schemes than anybody remembers.
 *
 * The other legal answer is a file this extension ships: a bare relative path,
 * no scheme, no authority, no parent-directory hop. It is returned tagged
 * rather than resolved, because resolving it needs `chrome.runtime.getURL` --
 * a relative `src` set from a content script resolves against espn.com, not
 * against the extension, and silently 404s.
 */
function ezUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return url.protocol === 'http:' || url.protocol === 'https:'
        ? { kind: 'remote', href: url.href }
        : null;
    } catch {
      return null;
    }
  }

  // Anything carrying a scheme, an authority or a `..` is not a file of ours,
  // whatever it looks like. The character class is deliberately narrow: a query
  // string or a fragment on a bundled path is a path that does not exist.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('/') || raw.includes('..')) return null;
  return /^[\w.-]+(\/[\w.-]+)*$/.test(raw) ? { kind: 'bundled', href: raw } : null;
}


/**
 * A number a human typed, held to a range.
 *
 * Fields come back as strings, and an empty one is not a zero -- `Number('')`
 * is, which is how a cleared width field turned the logo into nothing visible
 * rather than into the default.
 */
function ezNumber(value, low, high, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || value === '' || value === null) return fallback;
  return Math.min(high, Math.max(low, n));
}

/**
 * Merges stored settings over the defaults, one level into `copy`, and reads
 * the retired `placement` as the pair of flags that replaced it.
 *
 * The migration is here rather than at each read site because there are three
 * of them -- the content script, the popup and the options page -- and two
 * agreeing about a legacy value while the third does not is an options page
 * that saves something the card never reads.
 */
function ezSettings(stored) {
  const merged = { ...EZ_DEFAULTS, ...stored };
  merged.copy = { ...EZ_DEFAULTS.copy, ...(stored?.copy ?? {}) };

  // Two levels, and only the four names we know. A spread would let a stored
  // slot arrive with no `type` at all -- which is what a half-written storage
  // write looks like -- and a fifth name would be a corner nothing lays out.
  merged.slots = {};
  for (const name of EZ_SLOT_NAMES) {
    merged.slots[name] = { ...EZ_DEFAULTS.slots[name], ...(stored?.slots?.[name] ?? {}) };
  }

  // `sponsorBanner` was "draw the sponsor line or do not", which is exactly what
  // the bottom-right slot's own `show` says now. Read as that, so an install
  // that had turned the banner off does not come back showing one. The stored
  // slot wins where there is one: it is the newer answer to the same question.
  if (stored?.sponsorBanner === false && stored?.slots?.bottomRight?.show === undefined) {
    merged.slots.bottomRight.show = false;
  }

  // `tileBadge` was the top-right corner before the corners were slots -- the
  // same few words in the same place, which is what the headline is now. A
  // renamed badge that came back as the default would read as the extension
  // forgetting rather than as a rename.
  if (stored?.copy?.tileBadge && stored?.copy?.tileHeadline === undefined) {
    merged.copy.tileHeadline = stored.copy.tileBadge;
  }

  // The logo was its own switch and its own URL before a corner was a slot.
  // The stored slot wins where there is one: it is the newer answer.
  if (stored?.logoOn === false && stored?.slots?.topLeft?.show === undefined) {
    merged.slots.topLeft.show = false;
  }
  if (stored?.logo && stored?.slots?.topLeft?.image === undefined) {
    merged.slots.topLeft.image = stored.logo;
  }

  if (stored?.placement === 'tile' || stored?.placement === 'header') {
    const band = stored.placement === 'header';
    merged.placeTile = !band;
    merged.placeBand = band;
    // The old single `row` meant whichever of the two that placement used.
    if (band) {
      merged.gap = stored.row ?? null;
      merged.row = null;
    }
  }
  return merged;
}

// Reachable from the popup and the options page, which load this as a plain
// script, as well as from the content script's isolated world.
if (typeof globalThis !== 'undefined') {
  globalThis.EZ_DEFAULTS = EZ_DEFAULTS;
  globalThis.EZ_SLOT_TYPES = EZ_SLOT_TYPES;
  globalThis.EZ_SLOT_NAMES = EZ_SLOT_NAMES;
  globalThis.ezFill = ezFill;
  globalThis.ezUrl = ezUrl;
  globalThis.ezNumber = ezNumber;
  globalThis.ezSettings = ezSettings;
}
