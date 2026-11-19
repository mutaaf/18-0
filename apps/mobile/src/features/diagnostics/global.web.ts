import { reportError } from './report';

/**
 * Uncaught errors in the browser.
 *
 * A browser does not die on an uncaught error, so there is nothing to persist
 * and nothing to look back at: the report goes out with the next analytics
 * flush, and a render error is caught by a route's ErrorBoundary before it
 * gets here.
 *
 * Two kinds of error are dropped on purpose, because they are somebody else's:
 *
 * - `Script error.` with no error object is a cross-origin script failing --
 *   the ad loader, Box Office -- and the browser hides everything about it.
 * - An error whose file is on another origin is the same thing with its file
 *   name showing. Reporting either would put the ad server's bugs in this
 *   game's error rate, which nobody here can fix.
 */

let installed = false;

function foreign(filename: string | undefined): boolean {
  if (!filename || typeof location === 'undefined') return false;
  try {
    return new URL(filename, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}

export function installGlobalHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    if (!event.error && /^Script error\.?$/.test(event.message ?? '')) return;
    if (foreign(event.filename)) return;
    reportError(event.error ?? event.message, { source: 'global' });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportError(event.reason, { source: 'unhandled_rejection' });
  });
}

/** The browser has no session mark to keep; see `global.ts`. */
export function noteRoute(_route: string): void {}

/** No session mark on the web, and no memory warnings to keep; see `global.ts`. */
export function noteMemoryWarning(): void {}
