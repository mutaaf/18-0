import { ROSTER_SLOTS, type CompletedRoster, type SlotPenalty } from '../types.js';
import type { ScoringConfig } from '../constants/config.js';

/**
 * Weak-link penalty (PRFAQ §14).
 *
 *   slot_penalty = max(0, threshold - rating)^exponent * positionFactor * scale
 *
 * The point is not to punish ordinary rosters. It is to stop six elite picks
 * from hiding one materially weak slot.
 */
export function computeWeakLinkPenalty(
  roster: CompletedRoster,
  config: ScoringConfig,
): { total: number; detail: SlotPenalty[] } {
  const { threshold, exponent, positionFactors, scale } = config.weakLink;
  const detail: SlotPenalty[] = [];
  let total = 0;

  for (const slot of ROSTER_SLOTS) {
    const rating = roster[slot].season.rating;
    const shortfall = Math.max(0, threshold - rating);
    if (shortfall === 0) continue;
    const penalty = shortfall ** exponent * positionFactors[slot] * scale;
    total += penalty;
    detail.push({ slot, rating, shortfall, penalty });
  }

  // Largest offender first — the reveal screen leads with the real culprit.
  detail.sort((a, b) => b.penalty - a.penalty);
  return { total, detail };
}
