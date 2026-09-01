import { endingByKey } from '../constants/endings.js';
import type { ScoringConfig } from '../constants/config.js';
import type { Ending } from '../types.js';

/**
 * Score-to-record mapping (PRFAQ §20).
 *
 * Bands are inclusive floors: the highest floor at or below the rating wins.
 * This closes the gaps in the spec's table (62.9 -> 63) deterministically.
 *
 * Reaching the top band makes a roster *eligible* for 18-0. The perfection
 * gates decide whether it gets there.
 */
export function endingForRating(rating: number, config: ScoringConfig): Ending {
  let selected = config.recordBands[0]!;
  for (const band of config.recordBands) {
    if (rating >= band.minRating) selected = band;
    else break;
  }
  return endingByKey(selected.endingKey);
}
