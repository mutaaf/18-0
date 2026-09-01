import { ROSTER_SLOTS, type CompletedRoster, type RosterSlot } from '../types.js';
import type { ScoringConfig } from '../constants/config.js';

/**
 * Weighted roster rating (PRFAQ §13).
 *
 *   base = qb*.24 + def*.18 + wr1*.13 + rb1*.12 + wr2*.11 + te*.11 + rb2*.11
 */
export function computeBaseRating(roster: CompletedRoster, config: ScoringConfig): number {
  let total = 0;
  for (const slot of ROSTER_SLOTS) {
    total += roster[slot].season.rating * config.rosterWeights[slot];
  }
  return total;
}

/** Convenience accessor used across the scoring modules. */
export function slotRatings(roster: CompletedRoster): Record<RosterSlot, number> {
  return Object.fromEntries(
    ROSTER_SLOTS.map((slot) => [slot, roster[slot].season.rating]),
  ) as Record<RosterSlot, number>;
}
