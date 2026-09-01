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

const UNIVERSAL = config.perfection.universalSlotMinimum;
const QB_FLOOR = config.perfection.slotMinimums.QB!;
const DEF_FLOOR = config.perfection.slotMinimums.DEF!;
const ELITE = config.perfection.eliteCount;

/**
 * A roster that clears every gate, used as the baseline to break one at a time.
 * Derived from the config so a gate recalibration updates the tests with it.
 */
const PERFECT_SPEC = {
  QB: 99.5,
  RB1: ELITE.minRating + 1.5,
  RB2: ELITE.minRating + 1.2,
  WR1: 99.4,
  WR2: ELITE.minRating + 1.6,
  TE1: ELITE.minRating + 1.1,
  DEF: 99.1,
};

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

  it('requires QB to clear its dedicated floor', () => {
    const result = evaluatePerfection(
      makeRoster({ ...PERFECT_SPEC, QB: QB_FLOOR - 0.1 }),
      THRESHOLD,
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.failedGates.some((g) => g.slot === 'QB' && g.kind === 'position_minimum')).toBe(true);
  });

  it('requires DEF to clear its dedicated floor', () => {
    const result = evaluatePerfection(
      makeRoster({ ...PERFECT_SPEC, DEF: DEF_FLOOR - 0.01 }),
      THRESHOLD,
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.failedGates.some((g) => g.slot === 'DEF' && g.kind === 'position_minimum')).toBe(true);
  });

  it.each(ROSTER_SLOTS)('requires %s to clear the universal floor', (slot) => {
    const result = evaluatePerfection(
      makeRoster({ ...PERFECT_SPEC, [slot]: UNIVERSAL - 0.1 }),
      THRESHOLD,
      config,
    );
    expect(result.eligible).toBe(false);
    expect(result.failedGates.some((g) => g.slot === slot)).toBe(true);
  });

  it('accepts a slot exactly at the universal minimum', () => {
    const result = evaluatePerfection(
      makeRoster({ ...PERFECT_SPEC, RB2: UNIVERSAL }),
      THRESHOLD,
      config,
    );
    expect(result.failedGates).toEqual([]);
  });

  it('requires enough positions at the elite floor', () => {
    // Every slot clears its floor, but one short of the elite count.
    const below = ELITE.minRating - 0.5;
    const result = evaluatePerfection(
      makeRoster({
        QB: ELITE.minRating + 0.1,
        RB1: below,
        RB2: below,
        WR1: below,
        WR2: below,
        TE1: ELITE.minRating + 0.2,
        DEF: ELITE.minRating + 0.3,
      }),
      THRESHOLD,
      config,
    );
    const gate = result.failedGates.find((g) => g.kind === 'elite_count');
    expect(gate).toBeDefined();
    expect(gate!.actual).toBe(ELITE.minCount - 1);
    expect(gate!.required).toBe(ELITE.minCount);
    expect(result.eligible).toBe(false);
  });

  it('accepts exactly the required number of elite positions', () => {
    const below = ELITE.minRating - 0.5;
    const result = evaluatePerfection(
      makeRoster({
        QB: ELITE.minRating + 0.1,
        RB1: below,
        RB2: below,
        WR1: ELITE.minRating + 0.4,
        WR2: below,
        TE1: ELITE.minRating + 0.2,
        DEF: ELITE.minRating + 0.3,
      }),
      THRESHOLD,
      config,
    );
    expect(result.failedGates).toEqual([]);
  });

  it('names the blocker for the PERFECTION DENIED screen', () => {
    const result = evaluatePerfection(
      makeRoster({ ...PERFECT_SPEC, RB2: UNIVERSAL - 1 }),
      THRESHOLD,
      config,
    );
    expect(result.failedGates[0]!.message).toBe(
      `RB2 needed a ${UNIVERSAL.toFixed(1)} minimum for 18-0 eligibility.`,
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
      makeRoster({ QB: 100, RB1: 100, RB2: UNIVERSAL - 0.5, WR1: 100, WR2: 100, TE1: 100, DEF: 100 }),
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
