/**
 * The arithmetic of `ui_jank`, with no React Native in it, so `jank.test.ts`
 * can hold the numbers and time what the probe costs.
 *
 * The thresholds are `tv/jank.ts`'s, on purpose, so a hitch on a phone and a
 * hitch on a TV are the same thing on one dashboard: a frame over 25 ms is a
 * hitch (one and a half refreshes at 60 Hz -- and on a 120 Hz ProMotion screen,
 * three), over 50 ms a stall the player sees as a stop.
 */

export const WINDOW_MS = 1500;
export const HITCH_MS = 25;
export const STALL_MS = 50;
/** A screen people stay on (the play screen, a long leaderboard) still reports, every this many touches. */
export const TOUCHES_PER_REPORT = 30;
/** How many JS-delay samples one report keeps; past it, the oldest go. */
export const MAX_JS_SAMPLES = 64;

export interface FrameTally {
  frames: number;
  hitches: number;
  stalls: number;
  worst: number;
}

export interface Tally {
  touches: number;
  navigations: number;
  windows: number;
  frames: number;
  hitches: number;
  stalls: number;
  worstFrame: number;
  longTasks: number;
  jsLate: number[];
}

export const emptyFrames = (): FrameTally => ({ frames: 0, hitches: 0, stalls: 0, worst: 0 });

export const emptyTally = (): Tally => ({
  touches: 0,
  navigations: 0,
  windows: 0,
  frames: 0,
  hitches: 0,
  stalls: 0,
  worstFrame: 0,
  longTasks: 0,
  jsLate: [],
});

/**
 * One frame, folded in. Runs on the UI thread as a worklet in the probe, so it
 * allocates nothing and branches as little as it can.
 */
export function addFrame(f: FrameTally, dt: number): void {
  'worklet';
  f.frames += 1;
  if (dt > HITCH_MS) {
    f.hitches += 1;
    if (dt > STALL_MS) f.stalls += 1;
  }
  if (dt > f.worst) f.worst = dt;
}

/** A closed window's frames, into the screen's tally. */
export function closeWindow(t: Tally, f: FrameTally): void {
  t.windows += 1;
  t.frames += f.frames;
  t.hitches += f.hitches;
  t.stalls += f.stalls;
  t.worstFrame = Math.max(t.worstFrame, f.worst);
}

export function noteJsLate(t: Tally, ms: number): void {
  t.jsLate.push(ms);
  if (t.jsLate.length > MAX_JS_SAMPLES) t.jsLate.shift();
}

/** The flat properties of one `ui_jank` event, or null when there is nothing to say. */
export function jankPayload(t: Tally, route: string, why: string): Record<string, string | number> | null {
  if (t.windows === 0 || t.frames === 0) return null;
  const sorted = [...t.jsLate].sort((a, b) => a - b);
  return {
    route,
    why,
    touches: t.touches,
    navigations: t.navigations,
    windows: t.windows,
    frames: t.frames,
    hitches: t.hitches,
    stalls: t.stalls,
    hitch_pct: Math.round((t.hitches / t.frames) * 1000) / 10,
    worst_frame_ms: Math.round(t.worstFrame),
    long_tasks: t.longTasks,
    js_median_ms: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]!) : 0,
    js_worst_ms: sorted.length ? Math.round(sorted[sorted.length - 1]!) : 0,
  };
}
