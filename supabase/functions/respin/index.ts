/**
 * A paid respin in a ranked season (docs/respins.md).
 *
 * Replaces the spin that just landed, before anything is picked from it, with
 * one drawn here by the same code a normal spin uses (`_shared/wheel.ts`) --
 * every franchise-era still open to the season is equally likely, except the
 * one being replaced. Everything that decides whether the respin is *allowed*
 * (the season's, open, not a challenge, latest spin unpicked, a respin left
 * this season, a balance of at least one) is checked again inside
 * `apply_respin`, under locks, in the same transaction that debits the ledger,
 * rewrites the spin and stamps `game_sessions.respins_used`. The checks here
 * only save a draw that would be refused.
 *
 * The client sends a session id and nothing else. Which spin, which
 * franchise-era it was, what replaces it and whether it was paid for are all
 * read from rows, because a leaderboard reads `respins_used` and invariant 2
 * says a client is never the source of anything a leaderboard reads.
 *
 * Deploy: supabase functions deploy respin
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { audit, beginRequest, readJsonObject, corsHeaders, instrument, log, traceHeaders, withinRateLimit } from '../_shared/observability.ts';
import { readWheel } from '../_shared/wheel.ts';
import { RESPINS_PER_SEASON, drawUniform } from '../_shared/respins.ts';

/** Respins per minute per player. One per season is the real limit; this is for scripts. */
const RESPINS_PER_MINUTE = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `apply_respin` raises these as its message; anything else is a failure. */
const REFUSALS: Record<string, number> = {
  unknown_session: 404,
  forbidden: 403,
  already_completed: 409,
  respin_not_allowed_in_challenge: 409,
  respin_already_used: 409,
  spin_first: 409,
  spin_not_current: 409,
  spin_already_used: 409,
  spin_changed: 409,
  respin_same_bucket: 409,
  no_respins: 402,
};

Deno.serve(instrument('respin', async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const ctx = beginRequest(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...CORS, ...traceHeaders(ctx) },
    });

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthenticated' }, 401);

  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: auth } = await asUser.auth.getUser();
  const user = auth?.user;
  if (!user) return json({ error: 'unauthenticated' }, 401);

  let body: { gameSessionId?: string };
  try {
    body = await readJsonObject(req);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (typeof body.gameSessionId !== 'string' || !UUID.test(body.gameSessionId)) {
    return json({ error: 'invalid_session_id' }, 400);
  }

  const refuse = async (reason: string, status: number) => {
    await audit(admin, ctx, {
      event: 'respin_requested',
      outcome: 'rejected',
      actorId: user.id,
      subjectType: 'game_session',
      subjectId: body.gameSessionId,
      detail: { reason },
    });
    return json({ error: reason }, status);
  };

  if (!await withinRateLimit(admin, ctx, user.id, 'respin', RESPINS_PER_MINUTE)) {
    return await refuse('rate_limited', 429);
  }

  const { data: session, error: sessionError } = await admin
    .from('game_sessions')
    .select('id, user_id, status, challenge_id, gameday_key, respins_used')
    .eq('id', body.gameSessionId)
    .maybeSingle();
  if (sessionError) return await refuse('lookup_failed', 500);
  if (!session) return await refuse('unknown_session', 404);
  if (session.user_id !== user.id) return await refuse('forbidden', 403);
  if (session.status !== 'in_progress') return await refuse('already_completed', 409);
  // A duel replays the creator's seven spins; replacing one ends the duel.
  if (session.challenge_id) return await refuse('respin_not_allowed_in_challenge', 409);
  if ((session.respins_used ?? 0) >= RESPINS_PER_SEASON) return await refuse('respin_already_used', 409);

  const [{ data: spins }, { data: selections }] = await Promise.all([
    admin.from('game_spins').select('sequence, franchise_id, era_key').eq('game_session_id', session.id),
    admin.from('game_selections').select('roster_slot, card_id, spin_sequence').eq('game_session_id', session.id),
  ]);
  const latest = (spins ?? []).reduce<{ sequence: number; franchise_id: string; era_key: string } | null>(
    (best, s) => (!best || s.sequence > best.sequence ? s : best), null,
  );
  if (!latest) return await refuse('spin_first', 409);
  if ((selections ?? []).some((s) => s.spin_sequence === latest.sequence)) {
    return await refuse('spin_already_used', 409);
  }

  // Same pool a spin at this turn would draw from: the day's franchises on a
  // gameday, the whole league otherwise.
  let gamedayFranchises: string[] | null = null;
  if (session.gameday_key) {
    const { data: playing, error: playingError } = await admin
      .from('gameday_franchises')
      .select('franchise_id')
      .eq('gameday_key', session.gameday_key);
    if (playingError) return await refuse('lookup_failed', 500);
    gamedayFranchises = (playing ?? []).map((row) => row.franchise_id as string);
    if (gamedayFranchises.length === 0) return await refuse('no_playable_spin', 409);
  }

  const wheel = await readWheel(admin, selections ?? [], gamedayFranchises);
  if (!wheel.ok) {
    if (wheel.reason === 'lookup_failed') {
      log('error', ctx, { event: 'respin_lookup_failed', reason: wheel.detail ?? 'unknown' });
    }
    return await refuse(wheel.reason, wheel.reason === 'lookup_failed' ? 500 : 409);
  }

  const from = { franchiseId: latest.franchise_id, era: latest.era_key };
  const drawn = drawUniform(wheel.buckets, [from]);
  // The landed franchise-era was the only one left. Nothing to respin into,
  // and nothing is charged.
  if (!drawn) return await refuse('no_other_spin', 409);

  const { data: applied, error: applyError } = await admin.rpc('apply_respin', {
    p_user: user.id,
    p_session: session.id,
    p_sequence: latest.sequence,
    p_from_franchise: from.franchiseId,
    p_from_era: from.era,
    p_to_franchise: drawn.franchiseId,
    p_to_era: drawn.era,
  });
  if (applyError) {
    const reason = applyError.message;
    if (reason in REFUSALS) return await refuse(reason, REFUSALS[reason]!);
    log('error', ctx, { event: 'respin_apply_failed', reason });
    return await refuse('respin_failed', 500);
  }
  const row = (Array.isArray(applied) ? applied[0] : applied) as { balance: number; respins_used: number } | undefined;

  // The respin is already committed: the ledger row, the rewritten spin and
  // the stamp went in together. Unlike a spin, it cannot be rolled back here
  // if the trail refuses the row -- undoing it would be a second ledger write
  // that could itself fail -- so a missing audit row is logged loudly instead.
  // The ledger and `game_respins` hold the same facts either way.
  const recorded = await audit(admin, ctx, {
    event: 'respin_issued',
    outcome: 'ok',
    actorId: user.id,
    subjectType: 'game_session',
    subjectId: session.id,
    detail: {
      sequence: latest.sequence,
      discarded: `${from.franchiseId}:${from.era}`,
      franchise_id: drawn.franchiseId,
      era_key: drawn.era,
      open: wheel.buckets.length - 1,
      ...(session.gameday_key ? { gameday_key: session.gameday_key } : {}),
    },
  });
  if (!recorded) log('error', ctx, { event: 'respin_audit_missing', session: session.id });

  return json({
    spin: { sequence: latest.sequence, franchiseId: drawn.franchiseId, era: drawn.era },
    balance: Number(row?.balance ?? 0),
    respinsUsed: Number(row?.respins_used ?? 1),
    /** How many franchise-eras it was drawn from: the "N" in 1 in N. */
    drawnFrom: wheel.buckets.length - 1,
  });
}));
