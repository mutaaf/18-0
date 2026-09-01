/**
 * Core domain types for 18-0.
 *
 * These types are deliberately free of any React, network, or persistence
 * concern. Everything in this package is a pure function of its inputs so that
 * the client preview score and the server-authoritative score are computed by
 * the exact same code path (PRFAQ §26, §36).
 */

// ---------------------------------------------------------------------------
// Roster shape (PRFAQ §6.1)
// ---------------------------------------------------------------------------

export const ROSTER_SLOTS = [
  'QB',
  'RB1',
  'RB2',
  'WR1',
  'WR2',
  'TE1',
  'DEF',
] as const;

export type RosterSlot = (typeof ROSTER_SLOTS)[number];

export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DEF'] as const;
export type Position = (typeof POSITIONS)[number];

/** Which position may legally occupy each roster slot. */
export const SLOT_POSITION: Readonly<Record<RosterSlot, Position>> = {
  QB: 'QB',
  RB1: 'RB',
  RB2: 'RB',
  WR1: 'WR',
  WR2: 'WR',
  TE1: 'TE',
  DEF: 'DEF',
};

// ---------------------------------------------------------------------------
// Eras and franchises (PRFAQ §6.2, §27)
// ---------------------------------------------------------------------------

export const ERA_KEYS = [
  '1950s',
  '1960s',
  '1970s',
  '1980s',
  '1990s',
  '2000s',
  '2010s',
  '2020s',
] as const;

export type EraKey = (typeof ERA_KEYS)[number];

export interface Era {
  readonly key: EraKey;
  readonly label: string;
  readonly startYear: number;
  readonly endYear: number;
  readonly sortOrder: number;
}

export interface Franchise {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
  readonly abbreviation: string;
  readonly city: string;
  /** First season the franchise (or its lineage) played. */
  readonly activeFrom: number;
  /** Last season played, or null if still active. */
  readonly activeTo: number | null;
  readonly primaryColor: string;
  readonly secondaryColor: string;
}

/** A legal wheel outcome. Invalid pairs (JAX + 1970s) must never be generated. */
export interface FranchiseEra {
  readonly franchiseId: string;
  readonly era: EraKey;
  readonly spinWeight: number;
}

export interface SpinResult {
  readonly sequence: number;
  readonly franchiseId: string;
  readonly era: EraKey;
}

// ---------------------------------------------------------------------------
// Rated entities
// ---------------------------------------------------------------------------

/**
 * Chemistry inputs (PRFAQ §16). Tags describe *how* a season produced its
 * value, not how good it was. Kept small and additive on purpose.
 */
export const ARCHETYPES = [
  'deep_passer',
  'precision_passer',
  'dual_threat_qb',
  'vertical_receiver',
  'possession_receiver',
  'yac_receiver',
  'receiving_back',
  'power_back',
  'explosive_back',
  'seam_te',
  'blocking_te',
  'ball_hawk_defense',
  'pressure_defense',
  'stonewall_defense',
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

/**
 * A single scored, selectable card. Either a player-season or a team defensive
 * season — the scoring model only ever needs the rating plus its identity and
 * archetypes, so both collapse to one shape here.
 */
export interface RatedSeason {
  /** Stable id of the underlying player_season_rating or defense_season row. */
  readonly id: string;
  /**
   * Identity used for the "same player may not occupy two slots" rule
   * (PRFAQ §42). For defenses this is the franchise-season.
   */
  readonly entityId: string;
  readonly entityType: 'player' | 'defense';
  readonly displayName: string;
  readonly position: Position;
  readonly franchiseId: string;
  readonly seasonYear: number;
  readonly era: EraKey;
  /** 0-100, produced by the position rating models (PRFAQ §11). */
  readonly rating: number;
  readonly archetypes: readonly Archetype[];
  readonly ratingModelVersion: string;
}

export interface RosterSelection {
  readonly slot: RosterSlot;
  readonly season: RatedSeason;
  /** The spin that made this selection legal. */
  readonly spinSequence: number;
}

/** A roster with all seven slots filled. */
export type CompletedRoster = Readonly<Record<RosterSlot, RosterSelection>>;

/** A roster mid-build. */
export type PartialRoster = Readonly<Partial<Record<RosterSlot, RosterSelection>>>;

// ---------------------------------------------------------------------------
// Scoring output
// ---------------------------------------------------------------------------

export interface SlotPenalty {
  readonly slot: RosterSlot;
  readonly rating: number;
  readonly shortfall: number;
  readonly penalty: number;
}

export interface EliteDepthDetail {
  readonly countAt95: number;
  readonly countAt98: number;
  readonly bonus: number;
  readonly cappedAt: number | null;
}

export interface ChemistryLink {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

export interface ChemistryDetail {
  readonly links: readonly ChemistryLink[];
  readonly raw: number;
  readonly bonus: number;
}

export interface ScoreBreakdown {
  readonly baseRating: number;
  readonly weakLinkPenalty: number;
  readonly weakLinkDetail: readonly SlotPenalty[];
  readonly eliteBonus: number;
  readonly eliteDetail: EliteDepthDetail;
  readonly chemistryBonus: number;
  readonly chemistryDetail: ChemistryDetail;
  readonly rawTeamRating: number;
}

// ---------------------------------------------------------------------------
// Records and endings (PRFAQ §19, §20)
// ---------------------------------------------------------------------------

export type Tier = 'F' | 'D' | 'C-' | 'C' | 'C+' | 'B-' | 'B' | 'B+' | 'A-' | 'A' | 'A+' | 'S' | 'S+' | 'IMMORTAL';

export interface Ending {
  readonly key: string;
  readonly label: string;
  readonly tier: Tier;
  readonly wins: number;
  readonly losses: number;
}

export interface GameRecord {
  readonly wins: number;
  readonly losses: number;
}

// ---------------------------------------------------------------------------
// Perfection gates (PRFAQ §21)
// ---------------------------------------------------------------------------

export interface FailedGate {
  readonly kind: 'slot_minimum' | 'position_minimum' | 'elite_count';
  readonly slot: RosterSlot | null;
  readonly required: number;
  readonly actual: number;
  readonly message: string;
}

export interface PerfectEligibility {
  readonly eligible: boolean;
  readonly reachedThreshold: boolean;
  readonly failedGates: readonly FailedGate[];
}

export interface GameResult {
  readonly finalRating: number;
  readonly record: GameRecord;
  readonly ending: Ending;
  readonly breakdown: ScoreBreakdown;
  readonly perfectEligibility: PerfectEligibility;
  /** Points still needed to reach the 18-0 threshold. 0 once reached. */
  readonly distanceFromPerfection: number;
  readonly ratingModelVersion: string;
}
