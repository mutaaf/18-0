import { describe, expect, it } from 'vitest';
import {
  DIVERGED_NOTE,
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_ATTEMPTS,
  afterAttempt,
  completionFailureNote,
  completionRetryable,
  enqueue,
  onSelectRefused,
  onSpinRefused,
  parseOutbox,
  prune,
} from './ranked-rules';

const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('a refused ranked move', () => {
  it('a spin refused because the sides disagree finishes offline instead of looping', () => {
    // The stuck case: the server holds an unpicked spin the device never got.
    expect(onSpinRefused('pick_first')).toBe('downgrade');
    expect(onSpinRefused('already_completed')).toBe('downgrade');
    expect(onSpinRefused('unknown_session')).toBe('downgrade');
  });

  it('a genuine "no" to a spin is said, and the season stays ranked', () => {
    expect(onSpinRefused('no_playable_spin')).toBe('notice');
    expect(onSpinRefused('assist_not_allowed_in_gameday')).toBe('notice');
    expect(onSpinRefused('rate_limited')).toBe('notice');
  });

  it('a pick refused on its merits is taken back; a disagreement keeps it and drops the ranking', () => {
    expect(onSelectRefused('card_not_eligible_for_spin')).toBe('rollback');
    expect(onSelectRefused('audit_unavailable')).toBe('rollback');
    expect(onSelectRefused('spin_already_used')).toBe('downgrade');
    expect(onSelectRefused('spin_first')).toBe('downgrade');
  });
});

describe('completing a ranked season', () => {
  it('retries what the network or a busy server lost, never a final refusal', () => {
    expect(completionRetryable({ ok: false, kind: 'offline' })).toBe(true);
    expect(completionRetryable({ ok: false, kind: 'refused', reason: 'save_failed' })).toBe(true);
    expect(completionRetryable({ ok: false, kind: 'refused', reason: 'internal' })).toBe(true);
    expect(completionRetryable({ ok: false, kind: 'refused', reason: 'incomplete_roster' })).toBe(false);
    expect(completionRetryable({ ok: false, kind: 'refused', reason: 'forbidden' })).toBe(false);
    expect(completionRetryable({ ok: true })).toBe(false);
  });

  it('tells the player the season is still going to the board when it is', () => {
    const queued = completionFailureNote(null);
    expect(queued).toMatch(/^Could not reach the server/);
    expect(queued).toMatch(/goes to the board/);
    expect(completionFailureNote({ kind: 'offline' })).toBe(queued);
    expect(completionFailureNote({ kind: 'refused', reason: 'rate_limited', message: 'x' })).toBe(queued);
    expect(completionFailureNote({ kind: 'refused', reason: 'forbidden', message: 'Not yours.' })).toBe('Not yours.');
  });

  it('has one sentence for a disagreement', () => {
    expect(DIVERGED_NOTE).toMatch(/server/);
  });
});

describe('the completion outbox', () => {
  it('holds one entry per session, newest key winning', () => {
    let q = enqueue([], SESSION, 'key-aaaaaaaa', 1);
    q = enqueue(q, SESSION, 'key-bbbbbbbb', 2);
    expect(q).toEqual([{ sessionId: SESSION, idempotencyKey: 'key-bbbbbbbb', queuedAt: 2, attempts: 0 }]);
  });

  it('settles on a score, drops a final refusal, keeps the rest one attempt older', () => {
    const q = enqueue(enqueue([], SESSION, 'key-aaaaaaaa', 1), OTHER, 'key-cccccccc', 1);
    expect(afterAttempt(q, SESSION, { ok: true })).toMatchObject({ result: 'scored', queue: [{ sessionId: OTHER }] });
    expect(afterAttempt(q, SESSION, { ok: false, kind: 'refused', reason: 'incomplete_roster' }).result).toBe('dropped');
    const kept = afterAttempt(q, SESSION, { ok: false, kind: 'offline' });
    expect(kept.result).toBe('kept');
    expect(kept.queue.find((p) => p.sessionId === SESSION)?.attempts).toBe(1);
    // An expired sign-in may be refreshed by next launch.
    expect(afterAttempt(q, SESSION, { ok: false, kind: 'refused', reason: 'unauthenticated' }).result).toBe('kept');
  });

  it('gives up on what is too old or tried too often', () => {
    const q = [
      { sessionId: SESSION, idempotencyKey: 'key-aaaaaaaa', queuedAt: 0, attempts: 0 },
      { sessionId: OTHER, idempotencyKey: 'key-cccccccc', queuedAt: OUTBOX_MAX_AGE_MS, attempts: OUTBOX_MAX_ATTEMPTS },
    ];
    expect(prune(q, OUTBOX_MAX_AGE_MS + 1)).toEqual([]);
    expect(prune(q, 10)).toHaveLength(1);
  });

  it('reads back only whole entries, and survives garbage', () => {
    expect(parseOutbox(null)).toEqual([]);
    expect(parseOutbox('{not json')).toEqual([]);
    expect(parseOutbox('{"a":1}')).toEqual([]);
    const good = { sessionId: SESSION, idempotencyKey: 'key-aaaaaaaa', queuedAt: 5, attempts: 1 };
    expect(parseOutbox(JSON.stringify([good, null, { sessionId: 'x' }, { ...good, sessionId: 'not-a-uuid' }]))).toEqual([good]);
  });
});
