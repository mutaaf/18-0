import type {
  ComponentScore,
  PositionModel,
  RatingResult,
  SeasonContext,
  SeasonStats,
} from './types.js';
import { extractMetrics, percentileRank } from './context.js';
import { scoreFromPercentile, scoreFromZ } from './scale.js';
import { clamp, roundTo } from '../util/math.js';

export const RATING_ENGINE_VERSION = '1.0.0';

/**
 * Rates one season against its own era (PRFAQ §8-§11).
 *
 * Answers "how dominant was this season relative to what was possible at this
 * position in this year", not "who piled up the biggest raw totals". Every
 * component is z-scored against the same-position league environment for that
 * exact season, so a 1999 receiver and a 2024 receiver are directly comparable.
 *
 * A component whose data does not exist is dropped and its weight redistributed
 * across the components that do — never scored as zero.
 */
export function rateSeason(
  stats: SeasonStats,
  model: PositionModel,
  context: SeasonContext,
): RatingResult {
  const values = extractMetrics(stats, model);
  const scored: Omit<ComponentScore, 'effectiveWeight'>[] = [];
  const unavailable: string[] = [];

  for (const component of model.components) {
    if (component.percentileOf) {
      const distribution = context.get(component.percentileOf);
      const value = values.get(component.percentileOf) ?? null;
      if (!distribution || value === null) {
        unavailable.push(component.key);
        continue;
      }
      scored.push({
        key: component.key,
        label: component.label,
        weight: component.weight,
        score: scoreFromPercentile(percentileRank(value, distribution), distribution.count),
        z: null,
        metricUsed: component.percentileOf,
        value,
        fellBack: false,
      });
      continue;
    }

    let matched = false;
    for (let i = 0; i < component.metrics.length; i++) {
      const definition = component.metrics[i]!;
      const value = values.get(definition.key) ?? null;
      const distribution = context.get(definition.key);
      if (value === null || !distribution) continue;

      const z = (value - distribution.mean) / distribution.stddev;
      scored.push({
        key: component.key,
        label: component.label,
        weight: component.weight,
        score: scoreFromZ(z),
        z,
        metricUsed: definition.key,
        value,
        fellBack: i > 0,
      });
      matched = true;
      break;
    }
    if (!matched) unavailable.push(component.key);
  }

  const availableWeight = scored.reduce((sum, c) => sum + c.weight, 0);
  if (availableWeight <= 0) {
    throw new Error('No rating components had data for this season');
  }

  const components: ComponentScore[] = scored.map((c) => ({
    ...c,
    effectiveWeight: c.weight / availableWeight,
    score: roundTo(c.score, 2),
    z: c.z === null ? null : roundTo(c.z, 3),
  }));

  const overall = components.reduce((sum, c) => sum + c.score * c.effectiveWeight, 0);

  return {
    overall: roundTo(clamp(overall, 0, 100), 2),
    components,
    unavailable,
    ratingModelVersion: RATING_ENGINE_VERSION,
  };
}
