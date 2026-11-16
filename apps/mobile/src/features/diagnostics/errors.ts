/**
 * Turning an arbitrary thrown thing into a report that is safe to send.
 *
 * Pure: no React Native, no storage, no clock it does not take as an argument.
 * That is what lets `errors.test.ts` hold the two rules that matter here -- a
 * report never carries anything that identifies a player, and a loop can never
 * turn into a flood -- in a node test rather than in a hope.
 */

export type ErrorSource =
  /** An uncaught exception: `ErrorUtils` on native, `window.onerror` on the web. */
  | 'global'
  /** A promise nobody caught. */
  | 'unhandled_rejection'
  /** A render error caught by a route's ErrorBoundary. */
  | 'boundary'
  /** A JS fatal from the previous launch, persisted as it happened and sent on this one. */
  | 'previous_launch'
  /** Reported on purpose from code that caught it and carried on. */
  | 'caught';

export interface NormalisedError {
  readonly type: string;
  readonly message: string;
  /** The raw stack, scrubbed and capped. Empty when the engine gave none. */
  readonly stack: string;
}

export interface StackFrame {
  readonly function: string;
  readonly filename: string;
  readonly lineno?: number;
  readonly colno?: number;
}

const MAX_MESSAGE = 300;
const MAX_STACK = 4000;
const MAX_FRAMES = 30;

/**
 * Anything that could be about a person, taken out of free text.
 *
 * An error message is whatever the code that threw it chose to say, and some
 * of that code is a library. Supabase puts the request URL in a fetch error,
 * and a URL can carry a token; a validation error can quote the email it
 * rejected. None of it is needed to fix the bug, so it never leaves the device:
 * emails, JWT-shaped strings, long hex/base64 runs, UUIDs and query strings are
 * replaced before the text is stored, compared or sent. The long-run rule
 * leaves `/` and `-` out of its class and wants 48 characters on purpose: any
 * looser and every bundle path in a web stack (`/_expo/static/js/web/entry-<hash>.js`,
 * a 40-character hash) was "a token", which `errors.test.ts` caught.
 *
 * UUIDs go too, although an account id is not secret, because a message that
 * embeds one is a message that never deduplicates -- every player's copy of
 * the same bug would be its own issue.
 */
export function scrub(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b(?:phc|phx|sk|pk|sb)_[A-Za-z0-9_-]{8,}/g, '<key>')
    .replace(/\?[^\s'"()]*/g, '?<query>')
    .replace(/\b[A-Za-z0-9+_]{48,}={0,2}/g, '<token>');
}

const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Whatever was thrown -- an Error, a string, an object, `undefined` -- as one shape. */
export function normalise(thrown: unknown): NormalisedError {
  if (thrown instanceof Error || (thrown && typeof thrown === 'object' && 'message' in thrown)) {
    const e = thrown as { name?: unknown; message?: unknown; stack?: unknown };
    const type = typeof e.name === 'string' && e.name ? e.name : 'Error';
    const message = typeof e.message === 'string' ? e.message : String(e.message);
    const stack = typeof e.stack === 'string' ? e.stack : '';
    return {
      type: cap(type, 80),
      message: cap(scrub(message), MAX_MESSAGE),
      stack: cap(scrub(stack), MAX_STACK),
    };
  }
  let text: string;
  try {
    text = typeof thrown === 'string' ? thrown : JSON.stringify(thrown) ?? String(thrown);
  } catch {
    text = String(thrown);
  }
  // A rejection with a non-Error reason has no stack at all, and the type is
  // the honest part: "a string was thrown" is itself the bug.
  return { type: `Non-Error ${thrown === null ? 'null' : typeof thrown}`, message: cap(scrub(text), MAX_MESSAGE), stack: '' };
}

/**
 * The frames of a stack, in the order PostHog wants them: outermost first,
 * the frame that threw last.
 *
 * Two dialects. V8 (Chrome, and Hermes, which copies it) writes
 * `at fn (file:line:col)`; JavaScriptCore and Gecko write `fn@file:line:col`.
 * Anything else is dropped rather than guessed at -- a frame with the wrong
 * file name is worse than a missing one, because it is believed.
 */
export function parseStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    let m = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (m) {
      frames.push({ function: m[1] ?? '?', filename: m[2]!, lineno: Number(m[3]), colno: Number(m[4]) });
      continue;
    }
    m = /^(.*?)@(.+?):(\d+):(\d+)$/.exec(line);
    if (m) {
      frames.push({ function: m[1] || '?', filename: m[2]!, lineno: Number(m[3]), colno: Number(m[4]) });
    }
  }
  return frames.slice(0, MAX_FRAMES).reverse();
}

/**
 * What makes two reports "the same bug".
 *
 * The type, the source and the message with its numbers taken out -- so
 * "index 3 out of range" and "index 4 out of range" group, and two players'
 * copies of one crash are one issue. Deliberately not the stack: the web bundle
 * is minified and renamed on every deploy, so a fingerprint built from frames
 * would split every bug into one issue per release.
 */
export function fingerprint(error: NormalisedError, source: ErrorSource): string {
  const message = error.message.replace(/\d+(\.\d+)?/g, 'N').slice(0, 120);
  return `${source}:${error.type}:${message}`;
}

/**
 * Which reports may leave, so an error in a render loop or a `setInterval`
 * cannot spend the free tier in an afternoon.
 *
 * Per fingerprint, the 1st, 10th and 100th occurrence are sent and carry the
 * count -- a loop is visible as a loop without each turn of it being an event.
 * Across everything, at most `burst` reports per minute and `session` per
 * launch. A suppressed report is counted, and the count rides on the next one
 * that is allowed out, so silence is never mistaken for health.
 */
export class Limiter {
  private readonly seen = new Map<string, number>();
  private sent = 0;
  private window: number[] = [];
  private suppressed = 0;

  constructor(
    private readonly burst = 5,
    private readonly session = 25,
  ) {}

  /** Null means drop it. Otherwise: how many times this one has happened, and how many were held back. */
  admit(key: string, now: number): { occurrence: number; suppressed: number } | null {
    const occurrence = (this.seen.get(key) ?? 0) + 1;
    this.seen.set(key, occurrence);
    if (occurrence !== 1 && occurrence !== 10 && occurrence !== 100) {
      this.suppressed += 1;
      return null;
    }
    this.window = this.window.filter((t) => now - t < 60_000);
    if (this.window.length >= this.burst || this.sent >= this.session) {
      this.suppressed += 1;
      return null;
    }
    this.window.push(now);
    this.sent += 1;
    const held = this.suppressed;
    this.suppressed = 0;
    return { occurrence, suppressed: held };
  }
}
