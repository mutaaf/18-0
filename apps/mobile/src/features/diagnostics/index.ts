import { useEffect } from 'react';
import { useSegments } from 'expo-router';
import { setRoute } from './context';
import { installGlobalHandlers, noteRoute } from './global';
import { watchDowngrades } from './health';
import { useJankProbe } from './jank';
import { watchMemory } from './memory';
import { useScreenTiming } from './screen';
import { markInteractive } from './startup';
import { startWebVitals } from './vitals';

/**
 * Diagnostics: errors, crashes and the health of the key path.
 *
 * What is measured, where to look and what each alert means is in
 * docs/observability.md. The short version: everything is a `track()` event,
 * everything passes `diagnosticsAllowed()` (the `diagnostics` flag, and GPC/DNT
 * on the web), and nothing identifies a player.
 */

export { reportError, reportHealth } from './report';
export { noteServerCall } from './health';
export { diagnosticsAllowed } from './context';
export { noteTouch } from './jank';

/**
 * Installed at module scope by the root layout rather than in an effect, so an
 * error thrown while the first screen renders has a handler to land in.
 */
export function startDiagnostics(): void {
  installGlobalHandlers();
  watchDowngrades();
  watchMemory();
  startWebVitals();
}

/**
 * The root layout's half: which route is on screen, and the moment the app
 * became usable.
 *
 * The route is the segment *pattern* -- `card/[id]`, `(tabs)/leaderboard` --
 * because that is what a bug is filed against, and because a path would carry
 * the id of whatever card or challenge was open.
 *
 * Also the per-screen measurements, which hang off the same route:
 * `screen_ready` (screen.ts) and `ui_jank` (jank.ts). The probe's touches come
 * from `noteTouch` on the root view.
 */
export function useDiagnostics(ready: boolean): void {
  const segments = useSegments();
  const route = segments.join('/');
  useEffect(() => {
    setRoute(route);
    noteRoute(route || 'index');
  }, [route]);
  useEffect(() => {
    if (ready) markInteractive();
  }, [ready]);
  const pattern = route || 'index';
  useScreenTiming(pattern);
  useJankProbe(pattern);
}
