import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_CONFIG,
  ROSTER_SLOTS,
  evaluatePerfection,
  isPerfectionDenied,
  scoreRoster,
} from '../src/index.js';
import { flatRoster, makeRoster } from './helpers.js';

const config = DEFAULT_SCORING_CONFIG;
const THRESHOLD = config.perfection.minFinalRating;

/** A roster that clears every gate, used as the baseline to break one at a time. */
const PERFECT_SPEC = { QB: 99.5, RB1: 98.5, RB2: 98.2, WR1: 99.4, WR2: 98.6, TE1: 98.1, DEF: 99.1 };

describe('perfection gates (PRFAQ §21)', () => {
  it('passes a roster that satisfies every gate', () => {
    const result = evaluatePerfection(makeRoster(PERFECT_SPEC), THRESHOLD, config);
    expect(result.failedGates).toEqual([]);
    expect(result.eligible).toBe(true);
  });

  it('denies a roster below the score threshold even with a flawless lineup', () => {
    const result = evaluatePerfection(makeRoster(PERFECT_SPEC), THRESHOLD - 0.001, config);
    expect(result.reachedThreshold).toBe(false);
    expect(result.eligible).toBe(false);
    expect(result.failedGates).toEqual([]);
  });

  it('requires QB >= 98', () => {
    const result = evaluatePerfection(
      makeRoster({ ...PERFECT_SPEC, QB: 97.9 }),
      THRESHOLD,
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.failedGates.some((g) => g.slot === 'QB' && g.kind === 'position_minimum')).toBe(true);
  });

  it('requires DEF >= 98', () => {
    const result = evaluatePerfection(
      makeRoster({ ...PERFECT_SPEC, DEF: 97.99 }),
      THRESHOLD,
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.failedGates.some((g) => g.slot === 'DEF' && g.kind === 'position_minimum')).toBe(true);
  });

  it.each(ROSTER_SLOTS)('requires %s >= 96', (slot) => {
    const result = evaluatePerfection(
      makeRoster({ ...PERFECT_SPEC, [slot]: 95.9 }),
      THRESHOLD,
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.failedGates.some((g) => g.slot === slot)).toBe(true);
  });

  it('accepts a slot exactly at the universal minimum', () => {
    const result = evaluatePerfection(
      makeRoster({ ...PERFECT_SPEC, RB2: 96 }),
      THRESHOLD,
      config,
    );
    expect(result.failedGates).toEqual([]);
  });

  it('requires at least four positions at 98+', () => {
    // All seven clear 96 and QB/DEF clear 98, but only three slots reach 98.
    const result = evaluatePerfection(
      makeRoster({ QB: 98.1, RB1: 96.5, RB2: 96.5, WR1: 96.5, WR2: 96.5, TE1: 98.2, DEF: 98.3 }),
      THRESHOLD,
      config,
    );
    const gate = result.failedGates.find((g) => g.kind === 'elite_count');
    expect(gate).toBeDefined();
    expect(gate!.actual).toBe(3);
    expect(gate!.required).toBe(4);
    expect(result.eligible).toBe(false);
  });

  it('accepts exactly four positions at 98+', () => {
    const result = evaluatePerfection(
      makeRoster({ QB: 98.1, RB1: 96.5, RB2: 96.5, WR1: 98.4, WR2: 96.5, TE1: 98.2, DEF: 98.3 }),
      THRESHOLD,
      config,
    );
    expect(result.failedGates).toEqual([]);
  });

  it('names the blocker for the PERFECTION DENIED screen', () => {
    const result = evaluatePerfection(
      makeRoster({ ...PERFECT_SPEC, RB2: 95.4 }),
      THRESHOLD,
      config,
    );
    expect(result.failedGates[0]!.message).toBe(
      'RB2 needed a 96.0 minimum for 18-0 eligibility.',
    );
  });
});

describe('gate outcome routing (PRFAQ §21)', () => {
  it('a flawless roster that clears the threshold finishes 18-0', () => {
    const result = scoreRoster(flatRoster(100), config);
    expect(result.finalRating).toBeGreaterThanOrEqual(THRESHOLD);
    expect(result.record).toEqual({ wins: 18, losses: 0 });
    expect(result.ending.key).toBe('PERFECT');
    expect(result.ending.tier).toBe('IMMORTAL');
    expect(result.distanceFromPerfection).toBe(0);
    expect(isPerfectionDenied(result)).toBe(false);
  });

  it('a threshold-clearing roster with one failed gate falls to 17-1', () => {
    // Ratings high enough to clear the score, with one slot under the floor.
    const denied = scoreRoster(
      makeRoster({ QB: 100, RB1: 100, RB2: 95.5, WR1: 100, WR2: 100, TE1: 100, DEF: 100 }),
      config,
    );
    expect(denied.perfectEligibility.reachedThreshold).toBe(true);
    expect(denied.perfectEligibility.eligible).toBe(false);
    expect(denied.record).toEqual({ wins: 17, losses: 1 });
    expect(denied.ending.key).toBe('HEARTBREAK');
    expect(denied.ending.tier).toBe('S+');
    expect(isPerfectionDenied(denied)).toBe(true);
  });

  it('17-1 by score alone is not a denied perfection', () => {
    const result = scoreRoster(flatRoster(93), config);
    if (result.ending.key === 'HEARTBREAK') {
      expect(isPerfectionDenied(result)).toBe(false);
    }
  });
});
