import type { Archetype, RosterSlot } from '../types.js';
import { GENERATED_CALIBRATION_ANCHORS } from './calibration.generated.js';

/**
 * The scoring model is *configuration*, not code constants (PRFAQ §20, §45).
 *
 * Nothing in this file may be inlined into a view component. Every completed
 * game stores `version` alongside its result so a recalibration never silently
 * rewrites history.
 */

export interface WeakLinkConfig {
  /** Slots rated below this contribute a penalty (PRFAQ §14). */
  readonly threshold: number;
  readonly exponent: number;
  readonly positionFactors: Readonly<Record<RosterSlot, number>>;
  /** Calibrated empirically by `pnpm calibrate`. */
  readonly scale: number;
}

export interface EliteDepthTier {
  readonly minRating: number;
  readonly minCount: number;
  readonly bonus: number;
}

export interface EliteDepthConfig {
  /** Within one band the highest satisfied tier wins; bands then sum. */
  readonly bands: readonly (readonly EliteDepthTier[])[];
  readonly cap: number;
}

export interface ChemistryClause {
  readonly slots: readonly RosterSlot[];
  readonly archetype: Archetype;
}

export interface ChemistryRule {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** All clauses must be satisfied by *distinct* slots for the rule to fire. */
  readonly all: readonly ChemistryClause[];
}

export interface ChemistryConfig {
  readonly rules: readonly ChemistryRule[];
  readonly min: number;
  readonly max: number;
}

export interface CalibrationAnchor {
  readonly raw: number;
  readonly final: number;
}

export interface CalibrationConfig {
  /** Monotonic piecewise-linear curve, ascending by `raw`. */
  readonly anchors: readonly CalibrationAnchor[];
}

export interface RecordBand {
  /** Inclusive floor. The highest floor at or below the rating wins. */
  readonly minRating: number;
  readonly endingKey: string;
}

export interface PerfectionConfig {
  readonly minFinalRating: number;
  /** Hard per-slot floors above the universal minimum. */
  readonly slotMinimums: Readonly<Partial<Record<RosterSlot, number>>>;
  readonly universalSlotMinimum: number;
  readonly eliteCount: { readonly minRating: number; readonly minCount: number };
  /** Where a roster lands when it clears the score but fails a gate. */
  readonly deniedEndingKey: string;
}

export interface ScoringConfig {
  readonly version: string;
  readonly rosterWeights: Readonly<Record<RosterSlot, number>>;
  readonly weakLink: WeakLinkConfig;
  readonly eliteDepth: EliteDepthConfig;
  readonly chemistry: ChemistryConfig;
  readonly calibration: CalibrationConfig;
  readonly recordBands: readonly RecordBand[];
  readonly perfection: PerfectionConfig;
}

// ---------------------------------------------------------------------------

/** Roster weighting (PRFAQ §13). Must sum to 1. */
const ROSTER_WEIGHTS: Readonly<Record<RosterSlot, number>> = {
  QB: 0.24,
  DEF: 0.18,
  WR1: 0.13,
  RB1: 0.12,
  WR2: 0.11,
  TE1: 0.11,
  RB2: 0.11,
};

const WEAK_LINK: WeakLinkConfig = {
  threshold: 90,
  exponent: 1.35,
  positionFactors: {
    QB: 1.2,
    DEF: 1.1,
    WR1: 1.0,
    RB1: 1.0,
    WR2: 0.95,
    TE1: 0.95,
    RB2: 0.95,
  },
  // Owned by the calibration harness. See docs/scoring-model.md.
  scale: 0.02,
};

const ELITE_DEPTH: EliteDepthConfig = {
  bands: [
    [
      { minRating: 95, minCount: 7, bonus: 0.75 },
      { minRating: 95, minCount: 5, bonus: 0.5 },
      { minRating: 95, minCount: 3, bonus: 0.25 },
    ],
    [
      { minRating: 98, minCount: 5, bonus: 0.4 },
      { minRating: 98, minCount: 3, bonus: 0.25 },
    ],
  ],
  cap: 1.25,
};

