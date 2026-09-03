/**
 * Server-issued spins (PRFAQ §36).
 *
 * A client cannot be trusted to say which franchise-era it was offered: if it
 * could, a modified client would simply declare the seven buckets holding the
 * best cards in the dataset and earn a genuine near-perfect score from a roster
 * it could never have been dealt. So the wheel turns here, and the result is
 * recorded in `game_spins` before the client sees it.
 *
 * Offline play still spins locally — those games are never submitted. Only a
 * ranked game goes through this endpoint.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { audit, beginRequest, corsHeaders, log, traceHeaders, withinRateLimit } from '../_shared/observability.ts';

const ROSTER_SLOTS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1', 'DEF'] as const;
type RosterSlot = (typeof ROSTER_SLOTS)[number];

const SLOT_POSITION: Record<RosterSlot, string> = {
  QB: 'QB', RB1: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR', TE1: 'TE', DEF: 'DEF',
};


/** Spins per minute per player. A human cannot outpace this; a script can. */
const SPINS_PER_MINUTE = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
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

  const asUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: auth } = await asUser.auth.getUser();
  const user = auth?.user;
  if (!user) return json({ error: 'unauthenticated' }, 401);

  let body: { gameSessionId?: string; assist?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (typeof body.gameSessionId !== 'string' || !UUID.test(body.gameSessionId)) {
    return json({ error: 'invalid_session_id' }, 400);
  }

  const { data: session, error: sessionError } = await admin
    .from('game_sessions')
    .select('id, user_id, status, assisted, challenge_id, gameday_key')
    .eq('id', body.gameSessionId)
    .maybeSingle();
  if (sessionError) return json({ error: 'lookup_failed' }, 500);
  const refuse = async (reason: string, status: number) => {
    await audit(admin, ctx, {
      event: 'spin_requested',
      outcome: 'rejected',
      actorId: user.id,
      subjectType: 'game_session',
      subjectId: body.gameSessionId,
      detail: { reason },
    });
    return json({ error: reason }, status);
  };

  if (!await withinRateLimit(admin, ctx, user.id, 'spin', SPINS_PER_MINUTE)) {
    return await refuse('rate_limited', 429);
  }
  if (!session) return await refuse('unknown_session', 404);
  if (session.user_id !== user.id) return await refuse('forbidden', 403);
  if (session.status !== 'in_progress') return await refuse('already_completed', 409);

  const [{ data: spins }, { data: selections }] = await Promise.all([
    admin.from('game_spins').select('sequence').eq('game_session_id', session.id),
    admin.from('game_selections').select('roster_slot, card_id').eq('game_session_id', session.id),
  ]);

  const filled = new Set((selections ?? []).map((s) => s.roster_slot as RosterSlot));
  if (filled.size >= ROSTER_SLOTS.length) return await refuse('roster_complete', 409);

  // One selection per spin: refuse to deal another card until the last one was used.
  const spinCount = spins?.length ?? 0;
  if (spinCount > filled.size) return await refuse('pick_first', 409);

  // A challenge is a duel, and a duel on two different wheels is not one. A
  // session that declared a challenge replays the creator's franchise-era at
  // this sequence, so both rosters are built from the same seven spins.
  //
  // Here rather than in the client for the usual reason: a client that could
  // name its own buckets would name the seven holding the best cards in the
  // dataset and win every challenge it was ever sent.
  if (session.challenge_id) {
    // The cheat exists for solo play. Using it against another player is not
    // a cheat the game is willing to record as a win.
    if (body.assist === true) return await refuse('assist_not_allowed_in_challenge', 409);

    const { data: challenge } = await admin
      .from('challenges')
      .select('creator_game_session_id')
      .eq('id', session.challenge_id)
      .maybeSingle();

    const scripted = challenge
      ? (await admin
          .from('game_spins')
          .select('franchise_id, era_key')
          .eq('game_session_id', challenge.creator_game_session_id)
          .eq('sequence', spinCount + 1)
          .maybeSingle()).data
      : null;

    if (scripted) {
      const sequence = spinCount + 1;
      const { error: replayError } = await admin.from('game_spins').insert({
        game_session_id: session.id,
        sequence,
        franchise_id: scripted.franchise_id,
        era_key: scripted.era_key,
      });
      if (replayError) {
        log('error', ctx, { event: 'spin_insert_failed', reason: replayError.message });
        return await refuse('spin_failed', 500);
      }
      const kept = await audit(admin, ctx, {
        event: 'spin_issued',
        outcome: 'ok',
        actorId: user.id,
        subjectType: 'game_session',
        subjectId: session.id,
        detail: {
          sequence,
          franchise_id: scripted.franchise_id,
          era_key: scripted.era_key,
          assisted: false,
          replayed_from_challenge: session.challenge_id,
        },
      });
      if (!kept) {
        await admin.from('game_spins').delete()
          .eq('game_session_id', session.id).eq('sequence', sequence);
        return json({ error: 'audit_unavailable' }, 503);
      }
      return json({
        spin: { sequence, franchiseId: scripted.franchise_id, era: scripted.era_key },
        assisted: session.assisted,
      });
    }
    // No script at this sequence means the creator's session is missing spins
    // it should have. Falling through to a fair random spin keeps the game
    // playable; the challenge simply stops being a like-for-like duel.
    log('warn', ctx, {
      event: 'challenge_script_missing',
      session: session.id,
      sequence: spinCount + 1,
    });
  }

  // A gameday run is dealt from the franchises actually playing that day. The
  // key was stamped by the server when the session opened, so this reads a
  // fact rather than a claim -- and the pool is read here rather than trusted
  // from the client for the reason every spin is issued here at all.
  let gamedayFranchises: string[] | null = null;
  if (session.gameday_key) {
    // The three-finger spin is a solo indulgence. A one-day board is a
    // contest, and a rigged wheel is not something to record as a win on one.
    if (body.assist === true) return await refuse('assist_not_allowed_in_gameday', 409);

    const { data: playing, error: playingError } = await admin
      .from('gameday_franchises')
      .select('franchise_id')
      .eq('gameday_key', session.gameday_key);
    if (playingError) {
      log('error', ctx, { event: 'gameday_pool_lookup_failed', reason: playingError.message });
      return await refuse('lookup_failed', 500);
    }
    gamedayFranchises = (playing ?? []).map((row) => row.franchise_id as string);
    // The calendar is generated only from fixtures whose franchises the dataset
    // can field, so an empty pool means the row was written by something else.
    if (gamedayFranchises.length === 0) return await refuse('no_playable_spin', 409);
  }

  const openPositions = [...new Set(
    ROSTER_SLOTS.filter((slot) => !filled.has(slot)).map((slot) => SLOT_POSITION[slot]),
  )];

  // Identities already on the roster cannot be offered again (PRFAQ §42).
  let usedEntities: string[] = [];
  if (selections && selections.length > 0) {
    const { data: usedCards } = await admin
      .from('season_cards')
      .select('entity_id')
      .in('id', selections.map((s) => s.card_id));
    usedEntities = (usedCards ?? []).map((c) => c.entity_id as string);
  }

  // Every franchise-era that still offers a playable card for an open slot.
  let query = admin
    .from('season_cards')
    .select('franchise_id, era_key, rating')
    .in('position', openPositions)
    // A retired card is one a rebuilt dataset no longer contains. Its row stays
    // so the seasons played with it still resolve, but the wheel must never
    // deal it again -- the client's bundle has never heard of it (0020).
    .is('retired_at', null)
    .order('rating', { ascending: false });
  if (usedEntities.length > 0) query = query.not('entity_id', 'in', `(${usedEntities.join(',')})`);
  if (gamedayFranchises) query = query.in('franchise_id', gamedayFranchises);

  /**
   * The ceiling has to sit above the whole live dataset, not near it.
   *
   * On the first spin of a game every position is open, so this query is
   * "every live card", ordered by rating. A cap below that count silently
   * drops the tail -- and because the order is by rating descending, what it
   * drops is the weakest cards, which are exactly the ones that make a thin
   * franchise-era spinnable at all. A bucket whose every card fell past the cut
   * would simply stop being offered, with nothing logged and nothing to notice.
   *
   * It was 4,000 and the dataset reached 4,872 when 1980-1998 came in. No
   * franchise-era lost its last card -- checked, the 4,000th row rated 71.82
   * and every bucket still had something above it -- so this was one era away
   * from being a real bug rather than a latent one.
   */
  const CANDIDATE_CEILING = 25_000;

  const { data: candidates, error: candidateError } = await query.limit(CANDIDATE_CEILING);
  if (candidateError) {
    log('error', ctx, { event: 'spin_lookup_failed', reason: candidateError.message });
    return await refuse('lookup_failed', 500);
  }
  if (!candidates || candidates.length === 0) return await refuse('no_playable_spin', 409);
  // Hitting the ceiling means the tail was truncated and some franchise-era may
  // no longer be reachable. Cheap to check, and the alternative is finding out
  // from a player who says a team stopped coming up.
  if (candidates.length === CANDIDATE_CEILING) {
    log('error', ctx, {
      event: 'spin_candidates_truncated',
      reason: `the candidate query returned the full ${CANDIDATE_CEILING} it was allowed; raise the ceiling`,
    });
  }

  // The three-finger spin lands on the bucket holding the single best card
  // still available. Recorded as assisted here, where the client cannot undo it.
  const assist = body.assist === true;
  const chosen = assist
    ? candidates[0]!
    : (() => {
        const seen = new Set<string>();
        const buckets = candidates.filter((c) => {
          const key = `${c.franchise_id}:${c.era_key}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return buckets[Math.floor(Math.random() * buckets.length)]!;
      })();

  const sequence = spinCount + 1;
  const { error: insertError } = await admin.from('game_spins').insert({
    game_session_id: session.id,
    sequence,
    franchise_id: chosen.franchise_id,
    era_key: chosen.era_key,
  });
  if (insertError) {
    log('error', ctx, { event: 'spin_insert_failed', reason: insertError.message });
    return await refuse('spin_failed', 500);
  }

  if (assist && !session.assisted) {
    await admin.from('game_sessions').update({ assisted: true }).eq('id', session.id);
  }

  // The spin is state, and state we cannot account for is state we should not
  // have created. If the trail refuses the row, the spin is rolled back.
  const recorded = await audit(admin, ctx, {
    event: 'spin_issued',
    outcome: 'ok',
    actorId: user.id,
    subjectType: 'game_session',
    subjectId: session.id,
    detail: {
      sequence,
      franchise_id: chosen.franchise_id,
      era_key: chosen.era_key,
      assisted: assist,
      ...(session.gameday_key ? { gameday_key: session.gameday_key } : {}),
    },
  });
  if (!recorded) {
    await admin.from('game_spins').delete()
      .eq('game_session_id', session.id).eq('sequence', sequence);
    return json({ error: 'audit_unavailable' }, 503);
  }

  return json({
    spin: { sequence, franchiseId: chosen.franchise_id, era: chosen.era_key },
    assisted: assist || session.assisted,
  });
});
