import source from '../../../store/whats-new.json';

/**
 * The release notes, typed.
 *
 * The text lives in `apps/mobile/store/whats-new.json` rather than here because
 * Node reads it too: `scripts/store/release.mjs` writes it into the release tag
 * and `push-listing.mjs` sends it to the App Store's "What's New". One file, so
 * the sheet in the app and the store page cannot disagree.
 *
 * Pure data, no React Native, so the tests can read it in a node environment.
 */

/**
 * The art a callout card may wear: the app's own icon, or one of the dock's
 * tiles. A closed list, because a callout pointing at art that does not exist
 * would render as an empty square, and the test checks every key against it.
 * Never the crown -- that is reserved for an earned 17-0 (Crown.tsx).
 */
export const CALLOUT_ART = ['icon', 'play', 'games', 'leaderboard', 'challenges', 'stats'] as const;
export type CalloutArt = (typeof CALLOUT_ART)[number];

export interface Callout {
  readonly art: CalloutArt;
  /** A few words. */
  readonly title: string;
  /** One short line. */
  readonly line: string;
}

export interface ReleaseNotes {
  readonly version: string;
  readonly headline: string;
  readonly subhead: string;
  /** Two to four. */
  readonly callouts: readonly Callout[];
  /** The full notes, one change per entry; the store text is built from these. */
  readonly notes: readonly string[];
}

export const RELEASE_NOTES: readonly ReleaseNotes[] = (source.versions as unknown as ReleaseNotes[]);

export function notesFor(version: string | null | undefined): ReleaseNotes | null {
  if (!version) return null;
  return RELEASE_NOTES.find((entry) => entry.version === version) ?? null;
}
