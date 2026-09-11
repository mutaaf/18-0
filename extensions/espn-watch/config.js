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
  // Placement
  enabled: true,
  matchUi: true,
  placement: 'tile',
  row: null,

  // Attribution
  countWatch: true,
  countPlay: true,

  // Sponsorship. Empty by default: a placeholder sponsor is a sponsor somebody
  // forgets to remove before a screenshot.
  sponsor: '',
  sponsorLogo: '',
  sponsorBanner: true,

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
    tileBadge: 'Interactive',
    tileButton: 'Play a season',

    bandKicker: 'Play',
    bandTitle: '18-0 — build the perfect roster',
    bandSubtitle: 'Seven spins, sixty years of pro football, one undefeated season.',
    bandButton: 'Play a season',

    sponsorLine: 'Presented by {sponsor}',
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

/** Merges stored settings over the defaults, one level into `copy`. */
function ezSettings(stored) {
  const merged = { ...EZ_DEFAULTS, ...stored };
  merged.copy = { ...EZ_DEFAULTS.copy, ...(stored?.copy ?? {}) };
  return merged;
}

// Reachable from the popup and the options page, which load this as a plain
// script, as well as from the content script's isolated world.
if (typeof globalThis !== 'undefined') {
  globalThis.EZ_DEFAULTS = EZ_DEFAULTS;
  globalThis.ezFill = ezFill;
  globalThis.ezSettings = ezSettings;
}
