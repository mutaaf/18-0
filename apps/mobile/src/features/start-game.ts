import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { beginRanked } from '@/features/ranked';
import { track } from '@/features/telemetry';
import { useGameStore, type GameMode } from '@/state/game';

/**
 * Starting a season, from wherever the player pressed.
 *
 * Extracted the moment there was a second place to press. The flow is short but
 * every line of it is a thing that went wrong once, so a Quick Play button that
 * reimplemented it would be a Quick Play button that reintroduced them:
 *
 *   - **The ranked session is opened before the first spin**, so a player finds
 *     out that ranked is unavailable now rather than seven picks from now.
 *   - **It is timed out and the navigation happens regardless.** This used to be
 *     a bare `await` before `router.push`, so anything that threw or hung left
 *     the Play button doing nothing at all -- which is exactly what happened on
 *     device, where `crypto.randomUUID` does not exist. Failing to open a ranked
 *     game must cost the leaderboard, never the game.
 *   - **A downgrade is recorded, not swallowed.** The play screen says plainly
 *     that the season will not reach the board, and the reason is in telemetry.
 */

/** Resolves to null rather than hanging, so a stalled request cannot trap a screen. */
export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface StartGame {
  /** True while a ranked session is being opened. */
  readonly opening: boolean;
  readonly start: (mode: GameMode, options?: { ranked?: boolean }) => Promise<void>;
}

export function useStartGame(): StartGame {
  const router = useRouter();
  const game = useGameStore();
  const [opening, setOpening] = useState(false);

  const start = useCallback(
    async (mode: GameMode, { ranked = true }: { ranked?: boolean } = {}) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      // Read from the store rather than taken as an argument: a caller that had
      // to know whether a game was already in progress would be a caller that
      // could be wrong about it.
      const replacing = useGameStore.getState().status !== 'idle';
      track('play_started', { mode, replacing, ranked });
      game.startGame(mode, { ranked });

      if (ranked) {
        setOpening(true);
        try {
          const opened = await withTimeout(beginRanked(mode), 8000);
          if (opened?.ok) {
            game.attachServerSession(opened.value.sessionId, opened.value.idempotencyKey);
            track('ranked_started', { mode });
          } else {
            const reason = opened?.message ?? 'The server did not answer in time.';
            game.downgrade(reason);
            track('ranked_downgraded', { reason });
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Ranked play could not start.';
          game.downgrade(reason);
          track('ranked_downgraded', { reason });
        } finally {
          setOpening(false);
        }
      }

      router.push('/play');
    },
    [game, router],
  );

  return { opening, start };
}
