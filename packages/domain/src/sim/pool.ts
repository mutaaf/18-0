import { ARCHETYPES, POSITIONS, type Archetype, type EraKey, type Position, type RatedSeason } from '../types.js';
import { createRng, type Rng } from './rng.js';
import { ERA_BY_KEY, SIM_FRANCHISES, bucketKey, validFranchiseEras } from './franchises.js';

/**
 * A stand-in for the real historical ratings dataset.
 *
 * The shape is what matters, not the names: how many qualifying seasons a
 * franchise-decade produces per position, and how the ratings within them are
 * distributed. Era normalization (PRFAQ §10) means every decade generates its
 * own outliers, so elite density is modelled as roughly uniform per bucket
 * rather than concentrated in the modern era.
 *
 * Swap `PoolSpec` for measured counts once the ingest pipeline lands and every
 * number the harness produces becomes a real estimate.
 */

export interface RatingBand {
  readonly min: number;
  readonly max: number;
  readonly weight: number;
}

export interface PoolSpec {
  /** Qualifying seasons produced per franchise-decade, per position. */
  readonly seasonsPerBucket: Readonly<Record<Position, number>>;
  readonly bands: readonly RatingBand[];
  /**
   * How much historical greatness clusters. 0 spreads elite seasons evenly
   * across every franchise-decade; higher values concentrate them the way the
   * 1960s Packers and 1980s 49ers actually did, which makes any single spin
   * less likely to offer an elite card at the position you still need.
   */
  readonly talentClustering: number;
}

/**
 * Rating bands (PRFAQ §9). Weights are tuned so that league-wide counts land
 * near the historical intuition: a couple of 99.5+ seasons per position across
 * all of NFL history, roughly a dozen at 98+, roughly forty at 96+.
 */
export const DEFAULT_POOL_SPEC: PoolSpec = {
  seasonsPerBucket: { QB: 6, RB: 14, WR: 20, TE: 9, DEF: 10 },
  talentClustering: 0,
  bands: [
    { min: 99.5, max: 100, weight: 0.0015 },
    { min: 98, max: 99.5, weight: 0.01 },
    { min: 96, max: 98, weight: 0.028 },
    { min: 93, max: 96, weight: 0.07 },
    { min: 90, max: 93, weight: 0.12 },
    { min: 86, max: 90, weight: 0.18 },
    { min: 82, max: 86, weight: 0.2 },
    { min: 77, max: 82, weight: 0.2 },
    { min: 72, max: 77, weight: 0.12 },
    { min: 65, max: 72, weight: 0.07 },
    { min: 55, max: 65, weight: 0.0005 },
  ],
};

const ARCHETYPES_BY_POSITION: Readonly<Record<Position, readonly Archetype[]>> = {
  QB: ['deep_passer', 'precision_passer', 'dual_threat_qb'],
  RB: ['receiving_back', 'power_back', 'explosive_back'],
  WR: ['vertical_receiver', 'possession_receiver', 'yac_receiver'],
  TE: ['seam_te', 'blocking_te'],
  DEF: ['ball_hawk_defense', 'pressure_defense', 'stonewall_defense'],
};

