import { track, type EventName } from '@/features/telemetry';
import { context, diagnosticsAllowed } from './context';
import { Limiter, fingerprint, normalise, type ErrorSource } from './errors';

/**
 * Reporting an error, and the other diagnostic events, through the one pipe.
 *
 * Everything goes through `track()`, so a report lands in the local ring the
 * operator console reads and, when PostHog is configured, in PostHog as
 * `$exception` -- where error tracking groups it into an issue. Nothing here
 * talks to the network itself; `analytics.ts` owns the wire.
 */

const limiter = new Limiter();

export interface ReportOptions {
  readonly source: ErrorSource;
  /** True when the app could not carry on: a JS fatal, or a route that could only offer recovery. */
  readonly fatal?: boolean;
  /** Overrides the route the error is filed under, for a report sent a launch after it happened. */
  readonly route?: string;
  /** When it happened, if not now. */
  readonly at?: number;
  readonly extra?: Record<string, string | number | boolean>;
}

/**
 * Report one error. Returns whether it was sent, so a recovery screen can say
 * truthfully whether anybody was told.
 *
 * Never throws: an error reporter that can throw is an error reporter that can
 * turn one bug into a loop of them.
 */
export function reportError(thrown: unknown, options: ReportOptions): boolean {
  try {
    if (!diagnosticsAllowed()) return false;
    const error = normalise(thrown);
    const key = fingerprint(error, options.source);
    const admitted = limiter.admit(key, Date.now());
    if (!admitted) return false;
    track(
      '$exception',
      {
        ...context(),
        ...(options.route ? { route: options.route } : {}),
        ...(options.extra ?? {}),
        $exception_type: error.type,
        $exception_message: error.message,
        $exception_stack_trace_raw: error.stack,
        $exception_source: options.source,
        $exception_level: options.fatal ? 'fatal' : 'error',
        $exception_handled: options.source === 'caught' || options.source === 'boundary',
        $exception_fingerprint: key,
        occurrence: admitted.occurrence,
        suppressed: admitted.suppressed,
      },
      options.at,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * A diagnostic event that is not an error: start-up time, web vitals, a slow
 * server call. Same gate, same context, no rate limiter -- each of these fires
 * a bounded number of times by construction (once per launch, once per page,
 * once per request the player made).
 */
export function reportHealth(name: EventName, props: Record<string, string | number | boolean>): void {
  try {
    if (!diagnosticsAllowed()) return;
    track(name, { ...context(), ...props });
  } catch {
    // Measuring the game must never be able to break it.
  }
}
