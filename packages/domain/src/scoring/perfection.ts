import { ROSTER_SLOTS, type CompletedRoster, type FailedGate, type PerfectEligibility } from '../types.js';
import type { ScoringConfig } from '../constants/config.js';

/**
 * Perfection gates (PRFAQ §21).
 *
 * A score >= 99.25 is necessary but not sufficient. The gates enforce the
 * product promise: an 18-0 roster has no obvious weakness. Every failure is
 * reported so the reveal screen can name the blocker rather than shrug.
 */
export function evaluatePerfection(
  roster: CompletedRoster,
  finalRating: number,
  config: ScoringConfig,
): PerfectEligibility {
  const { minFinalRating, slotMinimums, universalSlotMinimum, eliteCount } = config.perfection;
  const reachedThreshold = finalRating >= minFinalRating;
  const failedGates: FailedGate[] = [];

  for (const slot of ROSTER_SLOTS) {
    const rating = roster[slot].season.rating;

    if (rating < universalSlotMinimum) {
      failedGates.push({
        kind: 'slot_minimum',
        slot,
        required: universalSlotMinimum,
        actual: rating,
        message: `${slot} needed a ${universalSlotMinimum.toFixed(1)} minimum for 18-0 eligibility.`,
      });
    }

    const positionFloor = slotMinimums[slot];
    if (positionFloor !== undefined && rating < positionFloor) {
      failedGates.push({
        kind: 'position_minimum',
        slot,
        required: positionFloor,
        actual: rating,
        message: `${slot} needed a ${positionFloor.toFixed(1)} minimum for 18-0 eligibility.`,
      });
    }
  }

  const eliteSlots = ROSTER_SLOTS.filter(
    (slot) => roster[slot].season.rating >= eliteCount.minRating,
  ).length;

  if (eliteSlots < eliteCount.minCount) {
    failedGates.push({
      kind: 'elite_count',
      slot: null,
      required: eliteCount.minCount,
      actual: eliteSlots,
      message: `18-0 needs at least ${eliteCount.minCount} positions at ${eliteCount.minRating}+. This roster had ${eliteSlots}.`,
    });
  }

  // Severity first: the hard position floors, then the universal floor, then
  // the depth requirement.
  const order: Record<FailedGate['kind'], number> = {
    position_minimum: 0,
    slot_minimum: 1,
    elite_count: 2,
  };
  failedGates.sort((a, b) => order[a.kind] - order[b.kind] || a.actual - b.actual);

  return {
    eligible: reachedThreshold && failedGates.length === 0,
    reachedThreshold,
    failedGates,
  };
}
