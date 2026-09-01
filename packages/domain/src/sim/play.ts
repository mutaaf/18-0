import {
  DEFAULT_SCORING_CONFIG,
  type ScoringConfig,
} from '../constants/config.js';
import {
  ROSTER_SLOTS,
  SLOT_POSITION,
  type CompletedRoster,
  type EraKey,
  type Position,
  type RatedSeason,
  type RosterSlot,
  type RosterSelection,
  type SpinResult,
} from '../types.js';
import { scoreRoster } from '../scoring/score.js';
import type { Rng } from './rng.js';
import { bucketFor, type Bucket, type RatingPool } from './pool.js';

// ---------------------------------------------------------------------------
// Spins
// ---------------------------------------------------------------------------

/** One weighted spin, via binary search over the pool's prefix sums. */
export function drawSpin(pool: RatingPool, rng: Rng, sequence: number): SpinResult {
  const roll = rng.next() * pool.totalWeight;
  const weights = pool.cumulativeWeights;
  let lo = 0;
  let hi = weights.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (weights[mid]! < roll) lo = mid + 1;
    else hi = mid;
  }
  const combo = pool.combos[lo]!;
  return { sequence, franchiseId: combo.franchiseId, era: combo.era };
}

export function drawSpins(pool: RatingPool, rng: Rng, count: number = ROSTER_SLOTS.length): SpinResult[] {
  const spins: SpinResult[] = [];
  for (let i = 0; i < count; i++) spins.push(drawSpin(pool, rng, i + 1));
  return spins;
}

// ---------------------------------------------------------------------------
// Strategies (PRFAQ §18 — the calibration population is real play, not optimum)
// ---------------------------------------------------------------------------

/**
 * A simulated player's skill, in [0, 1].
 *
 * 0 picks almost at random; 1 always takes the choice that maximises expected
 * roster value. Modelled as a continuum rather than a handful of named
 * archetypes, because a few discrete strategies produce a multi-modal score
 * distribution and any curve fitted to it inherits the gaps.
 */
export type Skill = number;

/** Named skill levels, for readable tests and fixtures. */
export const SKILL = { random: 0, casual: 0.35, decent: 0.6, expert: 1 } as const;

/** Expected best-of-bucket rating per position, used as the hold/take baseline. */
export function expectedBestByPosition(pool: RatingPool): Record<Position, number> {
  const sums: Record<string, number> = {};
  let buckets = 0;
  for (const bucket of pool.buckets.values()) {
    buckets++;
    for (const position of Object.keys(bucket) as Position[]) {
      sums[position] = (sums[position] ?? 0) + (bucket[position][0]?.rating ?? 0);
    }
  }
  return Object.fromEntries(
    Object.entries(sums).map(([position, total]) => [position, total / buckets]),
  ) as Record<Position, number>;
}

interface Candidate {
  slot: RosterSlot;
  season: RatedSeason;
}

/**
 * Every legal (slot, card) pair on offer — not just the best card per slot.
 *
 * This matters more than it looks: if the harness only ever offers the top
 * card of each position group, no simulated roster is ever mediocre, the raw
 * score distribution collapses into its top few points, and the calibration
 * fitted against it is meaningless.
 */
function candidatesFor(bucket: Bucket, open: RosterSlot[], usedEntities: Set<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const slot of open) {
    for (const season of bucket[SLOT_POSITION[slot]]) {
      if (!usedEntities.has(season.entityId)) out.push({ slot, season });
    }
  }
  return out;
}

/** The best still-available card for each open slot. */
function bestPerSlot(candidates: readonly Candidate[]): Candidate[] {
  const best = new Map<RosterSlot, Candidate>();
  for (const candidate of candidates) {
    const current = best.get(candidate.slot);
    if (!current || candidate.season.rating > current.season.rating) best.set(candidate.slot, candidate);
  }
  return [...best.values()];
}

/**
 * How much this pick improves the roster: the slot's weight times how far the
 * card beats what that position is expected to yield from a later spin.
 */
function candidateGain(
  candidate: Candidate,
  config: ScoringConfig,
  baseline: Record<Position, number>,
): number {
  const position = SLOT_POSITION[candidate.slot];
  return config.rosterWeights[candidate.slot] * (candidate.season.rating - baseline[position]);
}