/**
 * Chemistry is deliberately small (PRFAQ §16). It never rescues a materially
 * weak roster, and historical teammates get no automatic bonus.
 */
const CHEMISTRY: ChemistryConfig = {
  min: -1,
  max: 1,
  rules: [
    {
      key: 'DEEP_SHOT',
      label: 'Deep passer + vertical threat',
      value: 0.35,
      all: [
        { slots: ['QB'], archetype: 'deep_passer' },
        { slots: ['WR1', 'WR2'], archetype: 'vertical_receiver' },
      ],
    },
    {
      key: 'CHECKDOWN_ENGINE',
      label: 'Precision passer + receiving back',
      value: 0.25,
      all: [
        { slots: ['QB'], archetype: 'precision_passer' },
        { slots: ['RB1', 'RB2'], archetype: 'receiving_back' },
      ],
    },
    {
      key: 'THUNDER_AND_LIGHTNING',
      label: 'Complementary backfield',
      value: 0.2,
      all: [
        { slots: ['RB1', 'RB2'], archetype: 'power_back' },
        { slots: ['RB1', 'RB2'], archetype: 'explosive_back' },
      ],
    },
    {
      key: 'SEAM_STRETCH',
      label: 'Seam tight end in a vertical offense',
      value: 0.2,
      all: [
        { slots: ['TE1'], archetype: 'seam_te' },
        { slots: ['QB'], archetype: 'deep_passer' },
      ],
    },
    {
      key: 'CHAINS_MOVER',
      label: 'Possession receiver + precision passer',
      value: 0.15,
      all: [
        { slots: ['WR1', 'WR2'], archetype: 'possession_receiver' },
        { slots: ['QB'], archetype: 'precision_passer' },
      ],
    },
    {
      key: 'SHORT_FIELD',
      label: 'Ball-hawking defense + explosive offense',
      value: 0.2,
      all: [
        { slots: ['DEF'], archetype: 'ball_hawk_defense' },
        { slots: ['WR1', 'WR2'], archetype: 'yac_receiver' },
      ],
    },
    {
      key: 'GROUND_CONTROL',
      label: 'Blocking tight end + power back',
      value: 0.15,
      all: [
        { slots: ['TE1'], archetype: 'blocking_te' },
        { slots: ['RB1', 'RB2'], archetype: 'power_back' },
      ],
    },
    {
      key: 'ONE_DIMENSIONAL',
      label: 'No vertical element anywhere',
      value: -0.3,
      all: [
        { slots: ['QB'], archetype: 'precision_passer' },
        { slots: ['WR1', 'WR2'], archetype: 'possession_receiver' },
        { slots: ['TE1'], archetype: 'blocking_te' },
      ],
    },
    {
      key: 'NO_SAFETY_VALVE',
      label: 'Deep passer with no underneath outlet',
      value: -0.2,
      all: [
        { slots: ['QB'], archetype: 'deep_passer' },
        { slots: ['RB1', 'RB2'], archetype: 'power_back' },
        { slots: ['TE1'], archetype: 'blocking_te' },
      ],
    },
  ],
};

/**
 * Maps raw team rating onto the published distribution (PRFAQ §18).
 * Regenerate with `pnpm calibrate` — do not hand-edit.
 */
const CALIBRATION: CalibrationConfig = {
  anchors: GENERATED_CALIBRATION_ANCHORS,
};

