import { ascending, interpolate, type CurvePoint } from '../util/curve.js';
import { roundTo } from '../util/math.js';

/**
 * Player-rating calibration (PRFAQ §9).
 *
 * A rating is a weighted average of nine components, and averaging compresses
 * the top: no season is three standard deviations above the league in *every*
 * component, so even the best year in the dataset lands around 95 on the raw
 * scale. That is not what §9 says a 95 means.
 *
 * This maps each position's raw distribution onto the published scale, so a
 * rating reads the way the spec defines it — 93-95.9 is First-Team All-Pro
 * caliber, 98+ is historically dominant, and 99.5+ is genuinely GOAT-level.
 *
 * Calibrating per position is deliberate: a rating already answers "how
 * dominant was this relative to the position", so the same number should mean
 * the same thing at quarterback and at tight end.
 */
export const PLAYER_RATING_TARGETS: readonly (readonly [percentile: number, rating: number])[] = [
  [0, 58],
  [5, 66],
  [15, 70.5],
  [30, 74.5],
  [45, 77.5],
  [60, 80.5],
  [75, 84],
  [85, 87.5],
  [90, 90],
  [94, 92],
  [97, 94.2],
  [99, 96.4],
  [99.5, 97.5],
  [99.9, 98.8],
  [100, 99.7],
];

export type PlayerCalibration = readonly CurvePoint[];

function percentileOf(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loValue = sorted[lo]!;
  return lo === hi ? loValue : loValue + (rank - lo) * (sorted[hi]! - loValue);
}

/** Fits the curve for one position from its observed raw ratings. */
export function fitPlayerCalibration(
  rawRatings: readonly number[],
  targets = PLAYER_RATING_TARGETS,
): PlayerCalibration {
  const sorted = [...rawRatings].sort((a, b) => a - b);
  return ascending(
    targets.map(([percentile, rating]) => ({
      x: roundTo(percentileOf(sorted, percentile), 4),
      y: rating,
    })),
  );
}

export function applyPlayerCalibration(raw: number, curve: PlayerCalibration): number {
  return roundTo(interpolate(raw, curve), 2);
}