function chooseCandidate(
  candidates: Candidate[],
  skill: Skill,
  config: ScoringConfig,
  baseline: Record<Position, number>,
  rng: Rng,
): Candidate {
  if (candidates.length === 1) return candidates[0]!;
  if (skill >= 1) {
    return candidates.reduce((best, c) =>
      candidateGain(c, config, baseline) > candidateGain(best, config, baseline) ? c : best,
    );
  }

  // Softmax over the gain. Temperature falls as skill rises, so the same code
  // path spans a coin-flipper and an optimiser.
  const temperature = 0.05 + 3 * (1 - skill) ** 2;
  const gains = candidates.map((c) => candidateGain(c, config, baseline));
  const best = Math.max(...gains);
  const weights = gains.map((g) => Math.exp((g - best) / temperature));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let roll = rng.next() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

export interface PlayedGame {
  readonly roster: CompletedRoster;
  readonly spins: readonly SpinResult[];
  readonly skill: Skill;
}

/**
 * One complete game: seven spins, one selection each. A spin that offers
 * nothing for any open slot is re-spun rather than dead-ending (PRFAQ §6.3).
 */
export function playGame(
  pool: RatingPool,
  rng: Rng,
  skill: Skill,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
  baseline: Record<Position, number> = expectedBestByPosition(pool),
): PlayedGame {
  const selections: Partial<Record<RosterSlot, RosterSelection>> = {};
  const usedEntities = new Set<string>();
  const spins: SpinResult[] = [];
  let sequence = 0;
  let guard = 0;

  while (Object.keys(selections).length < ROSTER_SLOTS.length) {
    if (guard++ > 200) throw new Error('Spin loop failed to converge');
    const spin = drawSpin(pool, rng, sequence + 1);
    sequence++;
    const bucket = bucketFor(pool, spin.franchiseId, spin.era);
    const open = ROSTER_SLOTS.filter((slot) => selections[slot] === undefined);
    const candidates = candidatesFor(bucket, open, usedEntities);

    if (candidates.length === 0) {
      sequence--; // dead end: re-spin, this one never happened
      continue;
    }

    const chosen = chooseCandidate(candidates, skill, config, baseline, rng);
    selections[chosen.slot] = {
      slot: chosen.slot,
      season: chosen.season,
      spinSequence: spin.sequence,
    };
    usedEntities.add(chosen.season.entityId);
    spins.push(spin);
  }

  return { roster: selections as CompletedRoster, spins, skill };
}

// ---------------------------------------------------------------------------
// Perfection reachability — an upper bound, not a strategy
// ---------------------------------------------------------------------------

/**
 * Per-slot rating floors implied by the perfection gates, before the
 * "four positions at 98+" requirement is layered on.
 */
function slotFloors(config: ScoringConfig): Record<RosterSlot, number> {
  const { slotMinimums, universalSlotMinimum } = config.perfection;
  return Object.fromEntries(
    ROSTER_SLOTS.map((slot) => [slot, Math.max(universalSlotMinimum, slotMinimums[slot] ?? 0)]),
  ) as Record<RosterSlot, number>;
}

/** Best available card of `position` in `bucket` at or above `floor`, by rank. */
function nthQualifying(bucket: Bucket, position: Position, floor: number, rank: number): RatedSeason | undefined {
  const qualifying = bucket[position].filter((s) => s.rating >= floor);
  return qualifying[rank];
}

/**
 * Maximum-cardinality bipartite matching (Kuhn's algorithm) between the seven
 * spins and the seven roster slots.
 */
function matchSlots(
  edges: readonly (readonly number[])[],
  slotCount: number,
  spinCount: number,
): number[] | null {
  const spinToSlot = new Array<number>(spinCount).fill(-1);

  const tryAssign = (slot: number, seen: boolean[]): boolean => {
    for (const spin of edges[slot]!) {
      if (seen[spin]) continue;
      seen[spin] = true;
      if (spinToSlot[spin] === -1 || tryAssign(spinToSlot[spin]!, seen)) {
        spinToSlot[spin] = slot;
        return true;
      }
    }
    return false;
  };

  for (let slot = 0; slot < slotCount; slot++) {
    if (!tryAssign(slot, new Array<boolean>(spinCount).fill(false))) return null;
  }

  const slotToSpin = new Array<number>(slotCount).fill(-1);
  spinToSlot.forEach((slot, spin) => {
    if (slot !== -1) slotToSpin[slot] = spin;
  });
  return slotToSpin;
}

/** Confirms an assignment can be realised with seven distinct historical identities. */
function realise(
  slotToSpin: readonly number[],
  spins: readonly SpinResult[],
  pool: RatingPool,
  floors: readonly number[],
): CompletedRoster | null {
  const rankUsed = new Map<string, number>();
  const selections: Partial<Record<RosterSlot, RosterSelection>> = {};

  for (let slotIndex = 0; slotIndex < ROSTER_SLOTS.length; slotIndex++) {
    const slot = ROSTER_SLOTS[slotIndex]!;
    const spin = spins[slotToSpin[slotIndex]!]!;
    const bucket = bucketFor(pool, spin.franchiseId, spin.era);
    const position = SLOT_POSITION[slot];
    // Two spins can land on the same franchise-era; the second must take the
    // next-best card, not the same player again.
    const key = `${spin.franchiseId}:${spin.era}:${position}`;
    const rank = rankUsed.get(key) ?? 0;
    const season = nthQualifying(bucket, position, floors[slotIndex]!, rank);
    if (!season) return null;
    rankUsed.set(key, rank + 1);
    selections[slot] = { slot, season, spinSequence: spin.sequence };
  }

  return selections as CompletedRoster;
}

/**
 * How many roster slots could be filled at their gate floors simultaneously.
 * The diagnostic that explains *why* a draw fails: 7 means the gates were
 * within reach, 4 means three positions never showed up.
 */
export function maxGatedSlotCount(
  spins: readonly SpinResult[],
  pool: RatingPool,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): number {
  const floors = slotFloors(config);
  const edges = ROSTER_SLOTS.map((slot) => {
    const position = SLOT_POSITION[slot];
    const out: number[] = [];
    spins.forEach((spin, spinIndex) => {
      const bucket = bucketFor(pool, spin.franchiseId, spin.era);
      if (bucket[position].some((s) => s.rating >= floors[slot])) out.push(spinIndex);
    });
    return out;
  });

  const spinToSlot = new Array<number>(spins.length).fill(-1);
  const tryAssign = (slot: number, seen: boolean[]): boolean => {
    for (const spin of edges[slot]!) {
      if (seen[spin]) continue;
      seen[spin] = true;
      if (spinToSlot[spin] === -1 || tryAssign(spinToSlot[spin]!, seen)) {
        spinToSlot[spin] = slot;
        return true;
      }
    }
    return false;
  };

  let matched = 0;
  for (let slot = 0; slot < ROSTER_SLOTS.length; slot++) {
    if (tryAssign(slot, new Array<boolean>(spins.length).fill(false))) matched++;
  }
  return matched;
}

export interface ReachabilityVerdict {
  /** A roster satisfying every perfection gate exists for this spin sequence. */
  readonly gatesReachable: boolean;
  /** Best final rating found among gate-satisfying assignments. */
  readonly bestGatedRating: number | null;
  /** True only if that roster also clears the score threshold. */
  readonly perfectReachable: boolean;
}

/**
 * Given a fixed sequence of seven spins, could *any* legal set of choices
 * produce an 18-0?
 *
 * This deliberately assumes omniscient play — the user knows every card in
 * every bucket before choosing. It is an upper bound: no real strategy can do
 * better. If this says no, 18-0 is impossible for that draw.
 */
export function evaluateReachability(
  spins: readonly SpinResult[],
  pool: RatingPool,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): ReachabilityVerdict {
  const floors = slotFloors(config);
  const { minCount, minRating } = config.perfection.eliteCount;

  // QB and DEF already carry a 98 floor; the elite-count gate needs the rest
  // of the shortfall made up by other slots.
  const alreadyElite = ROSTER_SLOTS.filter((slot) => floors[slot] >= minRating);
  const upgradable = ROSTER_SLOTS.filter((slot) => floors[slot] < minRating);
  const extraNeeded = Math.max(0, minCount - alreadyElite.length);

  const subsets: RosterSlot[][] = [];
  const build = (start: number, current: RosterSlot[]) => {
    if (current.length === extraNeeded) {
      subsets.push([...current]);
      return;
    }
    for (let i = start; i < upgradable.length; i++) {
      current.push(upgradable[i]!);
      build(i + 1, current);
      current.pop();
    }
  };
  build(0, []);

  let bestGatedRating: number | null = null;
  let gatesReachable = false;

  for (const subset of subsets) {
    const raised = ROSTER_SLOTS.map((slot) =>
      subset.includes(slot) ? Math.max(floors[slot], minRating) : floors[slot],
    );

    const edges = ROSTER_SLOTS.map((slot, slotIndex) => {
      const position = SLOT_POSITION[slot];
      const out: number[] = [];
      spins.forEach((spin, spinIndex) => {
        const bucket = bucketFor(pool, spin.franchiseId, spin.era);
        if (bucket[position].some((s) => s.rating >= raised[slotIndex]!)) out.push(spinIndex);
      });
      return out;
    });

    const matching = matchSlots(edges, ROSTER_SLOTS.length, spins.length);
    if (!matching) continue;

    const roster = realise(matching, spins, pool, raised);
    if (!roster) continue;

    const result = scoreRoster(roster, config);
    if (result.perfectEligibility.failedGates.length > 0) continue;

    gatesReachable = true;
    if (bestGatedRating === null || result.finalRating > bestGatedRating) {
      bestGatedRating = result.finalRating;
    }
  }

  return {
    gatesReachable,
    bestGatedRating,
    perfectReachable:
      gatesReachable && bestGatedRating !== null && bestGatedRating >= config.perfection.minFinalRating,
  };
}

export type { EraKey };

/**
 * Draws a player's skill for one game.
 *
 * Skewed toward the middle with tails at both ends: most people play
 * reasonably, a few click through, a few optimise hard.
 */
export function drawSkill(rng: Rng): Skill {
  const a = rng.next();
  const b = rng.next();
  // Mean of two uniforms, nudged upward — a rough stand-in for a real skill curve.
  return Math.min(1, ((a + b) / 2) * 1.25);
}
