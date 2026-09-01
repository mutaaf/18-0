import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The optional server.
 *
 * 18-0 is playable start to finish with no account and no connection — the
 * dataset is bundled and the scoring is local. Supabase exists only for the
 * things that genuinely need a server: cross-device history, leaderboards and
 * challenges. If it is not configured, every function here degrades to a
 * no-op and the game carries on.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isBackendConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isBackendConfigured
  ? createClient(url!, anonKey!, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export interface LeaderboardRow {
  readonly gameSessionId: string;
  readonly handle: string;
  readonly finalRating: number;
  readonly wins: number;
  readonly losses: number;
  readonly endingKey: string;
  readonly tier: string;
  readonly completedAt: string;
}

export type LeaderboardPeriod = 'all_time' | 'month' | 'week';

function since(period: LeaderboardPeriod): string | null {
  if (period === 'all_time') return null;
  const now = new Date();
  const days = period === 'week' ? 7 : 30;
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** Highest rating, best first. Ties break on the earlier completion (PRFAQ §22.7). */
export async function fetchLeaderboard(
  period: LeaderboardPeriod,
  limit = 50,
): Promise<LeaderboardRow[]> {
  if (!supabase) return [];
  let query = supabase
    .from('leaderboard_rating')
    .select('game_session_id, handle, final_rating, record_wins, record_losses, ending_key, tier, completed_at')
    .order('final_rating', { ascending: false })
    .order('completed_at', { ascending: true })
    .limit(limit);

  const from = since(period);
  if (from) query = query.gte('completed_at', from);

  // Throws rather than returning [] so the screen can distinguish "no rankings
  // yet" from "could not reach the server".
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data) return [];
  return data.map((r) => ({
    gameSessionId: r.game_session_id as string,
    handle: (r.handle as string) ?? 'player',
    finalRating: Number(r.final_rating),
    wins: r.record_wins as number,
    losses: r.record_losses as number,
    endingKey: r.ending_key as string,
    tier: r.tier as string,
    completedAt: r.completed_at as string,
  }));
}

export interface ChallengeRow {
  readonly id: string;
  readonly shareToken: string;
  readonly creatorHandle: string;
  readonly creatorRating: number | null;
  readonly creatorRecord: string | null;
  readonly status: string;
  readonly createdAt: string;
}

export async function fetchMyChallenges(): Promise<ChallengeRow[]> {
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];

  // `creator_user_id` references public.profiles, so the embed hint is the
  // profiles constraint — hinting the auth.users one resolves to nothing and
  // PostgREST fails with PGRST200.
  const { data, error } = await supabase
    .from('challenges')
    .select('id, share_token, status, created_at, creator_game_session_id, game_sessions!challenges_creator_game_session_id_fkey(final_rating, record_wins, record_losses), profiles!challenges_creator_user_id_fkey(handle)')
    .or(`creator_user_id.eq.${auth.user.id},opponent_user_id.eq.${auth.user.id}`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  if (!data) return [];
  return data.map((row) => {
    const session = (row as Record<string, unknown>).game_sessions as
      | { final_rating: number; record_wins: number; record_losses: number }
      | null;
    const profile = (row as Record<string, unknown>).profiles as { handle: string } | null;
    return {
      id: row.id as string,
      shareToken: row.share_token as string,
      creatorHandle: profile?.handle ?? 'player',
      creatorRating: session ? Number(session.final_rating) : null,
      creatorRecord: session ? `${session.record_wins}-${session.record_losses}` : null,
      status: row.status as string,
      createdAt: row.created_at as string,
    };
  });
}

export async function createChallenge(gameSessionId: string): Promise<ChallengeRow | null> {
  if (!supabase) return null;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from('challenges')
    .insert({ creator_user_id: auth.user.id, creator_game_session_id: gameSessionId })
    .select('id, share_token, status, created_at')
    .single();
  if (error || !data) return null;
  return {
    id: data.id as string,
    shareToken: data.share_token as string,
    creatorHandle: 'you',
    creatorRating: null,
    creatorRecord: null,
    status: data.status as string,
    createdAt: data.created_at as string,
  };
}

/**
 * Submits a completed roster for authoritative scoring. The client never sends
 * a rating — only which cards it picked and which spin allowed each one.
 */
export async function submitCompletion(input: {
  gameSessionId: string;
  idempotencyKey: string;
  assisted: boolean;
  selections: { slot: string; cardId: string; spinSequence: number }[];
  spins: { sequence: number; franchiseId: string; era: string }[];
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'backend_not_configured' };
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase.functions.invoke('complete-game', { body: input });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Anonymous sign-in, so a player can appear on a leaderboard without a form. */
export async function ensureSession(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  if (data.session) return true;
  const { error } = await supabase.auth.signInAnonymously();
  return !error;
}
