/**
 * Records one selection against the spin that made it legal (PRFAQ §28).
 *
 * Together with `spin`, this means the server holds the whole game: which
 * franchise-eras were offered, and which card was taken from each. By the time
 * `complete-game` runs it needs nothing from the client but "I'm done" — there
 * is no roster for a modified client to invent.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ROSTER_SLOTS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1', 'DEF'] as const;
type RosterSlot = (typeof ROSTER_SLOTS)[number];
const SLOT_POSITION: Record<RosterSlot, string> = {
  QB: 'QB', RB1: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR', TE1: 'TE', DEF: 'DEF',
};
const SLOT_SET = new Set<string>(ROSTER_SLOTS);

const CORS = {
  'access-control-allow-origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
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

  let body: { gameSessionId?: string; slot?: string; cardId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (typeof body.gameSessionId !== 'string' || !UUID.test(body.gameSessionId)) {
    return json({ error: 'invalid_session_id' }, 400);
  }
  if (typeof body.slot !== 'string' || !SLOT_SET.has(body.slot)) return json({ error: 'invalid_slot' }, 400);
  if (typeof body.cardId !== 'string' || body.cardId.length > 128) return json({ error: 'invalid_card' }, 400);
  const slot = body.slot as RosterSlot;

  const { data: session, error: sessionError } = await admin
    .from('game_sessions').select('id, user_id, status').eq('id', body.gameSessionId).maybeSingle();
  if (sessionError) return json({ error: 'lookup_failed' }, 500);
  if (!session) return json({ error: 'unknown_session' }, 404);
  if (session.user_id !== user.id) return json({ error: 'forbidden' }, 403);
  if (session.status !== 'in_progress') return json({ error: 'already_completed' }, 409);

  const [{ data: spins }, { data: selections }, { data: card }] = await Promise.all([
    admin.from('game_spins').select('sequence, franchise_id, era_key').eq('game_session_id', session.id),
    admin.from('game_selections').select('roster_slot, card_id, spin_sequence').eq('game_session_id', session.id),
    admin.from('season_cards').select('id, entity_id, position, franchise_id, era_key').eq('id', body.cardId).maybeSingle(),
  ]);

  if (!card) return json({ error: 'unknown_card' }, 400);
  if (SLOT_POSITION[slot] !== card.position) return json({ error: 'position_mismatch' }, 400);
  if ((selections ?? []).some((s) => s.roster_slot === slot)) return json({ error: 'slot_filled' }, 409);

  // The most recent spin is the live one, and it yields exactly one pick.
  const latest = (spins ?? []).reduce<{ sequence: number; franchise_id: string; era_key: string } | null>(
    (best, s) => (!best || s.sequence > best.sequence ? s : best), null,
  );
  if (!latest) return json({ error: 'spin_first' }, 409);
  if ((selections ?? []).some((s) => s.spin_sequence === latest.sequence)) {
    return json({ error: 'spin_already_used' }, 409);
  }
  if (card.franchise_id !== latest.franchise_id || card.era_key !== latest.era_key) {
    return json({ error: 'card_not_eligible_for_spin' }, 400);
  }

  // A historical identity may hold only one slot (PRFAQ §42).
  if ((selections ?? []).length > 0) {
    const { data: used } = await admin
      .from('season_cards').select('entity_id').in('id', (selections ?? []).map((s) => s.card_id));
    if ((used ?? []).some((u) => u.entity_id === card.entity_id)) {
      return json({ error: 'duplicate_player' }, 409);
    }
  }

  const { error: insertError } = await admin.from('game_selections').insert({
    game_session_id: session.id,
    roster_slot: slot,
    card_id: card.id,
    spin_sequence: latest.sequence,
  });
  if (insertError) return json({ error: 'select_failed', detail: insertError.message }, 500);

  const filled = (selections ?? []).length + 1;
  return json({ ok: true, slot, filled, complete: filled === ROSTER_SLOTS.length });
});
