import raw from '../generated/schedule.json' with { type: 'json' };

/**
 * The gameday calendar.
 *
 * A gameday special has to answer one question -- *is the league playing right
 * now, and who* -- and the honest answer was already sitting in the repository:
 * `data/raw/games.csv` is nflverse's schedule file and it carries every fixture
 * through the following season, with kickoff times, both teams and the week.
 *
 * So this is a bundled table rather than a live feed, which matters for three
 * reasons the rest of the game already cares about:
 *
 * - **It is deterministic.** Two devices asked at the same instant agree, and
 *   so does the server. A feed that can be slow, wrong or rate-limited would
 *   put "which franchises are on the wheel" at the mercy of somebody else's
 *   uptime.
 * - **It works offline**, like everything else on the first screen.
 * - **It is auditable.** The window a season was played in can be recomputed
 *   from a file in the repository months later.
 *
 * The cost is that a schedule change -- a flexed kickoff, a postponement --
 * needs a rebuild to reach players. For a wheel and a daily board that is a
 * fair trade; nothing here decides a rating.
 */

/** How the schedule labels a round. */
export type GamedayType = 'REG' | 'WC' | 'DIV' | 'CON' | 'SB' | 'PRE';

export interface ScheduledGame {
  /** Visiting franchise id, as the dataset spells it. */
  readonly away: string;
  readonly home: string;
  /** Kickoff as a UTC instant, so nothing downstream does timezone maths. */
  readonly kickoff: string;
}

export interface Gameday {
  /** The Eastern calendar date, `YYYY-MM-DD`. Stable, readable, unique. */
  readonly key: string;
  readonly season: number;
  /** Week within the season. Postseason rounds carry their own week number. */
  readonly week: number;
  readonly type: GamedayType;
  readonly weekday: string;
  /** When the gameday board opens: three hours before the first kickoff. */
  readonly opensAt: string;
  /** When it closes: six hours after the last, so a night game gets its run. */
  readonly closesAt: string;
  /** Every franchise playing that day, sorted. The wheel for a gameday run. */
  readonly franchises: readonly string[];
  readonly games: readonly ScheduledGame[];
}

export interface Schedule {
  readonly version: string;
  /** SHA-256 of the gamedays, for the same reason the dataset carries one. */
  readonly fingerprint: string;
  readonly source: string;
  readonly gamedays: readonly Gameday[];
}

export const SCHEDULE = raw as unknown as Schedule;

/** Ascending by window, which is the order every lookup below relies on. */
export const GAMEDAYS: readonly Gameday[] = SCHEDULE.gamedays;

const ms = (iso: string): number => Date.parse(iso);

/**
 * The gameday whose window contains `at`, or null.
 *
 * Windows do not overlap -- `schedule.test.ts` fails the build if a rebuild
 * ever makes them -- so the first match is the only match.
 */
export function gamedayAt(at: Date = new Date()): Gameday | null {
  const t = at.getTime();
  for (const day of GAMEDAYS) {
    if (t < ms(day.opensAt)) return null; // sorted: nothing later can contain t
    if (t <= ms(day.closesAt)) return day;
  }
  return null;
}

/** The next gameday to open after `at`, for the screen that has to wait. */
export function nextGamedayAfter(at: Date = new Date()): Gameday | null {
  const t = at.getTime();
  for (const day of GAMEDAYS) {
    if (ms(day.opensAt) > t) return day;
  }
  return null;
}

export function gamedayByKey(key: string): Gameday | null {
  return GAMEDAYS.find((d) => d.key === key) ?? null;
}

const ROUND: Readonly<Record<GamedayType, string | null>> = {
  REG: null,
  WC: 'Wild Card',
  DIV: 'Divisional',
  CON: 'Conference Championship',
  SB: 'Super Bowl',
  PRE: 'Preseason',
};

/** `Week 1 · Sunday`, or `Divisional · Saturday`. */
export function gamedayLabel(day: Gameday): string {
  const round = ROUND[day.type] ?? `Week ${day.week}`;
  return `${round} · ${day.weekday}`;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * `Sunday, 13 September` — the date, without a year nobody needs on screen.
 *
 * Spelled out by hand rather than through `Intl`: the date shown has to be the
 * league's, not the device's, and a device-local formatter would print the day
 * after for anybody east of Eastern watching a night game. Hermes on Android
 * also ships a reduced ICU, so `weekday: 'long'` is not reliably there.
 */
export function gamedayDate(day: Gameday): string {
  const [, month, date] = day.key.split('-').map(Number);
  return `${day.weekday}, ${Number(date)} ${MONTHS[month! - 1]}`;
}
