import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { isBackendConfigured, saveRatingFeedback, withdrawRatingFeedback } from '@/services/supabase';
import { delivered, vote, type Pending, type Queue } from './rating-feedback-queue';
import { track } from './telemetry';

export { feedbackKey, type RatingVerdict } from './rating-feedback-queue';

/**
 * "Rate the ratings": a player's opinion that one of their seven is rated too
 * low or too high, kept here and sent to `rating_feedback` (migration 0025).
 *
 * Local first, because the game plays offline (invariant 3). The opinion is
 * the player's the moment they tap it and the screen shows it; the network is
 * only how it reaches us, so an opinion that cannot be sent waits in `pending`
 * and goes with the next flush. It never touches a score: a rating is
 * deterministic, and this is evidence for a person reading it at the next
 * refit (docs/scoring-model.md, "Player feedback").
 *
 * Keyed by model version as well as card, like the table: an opinion of a card
 * under 1.4.0 says nothing about the number a refit gives it.
 */

interface FeedbackState extends Queue {
  set: (entry: Pending) => void;
  sent: (key: string, entry: Pending) => void;
}

export const useRatingFeedback = create<FeedbackState>()(
  persist(
    (set) => ({
      verdicts: {},
      pending: {},
      set: (entry) => set((s) => vote(s, entry)),
      sent: (key, entry) => set((s) => delivered(s, key, entry)),
    }),
    { name: '18-0.rating-feedback', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

/** Records an opinion (or, with null, takes it back) and tries to send it. */
export function giveRatingFeedback(entry: Pending): void {
  useRatingFeedback.getState().set(entry);
  track('rating_feedback_given', {
    verdict: entry.verdict ?? 'withdrawn',
    model_version: entry.modelVersion,
  });
  void flushRatingFeedback();
}

let flushing: Promise<void> | null = null;

/** Sends whatever is waiting. Safe to call often; one flush runs at a time. */
export function flushRatingFeedback(): Promise<void> {
  if (!isBackendConfigured) return Promise.resolve();
  flushing ??= (async () => {
    try {
      const { pending, sent } = useRatingFeedback.getState();
      for (const [key, entry] of Object.entries(pending)) {
        const ok = entry.verdict
          ? await saveRatingFeedback({ ...entry, verdict: entry.verdict })
          : await withdrawRatingFeedback(entry.cardId, entry.modelVersion);
        if (!ok) break; // Offline or refused: the rest would fail the same way.
        sent(key, entry);
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}
