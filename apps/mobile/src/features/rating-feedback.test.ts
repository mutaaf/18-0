import { describe, expect, it } from 'vitest';
import { delivered, feedbackKey, vote, type Pending, type Queue } from './rating-feedback-queue';

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
