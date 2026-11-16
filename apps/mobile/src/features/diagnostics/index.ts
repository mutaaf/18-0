import { useEffect } from 'react';
import { useSegments } from 'expo-router';
import { setRoute } from './context';
import { installGlobalHandlers, noteRoute } from './global';
import { watchDowngrades } from './health';
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

/**
 * Installed at module scope by the root layout rather than in an effect, so an
 * error thrown while the first screen renders has a handler to land in.
 */
export function startDiagnostics(): void {
  installGlobalHandlers();
  watchDowngrades();
  startWebVitals();
}

/**
 * The root layout's half: which route is on screen, and the moment the app
 * became usable.
 *
 * The route is the segment *pattern* -- `card/[id]`, `(tabs)/leaderboard` --
 * because that is what a bug is filed against, and because a path would carry
 * the id of whatever card or challenge was open.
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
}
