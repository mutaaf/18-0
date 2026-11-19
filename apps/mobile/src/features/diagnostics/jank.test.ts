import { describe, expect, it } from 'vitest';
import {
  MAX_JS_SAMPLES,
  addFrame,
  closeWindow,
  emptyFrames,
  emptyTally,
  jankPayload,
  noteJsLate,
} from './jank-math';

describe('ui_jank arithmetic', () => {
  it('counts hitches and stalls on the TV probe\'s thresholds', () => {
    const f = emptyFrames();
    for (const dt of [16, 17, 26, 33, 51, 120, 8]) addFrame(f, dt);
    expect(f).toEqual({ frames: 7, hitches: 4, stalls: 2, worst: 120 });
  });

  it('summarises a screen as flat numbers', () => {
    const t = emptyTally();
    t.touches = 3;
    const f = emptyFrames();
    for (let i = 0; i < 90; i++) addFrame(f, i === 10 ? 60 : 16.7);
    closeWindow(t, f);
    for (const ms of [2, 40, 5]) noteJsLate(t, ms);
    expect(jankPayload(t, 'play', 'route')).toEqual({
      route: 'play',
      why: 'route',
      touches: 3,
      navigations: 0,
      windows: 1,
      frames: 90,
      hitches: 1,
      stalls: 1,
      hitch_pct: 1.1,
      worst_frame_ms: 60,
      long_tasks: 0,
      js_median_ms: 5,
      js_worst_ms: 40,
    });
  });

  it('says nothing about a screen it never measured', () => {
    expect(jankPayload(emptyTally(), 'index', 'route')).toBeNull();
  });

  it('keeps a bounded number of JS samples', () => {
    const t = emptyTally();
    for (let i = 0; i < 500; i++) noteJsLate(t, i);
    expect(t.jsLate.length).toBe(MAX_JS_SAMPLES);
  });
});

/**
 * What the probe costs, measured rather than asserted. The bounds are loose
 * enough for a slow CI machine and tight enough that a probe which started
 * allocating per frame, or sorting per touch, would fail.
 */
describe('ui_jank overhead', () => {
  const time = (n: number, body: () => void) => {
    const start = performance.now();
    for (let i = 0; i < n; i++) body();
    return ((performance.now() - start) * 1e6) / n; // ns each
  };

  it('folds a frame in well under a microsecond', () => {
    const f = emptyFrames();
    time(100_000, () => addFrame(f, 16.7)); // warm
    const ns = time(1_000_000, () => addFrame(f, 16.7));
    console.info(`[ui_jank] addFrame: ${ns.toFixed(1)} ns per frame`);
    expect(ns).toBeLessThan(1000);
  });

  it('closes a window and builds a report in well under a millisecond', () => {
    const ns = time(10_000, () => {
      const t = emptyTally();
      const f = emptyFrames();
      for (let i = 0; i < 90; i++) addFrame(f, 16.7);
      closeWindow(t, f);
      for (let i = 0; i < 30; i++) noteJsLate(t, i % 7);
      jankPayload(t, 'play', 'route');
    });
    console.info(`[ui_jank] window + report: ${(ns / 1000).toFixed(1)} µs`);
    expect(ns).toBeLessThan(1_000_000);
  });
});