/** Box-Muller, so bucket talent is a smooth spread rather than a few tiers. */
function standardNormal(rng: Rng): number {
  const u = Math.max(rng.next(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

/**
 * Maps a uniform draw onto the rating bands, ordered worst to best, so a
 * quantile can be tilted toward the top of the distribution.
 */
function ratingFromQuantile(quantile: number, bands: readonly RatingBand[]): number {
  const ascending = [...bands].sort((a, b) => a.min - b.min);
  const total = ascending.reduce((sum, b) => sum + b.weight, 0);
  let remaining = quantile * total;
  for (const band of ascending) {
    if (remaining <= band.weight) {
      const within = band.weight === 0 ? 0 : remaining / band.weight;
      return band.min + within * (band.max - band.min);
    }
    remaining -= band.weight;
  }
  const best = ascending[ascending.length - 1]!;
  return best.max;
}

function drawRating(rng: Rng, bands: readonly RatingBand[], talentTilt: number): number {
  const u = rng.next();
  // talentTilt > 1 pushes this bucket's draws toward the top of the curve.
  const quantile = talentTilt === 1 ? u : u ** (1 / talentTilt);
  return ratingFromQuantile(quantile, bands);
}

/** All eligible cards for one franchise-era, indexed by position. */
export type Bucket = Readonly<Record<Position, readonly RatedSeason[]>>;

export interface RatingPool {
  readonly buckets: ReadonlyMap<string, Bucket>;
  readonly combos: ReadonlyArray<{ franchiseId: string; era: EraKey; spinWeight: number }>;
  readonly spec: PoolSpec;
  /** Prefix sums over spinWeight, so a spin is one binary search. */
  readonly cumulativeWeights: readonly number[];
  readonly totalWeight: number;
}

/**
 * Builds a full synthetic league. Deterministic for a given seed, so a
 * reachability number can be reproduced and diffed.
 */
export function buildPool(seed: number, spec: PoolSpec = DEFAULT_POOL_SPEC): RatingPool {
  const rng = createRng(seed);
  const combos = validFranchiseEras();
  const buckets = new Map<string, Bucket>();
  const franchiseById = new Map(SIM_FRANCHISES.map((f) => [f.id, f]));

  for (const combo of combos) {
    const era = ERA_BY_KEY.get(combo.era)!;
    const franchise = franchiseById.get(combo.franchiseId)!;
    const bucket: Record<Position, RatedSeason[]> = { QB: [], RB: [], WR: [], TE: [], DEF: [] };
    // One talent level for the whole franchise-decade: a stacked era lifts
    // every position group at once, which is how dynasties actually look.
    const talentTilt =
      spec.talentClustering === 0
        ? 1
        : Math.exp(spec.talentClustering * standardNormal(rng));

    for (const position of POSITIONS) {
      const count = spec.seasonsPerBucket[position];
      for (let i = 0; i < count; i++) {
        const rating = Math.round(drawRating(rng, spec.bands, talentTilt) * 10) / 10;
        const seasonYear = era.startYear + rng.int(10);
        const archetypePool = ARCHETYPES_BY_POSITION[position];
        const archetypes: Archetype[] = [rng.pick(archetypePool)];
        if (rng.next() < 0.25) {
          const second = rng.pick(archetypePool);
          if (!archetypes.includes(second)) archetypes.push(second);
        }
        const id = `${combo.franchiseId}-${combo.era}-${position}-${i}`;
        bucket[position].push({
          id: `${id}-r`,
          entityId: id,
          entityType: position === 'DEF' ? 'defense' : 'player',
          displayName:
            position === 'DEF'
              ? `${seasonYear} ${franchise.displayName} Defense`
              : `${franchise.abbreviation} ${position}${i + 1}`,
          position,
          franchiseId: combo.franchiseId,
          seasonYear,
          era: combo.era,
          rating,
          archetypes,
          ratingModelVersion: '1.0.0',
        });
      }
      // Best card first — every strategy reads from the top.
      bucket[position].sort((a, b) => b.rating - a.rating);
    }

    buckets.set(bucketKey(combo.franchiseId, combo.era), bucket);
  }

  const cumulativeWeights: number[] = [];
  let running = 0;
  for (const combo of combos) {
    running += combo.spinWeight;
    cumulativeWeights.push(running);
  }

  return { buckets, combos, spec, cumulativeWeights, totalWeight: running };
}

export function bucketFor(pool: RatingPool, franchiseId: string, era: EraKey): Bucket {
  const bucket = pool.buckets.get(bucketKey(franchiseId, era));
  if (!bucket) throw new Error(`No bucket for ${franchiseId} ${era}`);
  return bucket;
}

/** Sanity helper: how many seasons league-wide sit at or above a rating. */
export function countAtOrAbove(pool: RatingPool, position: Position, min: number): number {
  let count = 0;
  for (const bucket of pool.buckets.values()) {
    for (const season of bucket[position]) if (season.rating >= min) count++;
  }
  return count;
}

export { ARCHETYPES };

/**
 * Builds a pool from real rated seasons instead of synthetic draws.
 *
 * Lets the calibration and reachability harnesses run against the bundled
 * historical dataset, so their answers stop being a function of `PoolSpec` and
 * start being a function of actual NFL history.
 */
export function poolFromSeasons(
  seasons: readonly RatedSeason[],
  combos: readonly { franchiseId: string; era: EraKey; spinWeight: number }[],
): RatingPool {
  const buckets = new Map<string, Bucket>();
  for (const combo of combos) {
    buckets.set(bucketKey(combo.franchiseId, combo.era), { QB: [], RB: [], WR: [], TE: [], DEF: [] });
  }

  for (const season of seasons) {
    const bucket = buckets.get(bucketKey(season.franchiseId, season.era));
    if (!bucket) continue;
    (bucket[season.position] as RatedSeason[]).push(season);
  }

  for (const bucket of buckets.values()) {
    for (const position of POSITIONS) {
      (bucket[position] as RatedSeason[]).sort((a, b) => b.rating - a.rating);
    }
  }

  const cumulativeWeights: number[] = [];
  let running = 0;
  for (const combo of combos) {
    running += combo.spinWeight;
    cumulativeWeights.push(running);
  }

  return {
    buckets,
    combos: [...combos],
    spec: DEFAULT_POOL_SPEC,
    cumulativeWeights,
    totalWeight: running,
  };
}
