import { AppState, Platform } from 'react-native';
import { noteMemoryWarning } from './global';
import { reportHealth } from './report';

/**
 * Memory warnings: `memory_warning`, and the hint they leave for the next
 * launch.
 *
 * iOS warns an app before it kills it for memory, and React Native passes the
 * warning on as AppState's `memoryWarning` (iOS only; Android and the web have
 * no equivalent event). The warning itself is reported -- rate-limited, since
 * iOS can send a burst -- and counted on the session mark (`global.ts`), so a
 * launch that dies afterwards is reported as `app_unclean_exit` with
 * `likely_oom`, or `app_background_exit` with `memory_warnings`, instead of as
 * a mystery.
 *
 * Nothing runs until a warning arrives.
 */

/** At most one report a minute; the warnings in between ride on it as `count`. */
const MIN_GAP_MS = 60_000;

let started = false;
let total = 0;
let unsent = 0;
let lastSent = 0;
const bootAt = Date.now();

interface HermesStats {
  js_heapSize?: number;
  js_allocatedBytes?: number;
}

/** Hermes' heap, when it will say: one call, made only on a warning. */
function heapMb(): number | null {
  try {
    const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => HermesStats } }).HermesInternal;
    const bytes = hermes?.getInstrumentedStats?.().js_heapSize;
    return typeof bytes === 'number' && bytes > 0 ? Math.round(bytes / (1024 * 1024)) : null;
  } catch {
    return null;
  }
}

export function watchMemory(): void {
  if (started || Platform.OS === 'web') return;
  started = true;
  try {
    AppState.addEventListener('memoryWarning', () => {
      total += 1;
      unsent += 1;
      noteMemoryWarning();
      const now = Date.now();
      if (now - lastSent < MIN_GAP_MS) return;
      lastSent = now;
      const heap = heapMb();
      reportHealth('memory_warning', {
        count: unsent,
        launch_warnings: total,
        uptime_s: Math.round((now - bootAt) / 1000),
        foreground: AppState.currentState === 'active',
        ...(heap !== null ? { js_heap_mb: heap } : {}),
      });
      unsent = 0;
    });
  } catch {
    // A platform without the event: nothing to watch.
  }
}
