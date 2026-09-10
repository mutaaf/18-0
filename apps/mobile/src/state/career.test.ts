import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from './history';
import {
  bucketOf,
  careerReport,
  cumulative,
  dayNumber,
  modeCount,
  percentileOf,
  quantile,
} from './career';

/**
 * The one walk of a player's history, asserted.
 *
 * Everything here is arithmetic somebody could do by hand, which is the point:
 * the report is fast because it reads the array once and derives the rest from
 * fixed-size accumulators, and the whole risk of that shape is that a figure is
 * quietly wrong in a way no screen makes obvious. A median interpolated off the
 * wrong side of a bucket, a streak that counts a gap, a variance that drifts --
 * all of them render as a plausible number.
 *
 * `environment: 'node'`, so this file and `career.ts` may not reach
 * react-native. `HistoryEntry` is imported as a type only; the value import
 * would pull in AsyncStorage and zustand and none of this would run.
 */

/**
 * Only the fields the report reads.
 *
 * `GameResult` carries a breakdown, a perfection eligibility and a model
 * version that no figure here touches, and building honest ones would make
 * every fixture in the file about scoring rather than about the walk.
 */
function season(input: {
  rating: number;
  at: number;
  assisted?: boolean;
  mode?: string;
  ending?: string;
  wins?: number;
  roster?: readonly { franchiseId: string; era: string; rating: number; name?: string }[];
}): HistoryEntry {
  const wins = input.wins ?? 9;
  return {
    id: `${input.at}-${input.rating}`,
    completedAt: input.at,
    assisted: input.assisted,
    mode: input.mode,
    result: {
      finalRating: input.rating,
      record: { wins, losses: 18 - wins },
      ending: { key: input.ending ?? 'SOLID' },
    },
    roster: (input.roster ?? []).map((pick, i) => ({
      slot: 'QB',
      cardId: `c${i}`,
      name: pick.name ?? `Player ${i}`,
      franchiseId: pick.franchiseId,
      era: pick.era,
      year: 2001,
      rating: pick.rating,
    })),
  } as unknown as HistoryEntry;
}

/** Midday local, `days` whole days before now. Midday so no timezone straddles. */
function daysAgo(days: number): number {
  const now = new Date();
  const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return noon.getTime() - days * 86_400_000;
}

