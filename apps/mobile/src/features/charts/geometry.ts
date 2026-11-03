/**
 * The arithmetic behind every chart, as paths.
 *
 * d3's scale, shape and array modules do the work -- the same code that draws
 * most of the charts on the web, and all of it pure: no DOM, no renderer, just
 * numbers in and SVG path strings out. That is why it is used here rather than
 * a React Native chart kit. The strings go straight into `react-native-svg`,
 * which renders identically on iOS, Android and the web, and the charts take
 * their colours from the theme tokens like everything else.
 *
 * Pure, so it is tested without rendering anything (`geometry.test.ts`).
 */
import { bin, max, mean } from 'd3-array';
import { scaleBand, scaleLinear } from 'd3-scale';
import { arc, area, curveMonotoneX, line, pie } from 'd3-shape';

export interface Box {
  readonly width: number;
  readonly height: number;
  /** Room left for labels: top, right, bottom, left. */
  readonly pad?: { top: number; right: number; bottom: number; left: number };
}

const PAD = { top: 10, right: 8, bottom: 18, left: 8 };

// ---------------------------------------------------------------------------
// Distribution: where a set of ratings falls, as a smooth ridge.
// ---------------------------------------------------------------------------

export interface Distribution {
  readonly area: string;
  readonly line: string;
  /** x of a rating, for markers. */
  readonly x: (rating: number) => number;
  readonly baseline: number;
  readonly domain: readonly [number, number];
  readonly ticks: readonly { value: number; x: number }[];
}

/**
 * A ridge rather than bars: the leaderboard is fifty seasons at most, and a
 * histogram of fifty is mostly empty columns and one tall one. Binned, then
 * drawn through the bin centres with a monotone curve -- which cannot
 * overshoot, so the ridge never dips below zero or invents a peak the data
 * does not have.
 */
export function distribution(ratings: readonly number[], box: Box, bins = 14): Distribution | null {
  if (ratings.length < 2) return null;
  const pad = box.pad ?? PAD;
  const lo = Math.floor(Math.min(...ratings) - 0.5);
  const hi = Math.ceil(Math.max(...ratings) + 0.5);
  const x = scaleLinear().domain([lo, hi]).range([pad.left, box.width - pad.right]);
  const groups = bin<number, number>().domain([lo, hi]).thresholds(x.ticks(bins))(ratings);
  const peak = max(groups, (g) => g.length) ?? 1;
  const y = scaleLinear().domain([0, peak]).range([box.height - pad.bottom, pad.top]);
  const points: [number, number][] = [
    [x(lo), y(0)],
    ...groups.map((g): [number, number] => [x(((g.x0 ?? lo) + (g.x1 ?? hi)) / 2), y(g.length)]),
    [x(hi), y(0)],
  ];
  const baseline = y(0);
  return {
    area: area<[number, number]>().x((p) => p[0]).y0(baseline).y1((p) => p[1]).curve(curveMonotoneX)(points) ?? '',
    line: line<[number, number]>().x((p) => p[0]).y((p) => p[1]).curve(curveMonotoneX)(points) ?? '',
    x: (rating) => x(Math.min(Math.max(rating, lo), hi)),
    baseline,
    domain: [lo, hi],
    ticks: x.ticks(5).map((value) => ({ value, x: x(value) })),
  };
}

// ---------------------------------------------------------------------------
// Trend: ratings in the order they were played, with a rolling average.
// ---------------------------------------------------------------------------

export interface Trend {
  readonly area: string;
  readonly line: string;
  readonly average: string;
  readonly best: { x: number; y: number; rating: number };
  readonly last: { x: number; y: number; rating: number };
  readonly gridlines: readonly { value: number; y: number }[];
}

/**
 * The rolling window is short on purpose. A long one smooths a run of good
 * seasons into a gentle slope, and the slope is the least interesting thing
 * about a run of good seasons.
 */
