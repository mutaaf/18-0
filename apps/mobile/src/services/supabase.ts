import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cached, invalidateIdentity } from '@/features/cache';

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

/**
 * The signed-in user, from the session already in memory.
 *
 * `auth.getUser()` asks the server who you are on every call, which is a
 * network round trip to learn something the session token already says. The
 * only thing that buys is revocation checking, and nothing here is a security
 * decision — the server re-derives the caller from the token on every request
 * that matters, and RLS does not trust this value at all.
 */
export async function currentUser(): Promise<{ id: string; anonymous: boolean } | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  return user ? { id: user.id, anonymous: user.is_anonymous === true } : null;
}

export interface LeaderboardRow {
  readonly gameSessionId: string;
  /** Needed to report the handle; never shown. */
  readonly userId: string;
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
  onFresh?: (rows: LeaderboardRow[]) => void,
): Promise<LeaderboardRow[]> {
  if (!supabase) return [];
  // A board that is thirty seconds out of date is a board. An empty panel
  // while the network answers is not, and that is what every tab switch used
  // to show.
  const read = await cached<LeaderboardRow[]>(
    `leaderboard:${period}:${limit}`,
    () => loadLeaderboard(period, limit),
    { ttl: 30_000, ...(onFresh ? { onFresh } : {}) },
  );
  return read.value ?? [];
}

async function loadLeaderboard(
  period: LeaderboardPeriod,
  limit: number,
): Promise<LeaderboardRow[]> {
  if (!supabase) return [];
  let query = supabase
    .from('leaderboard_rating')
    .select('game_session_id, user_id, handle, final_rating, record_wins, record_losses, ending_key, tier, completed_at')
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
    userId: r.user_id as string,
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
  const me = await currentUser();
  if (!me) return [];

  // `creator_user_id` references public.profiles, so the embed hint is the
  // profiles constraint — hinting the auth.users one resolves to nothing and
  // PostgREST fails with PGRST200.
  const { data, error } = await supabase
    .from('challenges')
    .select('id, share_token, status, created_at, creator_game_session_id, game_sessions!challenges_creator_game_session_id_fkey(final_rating, record_wins, record_losses), profiles!challenges_creator_user_id_fkey(handle)')
    .or(`creator_user_id.eq.${me.id},opponent_user_id.eq.${me.id}`)
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
  const me = await currentUser();
  if (!me) return null;
  const { data, error } = await supabase
    .from('challenges')
    .insert({ creator_user_id: me.id, creator_game_session_id: gameSessionId })
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

/**
 * Who the server thinks you are.
 *
 * `anonymous` is the normal state: playing never asks for an account, so most
 * players have an identity they never chose and never see. A handle is what
 * turns that into a name on a public board, and nothing appears there until
 * one is claimed.
 */
export interface Identity {
  readonly userId: string;
  readonly anonymous: boolean;
  readonly handle: string | null;
  readonly handleStatus: 'ok' | 'flagged' | 'hidden' | null;
}

export async function identity(onFresh?: (value: Identity | null) => void): Promise<Identity | null> {
  if (!supabase) return null;
  const me = await currentUser();
  if (!me) return null;

  const read = await cached<Identity | null>(
    `identity:${me.id}`,
    async () => {
      const { data: profile } = await supabase!
        .from('profiles')
        .select('handle, handle_status')
        .eq('id', me.id)
        .maybeSingle();
      return {
        userId: me.id,
        anonymous: me.anonymous,
        handle: (profile?.handle as string | null) ?? null,
        handleStatus: (profile?.handle_status as Identity['handleStatus']) ?? null,
      };
    },
    { ttl: 5 * 60_000, ...(onFresh ? { onFresh } : {}) },
  );
  return read.value;
}

/** What the database will accept, checked here so the error is a sentence. */
export const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,30}[A-Za-z0-9]$/;

export function handleProblem(handle: string): string | null {
  const trimmed = handle.trim();
  if (trimmed.length < 2) return 'A name needs at least two characters.';
  if (trimmed.length > 32) return 'A name can be at most 32 characters.';
  if (!HANDLE_PATTERN.test(trimmed)) {
    return 'Letters, numbers, spaces, and . _ - only, starting and ending with a letter or number.';
  }
  return null;
}

/**
 * Claim a display name, creating the profile if this is the first time.
 *
 * Signs in anonymously first if needed — claiming a name is the moment a player
 * asks to be visible, and it is the first moment an account is actually
 * required for anything.
 */
export async function claimHandle(handle: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'backend_not_configured' };
  const problem = handleProblem(handle);
  if (problem) return { ok: false, error: problem };
  if (!(await ensureSession())) return { ok: false, error: 'could not start a session' };

  const me = await currentUser();
  if (!me) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase
    .from('profiles')
    .upsert(
      { id: me.id, handle: handle.trim(), handle_set_at: new Date().toISOString() },
      { onConflict: 'id' },
    );
  if (error) {
    // 23505 is the unique violation on `handle`.
    if (error.code === '23505') return { ok: false, error: 'That name is taken.' };
    const policy = explainHandleRejection(error.message);
    return { ok: false, error: policy ?? error.message };
  }
  invalidateIdentity();
  return { ok: true };
}

/**
 * Delete the account and everything attached to it.
 *
 * Required to exist in-app by App Store Review Guideline 5.1.1(v). The server
 * does the work; this only asks and then clears the local session so the app
 * does not keep using a token for a user that no longer exists.
 */
export async function deleteAccount(): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'backend_not_configured' };
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return { ok: false, error: 'unauthenticated' };

  const { error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) return { ok: false, error: error.message };
  await supabase.auth.signOut().catch(() => {});
  invalidateIdentity();
  return { ok: true };
}

/**
 * Reporting a handle.
 *
 * The one piece of user-generated content in the game is a display name, and
 * App Store Review Guideline 1.2 asks that people be able to report it. Enough
 * distinct reports take a name off the board automatically — see the trigger in
 * migration 0003 — because a queue that only moves when somebody reads it is
 * not a timely response at three in the morning.
 */
export type ReportReason = 'impersonation' | 'offensive' | 'spam' | 'other';

export const REPORT_REASONS: readonly { value: ReportReason; label: string }[] = [
  { value: 'impersonation', label: 'Pretending to be someone' },
  { value: 'offensive', label: 'Offensive or abusive' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'other', label: 'Something else' },
];

export async function reportHandle(
  reportedUserId: string,
  reportedHandle: string,
  reason: ReportReason,
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'backend_not_configured' };
  if (!(await ensureSession())) return { ok: false, error: 'Could not start a session.' };

  const me = await currentUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (me.id === reportedUserId) return { ok: false, error: 'That is you.' };

  const { error } = await supabase.from('handle_reports').insert({
    reported_user_id: reportedUserId,
    reporter_user_id: me.id,
    reported_handle: reportedHandle,
    reason,
  });
  if (error) {
    // 23505 is the one-open-report-per-reporter index doing its job.
    if (error.code === '23505') return { ok: true };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Turns the handle-policy trigger's error into something a person can act on. */
export function explainHandleRejection(message: string): string | null {
  const match = /handle_not_allowed:(\w+)/.exec(message);
  if (!match) return null;
  return match[1] === 'impersonation'
    ? 'That name could be mistaken for the game or its staff.'
    : 'That name is not allowed.';
}
