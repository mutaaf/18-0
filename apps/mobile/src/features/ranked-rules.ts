/**
 * What a ranked refusal means, and the queue that keeps a finished season.
 *
 * Pure, so the rules can be asserted (`ranked-rules.test.ts`) without the
 * network or React Native -- `ranked.ts` and `ranked-outbox.ts` hold the I/O.
 */

/**
 * Refusals that mean this device and the server no longer agree about the
 * session -- not that the move was illegal. Retrying cannot fix any of them,
 * and leaving the season ranked would leave the player stuck: a `pick_first`
 * spin refusal used to be shown as a notice, and every later tap on Spin got
 * the same notice, forever, with no way out but abandoning seven picks.
 * The season finishes offline instead.
 */
const DIVERGED = new Set([
  'pick_first',
  'spin_first',
  'spin_already_used',
  'already_completed',
  'roster_complete',
  'unknown_session',
  'forbidden',
  'unauthenticated',
  'incomplete_roster',
  'spin_mismatch',
  'spin_reused',
  'duplicate_slot',
]);

/** What the player is told when one of those ends the ranking. */
export const DIVERGED_NOTE = 'This device and the server stopped agreeing about this season.';

export function hasDiverged(reason: string): boolean {
  return DIVERGED.has(reason);
}

/**
 * Refusals that say the server could not do it *right now*: nothing is wrong
 * with the request, and the same request later may well succeed.
 */
const TRANSIENT = new Set(['rate_limited', 'lookup_failed', 'save_failed', 'internal', 'audit_unavailable']);

export function isTransient(reason: string): boolean {
  return TRANSIENT.has(reason);
}

export type RefusalLike = { ok: true } | { ok: false; kind: 'offline' } | { ok: false; kind: 'refused'; reason: string };

/**
 * After a refused spin: carry on offline, or say why and let the player act.
 * A genuine "no" (no playable spin, a gameday rigged spin) is a notice; a
 * disagreement is a downgrade.
 */
export function onSpinRefused(reason: string): 'downgrade' | 'notice' {
  return hasDiverged(reason) ? 'downgrade' : 'notice';
}

/**
 * After a refused pick: take the pick back, or stop being ranked.
 *
 * Taken back when the server looked at *this pick* and said no -- the player
 * can choose again from the same spin, which the server still holds open.
 * A disagreement about the session keeps the pick and drops the ranking,
 * because the pick was legal and the session is what went wrong.
 */
export function onSelectRefused(reason: string): 'downgrade' | 'rollback' {
  return hasDiverged(reason) ? 'downgrade' : 'rollback';
}

/** Whether another attempt at `complete-game` could change the answer. */
export function completionRetryable(outcome: RefusalLike): boolean {
  if (outcome.ok) return false;
  if (outcome.kind === 'offline') return true;
  return isTransient(outcome.reason);
}

// --- the outbox --------------------------------------------------------------

/**
 * A ranked season whose completion has not been confirmed.
 *
 * The server already holds every spin and pick; all that is missing is the
 * "score it" call, which carries no roster and no rating. So sending it later
 * cannot be used to cheat -- the server scores its own rows -- and it is what
 * makes a dropped connection at the very last tap cost a few minutes rather
 * than the season. It also closes a door rather than opening one: before
 * this, going offline at the reveal was a way to keep a disappointing season
 * off the board, and now the season is sent anyway.
 */
export interface PendingCompletion {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly queuedAt: number;
  readonly attempts: number;
}

/** A week. Past that the session is treated as abandoned rather than pending. */
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Bounded, so a server that refuses forever cannot grow the queue forever. */
export const OUTBOX_MAX_ATTEMPTS = 20;
export const OUTBOX_MAX_ENTRIES = 20;

export function enqueue(queue: readonly PendingCompletion[], sessionId: string, idempotencyKey: string, now: number): PendingCompletion[] {
  const rest = queue.filter((p) => p.sessionId !== sessionId);
  return [...rest, { sessionId, idempotencyKey, queuedAt: now, attempts: 0 }].slice(-OUTBOX_MAX_ENTRIES);
}

export function settle(queue: readonly PendingCompletion[], sessionId: string): PendingCompletion[] {
  return queue.filter((p) => p.sessionId !== sessionId);
}

/**
 * Applies one flush attempt's outcome to its entry.
 *
 * Scored (or replayed): gone. Refused for good: gone, because it never will
 * be scored. Offline or a transient refusal: kept, one attempt older.
 */
export function afterAttempt(
  queue: readonly PendingCompletion[],
  sessionId: string,
  outcome: RefusalLike,
): { queue: PendingCompletion[]; result: 'scored' | 'dropped' | 'kept' } {
  if (outcome.ok) return { queue: settle(queue, sessionId), result: 'scored' };
  if (!completionRetryable(outcome) && !(outcome.kind === 'refused' && outcome.reason === 'unauthenticated')) {
    return { queue: settle(queue, sessionId), result: 'dropped' };
  }
  return {
    queue: queue.map((p) => (p.sessionId === sessionId ? { ...p, attempts: p.attempts + 1 } : p)),
    result: 'kept',
  };
}

/** Drops what is too old or has been tried too often to be worth another. */
export function prune(queue: readonly PendingCompletion[], now: number): PendingCompletion[] {
  return queue.filter((p) => now - p.queuedAt < OUTBOX_MAX_AGE_MS && p.attempts < OUTBOX_MAX_ATTEMPTS);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the queue back from storage, keeping only entries that are whole. */
export function parseOutbox(raw: string | null): PendingCompletion[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (p): p is PendingCompletion =>
      typeof p === 'object' &&
      p !== null &&
      typeof p.sessionId === 'string' &&
      UUID.test(p.sessionId) &&
      typeof p.idempotencyKey === 'string' &&
      p.idempotencyKey.length >= 8 &&
      typeof p.queuedAt === 'number' &&
      Number.isFinite(p.queuedAt) &&
      typeof p.attempts === 'number' &&
      Number.isFinite(p.attempts),
  );
}

/**
 * What to tell the player when the reveal could not get the server's score.
 *
 * `null` is play.tsx's own guard running out. In that case, and for anything
 * worth retrying, the season is in the outbox and will be scored -- so "this
 * season stayed on this device", which is what this used to say, stopped
 * being true. A refusal for good is said as the refusal.
 */
export function completionFailureNote(outcome: { kind: 'offline' } | { kind: 'refused'; reason: string; message: string } | null): string {
  if (outcome === null || outcome.kind === 'offline' || isTransient(outcome.reason)) {
    return 'Could not reach the server yet. The season is saved and goes to the board when the app next can.';
  }
  return outcome.message;
}
