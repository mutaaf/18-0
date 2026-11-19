import { useEffect, useRef } from 'react';
import { useNavigationContainerRef } from 'expo-router';
import { diagnosticsAllowed } from './context';
import { reportHealth } from './report';

/**
 * How long a screen takes to arrive: `screen_ready`, once per navigation.
 *
 * Two numbers, both from the moment the navigation was asked for:
 *
 * - `first_frame_ms` -- to the first frame drawn after the new screen
 *   committed. What the player sees as "it responded".
 * - `settled_ms` -- to the JS thread first going idle after that: the screen's
 *   effects, its data and anything it kicked off have run, and the next tap
 *   will be handled at once. What the player feels as "it's ready".
 *
 * The start is the navigation action, heard from the container
 * (`__unsafe_action__` is React Navigation's own hook for exactly this, and
 * fires before anything renders), so the render of the new screen is inside
 * the number. When no action was heard -- a deep link, a browser's back
 * button -- the start is the commit, and `basis` says so: the two are not
 * comparable, and a dashboard should filter on it.
 *
 * Cost: one `requestAnimationFrame` and one idle callback per navigation.
 * Nothing while a screen is simply on show. The first screen of a launch is
 * `app_started`'s, not this.
 */

/** An idle callback that never comes is a screen still busy; past this it is reported as it stands. */
const IDLE_TIMEOUT_MS = 3000;

type Idle = (callback: (deadline?: { didTimeout?: boolean }) => void, options?: { timeout: number }) => number;

function whenIdle(callback: (how: 'idle' | 'timeout' | 'timer') => void): void {
  const ric = (globalThis as { requestIdleCallback?: Idle }).requestIdleCallback;
  if (typeof ric === 'function') {
    ric((deadline) => callback(deadline?.didTimeout ? 'timeout' : 'idle'), { timeout: IDLE_TIMEOUT_MS });
    return;
  }
  // Safari before 18 has no idle callback. A 0 ms timer runs after the work
  // already queued, which is the same question asked less precisely.
  setTimeout(() => callback('timer'), 0);
}

const raf = (callback: () => void) =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 16);

export function useScreenTiming(route: string): void {
  const nav = useNavigationContainerRef();
  const actionAt = useRef<number | null>(null);
  const previous = useRef<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (!diagnosticsAllowed()) return;
    try {
      return nav.addListener('__unsafe_action__', () => {
        actionAt.current = performance.now();
      });
    } catch {
      return undefined;
    }
  }, [nav]);

  useEffect(() => {
    const from = previous.current;
    previous.current = route;
    // The first route of a launch is app_started's.
    if (from === null || from === route || !diagnosticsAllowed()) return;
    const committed = performance.now();
    // An action more than a few seconds old is not this navigation's.
    const heard = actionAt.current !== null && committed - actionAt.current < 5000 ? actionAt.current : null;
    actionAt.current = null;
    const start = heard ?? committed;
    const mine = ++generation.current;
    raf(() => {
      const painted = performance.now();
      whenIdle((how) => {
        // Navigated again before this one settled: its numbers would be the
        // next screen's.
        if (mine !== generation.current) return;
        const settled = performance.now();
        reportHealth('screen_ready', {
          route,
          from,
          basis: heard === null ? 'commit' : 'action',
          first_frame_ms: Math.round(painted - start),
          settled_ms: Math.round(settled - start),
          idle: how,
        });
      });
    });
  }, [route]);
}
