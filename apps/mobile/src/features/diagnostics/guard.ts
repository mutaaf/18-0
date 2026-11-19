/**
 * The shape every event's properties must have, enforced where they are made.
 *
 * Pure: no React Native, so `guard.test.ts` holds the rule in a node test.
 *
 * Two rules. **Flat primitives** -- a string, a finite number or a boolean --
 * because the local ring, the operator console and every PostHog breakdown
 * read a property as one value; an object arrives as `[object Object]` or as
 * JSON nobody can group on, and `NaN` arrives as `null` and silently drags a
 * percentile down. **No key that looks like it is about a person**, because a
 * property name is the one place a well-meant `email: user.email` would slip
 * past the scrubbing `errors.ts` does on free text. The PostHog `$exception`
 * fields are the exception, by name: their text is scrubbed before it gets
 * here.
 *
 * `track()` runs every event through `cleanProps`, so a property that breaks
 * either rule never leaves the call site -- dropped, not sent and regretted.
 * The TypeScript type already says primitives; this is for what a cast, an
 * `any` or a spread of somebody else's object gets past it.
 */

export type Primitive = string | number | boolean;

/**
 * Property names that would identify a player, or say where they are.
 *
 * Matched as a whole word between underscores (or a `$`, or the ends), so
 * `last_route` passes and `last_name` does not; `request_id` and `session_id`
 * pass because neither is a person -- one is the server's log line, the other
 * a random value that lives for one sitting.
 */
export const PII_KEY =
  /(^|[_$])(e_?mail|phone|tel|name|first_?name|last_?name|full_?name|surname|address|street|zip|postcode|ip|ip_?address|lat|lng|lon|latitude|longitude|geo|location|password|passwd|token|secret|jwt|ssn|dob|birth(day|date)?|user_?id|uid|distinct_?id|device_?id|idfa|idfv|gaid|advertising_?id|handle|username|url|href|query)($|_)/i;

/** PostHog's error-tracking fields: named its way, scrubbed by `errors.ts` before they get here. */
const ALLOWED = /^\$exception_/;

/** Long enough for a scrubbed error message; short enough that a property is never a payload. */
export const MAX_STRING = 300;

export function isPiiKey(key: string): boolean {
  return !ALLOWED.test(key) && PII_KEY.test(key);
}

export function isFlatPrimitive(value: unknown): value is Primitive {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * The properties that pass both rules, with strings capped. Never throws.
 * `dropped` is the keys that did not, for a development warning.
 */
export function cleanProps(props: Readonly<Record<string, unknown>>): {
  props: Record<string, Primitive>;
  dropped: string[];
} {
  const out: Record<string, Primitive> = {};
  const dropped: string[] = [];
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (!isFlatPrimitive(value) || isPiiKey(key)) {
      dropped.push(key);
      continue;
    }
    // The stack is the one long field, and `errors.ts` caps it itself.
    out[key] =
      typeof value === 'string' && value.length > MAX_STRING && key !== '$exception_stack_trace_raw'
        ? value.slice(0, MAX_STRING)
        : value;
  }
  return { props: out, dropped };
}
