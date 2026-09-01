import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_CONFIG,
  ROSTER_FIXTURES,
  ROSTER_SLOTS,
  fixtureByKey,
  fixtureRoster,
  isPerfectionDenied,
  scoreRoster,
} from '../src/index.js';

const config = DEFAULT_SCORING_CONFIG;

describe('seed fixtures (PRFAQ §38)', () => {
  it.each(ROSTER_FIXTURES.map((f) => [f.key, f] as const))(
    '%s lands on its expected ending',
    (_key, fixture) => {
      const result = scoreRoster(fixtureRoster(fixture), config);
      expect([result.record.wins, result.record.losses]).toEqual([...fixture.expectedRecord]);
      expect(result.ending.key).toBe(fixture.expectedEndingKey);
    },
  );

  it('covers a spread from a losing season to 18-0', () => {
    const wins = ROSTER_FIXTURES.map((f) => f.expectedRecord[0]);
    expect(Math.min(...wins)).toBeLessThanOrEqual(6);
    expect(Math.max(...wins)).toBe(18);
  });

  it('the perfect fixture clears every gate', () => {
    const result = scoreRoster(fixtureRoster(fixtureByKey('perfect')), config);
    expect(result.perfectEligibility.eligible).toBe(true);
    expect(result.perfectEligibility.failedGates).toEqual([]);
    expect(result.ending.tier).toBe('IMMORTAL');
    expect(result.distanceFromPerfection).toBe(0);
  });

  it('the denied fixture clears the score and fails on RB2', () => {
    const result = scoreRoster(fixtureRoster(fixtureByKey('perfection_denied')), config);
    expect(result.finalRating).toBeGreaterThanOrEqual(config.perfection.minFinalRating);
    expect(result.perfectEligibility.reachedThreshold).toBe(true);
    expect(result.perfectEligibility.eligible).toBe(false);
    expect(isPerfectionDenied(result)).toBe(true);
    expect(result.perfectEligibility.failedGates[0]!.slot).toBe('RB2');
    expect(result.record).toEqual({ wins: 17, losses: 1 });
  });

  it('the heartbreak fixture is 17-1 on score, not on a gate', () => {
    const result = scoreRoster(fixtureRoster(fixtureByKey('heartbreak')), config);
    expect(result.finalRating).toBeLessThan(config.perfection.minFinalRating);
    expect(isPerfectionDenied(result)).toBe(false);
    expect(result.distanceFromPerfection).toBeGreaterThan(0);
  });

  it('every fixture is a legal, fully-populated roster', () => {
    for (const fixture of ROSTER_FIXTURES) {
      const roster = fixtureRoster(fixture);
      const entityIds = new Set(ROSTER_SLOTS.map((s) => roster[s].season.entityId));
      expect(entityIds.size).toBe(ROSTER_SLOTS.length);
      for (const slot of ROSTER_SLOTS) {
        expect(roster[slot].season.rating).toBeGreaterThan(0);
        expect(roster[slot].season.rating).toBeLessThanOrEqual(100);
      }
    }
  });
});
