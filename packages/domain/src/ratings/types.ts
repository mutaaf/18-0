import type { Position } from '../types.js';

/**
 * A flat bag of raw season statistics.
 *
 * Deliberately source-agnostic: the ingest pipeline maps nflverse columns (or
 * anything else) into this shape, so the rating models never learn where their
 * numbers came from. Missing keys are genuinely missing — never zero.
 */
export type SeasonStats = Readonly<Record<string, number | undefined>>;

/** One metric in a component's fallback hierarchy (PRFAQ §11). */
export interface MetricDef {
  readonly key: string;
  readonly label: string;
  /**
   * Returns null when the underlying data does not exist for this season.
   *
   * Metrics where lower is better (points allowed, sack rate) negate here, so
   * every metric in the system is unambiguously higher-is-better by the time
   * it reaches the z-score. There is deliberately no `higherIsBetter` flag: one
   * existed, nothing read it, and it was a trap for the next person to add a
   * lower-is-better metric.
   */
  readonly extract: (stats: SeasonStats) => number | null;
}

/**
 * A weighted component of a position's rating. `metrics` is an ordered
 * fallback hierarchy: the first metric with data for this season wins, and the
 * result records which one was used so the explanation can be honest about it.
 */
export interface ComponentDef {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  readonly metrics: readonly MetricDef[];
  /**
   * Ranks the player against the league instead of z-scoring a metric. Used
   * for the "peak dominance" components (PRFAQ §11).
   */
  readonly percentileOf?: string;
}

export interface PositionModel {
  readonly position: Position;
  readonly components: readonly ComponentDef[];
  /** Qualification floor (PRFAQ §12). */
  readonly qualifies: (stats: SeasonStats, seasonGames: number) => boolean;
}

export interface ComponentScore {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  /** The weight actually applied after unavailable components were dropped. */
  readonly effectiveWeight: number;
  readonly score: number;
  readonly z: number | null;
  readonly metricUsed: string | null;
  readonly value: number | null;
  /** True when this component fell back past its primary metric. */
  readonly fellBack: boolean;
}

export interface RatingResult {
  readonly overall: number;
  readonly components: readonly ComponentScore[];
  /** Components with no data at all; their weight was redistributed. */
  readonly unavailable: readonly string[];
  readonly ratingModelVersion: string;
}

/** Mean and standard deviation of one metric across a season's qualified players. */
export interface MetricDistribution {
  readonly mean: number;
  readonly stddev: number;
  readonly count: number;
  /** Ascending values, for percentile ranks. */
  readonly sorted: readonly number[];
}

/** All distributions for one (season, position) — the era-normalization basis. */
export type SeasonContext = ReadonlyMap<string, MetricDistribution>;
