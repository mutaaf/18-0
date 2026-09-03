import { supabase, isBackendConfigured } from './supabase';

/**
 * The operator console's server side.
 *
 * Every call here lands on a definer-rights function that checks `admins`
 * before it does anything, so this module carries no authority of its own:
 * shipping it in the bundle tells a reader what the console can do and gets
 * them exactly nothing, because the gate is on the other end.
 *
 * There is deliberately no client-side "am I allowed" flag driving any of it.
 * `amOperator()` exists to decide what to render, not what to permit -- a
 * client that lied to itself about the answer would still be refused by every
 * function it then called.
 */

export interface Overview {
  players: number;
  namedPlayers: number;
  hiddenHandles: number;
  sessionsTotal: number;
  sessionsToday: number;
  completionsTotal: number;
  completionsToday: number;
  inProgress: number;
  challengesOpen: number;
  challengesSettled: number;
  voided: number;
  eventsHour: number;
  refusalsHour: number;
  p95LatencyMs: number | null;
  lastEventAt: string | null;
}

export interface OperatorPlayer {
  userId: string;
  handle: string | null;
  handleStatus: string;
  isPermanent: boolean;
  createdAt: string;
  sessions: number;
  completions: number;
  assisted: number;
  voided: number;
  bestRating: number | null;
  lastSeen: string | null;
}

export interface OperatorEvent {
  occurredAt: string;
  event: string;
  outcome: string;
  actorId: string | null;
  actorHandle: string | null;
  subjectType: string | null;
  subjectId: string | null;
  detail: Record<string, unknown>;
  latencyMs: number | null;
  requestId: string;
}

export interface OperatorSeason {
  id: string;
  finalRating: number | null;
  record: string;
  mode: string | null;
  endingKey: string | null;
  assisted: boolean;
  voidedAt: string | null;
  completedAt: string | null;
}

const one = <T>(data: unknown): T | null =>
  (Array.isArray(data) ? (data[0] as T) : (data as T)) ?? null;

const num = (v: unknown): number => Number(v ?? 0);

/** Whether this account is an operator, according to the server. */
export async function amOperator(): Promise<boolean> {
  if (!isBackendConfigured || !supabase) return false;
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;
  return data === true;
}

export async function fetchOverview(): Promise<Overview | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('admin_overview');
  if (error) throw new Error(error.message);
  const row = one<Record<string, unknown>>(data);
  if (!row) return null;
  return {
    players: num(row.players),
    namedPlayers: num(row.named_players),
    hiddenHandles: num(row.hidden_handles),
    sessionsTotal: num(row.sessions_total),
    sessionsToday: num(row.sessions_today),
    completionsTotal: num(row.completions_total),
    completionsToday: num(row.completions_today),
    inProgress: num(row.in_progress),
    challengesOpen: num(row.challenges_open),
    challengesSettled: num(row.challenges_settled),
    voided: num(row.voided),
    eventsHour: num(row.events_hour),
    refusalsHour: num(row.refusals_hour),
    p95LatencyMs: row.p95_latency_ms === null ? null : num(row.p95_latency_ms),
    lastEventAt: (row.last_event_at as string) ?? null,
  };
}

export async function fetchPlayers(search?: string, limit = 100): Promise<OperatorPlayer[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('admin_players', {
    p_limit: limit,
    p_search: search?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    userId: r.user_id as string,
    handle: (r.handle as string) ?? null,
    handleStatus: (r.handle_status as string) ?? 'ok',
    isPermanent: r.is_permanent === true,
    createdAt: r.created_at as string,
    sessions: num(r.sessions),
    completions: num(r.completions),
    assisted: num(r.assisted),
    voided: num(r.voided),
    bestRating: r.best_rating === null ? null : num(r.best_rating),
    lastSeen: (r.last_seen as string) ?? null,
  }));
}

export async function fetchEvents(onlyFailures = false, limit = 80): Promise<OperatorEvent[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('admin_events', {
    p_limit: limit,
    p_only_failures: onlyFailures,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    occurredAt: r.occurred_at as string,
    event: r.event as string,
    outcome: r.outcome as string,
    actorId: (r.actor_id as string) ?? null,
    actorHandle: (r.actor_handle as string) ?? null,
    subjectType: (r.subject_type as string) ?? null,
    subjectId: (r.subject_id as string) ?? null,
    detail: (r.detail as Record<string, unknown>) ?? {},
    latencyMs: r.latency_ms === null ? null : num(r.latency_ms),
    requestId: r.request_id as string,
  }));
}

/**
 * One player's seasons, so a season can be voided from the row that made it
 * suspicious. Read through the ordinary table: an operator is signed in, and
 * `completed games readable` already admits every completed season.
 */
export async function fetchPlayerSeasons(userId: string, limit = 20): Promise<OperatorSeason[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('game_sessions')
    .select('id, final_rating, record_wins, record_losses, mode, ending_key, assisted, voided_at, completed_at')
    .eq('user_id', userId)
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    finalRating: r.final_rating === null ? null : Number(r.final_rating),
    record: r.record_wins === null ? '—' : `${r.record_wins}-${r.record_losses}`,
    mode: (r.mode as string) ?? null,
    endingKey: (r.ending_key as string) ?? null,
    assisted: r.assisted === true,
    voidedAt: (r.voided_at as string) ?? null,
    completedAt: (r.completed_at as string) ?? null,
  }));
}

// --- Acting -----------------------------------------------------------------
//
// Each of these is refused by the server unless the caller is an operator, and
// each writes to the append-only trail before it does the work.

export async function setHandleStatus(userId: string, status: 'ok' | 'flagged' | 'hidden') {
  if (!supabase) return;
  const { error } = await supabase.rpc('admin_set_handle_status', {
    p_user: userId,
    p_status: status,
  });
  if (error) throw new Error(error.message);
}

export async function voidSeason(sessionId: string, reason?: string) {
  if (!supabase) return;
  const { error } = await supabase.rpc('admin_void_season', {
    p_session: sessionId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function restoreSeason(sessionId: string) {
  if (!supabase) return;
  const { error } = await supabase.rpc('admin_restore_season', { p_session: sessionId });
  if (error) throw new Error(error.message);
}

export async function deletePlayer(userId: string, reason?: string) {
  if (!supabase) return;
  const { error } = await supabase.rpc('admin_delete_player', {
    p_user: userId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}
