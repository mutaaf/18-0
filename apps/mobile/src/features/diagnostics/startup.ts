import { Platform } from 'react-native';
import { reportHealth } from './report';

/**
 * Cold start to the first screen a player can use, once per launch.
 *
 * "Usable" is the root layout's fonts having loaded and the navigator having
 * rendered: before that the player is looking at the splash (native) or a
 * blank ground (web), and after it the home screen is on the glass.
 *
 * The clock it is measured from differs by platform and says so in `basis`,
 * because the three are not comparable and a dashboard that averaged them
 * would be describing nothing:
 *
 * - `navigation` on the web: `performance.now()` counts from the navigation
 *   that loaded the page, so this includes the network.
 * - `process` on native when React Native's startup timing is available (the
 *   new architecture): from the native process starting.
 * - `runtime` on native otherwise: from the JS runtime starting, which misses
 *   the native launch before it.
 */

let reported = false;

interface StartupTiming {
  startTime?: number | null;
  executeJavaScriptBundleEntryPointStart?: number | null;
}

export function markInteractive(): void {
  if (reported) return;
  reported = true;
  try {
    const now = performance.now();
    if (Platform.OS === 'web') {
      reportHealth('app_started', { ready_ms: Math.round(now), basis: 'navigation' });
      return;
    }
    const timing = (performance as unknown as { rnStartupTiming?: StartupTiming }).rnStartupTiming;
    const start = timing?.startTime;
    // Only trusted when it is plausibly on the same clock as `now`. A start
    // time from a different epoch would report a launch of fifty years.
    if (typeof start === 'number' && start > 0 && now - start >= 0 && now - start < 300_000) {
      const bundle = timing?.executeJavaScriptBundleEntryPointStart;
      reportHealth('app_started', {
        ready_ms: Math.round(now - start),
        basis: 'process',
        ...(typeof bundle === 'number' && bundle >= start ? { native_ms: Math.round(bundle - start) } : {}),
      });
      return;
    }
    reportHealth('app_started', { ready_ms: Math.round(now), basis: 'runtime' });
  } catch {
    // No performance clock at all: nothing to say, and nothing worth breaking.
  }
}
