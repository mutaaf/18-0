/**
 * The arithmetic of Core Web Vitals, without a browser.
 *
 * Written out rather than taken from Google's `web-vitals` package: the three
 * definitions are a page of code, a dependency is a thing to audit and update,
 * and keeping them here lets `vitals-math.test.ts` check the parts that are easy
 * to get subtly wrong -- CLS's session windows and INP's percentile -- in node.
 * The thresholds are web.dev's published ones.
 */

export type Rating = 'good' | 'needs-improvement' | 'poor';

const THRESHOLDS = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  inp: [200, 500],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
} as const;

export function rate(metric: keyof typeof THRESHOLDS, value: number): Rating {
  const [good, poor] = THRESHOLDS[metric];
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
}

/**
 * Cumulative Layout Shift: the worst *session window*, not the sum of every
 * shift on the page. A window is shifts less than a second apart, at most five
 * seconds long. Summing everything punishes a page for being kept open, which
 * is the opposite of what the metric is for and how CLS was first defined
 * before Google changed it.
 */
export function clsFromShifts(shifts: readonly { value: number; startTime: number; hadRecentInput: boolean }[]): number {
  let worst = 0;
  let current = 0;
  let first = 0;
  let last = 0;
  for (const shift of shifts) {
    // A shift within half a second of a tap is the page answering the tap.
    if (shift.hadRecentInput) continue;
    if (current > 0 && shift.startTime - last < 1000 && shift.startTime - first < 5000) {
      current += shift.value;
    } else {
      current = shift.value;
      first = shift.startTime;
    }
    last = shift.startTime;
    worst = Math.max(worst, current);
  }
  return worst;
}

/**
 * Interaction to Next Paint: the slowest interaction, ignoring one in fifty.
 *
 * An interaction is every event entry sharing an `interactionId` (a tap is a
 * pointerdown, a pointerup and a click), and its latency is the longest of
 * them. With fewer than fifty interactions INP is simply the worst one; past
 * that, the worst is discarded once per fifty so a single hiccup on a long
 * session does not define it.
 */
export function inpFromEvents(entries: readonly { interactionId: number; duration: number }[]): number | null {
  const byInteraction = new Map<number, number>();
  for (const e of entries) {
    if (!e.interactionId) continue;
    byInteraction.set(e.interactionId, Math.max(byInteraction.get(e.interactionId) ?? 0, e.duration));
  }
  if (byInteraction.size === 0) return null;
  const sorted = [...byInteraction.values()].sort((a, b) => b - a);
  const skip = Math.min(sorted.length - 1, Math.floor(sorted.length / 50));
  return sorted[skip]!;
}
