/** Percentile of a pre-sorted ascending array, linear interpolation. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loValue = sorted[lo]!;
  if (lo === hi) return loValue;
  return loValue + (rank - lo) * (sorted[hi]! - loValue);
}

export function pct(count: number, total: number): string {
  if (count === 0) return '0';
  return `${((count / total) * 100).toFixed(4)}%`;
}

export function bar(fraction: number, width = 28): string {
  const filled = Math.round(fraction * width);
  return '█'.repeat(filled) + '·'.repeat(Math.max(0, width - filled));
}
