/**
 * The rules of the rating-feedback queue, without React Native or storage, so
 * they run under the node test environment. `rating-feedback.ts` is the store
 * and the network around them.
 */

/**
 * `fair` is a swipe right in Gut Check: the rating looks right. It is the
 * denominator every complaint was missing (migration 0028).
 */
export type RatingVerdict = 'too_low' | 'too_high' | 'fair';

/** Where the opinion was given: after a season, or in Gut Check. */
export type FeedbackSource = 'result' | 'swipe';

export interface Pending {
  cardId: string;
  modelVersion: string;
  ratingShown: number;
  /** null is a withdrawal. */
  verdict: RatingVerdict | null;
  /** Absent on anything queued before 0028, which was all from the result screen. */
  source?: FeedbackSource;
}

export interface Queue {
  verdicts: Record<string, RatingVerdict>;
  pending: Record<string, Pending>;
}

export const feedbackKey = (modelVersion: string, cardId: string) => `${modelVersion}:${cardId}`;

/** A tap: what the screen shows changes at once, and the change is queued. */
export function vote(state: Queue, entry: Pending): Queue {
  const key = feedbackKey(entry.modelVersion, entry.cardId);
  const verdicts = { ...state.verdicts };
  if (entry.verdict) verdicts[key] = entry.verdict;
  else delete verdicts[key];
  return { verdicts, pending: { ...state.pending, [key]: entry } };
}

/**
 * The server has `entry`. Clears it from the queue only if it is still what
 * the player wants: a second tap made while the first was in flight is newer
 * than what was sent, and must still go.
 */
export function delivered(state: Queue, key: string, entry: Pending): Queue {
  const now = state.pending[key];
  if (!now || now.verdict !== entry.verdict) return state;
  const pending = { ...state.pending };
  delete pending[key];
  return { verdicts: state.verdicts, pending };
}

const VERDICTS = new Set<string>(['too_low', 'too_high', 'fair']);

/**
 * The queue as storage returns it, keeping only whole entries.
 *
 * A malformed pending entry -- an older build's shape, a truncated write --
 * threw inside the flush on every launch (`entry.verdict` of null), and the
 * flush is fired and forgotten, so it surfaced as an unhandled rejection and
 * nothing behind it was ever sent.
 */
export function restoreQueue(raw: unknown): Queue {
  const out: Queue = { verdicts: {}, pending: {} };
  if (typeof raw !== 'object' || raw === null) return out;
  const { verdicts, pending } = raw as { verdicts?: unknown; pending?: unknown };
  if (typeof verdicts === 'object' && verdicts !== null) {
    for (const [key, verdict] of Object.entries(verdicts)) {
      if (typeof verdict === 'string' && VERDICTS.has(verdict)) out.verdicts[key] = verdict as RatingVerdict;
    }
  }
  if (typeof pending === 'object' && pending !== null) {
    for (const [key, p] of Object.entries(pending)) {
      if (typeof p !== 'object' || p === null) continue;
      const e = p as Record<string, unknown>;
      if (typeof e.cardId !== 'string' || typeof e.modelVersion !== 'string') continue;
      if (typeof e.ratingShown !== 'number' || !Number.isFinite(e.ratingShown)) continue;
      if (e.verdict !== null && !(typeof e.verdict === 'string' && VERDICTS.has(e.verdict))) continue;
      out.pending[key] = {
        cardId: e.cardId,
        modelVersion: e.modelVersion,
        ratingShown: e.ratingShown,
        verdict: e.verdict as RatingVerdict | null,
        ...(e.source === 'swipe' || e.source === 'result' ? { source: e.source } : {}),
      };
    }
  }
  return out;
}
