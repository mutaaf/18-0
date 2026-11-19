import { useEffect, useRef } from 'react';
import { AppState, useTVEventHandler } from 'react-native';
import { usePathname } from 'expo-router';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { buildId } from '@/features/diagnostics/context';
import { flag } from '@/features/flags';
import { track } from '@/features/telemetry';
import { isTV } from './platform';

/**
 * How smooth the app is on the Apple TVs it actually runs on.
 *
 * Every TV performance fix before this one was judged on the simulator, which
 * renders on a Mac's GPU, and each one shipped to a real Apple TV that still
 * stuttered (docs/apple-tv.md, "Real hardware"). Nobody working on this has a
 * TV wired to a profiler. So the app measures itself where it matters -- in
 * the two seconds after each press of the remote -- and reports one summary
 * per screen, which is what a regression or a fix is read from.
 *
 * - **UI thread:** a Reanimated frame callback, switched on only inside those
 *   windows, so an idle app pays nothing. A frame that took more than 25 ms
 *   (one and a half refreshes) is a hitch; more than 50 ms is a stall.
 * - **JS thread:** how late a 0 ms timer set at the press fires -- the queue
 *   of work the press caused in front of anything the next press needs.
 *
 * Sent as `tv_jank` when the screen changes, after twenty presses on one
 * screen, and when the app goes to the background. Counts and milliseconds
 * only; nothing about the player. Behind `tv_jank_probe` so a probe that
 * costs more than it tells can be switched off without a build.
 */

const WINDOW_MS = 2000;
const HITCH_MS = 25;
const STALL_MS = 50;
const PRESSES_PER_REPORT = 20;

type Tally = {
  presses: number;
  frames: number;
  hitches: number;
  stalls: number;
  worstFrame: number;
  jsLate: number[];
};

const empty = (): Tally => ({ presses: 0, frames: 0, hitches: 0, stalls: 0, worstFrame: 0, jsLate: [] });

/** The median and the worst of the JS delays, in whole milliseconds. */
function summarise(late: number[]): { js_median_ms: number; js_worst_ms: number } {
  if (late.length === 0) return { js_median_ms: 0, js_worst_ms: 0 };
  const sorted = [...late].sort((a, b) => a - b);
  return { js_median_ms: Math.round(sorted[Math.floor(sorted.length / 2)]!), js_worst_ms: Math.round(sorted[sorted.length - 1]!) };
}

export function useTVJankProbe(): void {
  const pathname = usePathname();
  const tally = useRef<Tally>(empty());
  const route = useRef(pathname);
  const closeAt = useRef(0);
  const closer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameTally = useSharedValue({ frames: 0, hitches: 0, stalls: 0, worst: 0 });

  const frame = useFrameCallback((info) => {
    'worklet';
    const dt = info.timeSincePreviousFrame;
    if (dt === null) return;
    // Read back on the JS thread at the end of the window; shared through the
    // callback's own closure would need a runOnJS per frame, which is the
    // kind of cost this is here to find.
    frameTally.value = {
      frames: frameTally.value.frames + 1,
      hitches: frameTally.value.hitches + (dt > HITCH_MS ? 1 : 0),
      stalls: frameTally.value.stalls + (dt > STALL_MS ? 1 : 0),
      worst: Math.max(frameTally.value.worst, dt),
    };
  }, false);

  const send = (why: string) => {
    const t = tally.current;
    if (t.presses === 0) return;
    track('tv_jank', {
      route: route.current,
      // Which build: the point is to compare one TestFlight build with the next.
      build: buildId(),
      why,
      presses: t.presses,
      frames: t.frames,
      hitches: t.hitches,
      stalls: t.stalls,
      hitch_pct: t.frames ? Math.round((t.hitches / t.frames) * 1000) / 10 : 0,
      worst_frame_ms: Math.round(t.worstFrame),
      ...summarise(t.jsLate),
    });
    tally.current = empty();
  };

  const closeWindow = () => {
    closer.current = null;
    frame.setActive(false);
    const f = frameTally.value;
    const t = tally.current;
    t.frames += f.frames;
    t.hitches += f.hitches;
    t.stalls += f.stalls;
    t.worstFrame = Math.max(t.worstFrame, f.worst);
    frameTally.value = { frames: 0, hitches: 0, stalls: 0, worst: 0 };
    if (t.presses >= PRESSES_PER_REPORT) send('presses');
  };

  useTVEvents((event) => {
    if (!on) return;
    // Presses only, once each: a press can arrive as a key-down and a key-up
    // (eventKeyAction 0 and 1), and focus, blur and pan events are not presses.
    if (!PRESSES.has(event.eventType) || (event as { eventKeyAction?: number }).eventKeyAction === 0) return;
    tally.current.presses += 1;
    const pressed = Date.now();
    setTimeout(() => tally.current.jsLate.push(Date.now() - pressed), 0);
    closeAt.current = pressed + WINDOW_MS;
    if (!closer.current) {
      frame.setActive(true);
      const wait = () => {
        const left = closeAt.current - Date.now();
        closer.current = left > 0 ? setTimeout(wait, left) : null;
        if (left <= 0) closeWindow();
      };
      closer.current = setTimeout(wait, WINDOW_MS);
    }
  });

  // A screen's report is sent when it is left, so every number is one screen's.
  useEffect(() => {
    if (route.current !== pathname) {
      if (closer.current) {
        clearTimeout(closer.current);
        closeWindow();
      }
      send('route');
      route.current = pathname;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') send('background');
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

const PRESSES = new Set(['up', 'down', 'left', 'right', 'select', 'longSelect', 'playPause', 'menu']);

// The web's React Native has no TV events; a TV is a TV for the life of the
// process, so which hook runs never changes between renders.
const useTVEvents: typeof useTVEventHandler = isTV ? useTVEventHandler : () => {};

/** Read once: a probe switched on mid-session would report half a window. */
const on = isTV && flag('tv_jank_probe');
