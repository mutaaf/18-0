import { describe, expect, it } from 'vitest';
import {
  POSITION_MODELS,
  POSITIONS,
  buildSeasonContext,
  metricKeysFor,
  percentileRank,
  scoreFromPercentile,
  scoreFromZ,
} from '../src/index.js';

describe('position rating models (PRFAQ §11)', () => {
  it.each(POSITIONS)('%s component weights sum to 1', (position) => {
    const total = POSITION_MODELS[position].components.reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it.each(POSITIONS)('%s has no component that can never be populated', (position) => {
    // A component with no metrics must be a percentile component; a component
    // with metrics must have at least one. Anything else is dropped at runtime
    // and its weight silently redistributed, which makes the published table a
    // description of something that never runs.
    for (const component of POSITION_MODELS[position].components) {
      const usable = component.metrics.length > 0 || component.percentileOf !== undefined;
      expect(usable, `${position}.${component.key} has no way to score`).toBe(true);
    }
  });

  it.each(POSITIONS)('%s percentile components rank a metric the model produces', (position) => {
    const model = POSITION_MODELS[position];
    const produced = new Set(model.components.flatMap((c) => c.metrics.map((m) => m.key)));
    for (const component of model.components) {
      if (!component.percentileOf) continue;
      expect(
        produced.has(component.percentileOf),
        `${position}.${component.key} ranks "${component.percentileOf}", which no metric extracts`,
      ).toBe(true);
    }
  });

  it.each(POSITIONS)('%s spreads its weight across distinct measurements', (position) => {
    // Ranking a metric and z-scoring it are genuinely different readings, so
    // some overlap is fine. What is not fine is one number quietly deciding the
    // rating: before this test, receiving yards drove 47% of every tight end.
    const model = POSITION_MODELS[position];
    const byMetric = new Map<string, number>();
    const add = (key: string | undefined, weight: number) => {
      if (!key) return;
      byMetric.set(key, (byMetric.get(key) ?? 0) + weight);
    };
    for (const component of model.components) {
      add(component.metrics[0]?.key, component.weight);
      add(component.percentileOf, component.weight);
    }
    for (const [metricKey, weight] of byMetric) {
      expect(weight, `${position}: "${metricKey}" carries ${(weight * 100).toFixed(1)}% of the rating`)
        .toBeLessThanOrEqual(0.35);
    }
  });

  it('every model declares its metric keys', () => {
    for (const position of POSITIONS) {
      expect(metricKeysFor(POSITION_MODELS[position]).length).toBeGreaterThan(0);
    }
  });
});

describe('era normalization', () => {
  const distribution = (values: number[]) =>
    buildSeasonContext(values.map((v) => new Map([['m', v]])), 4).get('m')!;

  it('uses the sample estimator, not the population one', () => {
    // [0,2,4,6] -> mean 3, sample sd 2.582, population sd 2.236
    expect(distribution([0, 2, 4, 6]).stddev).toBeCloseTo(2.5819, 3);
  });

  it('drops a metric with too few observations rather than z-scoring noise', () => {
    const context = buildSeasonContext([new Map([['m', 1]]), new Map([['m', 2]])], 8);
    expect(context.has('m')).toBe(false);
  });

  it('drops a metric with no spread', () => {
    const context = buildSeasonContext(
      Array.from({ length: 10 }, () => new Map([['m', 5]])),
      4,
    );
    expect(context.has('m')).toBe(false);
  });

  it('gives the league leader headroom rather than a saturated score', () => {
    const d = distribution([1, 2, 3, 40]);
    const leader = scoreFromPercentile(percentileRank(40, d), d.count);
    const runnerUp = scoreFromPercentile(percentileRank(3, d), d.count);
    expect(leader).toBeGreaterThan(runnerUp);
    expect(leader).toBeLessThan(100);
  });

  it('scales the ceiling with the sample size behind it', () => {
    // Leading a 10-player field should not be worth as much as leading a 200-player one.
    const small = scoreFromPercentile(1, 10);
    const large = scoreFromPercentile(1, 200);
    expect(large).toBeGreaterThan(small);
  });

  it('maps z-scores onto the §9 bands', () => {
    expect(scoreFromZ(0)).toBeCloseTo(75, 5);
    expect(scoreFromZ(1)).toBeCloseTo(86, 5);
    expect(scoreFromZ(2)).toBeCloseTo(93, 5);
    expect(scoreFromZ(3)).toBeCloseTo(97.3, 5);
    expect(scoreFromZ(10)).toBeLessThanOrEqual(100);
    expect(scoreFromZ(-10)).toBeGreaterThanOrEqual(0);
  });
});
