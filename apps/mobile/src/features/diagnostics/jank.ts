import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { diagnosticsAllowed } from './context';
import {
  TOUCHES_PER_REPORT,
  WINDOW_MS,
  addFrame,
  closeWindow,
  emptyFrames,
  emptyTally,
  jankPayload,
  noteJsLate,
  type Tally,
} from './jank-math';
import { reportHealth } from './report';

/**
 * How smooth the app is on phones, tablets and the web: `ui_jank`.
 *
 * The sibling of `tv/jank.ts`, which measures the two seconds after each press
 * of the Apple TV remote. A phone has no remote, so a window opens on a touch
 * starting anywhere in the app, or on a navigation, and stays open while
 * touches keep arriving and for 1.5 s after the last. Outside a window nothing
 * runs at all -- the frame callback is switched off, and no timer is pending --
 * so an idle app, or a player reading a card, pays nothing.
 *
 * - **UI thread:** a Reanimated frame callback, folding each frame into four
 *   numbers in place (`addFrame`); read back once, when the window closes.
 * - **JS thread:** how late a 0 ms timer set at the touch fires.
 * - **Web:** also the browser's own long tasks (> 50 ms) inside a window,
 *   where the browser reports them (Chromium).
 *
 * One summary per screen, sent when it is left, every thirty touches on a
 * screen people stay on, and when the app goes to the background. The TV is
 * left to `tv_jank` -- a TV has no touches, and two probes there would be two
 * frame callbacks.
 *
 * Gated by `diagnostics` like every other diagnostic event, and read once: a
 * probe switched on mid-session would report half a window.
 */

interface Probe {
  open(kind: 'touch' | 'navigation'): void;
}

let probe: Probe | null = null;

/**
 * For the root view's `onTouchStart`. Touch events bubble, so one handler at
 * the root hears every touch that starts anywhere, before any responder
 * decides what it is. Native only; the web listens for `pointerdown` itself.
 */
export function noteTouch(): void {
  if (Platform.OS !== 'web') probe?.open('touch');
}

export function useJankProbe(route: string): void {
  const on = useRef<boolean | null>(null);
  on.current ??= Platform.isTV !== true && diagnosticsAllowed();

  const tally = useRef<Tally>(emptyTally());
  const reported = useRef(route);
  const closeAt = useRef(0);
  const closer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frames = useSharedValue(emptyFrames());

  const frame = useFrameCallback((info) => {
    'worklet';
    const dt = info.timeSincePreviousFrame;
    if (dt === null) return;
    // In place, without notifying anybody: a new object per frame, or a
    // runOnJS per frame, is the kind of cost this exists to find.
    frames.modify((f) => {
      'worklet';
      addFrame(f, dt);
      return f;
    }, false);
  }, false);

  const send = (why: string) => {
    const payload = jankPayload(tally.current, reported.current, why);
    tally.current = emptyTally();
    if (payload) reportHealth('ui_jank', payload);
  };

  const finish = () => {
    if (closer.current) clearTimeout(closer.current);
    closer.current = null;
    frame.setActive(false);
    // The one cross-thread read, once per window.
    closeWindow(tally.current, frames.value);
    frames.value = emptyFrames();
  };

  const self = useRef<Probe | null>(null);
  self.current ??= {
    open(kind) {
      const t = tally.current;
      const now = Date.now();
      if (kind === 'touch') {
        t.touches += 1;
        setTimeout(() => noteJsLate(tally.current, Date.now() - now), 0);
      } else {
        t.navigations += 1;
      }
      closeAt.current = now + WINDOW_MS;
      if (closer.current) return;
      frame.setActive(true);
      const wait = () => {
        const left = closeAt.current - Date.now();
        if (left > 0) {
          closer.current = setTimeout(wait, left);
          return;
        }
        finish();
        if (tally.current.touches >= TOUCHES_PER_REPORT) send('touches');
      };
      closer.current = setTimeout(wait, WINDOW_MS);
    },
  };

  useEffect(() => {
    if (!on.current) return;
    probe = self.current;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      if (closer.current) finish();
      send('background');
    });

    let stopWeb = () => {};
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const down = () => probe?.open('touch');
      window.addEventListener('pointerdown', down, { capture: true, passive: true });
      let observer: PerformanceObserver | null = null;
      try {
        observer = new PerformanceObserver((list) => {
          // Counted only inside a window, so the number means "after a touch".
          if (closer.current) tally.current.longTasks += list.getEntries().length;
        });
        observer.observe({ type: 'longtask' } as PerformanceObserverInit);
      } catch {
        // No Long Tasks API (Safari, Firefox): frames and JS delay still count.
      }
      stopWeb = () => {
        window.removeEventListener('pointerdown', down, { capture: true });
        observer?.disconnect();
      };
    }
    return () => {
      sub.remove();
      stopWeb();
      if (probe === self.current) probe = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A screen's report is sent when it is left, so every number is one
  // screen's. The window the navigation opens belongs to the new screen: its
  // mount is what the player is waiting through.
  useEffect(() => {
    if (!on.current || reported.current === route) return;
    if (closer.current) finish();
    send('route');
    reported.current = route;
    self.current?.open('navigation');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);
}
