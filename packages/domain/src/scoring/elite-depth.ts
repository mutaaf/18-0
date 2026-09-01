import { ROSTER_SLOTS, type CompletedRoster, type EliteDepthDetail } from '../types.js';
import type { ScoringConfig } from '../constants/config.js';

/**
 * Elite depth bonus (PRFAQ §15).
 *
 * Within a band only the highest satisfied tier counts; the bands then sum and
 * the total is capped.
 */
export function computeEliteDepthBonus(
  roster: CompletedRoster,
  config: ScoringConfig,
): EliteDepthDetail {
  const ratings = ROSTER_SLOTS.map((slot) => roster[slot].season.rating);
  const countAtLeast = (min: number) => ratings.filter((r) => r >= min).length;

  let raw = 0;
  for (const band of config.eliteDepth.bands) {
    for (const tier of band) {
      if (countAtLeast(tier.minRating) >= tier.minCount) {
        raw += tier.bonus;
        break; // tiers are ordered strongest-first
      }
    }
  }

  const bonus = Math.min(raw, config.eliteDepth.cap);
  return {
    countAt95: countAtLeast(95),
    countAt98: countAtLeast(98),
    bonus,
    cappedAt: raw > config.eliteDepth.cap ? config.eliteDepth.cap : null,
  };
}
