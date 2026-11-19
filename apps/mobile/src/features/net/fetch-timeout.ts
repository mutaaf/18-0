/**
 * A fetch that gives up.
 *
 * Neither React Native's fetch nor the browser's has a timeout of its own, and
 * supabase-js adds none: a request sent into a captive portal, a dead hotel
 * Wi-Fi or a tunnel just sits there. Every board, the challenge list, the
 * account panel and the sign-in exchange waited on a promise that could stay
 * pending for minutes -- a spinner where invariant 3 asks for an honest "could
 * not reach the server". With this installed as the Supabase client's fetch,
 * a stalled request rejects like any other network failure, and every caller
 * already has a path for that.
 *
 * A caller's own signal still works: aborting it aborts the request, and the
 * timer is always cleared, so a long-lived app does not collect timers.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class RequestTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`The request took longer than ${Math.round(ms / 1000)}s and was abandoned.`);
    this.name = 'RequestTimeoutError';
  }
}

export function fetchWithTimeout(base: Fetch, ms: number = DEFAULT_REQUEST_TIMEOUT_MS): Fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const outer = init?.signal ?? null;
    let timedOut = false;
    // Linked by hand: `AbortSignal.any` is not in Hermes.
    const forward = () => controller.abort();
    if (outer) {
      if (outer.aborted) controller.abort();
      else outer.addEventListener('abort', forward);
    }
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ms);
    try {
      return await base(input, { ...init, signal: controller.signal });
    } catch (error) {
      // Said as what it was. An AbortError from a timeout reads as "the caller
      // cancelled", which is how one got logged as a deliberate navigation.
      if (timedOut) throw new RequestTimeoutError(ms);
      throw error;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', forward);
    }
  };
}
