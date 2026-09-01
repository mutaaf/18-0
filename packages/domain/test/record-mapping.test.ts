import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_CONFIG,
  ENDINGS,
  endingForRating,
  assertMonotonicCalibration,
} from '../src/index.js';

const config = DEFAULT_SCORING_CONFIG;

describe('score-to-record mapping (PRFAQ §20)', () => {
  it('defines all 19 endings, 0-18 through 18-0', () => {
    expect(ENDINGS).toHaveLength(19);
    ENDINGS.forEach((ending, index) => {
      expect(ending.wins).toBe(index);
      expect(ending.losses).toBe(18 - index);
      expect(ending.wins + ending.losses).toBe(18);
    });
  });

  it('has a band for every ending', () => {
    expect(config.recordBands).toHaveLength(ENDINGS.length);
    const bandKeys = config.recordBands.map((b) => b.endingKey);
    expect(new Set(bandKeys).size).toBe(ENDINGS.length);
  });

  it('bands ascend and map to ascending win totals', () => {
    let previousFloor = -Infinity;
    let previousWins = -1;
    for (const band of config.recordBands) {
      expect(band.minRating).toBeGreaterThan(previousFloor);
      const ending = ENDINGS.find((e) => e.key === band.endingKey)!;
      expect(ending.wins).toBeGreaterThan(previousWins);
      previousFloor = band.minRating;
      previousWins = ending.wins;
    }
  });

  // Exact boundary values called out in PRFAQ §37.
  it.each([
    [96.499, 16, 2],
    [96.5, 17, 1],
    [99.249, 17, 1],
    [99.25, 18, 0],
  ])('rating %s maps to %i-%i', (rating, wins, losses) => {
    const ending = endingForRating(rating, config);
    expect([ending.wins, ending.losses]).toEqual([wins, losses]);
  });

  it.each([
    [0, 0],
    [60.999, 0],
    [61, 1],
    [62.9, 1],
    [62.999, 1],
    [63, 2],
    [65, 3],
    [67, 4],
    [69, 5],
    [71, 6],
    [73, 7],
    [75, 8],
    [77, 9],
    [79.999, 9],
    [80, 10],
    [82.5, 11],
    [85, 12],
    [87.5, 13],
    [90, 14],
    [92.5, 15],
    [94.5, 16],
    [100, 18],
  ])('rating %s yields %i wins', (rating, wins) => {
    expect(endingForRating(rating, config).wins).toBe(wins);
  });

  it('is monotonic across the whole 0-100 range', () => {
    let previous = -1;
    for (let r = 0; r <= 100; r += 0.05) {
      const wins = endingForRating(Number(r.toFixed(2)), config).wins;
      expect(wins).toBeGreaterThanOrEqual(previous);
      previous = wins;
    }
  });

  it('every ending is reachable from some rating', () => {
    const reached = new Set<string>();
    for (let r = 0; r <= 100; r += 0.05) {
      reached.add(endingForRating(Number(r.toFixed(2)), config).key);
    }
    expect(reached.size).toBe(19);
  });

  it('ships a monotonic calibration curve', () => {
    expect(() => assertMonotonicCalibration(config)).not.toThrow();
  });
});