describe('careerReport', () => {
  it('has an answer for a player who has never played', () => {
    const report = careerReport([]);
    expect(report.total).toBe(0);
    expect(report.bestRating).toBeNull();
    expect(report.medianRating).toBeNull();
    expect(report.ratingSpread).toBeNull();
    // Fixed-length and safe to render: a chart that maps over this must not
    // have to check whether it exists.
    expect(report.histogram).toHaveLength(25);
    expect(report.weekdays).toHaveLength(7);
  });

  it('splits counted seasons from assisted ones', () => {
    const report = careerReport([
      season({ rating: 90, at: daysAgo(0) }),
      season({ rating: 99, at: daysAgo(1), assisted: true }),
      season({ rating: 70, at: daysAgo(2) }),
    ]);

    expect(report.total).toBe(3);
    expect(report.counted).toBe(2);
    expect(report.assisted).toBe(1);
    // The rigged season is the highest rating in the array and must not be the
    // best, the average, or a bar on the chart.
    expect(report.bestRating).toBe(90);
    expect(report.averageRating).toBe(80);
    expect(report.histogram.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('aggregates the record, the endings and the modes', () => {
    const report = careerReport([
      season({ rating: 99, at: daysAgo(0), wins: 18, ending: 'PERFECT', mode: 'player_iq' }),
      season({ rating: 95, at: daysAgo(1), wins: 17, ending: 'HEARTBREAK', mode: 'player_iq' }),
      season({ rating: 60, at: daysAgo(2), wins: 4, mode: 'rookie' }),
    ]);

    expect(report.wins).toBe(39);
    expect(report.losses).toBe(15);
    expect(report.perfect).toBe(1);
    expect(report.heartbreak).toBe(1);
    expect(report.bestRecord).toEqual({ wins: 18, losses: 0 });
    // Ranked descending, so the favourite is first.
    expect(report.modes[0]).toEqual({ mode: 'player_iq', count: 2 });
    expect(modeCount(report, 'rookie')).toBe(1);
    expect(modeCount(report, 'gameday')).toBe(0);
  });

  it('treats a season with no mode as rookie', () => {
    const report = careerReport([season({ rating: 80, at: daysAgo(0) })]);
    expect(report.modes).toEqual([{ mode: 'rookie', count: 1 }]);
  });

  it('finds the favourite franchise, era and pick across every roster', () => {
    const report = careerReport([
      season({
        rating: 80,
        at: daysAgo(0),
        roster: [
          { franchiseId: 'BAL', era: '2010_2019', rating: 88 },
          { franchiseId: 'BAL', era: '1999_2009', rating: 91, name: 'The best one' },
        ],
      }),
      season({
        rating: 80,
        at: daysAgo(1),
        roster: [{ franchiseId: 'GB', era: '2010_2019', rating: 70 }],
      }),
    ]);

    expect(report.topFranchise).toBe('BAL');
    expect(report.topFranchisePicks).toBe(2);
    expect(report.topEra).toBe('2010_2019');
    expect(report.topEraPicks).toBe(2);
    expect(report.picks).toBe(3);
    expect(report.bestCard?.name).toBe('The best one');
  });

  it('gives the form line oldest-first and caps it at twelve', () => {
    // History is stored newest-first, so this is a player who has been
    // improving. A form line that came out in the stored order would show every
    // one of them getting worse.
    const games = Array.from({ length: 20 }, (_, i) =>
      season({ rating: 99 - i, at: daysAgo(i) }),
    );
    const report = careerReport(games);

    expect(report.form).toHaveLength(12);
    expect(report.form[0]).toBe(88);
    expect(report.form[11]).toBe(99);
  });

  it('caches on the array identity', () => {
    const games = [season({ rating: 80, at: daysAgo(0) })];
    expect(careerReport(games)).toBe(careerReport(games));
    // A new array is a new history, whatever it contains.
    expect(careerReport([...games])).not.toBe(careerReport(games));
  });
});

describe('the distribution', () => {
  it('buckets ratings into the fixed span, clamping the ends', () => {
    expect(bucketOf(50)).toBe(0);
    expect(bucketOf(51.9)).toBe(0);
    expect(bucketOf(52)).toBe(1);
    expect(bucketOf(99.9)).toBe(24);
    // Nothing scores outside 50-100, but a clamp is cheaper than a crash if
    // the calibration curve ever moves.
    expect(bucketOf(0)).toBe(0);
    expect(bucketOf(120)).toBe(24);
  });

  it('reads the median off the histogram rather than a sort', () => {
    // Five seasons, so the median is the third: 80.
    const report = careerReport(
      [70, 76, 80, 88, 94].map((rating, i) => season({ rating, at: daysAgo(i) })),
    );
    // Each of those is alone in its bucket, so the interpolation lands inside
    // the bucket holding 80 rather than on its floor.
    expect(report.medianRating).toBeGreaterThanOrEqual(80);
    expect(report.medianRating).toBeLessThan(82);
  });

  it('interpolates inside a bucket rather than quantising to it', () => {
    // Ten seasons in the same two-point bucket. A median that returned the
    // bucket's midpoint would be identical for every possible arrangement of
    // them, which is what made it disagree visibly with the average.
    const report = careerReport(
      Array.from({ length: 10 }, (_, i) => season({ rating: 80.5, at: daysAgo(i) })),
    );
    expect(report.medianRating).toBeCloseTo(81, 5);
  });

  it('answers any quantile from the same twenty-five numbers', () => {
    const report = careerReport(
      Array.from({ length: 100 }, (_, i) => season({ rating: 50 + i * 0.5, at: daysAgo(i % 40) })),
    );

    expect(quantile(report, 0.5)).toBeCloseTo(report.medianRating!, 6);
    expect(quantile(report, 0.1)!).toBeLessThan(quantile(report, 0.9)!);
    // Clamped rather than thrown: a caller asking for p100 mid-render wants the
    // top of the distribution.
    expect(quantile(report, 1.5)).toBe(quantile(report, 1));
    expect(quantile(report, -1)).toBe(quantile(report, 0));
    expect(quantile(careerReport([]), 0.5)).toBeNull();
  });

  it('reports where one rating sits among the rest', () => {
    const report = careerReport(
      [60, 70, 80, 90].map((rating, i) => season({ rating, at: daysAgo(i) })),
    );

    expect(percentileOf(report, 50)).toBe(0);
    expect(percentileOf(report, 100)).toBe(1);
    expect(percentileOf(report, 85)).toBeCloseTo(0.75, 6);
    expect(percentileOf(careerReport([]), 80)).toBeNull();
  });

  it('runs the histogram up to the counted total', () => {
    const report = careerReport(
      [60, 70, 80].map((rating, i) => season({ rating, at: daysAgo(i) })),
    );
    const running = cumulative(report.histogram);
    expect(running).toHaveLength(25);
    expect(running[24]).toBe(3);
    // Monotonic, or the cumulative chart draws a curve that goes backwards.
    for (let i = 1; i < running.length; i++) {
      expect(running[i]!).toBeGreaterThanOrEqual(running[i - 1]!);
    }
  });

  it('measures the spread, and refuses to for a single season', () => {
    const one = careerReport([season({ rating: 80, at: daysAgo(0) })]);
    expect(one.ratingSpread).toBeNull();

    // Population sigma of 70 and 90 about a mean of 80 is exactly 10.
    const two = careerReport([
      season({ rating: 70, at: daysAgo(0) }),
      season({ rating: 90, at: daysAgo(1) }),
    ]);
    expect(two.averageRating).toBe(80);
    expect(two.ratingSpread).toBeCloseTo(10, 10);

    const flat = careerReport(
      Array.from({ length: 8 }, (_, i) => season({ rating: 84, at: daysAgo(i) })),
    );
    expect(flat.ratingSpread).toBeCloseTo(0, 10);
  });
});

describe('the play rhythm', () => {
  it('counts days rather than seasons', () => {
    const report = careerReport([
      season({ rating: 80, at: daysAgo(0) }),
      season({ rating: 81, at: daysAgo(0) + 3_600_000 }),
      season({ rating: 82, at: daysAgo(1) }),
    ]);
    expect(report.total).toBe(3);
    expect(report.daysPlayed).toBe(2);
  });

  it('counts a run that reaches today', () => {
    const report = careerReport(
      [0, 1, 2, 3].map((d) => season({ rating: 80, at: daysAgo(d) })),
    );
    expect(report.dayStreak).toBe(4);
    expect(report.longestStreak).toBe(4);
  });

  it('keeps a streak alive on a day that has not been missed yet', () => {
    // Played yesterday, not today. The day is not over, so nothing is broken.
    const report = careerReport(
      [1, 2, 3].map((d) => season({ rating: 80, at: daysAgo(d) })),
    );
    expect(report.dayStreak).toBe(3);
  });

  it('breaks the current run on a gap but keeps the longest', () => {
    // A five-day run a fortnight ago, then two days ending yesterday. The
    // current run is the recent one; the longest is the old one.
    const report = careerReport(
      [1, 2, 14, 15, 16, 17, 18].map((d) => season({ rating: 80, at: daysAgo(d) })),
    );
    expect(report.dayStreak).toBe(2);
    expect(report.longestStreak).toBe(5);
  });

  it('reports no current run once a whole day has been missed', () => {
    const report = careerReport(
      [2, 3, 4].map((d) => season({ rating: 80, at: daysAgo(d) })),
    );
    expect(report.dayStreak).toBe(0);
    expect(report.longestStreak).toBe(3);
  });

  it('spreads seasons across the weekdays they were played on', () => {
    const games = [0, 1, 2].map((d) => season({ rating: 80, at: daysAgo(d) }));
    const report = careerReport(games);

    expect(report.weekdays.reduce((a, b) => a + b, 0)).toBe(3);
    for (const game of games) {
      expect(report.weekdays[new Date(game.completedAt).getDay()]).toBeGreaterThan(0);
    }
  });

  it('counts an assisted season in the rhythm but not in the record', () => {
    // Opening the app is opening the app. The rigged spin costs a record, not
    // a streak.
    const report = careerReport([
      season({ rating: 99, at: daysAgo(0), assisted: true }),
      season({ rating: 80, at: daysAgo(1) }),
    ]);
    expect(report.dayStreak).toBe(2);
    expect(report.counted).toBe(1);
  });

  it('brackets the career with its first and last season', () => {
    const report = careerReport([
      season({ rating: 80, at: daysAgo(0) }),
      season({ rating: 80, at: daysAgo(9) }),
    ]);
    expect(report.firstAt).toBe(daysAgo(9));
    expect(report.lastAt).toBe(daysAgo(0));
  });
});

describe('dayNumber', () => {
  it('is the device’s own idea of a day, not the server’s', () => {
    // Two moments the same local day apart by hours must be one day, or every
    // streak is decided by what time somebody plays.
    const morning = new Date(2026, 2, 14, 7, 30).getTime();
    const night = new Date(2026, 2, 14, 23, 45).getTime();
    expect(dayNumber(morning)).toBe(dayNumber(night));
    expect(dayNumber(new Date(2026, 2, 15, 1).getTime())).toBe(dayNumber(morning) + 1);
  });
});
