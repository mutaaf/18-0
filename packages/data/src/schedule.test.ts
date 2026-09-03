import { describe, expect, it } from 'vitest';
import { DATASET } from './index.js';
import {
  GAMEDAYS,
  gamedayAt,
  gamedayByKey,
  gamedayDate,
  gamedayLabel,
  nextGamedayAfter,
} from './schedule.js';
import { easternToUtc } from './csv.js';

/**
 * The gameday calendar decides which franchises a gameday run may be dealt, so
 * a wrong window is not a cosmetic bug: it either opens a board on a day the
 * league is not playing, or restricts the wheel to a franchise pool that cannot
 * fill seven slots.
 */
const at = (iso: string) => new Date(iso);

describe('the gameday calendar', () => {
  it('is not empty and is sorted by window', () => {
    expect(GAMEDAYS.length).toBeGreaterThan(50);
    for (let i = 1; i < GAMEDAYS.length; i++) {
      expect(Date.parse(GAMEDAYS[i]!.opensAt)).toBeGreaterThan(
        Date.parse(GAMEDAYS[i - 1]!.opensAt),
      );
    }
  });

  /**
   * `gamedayAt` returns on the first window it reaches, which is only correct
   * while no two windows overlap. The build throws on an overlap; this fails
   * the test suite if a generated file ever arrives without having been built.
   */
  it('has no overlapping windows', () => {
    for (let i = 1; i < GAMEDAYS.length; i++) {
      expect(
        Date.parse(GAMEDAYS[i]!.opensAt),
        `${GAMEDAYS[i - 1]!.key} overlaps ${GAMEDAYS[i]!.key}`,
      ).toBeGreaterThan(Date.parse(GAMEDAYS[i - 1]!.closesAt));
    }
  });

  it('opens before its first kickoff and closes after its last', () => {
    for (const day of GAMEDAYS) {
      const kickoffs = day.games.map((g) => Date.parse(g.kickoff));
      expect(Date.parse(day.opensAt)).toBeLessThan(Math.min(...kickoffs));
      expect(Date.parse(day.closesAt)).toBeGreaterThan(Math.max(...kickoffs));
    }
  });

  it('lists exactly the franchises its fixtures name', () => {
    for (const day of GAMEDAYS) {
      const union = [...new Set(day.games.flatMap((g) => [g.away, g.home]))].sort();
      expect(day.franchises, day.key).toEqual(union);
    }
  });

  /**
   * The playability invariant. A gameday run's wheel is restricted to the
   * franchises playing that day, so every one of them needs at least one
   * franchise-era in the dataset -- a combo already guarantees a fillable
   * roster, because `build.ts` drops any that cannot field one.
   */
  it('only names franchises the wheel can actually offer', () => {
    const spinnable = new Set(DATASET.combos.map((c) => c.franchiseId));
    for (const day of GAMEDAYS) {
      for (const franchiseId of day.franchises) {
        expect(spinnable, `${day.key}: ${franchiseId} has no franchise-era`).toContain(franchiseId);
      }
    }
  });

  it('carries no preseason', () => {
    for (const day of GAMEDAYS) expect(day.type).not.toBe('PRE');
  });
});

describe('resolving the moment', () => {
  const day = GAMEDAYS.find((d) => d.games.length > 4)!;

  it('finds the gameday inside its window', () => {
    expect(gamedayAt(at(day.opensAt))?.key).toBe(day.key);
    expect(gamedayAt(at(day.closesAt))?.key).toBe(day.key);
    const middle = (Date.parse(day.opensAt) + Date.parse(day.closesAt)) / 2;
    expect(gamedayAt(new Date(middle))?.key).toBe(day.key);
  });

  it('is closed a minute either side of it', () => {
    expect(gamedayAt(new Date(Date.parse(day.opensAt) - 60_000))?.key).not.toBe(day.key);
    expect(gamedayAt(new Date(Date.parse(day.closesAt) + 60_000))?.key).not.toBe(day.key);
  });

  it('is closed long before the season and long after it', () => {
    expect(gamedayAt(at('2000-01-01T00:00:00Z'))).toBeNull();
    expect(gamedayAt(at('2099-01-01T00:00:00Z'))).toBeNull();
  });

  it('names the next gameday when none is live', () => {
    const first = GAMEDAYS[0]!;
    expect(nextGamedayAfter(at('2000-01-01T00:00:00Z'))?.key).toBe(first.key);
    expect(nextGamedayAfter(at('2099-01-01T00:00:00Z'))).toBeNull();
    // Inside a window, "next" is the one after this one, not this one.
    expect(nextGamedayAfter(at(day.opensAt))?.key).not.toBe(day.key);
  });

  it('looks a gameday up by key', () => {
    expect(gamedayByKey(day.key)?.key).toBe(day.key);
    expect(gamedayByKey('1999-12-31')).toBeNull();
  });
});

describe('what a gameday is called', () => {
  it('labels a regular-season day by week and a postseason day by round', () => {
    const regular = GAMEDAYS.find((d) => d.type === 'REG')!;
    expect(gamedayLabel(regular)).toBe(`Week ${regular.week} · ${regular.weekday}`);
    const superBowl = GAMEDAYS.find((d) => d.type === 'SB');
    if (superBowl) expect(gamedayLabel(superBowl)).toContain('Super Bowl');
  });

  it('prints the date without a year', () => {
    const day = GAMEDAYS.find((d) => d.key === '2026-09-13');
    if (day) expect(gamedayDate(day)).toBe('Sunday, 13 September');
  });
});

/**
 * The schedule states kickoffs in Eastern with no offset attached. Getting the
 * conversion wrong by an hour is survivable; getting the daylight-saving rule
 * wrong moves a Sunday board onto a Monday for everyone west of the league.
 */
describe('Eastern kickoffs become UTC instants', () => {
  it('uses daylight time in September and standard time in February', () => {
    expect(easternToUtc('2026-09-13', '13:00').toISOString()).toBe('2026-09-13T17:00:00.000Z');
    expect(easternToUtc('2026-02-08', '18:30').toISOString()).toBe('2026-02-08T23:30:00.000Z');
  });

  it('switches on the second Sunday in March and the first in November', () => {
    expect(easternToUtc('2026-03-07', '13:00').toISOString()).toBe('2026-03-07T18:00:00.000Z');
    expect(easternToUtc('2026-03-08', '13:00').toISOString()).toBe('2026-03-08T17:00:00.000Z');
    expect(easternToUtc('2026-11-01', '13:00').toISOString()).toBe('2026-11-01T18:00:00.000Z');
    expect(easternToUtc('2026-10-31', '13:00').toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });
});
