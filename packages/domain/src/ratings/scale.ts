/**
 * Turning an era-relative z-score into a component score (PRFAQ §10).
 *
 * The anchors are read directly off the published rating scale (PRFAQ §9), so
 * the curve is auditable against the product definition rather than being a
 * magic constant:
 *
 *   0 SD  average starter          -> 75
 *  +1 SD  Pro Bowl caliber         -> 86
 *  +2 SD  elite / All-Pro          -> 93
 *  +3 SD  historically dominant    -> 97.3
 *  +4 SD  extreme outlier          -> 99.3
 *
 * Smooth, monotonic and capped, exactly as §10 requires.
 */

export interface ScaleAnchor {
  readonly z: number;
  readonly score: number;
}

export const COMPONENT_SCALE: readonly ScaleAnchor[] = [
  { z: -4, score: 20 },
  { z: -3, score: 38 },
  { z: -2, score: 54 },
  { z: -1, score: 66 },
  { z: -0.5, score: 71 },
  { z: 0, score: 75 },
  { z: 0.5, score: 80.5 },
  { z: 1, score: 86 },
  { z: 1.5, score: 90 },
  { z: 2, score: 93 },
  { z: 2.5, score: 95.5 },
  { z: 3, score: 97.3 },
  { z: 3.5, score: 98.5 },
  { z: 4, score: 99.3 },
  { z: 5, score: 99.9 },
  { z: 6, score: 100 },
];

/** Bounded, monotonic transform of a z-score into a 0-100 component score. */
export function scoreFromZ(z: number, anchors: readonly ScaleAnchor[] = COMPONENT_SCALE): number {
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (z <= first.z) return first.score;
  if (z >= last.z) return last.score;

  for (let i = 1; i < anchors.length; i++) {
    const lo = anchors[i - 1]!;
    const hi = anchors[i]!;
    if (z > hi.z) continue;
    const t = (z - lo.z) / (hi.z - lo.z);
    return lo.score + t * (hi.score - lo.score);
  }
  return last.score;
}

/**
 * Percentile rank (0-1) mapped onto the same component scale via its
 * z-equivalent.
 *
 * `sampleSize` matters: clamping at a fixed 1e-6 handed every league leader an
 * identical z of 4.75 — so the top tight end in a 40-man pool and the top one
 * in an 8-man pool scored the same, and beating the field by one yard was worth
 * seven points. The ceiling now scales with the evidence behind it.
 */
export function scoreFromPercentile(percentile: number, sampleSize?: number): number {
  const ceiling = sampleSize && sampleSize > 1 ? 1 - 1 / (2 * sampleSize) : 1 - 1e-6;
  const floor = sampleSize && sampleSize > 1 ? 1 / (2 * sampleSize) : 1e-6;
  const p = Math.min(Math.max(percentile, floor), ceiling);
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pLow = 0.02425;
  let z: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    z = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    z = (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    z = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  return scoreFromZ(z);
}
