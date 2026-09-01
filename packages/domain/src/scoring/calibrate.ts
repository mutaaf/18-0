import type { ScoringConfig } from '../constants/config.js';
import { clamp } from '../util/math.js';

/**
 * Maps the raw team rating onto the published distribution (PRFAQ §17, §18).
 *
 * A monotonic piecewise-linear curve rather than a fitted polynomial: it is
 * inspectable, guaranteed order-preserving, and the calibration harness can
 * regenerate its anchors from simulated roster percentiles without anyone
 * having to reason about coefficients.
 */
export function calibrate(raw: number, config: ScoringConfig): number {
  const anchors = config.calibration.anchors;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (!first || !last) throw new Error('Calibration curve has no anchors');

  if (raw <= first.raw) return clamp(first.final, 0, 100);
  if (raw >= last.raw) return clamp(last.final, 0, 100);

  for (let i = 1; i < anchors.length; i++) {
    const lo = anchors[i - 1]!;
    const hi = anchors[i]!;
    if (raw > hi.raw) continue;
    const span = hi.raw - lo.raw;
    const t = span === 0 ? 0 : (raw - lo.raw) / span;
    return clamp(lo.final + t * (hi.final - lo.final), 0, 100);
  }

  return clamp(last.final, 0, 100);
}

/** Guards against an anchor set that would make the score non-monotonic. */
export function assertMonotonicCalibration(config: ScoringConfig): void {
  const anchors = config.calibration.anchors;
  for (let i = 1; i < anchors.length; i++) {
    const lo = anchors[i - 1]!;
    const hi = anchors[i]!;
    if (hi.raw <= lo.raw) {
      throw new Error(`Calibration anchors must ascend by raw: ${lo.raw} -> ${hi.raw}`);
    }
    if (hi.final < lo.final) {
      throw new Error(`Calibration must be monotonic: ${lo.final} -> ${hi.final}`);
    }
  }
}
