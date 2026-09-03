import { Platform } from 'react-native';
import type { RosterSlot } from '@18-0/domain';
import { currentUser, ensureSession, isBackendConfigured, supabase } from '@/services/supabase';
import { uuid } from '@/features/uuid';
import type { GameMode } from '@/state/game';

/**
 * A game played against the server.
 *
 * The server issues the spins and scores the roster. That is not ceremony: a
 * client that could declare which franchise-era it was offered could declare
 * the seven holding the best cards in the dataset and earn a genuine
 * near-perfect score from a roster it was never dealt. So a ranked game asks,
 * and a casual game — which is the default, and needs no connection at all —
 * does the same work locally and never leaves the device.
 *
 * Every call here returns a plain result rather than throwing. Losing the
 * network in the middle of a game should cost the leaderboard, not the game.
 */

export type RankedFailure =
  | { kind: 'offline'; message: string }
  | { kind: 'refused'; reason: string; message: string };

export type RankedResult<T> = { ok: true; value: T } | ({ ok: false } & RankedFailure);

const offline = (message: string): RankedResult<never> => ({ ok: false, kind: 'offline', message });

/** Turns the server's error codes into something a player can act on. */
const REASONS: Record<string, string> = {
  rate_limited: 'Too many requests. Give it a moment.',
  pick_first: 'Take a player from the last spin first.',
  roster_complete: 'That roster is already full.',
  already_completed: 'That game is already finished.',
  spin_first: 'Spin before picking.',
  slot_filled: 'That slot is already filled.',
  duplicate_player: 'That player is already on your roster.',
  card_not_eligible_for_spin: 'That player was not part of this spin.',
  position_mismatch: 'That player cannot play there.',
  audit_unavailable: 'The server could not record that. Nothing was saved.',
  no_playable_spin: 'No franchise-era can fill an open slot.',
};

const refused = (reason: string): RankedResult<never> => ({
  ok: false,
  kind: 'refused',
  reason,
  message: REASONS[reason] ?? 'The server refused that.',
});

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<RankedResult<T>> {
  if (!supabase) return offline('Ranked play needs a connection.');
  try {
    const { data, error } = await supabase.functions.invoke(fn, {
      body,
      // The trail records which platform asked, so "only iOS is seeing this"
      // is answerable. Not identifying: three possible values, no device id.
      headers: { 'x-client': Platform.OS },
    });
    if (error) {
      // A refusal arrives as a non-2xx with a JSON body; anything else is the
      // network, and the two mean very different things to the player.
      const payload = await readError(error);
      return payload ? refused(payload) : offline('Could not reach the server.');
    }
    return { ok: true, value: data as T };
  } catch {
    return offline('Could not reach the server.');
  }
}

async function readError(error: unknown): Promise<string | null> {
  const response = (error as { context?: Response }).context;
  if (!response || typeof response.json !== 'function') return null;
  try {
    const body = await response.json();
    return typeof body?.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

/**
 * Opens a ranked session, signing in anonymously if this is the first one.
 *
 * The mode is declared here, before the first spin, and cannot be changed
 * afterwards: there is no update grant on game_sessions. Each mode ranks on
 * its own board, so a player cannot decide a run was GM Mode once they have
 * seen what it scored with the ratings on screen.
 */
export async function beginRanked(
  mode: GameMode,
  /**
   * The challenge this season answers, if it answers one. Declared at insert
   * time so the server can replay the creator's wheel from the first spin and
   * so the result attaches itself when it is scored -- neither of which can be
   * bolted on afterwards by a client that has already seen its score.
   */
  challengeId?: string,
): Promise<RankedResult<{ sessionId: string; idempotencyKey: string }>> {
  if (!isBackendConfigured || !supabase) return offline('Ranked play is not configured.');
  if (!(await ensureSession())) return offline('Could not start a session.');

  const me = await currentUser();
  if (!me) return offline('Could not start a session.');

  const idempotencyKey = uuid();
  const { data, error } = await supabase
    .from('game_sessions')
    .insert({
      user_id: me.id,
      status: 'in_progress',
      idempotency_key: idempotencyKey,
      mode,
      challenge_id: challengeId ?? null,
    })
    .select('id')
    .single();
  if (error || !data) {
    // The insert policy refuses a session pointed at a challenge that is
    // closed, expired, or your own, so this is the one place that failure can
    // surface and it deserves its own sentence.
    return offline(challengeId ? 'That challenge is no longer open.' : 'Could not open a ranked game.');
  }
  return { ok: true, value: { sessionId: data.id as string, idempotencyKey } };
}

export interface ServerSpin {
  readonly sequence: number;
  readonly franchiseId: string;
  readonly era: string;
  readonly assisted: boolean;
}

export async function rankedSpin(
  sessionId: string,
  assist: boolean,
): Promise<RankedResult<ServerSpin>> {
  const result = await invoke<{ spin: Omit<ServerSpin, 'assisted'>; assisted: boolean }>('spin', {
    gameSessionId: sessionId,
    assist,
  });
  if (!result.ok) return result;
  return { ok: true, value: { ...result.value.spin, assisted: result.value.assisted } };
}

export async function rankedSelect(
  sessionId: string,
  slot: RosterSlot,
  cardId: string,
): Promise<RankedResult<{ filled: number; complete: boolean }>> {
  return invoke('select', { gameSessionId: sessionId, slot, cardId });
}

export interface ServerScore {
  readonly finalRating: number;
  readonly record: { wins: number; losses: number };
  readonly endingKey: string;
  readonly tier: string;
  readonly assisted: boolean;
}

/**
 * Asks the server to score the roster it recorded.
 *
 * Deliberately sends no roster and no rating — there is nothing here for a
 * modified client to inflate. The answer is the one that reaches the board.
 */
export async function rankedComplete(
  sessionId: string,
  idempotencyKey: string,
): Promise<RankedResult<ServerScore>> {
  const result = await invoke<{ result: ServerScore }>('complete-game', {
    gameSessionId: sessionId,
    idempotencyKey,
  });
  if (!result.ok) return result;
  return { ok: true, value: result.value.result };
}
