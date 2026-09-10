import type { HistoryEntry } from './history';

/**
 * Everything the account screen knows about a player, from one walk of their
 * history.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ONE PASS AND NOT TWELVE
 * ---------------------------------------------------------------------------
 *
 * The screen wants a dozen numbers: totals, a best, an average, a median, a
 * distribution, recent form, a mode split, a favourite franchise, a day streak.
 * The obvious way to get them is a dozen `filter`/`map`/`reduce` calls, which is
 * what the old `computeStats` did -- six passes over the array plus several
 * throwaway arrays, and then `Math.max(...blind.map(...))`, which allocates an
 * array *and* spreads it into a call frame. That last one is not merely slow:
 * spreading a large array into a function is how you get
 * `RangeError: Maximum call stack size exceeded`, and the cap on stored history
 * is five hundred, which is close enough to matter on the weaker JS engines this
 * ships to.
 *
 * So: one loop, fixed-size accumulators, no intermediate arrays. Every figure
 * below is either accumulated in that loop or derived afterwards from something
 * of bounded size -- a 25-bucket histogram, a set of day keys.
 *
 * ---------------------------------------------------------------------------
 * WHY THE MEDIAN COMES OUT OF THE HISTOGRAM
 * ---------------------------------------------------------------------------
 *
 * A median normally means sorting, which is `O(n log n)` and a full copy of the
 * array. The distribution is already being counted for the chart, and a
 * histogram is a cumulative frequency table -- so the median falls out of it in
 * `O(buckets)` with no allocation at all, interpolated inside the bucket it
 * lands in. At two rating points per bucket the answer is within a point of the
 * exact one, which is well inside what anybody reads off a screen.
 *
 * The same argument covers every other quantile, which is why `quantile()` and
 * `percentileOf()` below take the report rather than the history. Once the
 * histogram exists it is a sufficient statistic for the whole distribution: p10,
 * p90 and "what fraction of my seasons did this one beat" are all `O(25)` reads
 * off twenty-five integers, and none of them may go back to the array. A chart
 * control that re-walks five hundred seasons every time somebody taps a segment
 * is the thing this shape exists to make impossible.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS CACHED ON THE ARRAY ITSELF
 * ---------------------------------------------------------------------------
 *
 * Several panels want this and they do not share a parent. Threading it through
 * props would couple them; recomputing per panel would walk the history once per
 * panel per render. A `WeakMap` keyed on the array gives every caller the same
 * object for as long as the store's array identity holds -- which, with zustand,
 * is exactly until a game is recorded -- and lets the whole thing be collected
 * the moment that array is replaced.
 */

/** Ratings below this are not worth a bucket; nothing scores here. */
const FLOOR = 50;
const CEIL = 100;
const BUCKETS = 25;
const SPAN = (CEIL - FLOOR) / BUCKETS;

/** How many recent seasons the form line shows. */
const FORM = 12;

export interface ModeSplit {
  readonly mode: string;
  readonly count: number;
}

export interface CareerReport {
  /** Every season, assisted ones included. */
  readonly total: number;
  /** Seasons allowed to set a record. */
  readonly counted: number;
  readonly assisted: number;

  readonly bestRating: number | null;
  readonly bestRecord: { readonly wins: number; readonly losses: number } | null;
  readonly averageRating: number | null;
  readonly medianRating: number | null;
  readonly worstRating: number | null;
  /**
   * Population standard deviation of the counted ratings.
   *
   * The number that separates a player who lands 84 every time from one whose
   * 84 average is a 96 and a 72. Null until there are two seasons to spread.
   */
  readonly ratingSpread: number | null;

  readonly perfect: number;
  readonly heartbreak: number;
  /** Aggregate record across every counted season. */
  readonly wins: number;
  readonly losses: number;

  /** Counts per rating bucket, low to high. Fixed length, safe to render directly. */
  readonly histogram: readonly number[];
  readonly bucketFloor: number;
  readonly bucketSpan: number;

  /** Up to twelve ratings, oldest first, for the form line. */
  readonly form: readonly number[];

  readonly modes: readonly ModeSplit[];
  readonly topFranchise: string | null;
  readonly topEra: string | null;
  /** How many picks the favourites account for, and out of how many. */
  readonly topFranchisePicks: number;
  readonly topEraPicks: number;
  readonly picks: number;
  readonly bestCard: HistoryEntry['roster'][number] | null;

  /** Consecutive days ending today or yesterday, and the longest ever run. */
  readonly dayStreak: number;
  readonly longestStreak: number;
  readonly daysPlayed: number;
  /**
   * Seasons per local weekday, Sunday first. Assisted ones included: this is
   * when somebody opens the app, not what they are allowed to be proud of.
   */
  readonly weekdays: readonly number[];