/** Score-to-record mapping (PRFAQ §20). Floors close the spec's band gaps. */
const RECORD_BANDS: readonly RecordBand[] = [
  { minRating: 0, endingKey: 'HISTORIC_COLLAPSE' },
  { minRating: 61, endingKey: 'ROCK_BOTTOM' },
  { minRating: 63, endingKey: 'REBUILD' },
  { minRating: 65, endingKey: 'LOST_SEASON' },
  { minRating: 67, endingKey: 'BOTTOM_FEEDER' },
  { minRating: 69, endingKey: 'STRUGGLING' },
  { minRating: 71, endingKey: 'UNDERACHIEVER' },
  { minRating: 73, endingKey: 'FRINGE' },
  { minRating: 75, endingKey: 'ALMOST_THERE' },
  { minRating: 77, endingKey: 'AVERAGE' },
  { minRating: 80, endingKey: 'WINNING_SEASON' },
  { minRating: 82.5, endingKey: 'WILD_CARD' },
  { minRating: 85, endingKey: 'PLAYOFF_TEAM' },
  { minRating: 87.5, endingKey: 'CONTENDER' },
  { minRating: 90, endingKey: 'ELITE' },
  { minRating: 92.5, endingKey: 'CHAMPIONSHIP_CALIBER' },
  { minRating: 94.5, endingKey: 'DYNASTY' },
  { minRating: 96.5, endingKey: 'HEARTBREAK' },
  { minRating: 99, endingKey: 'PERFECT' },
];

/**
 * Perfection gates (PRFAQ §21). Score alone is necessary, not sufficient.
 *
 * The values differ from the ones written in §21 (99.25 / 96 everywhere / 98 at
 * QB and DEF). Measured against the real dataset those produced **zero** 18-0
 * seasons in 600,000 simulated games: rosters cleared the score and not one
 * could also field seven slots at 96+, because most franchise-eras never
 * produced an all-time-elite season at every position.
 *
 * These floors were fitted instead of guessed (`pnpm --filter @18-0/data tune`)
 * and they still read cleanly against the §9 scale:
 *
 *   94 = First-Team All-Pro caliber  -> no slot is an obvious weakness
 *   96 = all-time elite              -> QB and defence must be all-time elite,
 *                                       and four positions in total
 *
 * **Refitted three times, and the reason is always the same: the pool got
 * deeper.** Three decades became five periods, which shrank each bucket and
 * made 18-0 a 1-in-200,000 event. Then the rating model started falling back
 * to the metric a season has rather than dropping the component, which took
 * the dataset from 2,994 cards to 3,279 and 18-0 to 1 in 3,243. Then 1980-1998
 * came in: 4,872 cards across 218 franchise-eras, and 1 in 1,690.
 *
 * A gate that drifts by a factor of four is a published claim that has quietly
 * become false -- the README, the home screen and the stats screen all say 18-0
 * lands about once every 6,000 games. So the calibration curve was refitted
 * against the new dataset (`pnpm --filter @18-0/data analyze -- --write`),
 * which put 17-1 back at 1 in 52 on its own, and these floors were tuned on top
 * of it over 400,000 games:
 *
 *   18-0  1 in 5,797     (claimed: about 1 in 6,000)
 *   17-1  1 in 51        (claimed: about 1 in 49)
 *
 * Anything that moves either number moves a sentence on the front page. Retune
 * both together, or change the copy.
 */
const PERFECTION: PerfectionConfig = {
  minFinalRating: 99,
  slotMinimums: { QB: 96, DEF: 96 },
  universalSlotMinimum: 94,
  eliteCount: { minRating: 96, minCount: 4 },
  deniedEndingKey: 'HEARTBREAK',
};

export const SCORING_CONFIG_V1: ScoringConfig = {
  version: '1.3.0',
  rosterWeights: ROSTER_WEIGHTS,
  weakLink: WEAK_LINK,
  eliteDepth: ELITE_DEPTH,
  chemistry: CHEMISTRY,
  calibration: CALIBRATION,
  recordBands: RECORD_BANDS,
  perfection: PERFECTION,
};

export const DEFAULT_SCORING_CONFIG = SCORING_CONFIG_V1;
export const RATING_MODEL_VERSION = SCORING_CONFIG_V1.version;

const REGISTRY: Readonly<Record<string, ScoringConfig>> = {
  '1.3.0': SCORING_CONFIG_V1,
};

/** Historical results must be re-readable under the model that produced them. */
export function scoringConfigForVersion(version: string): ScoringConfig {
  const config = REGISTRY[version];
  if (!config) throw new Error(`Unknown rating model version: ${version}`);
  return config;
}
