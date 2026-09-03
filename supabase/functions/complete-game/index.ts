/**
 * Authoritative game completion (PRFAQ §26, §36).
 *
 * The client sends only roster slot -> card id. Everything else is read from the
 * database: the ratings, the spins that were issued, and whether the run was
 * assisted. The score is recomputed with the same shared scoring module the
 * client previews with, so a modified client cannot post a rating it did not
 * earn — it never gets to state one.
 *
 * Deploy: supabase functions deploy complete-game
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { audit, beginRequest, corsHeaders, log, traceHeaders, withinRateLimit } from '../_shared/observability.ts';
import {
  DEFAULT_SCORING_CONFIG,
  ROSTER_SLOTS,
  SLOT_POSITION,
  scoreRoster,
  type CompletedRoster,
  type RosterSlot,
} from '../_shared/domain.ts';

interface CompleteRequest {
  gameSessionId: string;
  idempotencyKey: string;
  /**
   * What the client believes it is running. Advisory, never trusted: it is
   * compared, recorded, and reported back -- see `versionCheck`.
   */
  modelVersion?: string;
  datasetModelVersion?: string;
}

/**
 * Do the two sides agree about which model they are running?
 *
 * The client previews a score from a dataset bundled into the app; the server
 * scores from rows in Postgres. Shipping an app release and reseeding the
 * database are two separate acts and cannot be simultaneous, so there is
 * always a window where a player's preview and their result were produced by
 * different inputs -- and until now nothing in the system noticed, which is
 * the worst version of that: a player sees one number, the board shows
 * another, and neither side can say why.
 *
 * Reported, not refused. The server's answer already wins, and refusing every
 * completion during a rollout would take the game down to protect a rounding
 * difference. What matters is that the disagreement is visible: on the trail
 * for whoever is deploying, and on screen for whoever is playing.
 */
function versionCheck(
  claimed: Pick<CompleteRequest, 'modelVersion' | 'datasetModelVersion'>,
  serverModel: string,
  cardModels: readonly string[],
) {
  const cardModel = [...new Set(cardModels)].sort().join(',');
  const model = claimed.modelVersion ?? null;
  const dataset = claimed.datasetModelVersion ?? null;
  const agreed =
    (model === null || model === serverModel) && (dataset === null || dataset === cardModel);
  return {
    agreed,
    scoring: { client: model, server: serverModel },
    ratings: { client: dataset, server: cardModel },
  };
}


/** Completions per minute per player. A game takes far longer than this allows. */
const COMPLETIONS_PER_MINUTE = 12;

