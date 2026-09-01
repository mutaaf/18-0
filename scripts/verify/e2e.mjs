/**
 * End-to-end verification of the server layer.
 *
 * Plays a full ranked game against a live Supabase instance and then tries to
 * cheat it in every way the threat model in PRFAQ §36 cares about. Every
 * attack below MUST fail; every legitimate step MUST succeed.
 *
 *   node scripts/verify/e2e.mjs
 */
import { createClient } from '@supabase/supabase-js';

const API = process.env.API_URL;
const ANON = process.env.ANON_KEY;
const FUNCTIONS = `${API}/functions/v1`;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? passed++ : failed++;
};

const client = () => createClient(API, ANON, { auth: { persistSession: false } });

async function signIn(label) {
  const sb = client();
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw new Error(`${label} sign-in failed: ${error.message}`);
  return { sb, user: data.user, token: data.session.access_token };
}

const call = async (fn, token, body) => {
  const res = await fetch(`${FUNCTIONS}/${fn}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const SLOTS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1', 'DEF'];
const SLOT_POSITION = { QB: 'QB', RB1: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR', TE1: 'TE', DEF: 'DEF' };

/** Plays a full ranked game: create session, spin 7 times, pick each time. */
async function playRankedGame({ sb, user, token }, { assist = false } = {}) {
  const idempotencyKey = crypto.randomUUID();
  const { data: session, error } = await sb
    .from('game_sessions')
    .insert({ user_id: user.id, status: 'in_progress', idempotency_key: idempotencyKey })
    .select('id')
    .single();
  if (error) throw new Error(`session insert failed: ${error.message}`);

  const selections = [];
  const filled = new Set();
  const usedEntities = new Set();

  for (let i = 0; i < SLOTS.length; i++) {
    const spun = await call('spin', token, { gameSessionId: session.id, assist });
    if (spun.status !== 200) throw new Error(`spin ${i + 1} failed: ${JSON.stringify(spun.body)}`);
    const { franchiseId, era, sequence } = spun.body.spin;

    const open = SLOTS.filter((s) => !filled.has(s));
    const { data: cards } = await sb
      .from('season_cards')
      .select('id, entity_id, position, rating')
      .eq('franchise_id', franchiseId)
      .eq('era_key', era)
      .in('position', [...new Set(open.map((s) => SLOT_POSITION[s]))])
      .order('rating', { ascending: false });

    const card = (cards ?? []).find((c) => !usedEntities.has(c.entity_id));
    if (!card) throw new Error(`no playable card for spin ${sequence}`);
    const slot = open.find((s) => SLOT_POSITION[s] === card.position);

    const picked = await call('select', token, { gameSessionId: session.id, slot, cardId: card.id });
    if (picked.status !== 200) throw new Error(`select ${i + 1} failed: ${JSON.stringify(picked.body)}`);

    filled.add(slot);
    usedEntities.add(card.entity_id);
    selections.push({ slot, cardId: card.id, spinSequence: sequence });
  }

  return { sessionId: session.id, idempotencyKey, selections };
}

console.log('\n18-0 — SERVER END-TO-END VERIFICATION\n' + '='.repeat(64));

// ---------------------------------------------------------------------------
console.log('\nHAPPY PATH');
const alice = await signIn('alice');
check('anonymous sign-in works', Boolean(alice.user?.id));

const { data: profile } = await alice.sb.from('profiles').select('handle').eq('id', alice.user.id).maybeSingle();
check('a profile is created for a new account', Boolean(profile?.handle), profile?.handle);

const game = await playRankedGame(alice);
check('seven server-issued spins, one pick each', game.selections.length === 7);

const completion = await call('complete-game', alice.token, {
  gameSessionId: game.sessionId,
  idempotencyKey: game.idempotencyKey,
});
check('complete-game scores the roster', completion.status === 200 && completion.body.result?.finalRating > 0,
  completion.status === 200
    ? `${completion.body.result.record.wins}-${completion.body.result.record.losses} ${completion.body.result.ending.key} @ ${completion.body.result.result ?? completion.body.result.finalRating}`
    : JSON.stringify(completion.body));

const replay = await call('complete-game', alice.token, {
  gameSessionId: game.sessionId,
  idempotencyKey: game.idempotencyKey,
});
check('replaying a completion is idempotent', replay.status === 200 && replay.body.replayed === true &&
  replay.body.result.finalRating === completion.body.result.finalRating);

const { data: board } = await alice.sb
  .from('leaderboard_rating')
  .select('game_session_id, handle, final_rating, record_wins, record_losses');
const mine = (board ?? []).find((r) => r.game_session_id === game.sessionId);
check('the completed game appears on the leaderboard', Boolean(mine),
  mine ? `${mine.handle} ${mine.record_wins}-${mine.record_losses} @ ${mine.final_rating}` : 'not listed');

// ---------------------------------------------------------------------------
console.log('\nFORGERY ATTEMPTS (all must be refused)');

const forge = await alice.sb.from('game_sessions').insert({
  user_id: alice.user.id,
  status: 'completed',
  idempotency_key: crypto.randomUUID(),
  final_rating: 99.9999,
  record_wins: 18,
  record_losses: 0,
  ending_key: 'PERFECT',
  tier: 'IMMORTAL',
  roster_fingerprint: crypto.randomUUID(),
});
check('client cannot INSERT a pre-scored completed session', forge.error !== null,
  forge.error ? forge.error.code : 'INSERTED — leaderboard is forgeable');

const tamper = await alice.sb
  .from('game_sessions')
  .update({ final_rating: 99.9999, record_wins: 18, record_losses: 0, ending_key: 'PERFECT' })
  .eq('id', game.sessionId)
  .select();
check('client cannot UPDATE its own result', tamper.error !== null || (tamper.data ?? []).length === 0,
  tamper.error ? tamper.error.code : `${(tamper.data ?? []).length} rows changed`);

const bob = await signIn('bob');
const steal = await call('complete-game', bob.token, {
  gameSessionId: game.sessionId,
  idempotencyKey: crypto.randomUUID(),
});
check("a user cannot complete another user's session", steal.status === 403,
  `${steal.status} ${steal.body.error ?? ''}`);

const bobSpin = await call('spin', bob.token, { gameSessionId: game.sessionId });
check("a user cannot spin into another user's session", bobSpin.status === 403 || bobSpin.status === 409,
  `${bobSpin.status} ${bobSpin.body.error ?? ''}`);

// Declare spins that were never issued: pick the best cards in the dataset.
const bobGame = await (async () => {
  const idem = crypto.randomUUID();
  const { data: s } = await bob.sb
    .from('game_sessions')
    .insert({ user_id: bob.user.id, status: 'in_progress', idempotency_key: idem })
    .select('id').single();
  return { sessionId: s.id, idempotencyKey: idem };
})();

const { data: best } = await bob.sb
  .from('season_cards').select('id, position, entity_id').order('rating', { ascending: false }).limit(400);
const dream = [];
const seen = new Set();
for (const slot of SLOTS) {
  const c = best.find((x) => x.position === SLOT_POSITION[slot] && !seen.has(x.entity_id));
  if (c) { seen.add(c.entity_id); dream.push({ slot, cardId: c.id, spinSequence: dream.length + 1 }); }
}
// With no spin issued, the server refuses to record the pick at all.
const forgedPick = await call('select', bob.token, {
  gameSessionId: bobGame.sessionId, slot: dream[0].slot, cardId: dream[0].cardId,
});
check('a pick with no spin issued is refused',
  forgedPick.status === 409 && forgedPick.body.error === 'spin_first',
  `${forgedPick.status} ${forgedPick.body.error ?? ''}`);

// Spin once, then try to take a card from a different franchise-era.
const bobSpun = await call('spin', bob.token, { gameSessionId: bobGame.sessionId });
const wrongBucket = dream.find((d) => {
  const c = best.find((x) => x.id === d.cardId);
  return c && SLOT_POSITION[d.slot] === c.position;
});
const offSpin = await call('select', bob.token, {
  gameSessionId: bobGame.sessionId, slot: wrongBucket.slot, cardId: wrongBucket.cardId,
});
check('a card outside the issued franchise-era is refused',
  offSpin.status === 400 && offSpin.body.error === 'card_not_eligible_for_spin',
  `${offSpin.status} ${offSpin.body.error ?? ''} (spin was ${bobSpun.body.spin?.franchiseId}/${bobSpun.body.spin?.era})`);

const forgedSpins = await call('complete-game', bob.token, {
  gameSessionId: bobGame.sessionId,
  idempotencyKey: bobGame.idempotencyKey,
});
check('completing an unfinished roster is refused',
  forgedSpins.status === 400 && forgedSpins.body.error === 'incomplete_roster',
  `${forgedSpins.status} ${forgedSpins.body.error ?? ''}`);

const noSession = await call('complete-game', bob.token, {
  gameSessionId: crypto.randomUUID(),
  idempotencyKey: crypto.randomUUID(),
});
check('completing a session that does not exist is refused', noSession.status === 404,
  `${noSession.status} ${noSession.body.error ?? ''}`);

const unauth = await fetch(`${FUNCTIONS}/complete-game`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
});
check('an unauthenticated completion is refused', unauth.status === 401, String(unauth.status));

const badShape = await call('complete-game', bob.token, { gameSessionId: 'not-a-uuid', idempotencyKey: 'x' });
check('a malformed request is refused without a 500', badShape.status === 400,
  `${badShape.status} ${badShape.body.error ?? ''}`);

// ---------------------------------------------------------------------------
console.log('\nASSISTED RUNS');
const carol = await signIn('carol');
const rigged = await playRankedGame(carol, { assist: true });
const riggedResult = await call('complete-game', carol.token, {
  gameSessionId: rigged.sessionId,
  idempotencyKey: rigged.idempotencyKey,
});
check('a rigged game still completes', riggedResult.status === 200,
  riggedResult.status === 200
    ? `${riggedResult.body.result.record.wins}-${riggedResult.body.result.record.losses} @ ${riggedResult.body.result.finalRating}`
    : JSON.stringify(riggedResult.body));
check('the server marks it assisted regardless of what the client said',
  riggedResult.body.result?.assisted === true);

const { data: boardAfter } = await carol.sb.from('leaderboard_rating').select('user_id');
check('an assisted run is kept off the leaderboard',
  !(boardAfter ?? []).some((r) => r.user_id === carol.user.id),
  `${(boardAfter ?? []).length} entries on the board, none of them carol's`);

// ---------------------------------------------------------------------------
console.log('\nCHALLENGES');
const challenge = await alice.sb.from('challenges').insert({
  creator_user_id: alice.user.id, creator_game_session_id: game.sessionId,
}).select('id, share_token').single();
check('a challenge can be created from a completed game', challenge.error === null,
  challenge.error ? challenge.error.message : challenge.data.share_token);
check('the share token is URL-safe',
  challenge.data ? !/[+/]/.test(challenge.data.share_token) : false,
  challenge.data?.share_token);

const hijack = await bob.sb.from('challenges')
  .update({ creator_user_id: bob.user.id, opponent_user_id: bob.user.id, status: 'complete' })
  .eq('id', challenge.data?.id ?? crypto.randomUUID()).select();
check('a challenge cannot be hijacked', hijack.error !== null || (hijack.data ?? []).length === 0,
  hijack.error ? hijack.error.code : `${(hijack.data ?? []).length} rows changed`);

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(64));
console.log(`${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