  readonly firstAt: number | null;
  readonly lastAt: number | null;
}

const EMPTY: CareerReport = {
  total: 0, counted: 0, assisted: 0,
  bestRating: null, bestRecord: null, averageRating: null, medianRating: null, worstRating: null,
  ratingSpread: null,
  perfect: 0, heartbreak: 0, wins: 0, losses: 0,
  histogram: new Array(BUCKETS).fill(0),
  bucketFloor: FLOOR, bucketSpan: SPAN,
  form: [], modes: [], topFranchise: null, topEra: null,
  topFranchisePicks: 0, topEraPicks: 0, picks: 0, bestCard: null,
  dayStreak: 0, longestStreak: 0, daysPlayed: 0,
  weekdays: new Array(7).fill(0),
  firstAt: null, lastAt: null,
};

const cache = new WeakMap<readonly HistoryEntry[], CareerReport>();

export function careerReport(games: readonly HistoryEntry[]): CareerReport {
  const hit = cache.get(games);
  if (hit) return hit;
  const built = build(games);
  cache.set(games, built);
  return built;
}

function build(games: readonly HistoryEntry[]): CareerReport {
  if (games.length === 0) return EMPTY;

  const histogram = new Array<number>(BUCKETS).fill(0);
  const franchises = new Map<string, number>();
  const eras = new Map<string, number>();
  const modes = new Map<string, number>();
  const days = new Set<number>();
  const weekdays = new Array<number>(7).fill(0);

  let counted = 0;
  let assisted = 0;
  let picks = 0;
  // Welford, rather than accumulating the sum and the sum of squares and
  // subtracting. Both terms in `E[x²] - E[x]²` sit around 7,200 for ratings in
  // the eighties and their difference is a variance around 9, which throws
  // three significant digits away for nothing: the recurrence costs the same
  // two multiplies and never does that.
  let mean = 0;
  let m2 = 0;
  let best: HistoryEntry | null = null;
  let worst = Number.POSITIVE_INFINITY;
  let perfect = 0;
  let heartbreak = 0;
  let wins = 0;
  let losses = 0;
  let bestCard: HistoryEntry['roster'][number] | null = null;
  let firstAt = Number.POSITIVE_INFINITY;
  let lastAt = 0;

  // History is stored newest-first, so the first `FORM` counted entries are the
  // recent ones. Collected forwards and reversed once at the end rather than
  // unshifted, which would be quadratic.
  const form: number[] = [];

  for (let i = 0; i < games.length; i++) {
    const game = games[i]!;
    if (game.completedAt < firstAt) firstAt = game.completedAt;
    if (game.completedAt > lastAt) lastAt = game.completedAt;
    // Local days: this is the player's own sense of "yesterday", and it is not
    // the server's UTC streak. The two are different numbers on purpose and the
    // screen never presents this one as what the multiplier pays for.
    days.add(dayNumber(game.completedAt));
    weekdays[new Date(game.completedAt).getDay()]!++;

    if (game.assisted) { assisted++; continue; }
    counted++;

    const rating = game.result.finalRating;
    const delta = rating - mean;
    mean += delta / counted;
    m2 += delta * (rating - mean);
    if (rating < worst) worst = rating;
    if (!best || rating > best.result.finalRating) best = game;
    histogram[bucketOf(rating)]!++;

    if (form.length < FORM) form.push(rating);

    const ending = game.result.ending.key;
    if (ending === 'PERFECT') perfect++;
    else if (ending === 'HEARTBREAK') heartbreak++;

    wins += game.result.record.wins;
    losses += game.result.record.losses;

    bump(modes, game.mode ?? 'rookie');

    picks += game.roster.length;
    for (let j = 0; j < game.roster.length; j++) {
      const pick = game.roster[j]!;
      bump(franchises, pick.franchiseId);
      bump(eras, pick.era);
      if (!bestCard || pick.rating > bestCard.rating) bestCard = pick;
    }
  }

  form.reverse();
  const streaks = walkStreaks(days);
  const topFranchise = rank(franchises)[0] ?? null;
  const topEra = rank(eras)[0] ?? null;

  return {
    total: games.length,
    counted,
    assisted,
    bestRating: best?.result.finalRating ?? null,
    bestRecord: best?.result.record ?? null,
    averageRating: counted > 0 ? mean : null,
    medianRating: counted > 0 ? quantileFrom(histogram, counted, 0.5) : null,
    worstRating: counted > 0 ? worst : null,
    // One season has no spread, and calling it zero would put a player who has
    // played once next to one who has landed the same rating forty times.
    ratingSpread: counted > 1 ? Math.sqrt(m2 / counted) : null,
    perfect,
    heartbreak,
    wins,
    losses,
    histogram,
    bucketFloor: FLOOR,
    bucketSpan: SPAN,
    form,
    modes: rank(modes),
    topFranchise: topFranchise?.mode ?? null,
    topEra: topEra?.mode ?? null,
    topFranchisePicks: topFranchise?.count ?? 0,
    topEraPicks: topEra?.count ?? 0,
    picks,
    bestCard,
    dayStreak: streaks.current,
    longestStreak: streaks.longest,
    daysPlayed: days.size,
    weekdays,
    firstAt: Number.isFinite(firstAt) ? firstAt : null,
    lastAt: lastAt || null,
  };
}