export function trend(ratings: readonly number[], box: Box, window = 5): Trend | null {
  if (ratings.length < 2) return null;
  const pad = box.pad ?? PAD;
  const lo = Math.floor(Math.min(...ratings) - 1);
  const hi = Math.ceil(Math.max(...ratings) + 1);
  const x = scaleLinear().domain([0, ratings.length - 1]).range([pad.left, box.width - pad.right]);
  const y = scaleLinear().domain([lo, hi]).range([box.height - pad.bottom, pad.top]).nice();
  const at = (r: number, i: number): [number, number] => [x(i), y(r)];
  const points = ratings.map(at);
  const rolling = ratings.map((_, i) => mean(ratings.slice(Math.max(0, i - window + 1), i + 1)) ?? 0).map(at);
  const bestIndex = ratings.reduce((b, r, i) => (r > ratings[b]! ? i : b), 0);
  const lastIndex = ratings.length - 1;
  const [y0] = y.range() as [number, number];
  return {
    area: area<[number, number]>().x((p) => p[0]).y0(y0).y1((p) => p[1]).curve(curveMonotoneX)(points) ?? '',
    line: line<[number, number]>().x((p) => p[0]).y((p) => p[1]).curve(curveMonotoneX)(points) ?? '',
    average: line<[number, number]>().x((p) => p[0]).y((p) => p[1]).curve(curveMonotoneX)(rolling) ?? '',
    best: { x: x(bestIndex), y: y(ratings[bestIndex]!), rating: ratings[bestIndex]! },
    last: { x: x(lastIndex), y: y(ratings[lastIndex]!), rating: ratings[lastIndex]! },
    gridlines: y.ticks(4).map((value) => ({ value, y: y(value) })),
  };
}

// ---------------------------------------------------------------------------
// Wins: every record from 0-17 to 17-0, one column each.
// ---------------------------------------------------------------------------

export interface Column {
  readonly wins: number;
  readonly count: number;
  readonly x: number;
  readonly width: number;
  readonly y: number;
  readonly height: number;
}

/** All eighteen records get a column, empty or not: the gap at 17 is the story. */
export function winColumns(wins: readonly number[], box: Box): Column[] {
  const pad = box.pad ?? PAD;
  const counts = Array.from({ length: 18 }, (_, w) => wins.filter((v) => v === w).length);
  const peak = Math.max(...counts, 1);
  const x = scaleBand<number>()
    .domain(counts.map((_, w) => w))
    .range([pad.left, box.width - pad.right])
    .paddingInner(0.22);
  const y = scaleLinear().domain([0, peak]).range([box.height - pad.bottom, pad.top]);
  return counts.map((count, w) => {
    // A column with seasons in it is never thinner than a hairline's worth
    // of height: one 16-1 among two hundred games is still worth seeing.
    const top = count > 0 ? Math.min(y(count), y(0) - 2) : y(0);
    return { wins: w, count, x: x(w) ?? 0, width: x.bandwidth(), y: top, height: y(0) - top };
  });
}

// ---------------------------------------------------------------------------
// Share: a ring of how seasons split across modes.
// ---------------------------------------------------------------------------

export interface Slice<K extends string> {
  readonly key: K;
  readonly count: number;
  readonly path: string;
  readonly share: number;
}

export function ring<K extends string>(
  parts: readonly { key: K; count: number }[],
  size: number,
  thickness = 12,
): Slice<K>[] {
  const total = parts.reduce((t, p) => t + p.count, 0);
  if (total === 0) return [];
  const outer = size / 2;
  const shape = arc<{ startAngle: number; endAngle: number }>()
    .innerRadius(outer - thickness)
    .outerRadius(outer)
    .cornerRadius(thickness / 2)
    .padAngle(parts.filter((p) => p.count > 0).length > 1 ? 0.04 : 0);
  return pie<{ key: K; count: number }>()
    .value((p) => p.count)
    .sort(null)(parts.filter((p) => p.count > 0))
    .map((slice) => ({
      key: slice.data.key,
      count: slice.data.count,
      path: shape(slice) ?? '',
      share: slice.data.count / total,
    }));
}
