import type { Archetype, EraKey, Position } from '@18-0/domain';

/**
 * The bundled historical dataset.
 *
 * NFL history does not change, so this is computed once by `pnpm build:dataset`
 * and shipped inside the app. The core game loop needs no network at all: a
 * spin, the eligible list, and the rating are all local. The server only ever
 * needs to exist for leaderboards and challenges.
 */

/**
 * A franchise, identified by where it plays.
 *
 * `name` and `nick` are both the city — the club name is a trademark and is
 * dropped when the dataset is built, so nothing downstream can leak one. The
 * colours are generated per franchise rather than taken from the club's own
 * palette, and there is deliberately no logo field: the marks are not ours.
 */
export interface DatasetFranchise {
  readonly id: string;
  /** Geographic short code, e.g. `BAL`. */
  readonly abbr: string;
  /** The city, e.g. `Baltimore`. */
  readonly name: string;
  /** The city again, kept for callers that want the short label. */
  readonly nick: string;
  readonly conference: string;
  readonly color: string;
  readonly color2: string;
}

export interface DatasetEra {
  readonly key: EraKey;
  /** An editorial name for the period, e.g. "The Passing Boom". */
  readonly name: string;
  /** The year range, e.g. "1999–2004". */
  readonly label: string;
  readonly startYear: number;
  readonly endYear: number;
  readonly tagline: string;
}

/** A headline stat shown on a player card, already formatted for display. */
export interface StatLine {
  readonly label: string;
  readonly value: string;
}

/**
 * A component score, stored compactly — labels are looked up from the position
 * model by key at read time, which keeps the bundled file about a third of the
 * size it would otherwise be.
 */
export interface DatasetComponent {
  /** Component key, matching the position model. */
  readonly k: string;
  /** Component score, 0-100. */
  readonly s: number;
  /** Effective weight after unavailable components were redistributed. */
  readonly w: number;
  /** Which metric in the fallback hierarchy supplied the score. */
  readonly m: string | null;
  /** Era-relative z-score, or null for percentile-based components. */
  readonly z: number | null;
}

/** A card as it ships in the boot dataset — component scores live separately. */
export type BootCard = Omit<DatasetCard, 'components' | 'unavailable'>;

export interface DatasetCard {
  readonly id: string;
  /** Stable identity across seasons — blocks the same player twice (PRFAQ §42). */
  readonly entityId: string;
  readonly name: string;
  readonly position: Position;
  readonly franchiseId: string;
  readonly year: number;
  readonly era: EraKey;
  readonly rating: number;
  readonly games: number;
  readonly archetypes: readonly Archetype[];
  readonly stats: readonly StatLine[];
  readonly components: readonly DatasetComponent[];
  /** Components with no historical data, whose weight was redistributed. */
  readonly unavailable: readonly string[];
}

export interface DatasetCombo {
  readonly franchiseId: string;
  readonly era: EraKey;
  readonly spinWeight: number;
}

export interface Dataset {
  readonly version: string;
  readonly ratingModelVersion: string;
  readonly generatedAt: string;
  readonly source: string;
  readonly coverage: { readonly firstSeason: number; readonly lastSeason: number };
  readonly eras: readonly DatasetEra[];
  readonly franchises: readonly DatasetFranchise[];
  readonly combos: readonly DatasetCombo[];
  readonly cards: readonly BootCard[];
}