/** How many seasons were played in one mode. At most a handful of entries. */
export function modeCount(report: CareerReport, mode: string): number {
  for (let i = 0; i < report.modes.length; i++) {
    if (report.modes[i]!.mode === mode) return report.modes[i]!.count;
  }
  return 0;
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Descending by count, then by name so the order is stable across renders. */
function rank(map: Map<string, number>): ModeSplit[] {
  return [...map.entries()]
    .map(([mode, count]) => ({ mode, count }))
    .sort((a, b) => b.count - a.count || a.mode.localeCompare(b.mode));
}

export function bucketOf(rating: number): number {
  const index = Math.floor((rating - FLOOR) / SPAN);
  return index < 0 ? 0 : index >= BUCKETS ? BUCKETS - 1 : index;
}

/**
 * Any quantile, read off the cumulative frequency table.
 *
 * Walks buckets until it passes the target count, then interpolates across the
 * bucket it stopped in rather than returning the bucket's midpoint -- otherwise
 * the answer is quantised to two rating points and visibly disagrees with the
 * average on small histories.
 *
 * `q` is clamped rather than rejected: a caller asking for p100 wants the top
 * of the distribution, not an exception in the middle of a render.
 */
export function quantile(report: CareerReport, q: number): number | null {
  if (report.counted === 0) return null;
  return quantileFrom(report.histogram, report.counted, q);
}

function quantileFrom(histogram: readonly number[], counted: number, q: number): number {
  const target = counted * Math.min(1, Math.max(0, q));
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    const inBucket = histogram[i]!;
    if (seen + inBucket >= target) {
      const within = inBucket === 0 ? 0 : (target - seen) / inBucket;
      return FLOOR + (i + within) * SPAN;
    }
    seen += inBucket;
  }
  return CEIL;
}

/**
 * The share of counted seasons at or below a rating, 0-1.
 *
 * The inverse of `quantile`, and the reason the chart can say "better than 94%
 * of your seasons" without touching the history: the bucket boundaries are
 * known, so the rating's position inside its own bucket is arithmetic.
 */
export function percentileOf(report: CareerReport, rating: number): number | null {
  if (report.counted === 0) return null;
  const bucket = bucketOf(rating);
  let below = 0;
  for (let i = 0; i < bucket; i++) below += report.histogram[i]!;
  const within = (rating - (FLOOR + bucket * SPAN)) / SPAN;
  const inBucket = report.histogram[bucket]! * Math.min(1, Math.max(0, within));
  return Math.min(1, (below + inBucket) / report.counted);
}

/**
 * The histogram as a running total, low to high.
 *
 * Twenty-five additions, so the cumulative view of the chart costs one array of
 * twenty-five numbers rather than a second look at anything.
 */
export function cumulative(histogram: readonly number[]): number[] {
  const out = new Array<number>(histogram.length);
  let seen = 0;
  for (let i = 0; i < histogram.length; i++) {
    seen += histogram[i]!;
    out[i] = seen;
  }
  return out;
}

/** Whole days since the epoch, in the device's own timezone. */
export function dayNumber(at: number): number {
  const d = new Date(at);
  return Math.floor(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000,
  );
}

/**
 * The current run and the longest one, from the set of days played.
 *
 * Sorting the days costs `O(d log d)` where `d` is days played, not seasons --
 * a player with five hundred seasons over a year has 365 of these at most, and
 * usually far fewer. Walking the set day-by-day instead would be `O(span)`,
 * which is worse the moment somebody comes back after a long absence.
 *
 * The current run counts today or yesterday as still alive: a streak the player
 * has not yet had a chance to break today is not broken.
 */
function walkStreaks(days: ReadonlySet<number>): { current: number; longest: number } {
  if (days.size === 0) return { current: 0, longest: 0 };

  const sorted = [...days].sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i]! === sorted[i - 1]! + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const today = dayNumber(Date.now());
  const last = sorted[sorted.length - 1]!;
  const current = last === today || last === today - 1 ? run : 0;

  return { current, longest };
}
