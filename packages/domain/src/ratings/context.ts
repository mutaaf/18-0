import type { MetricDistribution, PositionModel, SeasonContext, SeasonStats } from './types.js';
import { metricKeysFor } from './models.js';

/**
 * Extracts every metric a model can consult, once, for one season.
 * `null` means the underlying data does not exist — never zero (PRFAQ §10).
 */
export function extractMetrics(
  stats: SeasonStats,
  model: PositionModel,
): ReadonlyMap<string, number | null> {
  const values = new Map<string, number | null>();
  for (const component of model.components) {
    for (const m of component.metrics) {
      if (!values.has(m.key)) values.set(m.key, m.extract(stats));
    }
  }
  // Percentile components can reference a metric no component extracts directly.
  for (const key of metricKeysFor(model)) {
    if (!values.has(key)) values.set(key, null);
  }
  return values;
}

/**
 * Builds the era-normalization basis: mean, standard deviation and the sorted
 * value list for every metric, across the qualified players at one position in
 * one season (PRFAQ §10).
 *
 * A metric with too few observations is omitted entirely, which makes every
 * component that depends on it fall back rather than z-score against noise.
 */
export function buildSeasonContext(
  qualifiedSeasons: readonly ReadonlyMap<string, number | null>[],
  // With the population estimator and the subject inside its own distribution,
  // the largest attainable |z| is (n-1)/sqrt(n) — at n=8 that caps a component
  // at 95.4 no matter how dominant the season. 20 puts the ceiling out of the
  // way so sample size never decides the rating.
  minSample = 20,
): SeasonContext {
  const byMetric = new Map<string, number[]>();

  for (const season of qualifiedSeasons) {
    for (const [key, value] of season) {
      if (value === null || !Number.isFinite(value)) continue;
      const bucket = byMetric.get(key);
      if (bucket) bucket.push(value);
      else byMetric.set(key, [value]);
    }
  }

  const context = new Map<string, MetricDistribution>();
  for (const [key, values] of byMetric) {
    if (values.length < minSample) continue;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    // Sample estimator (n-1). The question a rating asks is "how far above the
    // rest of the league is this season", which is a leave-one-out question;
    // the population estimator understates the spread and compresses z.
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, values.length - 1);
    const stddev = Math.sqrt(variance);
    // A metric with no spread cannot discriminate; treat it as unavailable.
    if (stddev < 1e-9) continue;
    context.set(key, {
      mean,
      stddev,
      count: values.length,
      sorted: [...values].sort((a, b) => a - b),
    });
  }

  return context;
}

/**
 * Fraction of the league at or below `value`, as a Hazen plotting position.
 *
 * `count / n` gives the maximum value exactly 1.0, which then saturates the
 * score curve; `(count - 0.5) / n` leaves headroom so the leader's margin
 * still registers.
 */
export function percentileRank(value: number, distribution: MetricDistribution): number {
  const { sorted } = distribution;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, (lo - 0.5) / sorted.length);
}
