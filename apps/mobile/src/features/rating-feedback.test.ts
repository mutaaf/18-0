import { describe, expect, it } from 'vitest';
import { delivered, feedbackKey, restoreQueue, sendOutcome, vote, type Pending, type Queue } from './rating-feedback-queue';

const empty: Queue = { verdicts: {}, pending: {} };
const card = (verdict: Pending['verdict'], cardId = 'payton-1985'): Pending => ({
  cardId,
  modelVersion: '1.4.0',
  ratingShown: 95.7,
  verdict,
});
const key = feedbackKey('1.4.0', 'payton-1985');

describe('rating feedback queue', () => {
  it('shows a vote at once and queues it', () => {
    const s = vote(empty, card('too_low'));
    expect(s.verdicts[key]).toBe('too_low');
    expect(s.pending[key]?.verdict).toBe('too_low');
  });

  it('a withdrawal clears what is shown and is itself queued', () => {
    const s = vote(vote(empty, card('too_low')), card(null));
    expect(s.verdicts[key]).toBeUndefined();
    expect(s.pending[key]?.verdict).toBeNull();
  });

  it('forgets a vote once the server has it', () => {
    const s = vote(empty, card('too_high'));
    expect(delivered(s, key, card('too_high')).pending).toEqual({});
  });

  it('keeps a newer vote made while an older one was in flight', () => {
    // Sent too_low; the player changed their mind before the answer came back.
    const s = vote(vote(empty, card('too_low')), card('too_high'));
    const after = delivered(s, key, card('too_low'));
    expect(after.pending[key]?.verdict).toBe('too_high');
    expect(after.verdicts[key]).toBe('too_high');
  });

  it('keys by model version, so a refit starts every card afresh', () => {
    expect(feedbackKey('1.4.0', 'x')).not.toBe(feedbackKey('1.5.0', 'x'));
  });
});

describe('the queue as storage returns it', () => {
  it('keeps whole entries and drops the rest, so the flush cannot throw on launch', () => {
    const good = { cardId: 'c1', modelVersion: '1.4.0', ratingShown: 88.1, verdict: 'too_low', source: 'swipe' };
    const out = restoreQueue({
      verdicts: { a: 'too_low', b: 'loved_it', c: null },
      pending: { a: good, b: null, c: { cardId: 'c2' }, d: { ...good, verdict: null }, e: { ...good, verdict: 'meh' } },
    });
    expect(out.verdicts).toEqual({ a: 'too_low' });
    expect(Object.keys(out.pending)).toEqual(['a', 'd']);
    expect(out.pending.d!.verdict).toBeNull();
  });

  it('anything else is an empty queue', () => {
    for (const raw of [undefined, null, 'x', 3, { verdicts: 'x', pending: 4 }]) {
      expect(restoreQueue(raw)).toEqual({ verdicts: {}, pending: {} });
    }
  });
});

describe('sorting a send failure', () => {
  it('a constraint or bad-value refusal is dropped, not retried forever', () => {
    expect(sendOutcome({ code: '23503' })).toBe('refused'); // unknown card
    expect(sendOutcome({ code: '22P02' })).toBe('refused');
    expect(sendOutcome({ status: 400 })).toBe('refused');
  });

  it('no error is ok; a network, auth or server failure stays queued', () => {
    expect(sendOutcome(null)).toBe('ok');
    expect(sendOutcome({ code: null, status: null })).toBe('offline');
    expect(sendOutcome({ code: 'PGRST301', status: 401 })).toBe('offline');
    expect(sendOutcome({ status: 503 })).toBe('offline');
  });
});
