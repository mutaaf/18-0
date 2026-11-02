import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_CONFIG,
  ENDINGS,
  ENDINGS_18_GAME,
  endingForRating,
  endingsForSeason,
  assertMonotonicCalibration,
  scoreRoster,
  scoringConfigForVersion,
  type ScoringConfig,
} from '../src/index.js';
import { ROSTER_FIXTURES, fixtureRoster } from '../src/index.js';

const config = DEFAULT_SCORING_CONFIG;

describe('score-to-record mapping (PRFAQ §20)', () => {
  it('is a 17-game season: 18 endings, 0-17 through 17-0', () => {
    expect(config.seasonGames).toBe(17);
    expect(ENDINGS).toHaveLength(18);
    ENDINGS.forEach((ending, index) => {
      expect(ending.wins).toBe(index);
      expect(ending.losses).toBe(17 - index);
    });
    expect(ENDINGS.find((e) => e.key === 'AVERAGE')).toBeUndefined();
    expect(ENDINGS.at(-1)!.key).toBe('PERFECT');
    expect(ENDINGS.at(-2)!.key).toBe('HEARTBREAK');
  });

  it.each([
    [96.499, 15, 2],
    [96.5, 16, 1],
    [78.499, 8, 9],
    [78.5, 9, 8],
  ])('rating %s maps to %i-%i', (rating, wins, losses) => {
    const ending = endingForRating(rating, config);
    expect([ending.wins, ending.losses]).toEqual([wins, losses]);
  });

  it('is exact at the 17-0 floor', () => {
    const floor = config.perfection.minFinalRating;
    expect(endingForRating(floor - 0.001, config).wins).toBe(16);
    expect(endingForRating(floor, config).wins).toBe(17);
  });

  it.each([
    [0, 0],
    [60.999, 0],
    [61, 1],
    [62.999, 1],
    [63, 2],
    [65, 3],
    [67, 4],
    [69, 5],
    [71, 6],
    [73, 7],
    [75, 8],
    [78.499, 8],
    [78.5, 9],
    [80, 9],
    [82.5, 10],
    [85, 11],
    [87.5, 12],
    [90, 13],
    [92.5, 14],
    [94.5, 15],
    [100, 17],
  ])('rating %s yields %i wins', (rating, wins) => {
    expect(endingForRating(rating, config).wins).toBe(wins);
  });

  it('ships a monotonic calibration curve', () => {
    expect(() => assertMonotonicCalibration(config)).not.toThrow();
  });
});

// Every registered model, current and frozen, must be internally consistent:
// a band for every ending of its own season length, ascending, all reachable.
describe.each(['1.2.0', '1.3.0', '1.4.0'])('model %s', (version) => {
  const c: ScoringConfig = scoringConfigForVersion(version);
  const endings = endingsForSeason(c.seasonGames);

  it('has one band per ending of its season length', () => {
    expect(endings).toHaveLength(c.seasonGames + 1);
    expect(c.recordBands).toHaveLength(endings.length);
    expect(new Set(c.recordBands.map((b) => b.endingKey)).size).toBe(endings.length);
  });

  it('bands ascend and map to ascending win totals', () => {
    let previousFloor = -Infinity;
    let previousWins = -1;
    for (const band of c.recordBands) {
      expect(band.minRating).toBeGreaterThan(previousFloor);
      const ending = endings.find((e) => e.key === band.endingKey)!;
      expect(ending.wins).toBeGreaterThan(previousWins);
      previousFloor = band.minRating;
      previousWins = ending.wins;
    }
  });

  it('the perfect band floor and the perfection threshold agree', () => {
    const band = c.recordBands.find((b) => b.endingKey === 'PERFECT');
    expect(band?.minRating).toBe(c.perfection.minFinalRating);
  });

  it('every ending is reachable from some rating', () => {
    const reached = new Set<string>();
    for (let r = 0; r <= 100; r += 0.05) {
      reached.add(endingForRating(Number(r.toFixed(2)), c).key);
    }
    expect(reached.size).toBe(endings.length);
  });
});

describe('the 17-game model changed records, not ratings', () => {
  it('1.3.0 still reads as the 18-game model its seasons were published under', () => {
    const legacy = scoringConfigForVersion('1.3.0');
    expect(legacy.seasonGames).toBe(18);
    expect(endingsForSeason(18)).toBe(ENDINGS_18_GAME);
    expect(endingForRating(100, legacy)).toMatchObject({ wins: 18, losses: 0 });
    expect(endingForRating(77, legacy)).toMatchObject({ key: 'AVERAGE', wins: 9, losses: 9 });
  });

  it('every fixture rates identically under 1.3.0 and 1.4.0, and keeps its top-end ending', () => {
    const legacy = scoringConfigForVersion('1.3.0');
    for (const fixture of ROSTER_FIXTURES) {
      const now = scoreRoster(fixtureRoster(fixture), config);
      const then = scoreRoster(fixtureRoster(fixture), legacy);
      expect(now.finalRating).toBe(then.finalRating);
      if (then.ending.key === 'PERFECT' || then.ending.key === 'HEARTBREAK') {
        expect(now.ending.key).toBe(then.ending.key);
      }
    }
  });
});