const jsonWith = (extra: Record<string, string>) => (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One response shape for both the fresh and the replayed path. */
function toResponse(row: Record<string, unknown>) {
  return {
    finalRating: Number(row.final_rating),
    record: { wins: row.record_wins, losses: row.record_losses },
    ending: { key: row.ending_key, tier: row.tier },
    breakdown: {
      baseRating: row.base_rating === null ? null : Number(row.base_rating),
      weakLinkPenalty: row.weak_link_penalty === null ? null : Number(row.weak_link_penalty),
      eliteBonus: row.elite_bonus === null ? null : Number(row.elite_bonus),
      chemistryBonus: row.chemistry_bonus === null ? null : Number(row.chemistry_bonus),
    },
    perfectEligibility: { eligible: row.perfect_eligible, failedGates: row.failed_gates ?? [] },
    assisted: row.assisted === true,
    ratingModelVersion: row.rating_model_version,
  };
}

Deno.serve(async (req) => {
  const ctx = beginRequest(req);
  const CORS = corsHeaders(req);
  // Both, and in this order: `extra` was previously accepted and never spread,
  // so every response from this endpoint went out without its trace header.
  const json = jsonWith({ ...CORS, ...traceHeaders(ctx) });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
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

  let body: CompleteRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  // --- validate the request shape ------------------------------------------
  if (typeof body.gameSessionId !== 'string' || !UUID.test(body.gameSessionId)) {
    return json({ error: 'invalid_session_id' }, 400);
  }
  if (
    typeof body.idempotencyKey !== 'string' ||
    body.idempotencyKey.length < 8 ||
    body.idempotencyKey.length > 128
  ) {
    return json({ error: 'invalid_idempotency_key' }, 400);
  }
  // --- the session must exist, be ours, and still be open ------------------
  const { data: session, error: sessionError } = await admin
    .from('game_sessions')
    .select('*')
    .eq('id', body.gameSessionId)
    .maybeSingle();
  const refuse = async (reason: string, status: number, extra: Record<string, unknown> = {}) => {
    await audit(admin, ctx, {
      event: 'completion_requested',
      outcome: 'rejected',
      actorId: user.id,
      subjectType: 'game_session',
      subjectId: body.gameSessionId,
      detail: { reason, ...extra },
    });
    return json({ error: reason, ...extra }, status);
  };

  if (!await withinRateLimit(admin, ctx, user.id, 'complete', COMPLETIONS_PER_MINUTE)) {
    return await refuse('rate_limited', 429);
  }
  if (sessionError) return await refuse('lookup_failed', 500);
  if (!session) return await refuse('unknown_session', 404);
  if (session.user_id !== user.id) return await refuse('forbidden', 403);
  if (session.status === 'completed') {
    // Idempotent replay rather than an error.
    await audit(admin, ctx, {
      event: 'completion_replayed',
      outcome: 'ok',
      actorId: user.id,
      subjectType: 'game_session',
      subjectId: session.id,
      detail: { final_rating: session.final_rating },
    });
    return json({ result: toResponse(session), replayed: true });
  }

  // --- the roster comes from the database, never from the client -----------
  const [{ data: spins, error: spinError }, { data: stored, error: selectionsError }] = await Promise.all([
    admin.from('game_spins').select('sequence, franchise_id, era_key').eq('game_session_id', session.id),
    admin.from('game_selections').select('roster_slot, card_id, spin_sequence').eq('game_session_id', session.id),
  ]);
  if (spinError || selectionsError) {
    return await refuse('lookup_failed', 500);
  }
  if (!stored || stored.length !== ROSTER_SLOTS.length) {
    return await refuse('incomplete_roster', 400, { filled: stored?.length ?? 0 });
  }

  const selections = stored.map((s) => ({
    slot: s.roster_slot as RosterSlot,
    cardId: s.card_id as string,
    spinSequence: s.spin_sequence as number,
  }));
  if (new Set(selections.map((s) => s.slot)).size !== ROSTER_SLOTS.length) {
    return await refuse('duplicate_slot', 400);
  }

  const spinBySequence = new Map((spins ?? []).map((s) => [s.sequence as number, s]));

  const { data: cards, error: cardError } = await admin
    .from('season_cards')
    .select('id, entity_id, display_name, position, franchise_id, season_year, era_key, rating, archetypes, rating_model_version')
    .in('id', selections.map((s) => s.cardId));
  if (cardError) return await refuse('lookup_failed', 500);
  const byId = new Map((cards ?? []).map((c) => [c.id as string, c]));
  if (byId.size !== new Set(selections.map((s) => s.cardId)).size) {
    return await refuse('unknown_card', 400);
  }

  const entityIds = new Set<string>();
  const usedSpins = new Set<number>();
  const roster: Partial<Record<RosterSlot, unknown>> = {};

  for (const selection of selections) {
    const card = byId.get(selection.cardId)!;
    if (SLOT_POSITION[selection.slot] !== card.position) {
      return await refuse('position_mismatch', 400, { slot: selection.slot });
    }
    if (entityIds.has(card.entity_id)) {
      return await refuse('duplicate_player', 400, { slot: selection.slot });
    }
    entityIds.add(card.entity_id);

    // Each spin yields exactly one selection, and the card must have been
    // legal for the spin the SERVER issued.
    if (usedSpins.has(selection.spinSequence)) {
      return await refuse('spin_reused', 400, { slot: selection.slot });
    }
    usedSpins.add(selection.spinSequence);

    const spin = spinBySequence.get(selection.spinSequence);
    if (!spin || spin.franchise_id !== card.franchise_id || spin.era_key !== card.era_key) {
      return await refuse('spin_mismatch', 400, { slot: selection.slot });
    }

    roster[selection.slot] = {
      slot: selection.slot,
      spinSequence: selection.spinSequence,
      season: {
        id: card.id,
        entityId: card.entity_id,
        entityType: card.position === 'DEF' ? 'defense' : 'player',
        displayName: card.display_name,
        position: card.position,
        franchiseId: card.franchise_id,
        seasonYear: card.season_year,
        era: card.era_key,
        rating: Number(card.rating),
        archetypes: card.archetypes ?? [],
        ratingModelVersion: card.rating_model_version,
      },
    };
  }

  const result = scoreRoster(roster as CompletedRoster, DEFAULT_SCORING_CONFIG);

  const versions = versionCheck(
    body,
    DEFAULT_SCORING_CONFIG.version,
    (cards ?? []).map((c) => c.rating_model_version as string),
  );
  if (!versions.agreed) {
    // Its own event, so a rollout that has left half the players on an older
    // bundle shows up as a spike rather than as scattered confusion.
    await audit(admin, ctx, {
      event: 'version_mismatch',
      outcome: 'ok',
      actorId: user.id,
      subjectType: 'game_session',
      subjectId: session.id,
      detail: versions,
    });
    log('warn', ctx, { event: 'version_mismatch', session_id: session.id, ...versions });
  }

  // Identifies the roster, so the same seven cards hold only one leaderboard place.
  const fingerprint = [...selections.map((s) => s.cardId)].sort().join('|');

  // Scoped UPDATE, not an upsert: it cannot create a row, cannot touch another
  // user's row, and the status predicate makes completion single-shot.
  const { data: saved, error: saveError } = await admin
    .from('game_sessions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      rating_model_version: result.ratingModelVersion,
      final_rating: result.finalRating,
      record_wins: result.record.wins,
      record_losses: result.record.losses,
      ending_key: result.ending.key,
      tier: result.ending.tier,
      base_rating: result.breakdown.baseRating,
      weak_link_penalty: result.breakdown.weakLinkPenalty,
      elite_bonus: result.breakdown.eliteBonus,
      chemistry_bonus: result.breakdown.chemistryBonus,
      perfect_eligible: result.perfectEligibility.eligible,
      failed_gates: result.perfectEligibility.failedGates,
      roster_fingerprint: fingerprint,
    })
    .eq('id', session.id)
    .eq('user_id', user.id)
    .eq('status', 'in_progress')
    .select()
    .maybeSingle();

  if (saveError) {
    log('error', ctx, { event: 'completion_save_failed', reason: saveError.message });
    return await refuse('save_failed', 500);
  }
  if (!saved) {
    // Lost a race with a concurrent completion — return that one.
    const { data: prior } = await admin
      .from('game_sessions').select('*').eq('id', session.id).maybeSingle();
    if (prior?.status === 'completed') return json({ result: toResponse(prior), replayed: true });
    return json({ error: 'save_failed' }, 500);
  }

  // The one row that can reach a public leaderboard. It does not leave here
  // without a line in the trail saying what it scored and why.
  const recorded = await audit(admin, ctx, {
    event: 'game_completed',
    outcome: 'ok',
    actorId: user.id,
    subjectType: 'game_session',
    subjectId: session.id,
    detail: {
      final_rating: saved.final_rating,
      record: `${saved.record_wins}-${saved.record_losses}`,
      ending_key: saved.ending_key,
      tier: saved.tier,
      assisted: saved.assisted,
      rating_model_version: saved.rating_model_version,
      roster_fingerprint: saved.roster_fingerprint,
    },
  });
  if (!recorded) log('error', ctx, { event: 'completion_unaudited', session_id: session.id });

  return json({ result: toResponse(saved), replayed: false, versions });
});
