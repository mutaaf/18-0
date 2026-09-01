import { DEFAULT_SCORING_CONFIG, type ScoringConfig } from '../constants/config.js';
import { endingByKey } from '../constants/endings.js';
import { RATING_PRECISION, clamp, roundTo } from '../util/math.js';
import type { CompletedRoster, GameResult, ScoreBreakdown } from '../types.js';
import { computeBaseRating } from './base.js';
import { computeWeakLinkPenalty } from './weak-link.js';
import { computeEliteDepthBonus } from './elite-depth.js';
import { computeChemistry } from './chemistry.js';
import { calibrate } from './calibrate.js';
import { endingForRating } from './record.js';
import { evaluatePerfection } from './perfection.js';

/**
 * The single scoring entry point (PRFAQ §17).
 *
 *   raw   = base - weakLink + eliteDepth + chemistry
 *   final = calibrated(raw), clamped to [0, 100]
 *
 * Deterministic by construction: no clock, no randomness, no I/O. The client
 * preview and the server-authoritative result run this same function, so a
 * mismatch can only ever mean a model-version mismatch.
 */
export function scoreRoster(
  roster: CompletedRoster,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): GameResult {
  const baseRating = computeBaseRating(roster, config);
  const weakLink = computeWeakLinkPenalty(roster, config);
  const elite = computeEliteDepthBonus(roster, config);
  const chemistry = computeChemistry(roster, config);

  const rawTeamRating = baseRating - weakLink.total + elite.bonus + chemistry.bonus;
  const finalRating = roundTo(
    clamp(calibrate(rawTeamRating, config), 0, 100),
    RATING_PRECISION,
  );

  const breakdown: ScoreBreakdown = {
    baseRating: roundTo(baseRating, RATING_PRECISION),
    weakLinkPenalty: roundTo(weakLink.total, RATING_PRECISION),
    weakLinkDetail: weakLink.detail,
    eliteBonus: roundTo(elite.bonus, RATING_PRECISION),
    eliteDetail: elite,
    chemistryBonus: roundTo(chemistry.bonus, RATING_PRECISION),
    chemistryDetail: chemistry,
    rawTeamRating: roundTo(rawTeamRating, RATING_PRECISION),
  };

  const perfectEligibility = evaluatePerfection(roster, finalRating, config);

  // Reaching the threshold only makes a roster *eligible*. A failed gate sends
  // it to 17-1 with an explanation rather than to 18-0.
  const banded = endingForRating(finalRating, config);
  const ending =
    banded.key === 'PERFECT' && !perfectEligibility.eligible
      ? endingByKey(config.perfection.deniedEndingKey)
      : banded;

  return {
    finalRating,
    record: { wins: ending.wins, losses: ending.losses },
    ending,
    breakdown,
    perfectEligibility,
    distanceFromPerfection: roundTo(
      Math.max(0, config.perfection.minFinalRating - finalRating),
      RATING_PRECISION,
    ),
    ratingModelVersion: config.version,
  };
}

/**
 * True when a roster cleared the score threshold but was denied 18-0 by a
 * gate — the "PERFECTION DENIED" reveal state (PRFAQ §21).
 */
export function isPerfectionDenied(result: GameResult): boolean {
  return result.perfectEligibility.reachedThreshold && !result.perfectEligibility.eligible;
}
