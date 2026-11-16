/**
 * The rules of the rating-feedback queue, without React Native or storage, so
 * they run under the node test environment. `rating-feedback.ts` is the store
 * and the network around them.
 */

export type RatingVerdict = 'too_low' | 'too_high';

export interface Pending {
  cardId: string;
  modelVersion: string;
  ratingShown: number;
  /** null is a withdrawal. */
  verdict: RatingVerdict | null;
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
