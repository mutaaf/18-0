/**
 * Monotonic piecewise-linear interpolation.
 *
 * Used for every calibration in the system — component z-scores, player
 * ratings, and the final team rating. Chosen over fitted polynomials because
 * it is inspectable, order-preserving by construction, and refittable from
 * empirical percentiles without anyone reasoning about coefficients.
 */
export interface CurvePoint {
  readonly x: number;
  readonly y: number;
}

export function interpolate(x: number, points: readonly CurvePoint[]): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) throw new Error('Curve has no points');
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;

  for (let i = 1; i < points.length; i++) {
    const lo = points[i - 1]!;
    const hi = points[i]!;
    if (x > hi.x) continue;
    const span = hi.x - lo.x;
    const t = span === 0 ? 0 : (x - lo.x) / span;
    return lo.y + t * (hi.y - lo.y);
  }
  return last.y;
}

/** Drops points that would make the curve non-ascending in x. */
export function ascending(points: readonly CurvePoint[]): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous && point.x <= previous.x) continue;
    out.push(point);
  }
  return out;
}
