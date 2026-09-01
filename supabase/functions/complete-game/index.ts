/**
 * Authoritative game completion (PRFAQ §26, §36).
 *
 * The client sends only roster slot -> card id. The server looks the ratings up
 * in Postgres, recomputes the score with the same shared scoring module the
 * client previews with, and writes the result itself. A modified client cannot
 * post a fake 18-0 because it never gets to state its own rating.
 *
 * Deploy: supabase functions deploy complete-game
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
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
  assisted?: boolean;
  selections: { slot: RosterSlot; cardId: string; spinSequence: number }[];
  spins: { sequence: number; franchiseId: string; era: string }[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'POST, OPTIONS',
      },
    });
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthenticated' }, 401);

  // Caller identity comes from their JWT; writes use the service role, because
  // no client is allowed to update a result row.
  const asUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: auth } = await asUser.auth.getUser();
  const user = auth?.user;
  if (!user) return json({ error: 'unauthenticated' }, 401);

  let body: CompleteRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!Array.isArray(body.selections) || body.selections.length !== ROSTER_SLOTS.length) {
    return json({ error: 'incomplete_roster' }, 400);
  }

  // Idempotency: a retried completion returns the original result rather than
  // creating a second season (PRFAQ §36).
  const { data: existing } = await admin
    .from('game_sessions')
    .select('*')
    .eq('user_id', user.id)
    .eq('idempotency_key', body.idempotencyKey)
    .eq('status', 'completed')
    .maybeSingle();
  if (existing) return json({ result: toResponse(existing), replayed: true });

  const cardIds = body.selections.map((s) => s.cardId);
  const { data: cards, error: cardError } = await admin
    .from('season_cards')
    .select('id, entity_id, display_name, position, franchise_id, season_year, era_key, rating, archetypes, rating_model_version')
    .in('id', cardIds);
  if (cardError) return json({ error: 'lookup_failed', detail: cardError.message }, 500);
  if (!cards || cards.length !== cardIds.length) return json({ error: 'unknown_card' }, 400);

  const byId = new Map(cards.map((c) => [c.id, c]));
  const entityIds = new Set<string>();
  const roster: Partial<Record<RosterSlot, unknown>> = {};

  for (const selection of body.selections) {
    const card = byId.get(selection.cardId)!;
    if (SLOT_POSITION[selection.slot] !== card.position) {
      return json({ error: 'position_mismatch', slot: selection.slot }, 400);
    }
    if (entityIds.has(card.entity_id)) {
      return json({ error: 'duplicate_player', slot: selection.slot }, 400);
    }
    entityIds.add(card.entity_id);

    // The card must have been legal for the spin the client claims it came from.
    const spin = body.spins.find((s) => s.sequence === selection.spinSequence);
    if (!spin || spin.franchiseId !== card.franchise_id || spin.era !== card.era_key) {
      return json({ error: 'spin_mismatch', slot: selection.slot }, 400);
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

  if (ROSTER_SLOTS.some((slot) => roster[slot] === undefined)) {
    return json({ error: 'incomplete_roster' }, 400);
  }

  const result = scoreRoster(roster as CompletedRoster, DEFAULT_SCORING_CONFIG);

  // Identifies the roster itself, so the same seven cards only ever hold one
  // leaderboard place for a given player.
  const fingerprint = [...cardIds].sort().join('|');

  const { data: saved, error: saveError } = await admin
    .from('game_sessions')
    .upsert(
      {
        id: body.gameSessionId,
        user_id: user.id,
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
        assisted: body.assisted === true,
        idempotency_key: body.idempotencyKey,
        roster_fingerprint: fingerprint,
      },
      { onConflict: 'id' },
    )
    .select()
    .single();
  if (saveError) return json({ error: 'save_failed', detail: saveError.message }, 500);

  await admin.from('game_selections').upsert(
    body.selections.map((s) => ({
      game_session_id: saved.id,
      roster_slot: s.slot,
      card_id: s.cardId,
      spin_sequence: s.spinSequence,
    })),
    { onConflict: 'game_session_id,roster_slot' },
  );

  return json({ result, replayed: false });
});

function toResponse(row: Record<string, unknown>) {
  return {
    finalRating: Number(row.final_rating),
    record: { wins: row.record_wins, losses: row.record_losses },
    ending: { key: row.ending_key, tier: row.tier },
    ratingModelVersion: row.rating_model_version,
    perfectEligibility: { eligible: row.perfect_eligible, failedGates: row.failed_gates ?? [] },
  };
}
