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
/** Optional. Unlocks the checks that inspect the trail from the inside. */
const SERVICE = process.env.SERVICE_KEY;
const FUNCTIONS = `${API}/functions/v1`;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  ok ? passed++ : failed++;
};

const client = () => createClient(API, ANON, { auth: { persistSession: false } });

/**
 * A fresh anonymous account.
 *
 * Supabase caps anonymous sign-ins per IP per hour, and one pass of this file
 * makes seven of them. Running the harness a few times while iterating is
 * enough to hit the cap, and the failure arrived as an unhandled rejection
 * midway through — a stack trace where a result should have been, with the
 * checks that had already passed scrolled off the top.
 *
 * A short backoff rides out a burst. A cap that is genuinely exhausted cannot
 * be waited out inside a run, so that says so plainly instead.
 */
/**
 * Everything this file creates is tagged with this, and deleted at the end.
 *
 * These accounts play *real* ranked games, because a verification that plays
 * fake ones verifies nothing. Real ranked games go on the public leaderboard —
 * so every run of this harness was quietly pushing another handful of
 * `verify_*` and `player-*` entries onto the board people actually look at.
 *
 * The tag is what makes the cleanup safe: it deletes accounts this run made and
 * cannot touch a real player's, however similar their handle looks.
 */
const RUN = `verify-${crypto.randomUUID()}`;
const created = [];

/**
 * Take this run's accounts back off the board.
 *
 * Registered against process exit as well as being awaited at the end, because
 * the run that most needs cleaning up is the one that died partway through —
 * and the first version only cleaned up after a complete pass, so an abort left
 * its games sitting on the public leaderboard.
 */
let cleaned = false;
async function cleanUp() {
  if (cleaned) return;
  cleaned = true;

  console.log('\nCLEANING UP');
  if (!SERVICE) {
    console.log('  · skipped (set SERVICE_KEY to clean up; this run left accounts behind)');
    return;
  }
  const admin = createClient(API, SERVICE, { auth: { persistSession: false } });

  // Deleting the account cascades to its profile and its games, which is what
  // takes the run back off the leaderboard. The audit trail keeps the account
  // id, by design — it is append-only, and that is the point of it.
  // An account that is already gone counts as gone: the deletion test has one
  // of these delete itself, and reporting that as a failure to clean up reads
  // as a leak when there is nothing left to leak.
  const removed = await Promise.all(
    created.map((id) =>
      admin.auth.admin
        .deleteUser(id)
        .then((r) => !r.error || /not.?found/i.test(r.error.message))
        .catch(() => false),
    ),
  );
  const lost = removed.filter((ok) => !ok).length;
  console.log(
    `  · removed ${removed.length - lost} of ${created.length} accounts this run created` +
      (lost > 0 ? ` — ${lost} COULD NOT BE REMOVED` : ''),
  );

  // And anything an earlier run abandoned. Matching on the tag rather than the
  // handle: handles are guessable and a real player could pick one.
  const { data: page } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const orphans = (page?.users ?? []).filter(
    (u) => typeof u.user_metadata?.harness_run === 'string' && !created.includes(u.id),
  );
  if (orphans.length > 0) {
    await Promise.all(orphans.map((u) => admin.auth.admin.deleteUser(u.id).catch(() => {})));
    console.log(`  · swept ${orphans.length} account(s) left behind by an earlier run`);
  }
}

// An abort is exactly when this matters, so it is not left to the happy path.
for (const signal of ['uncaughtException', 'unhandledRejection']) {
  process.on(signal, async (cause) => {
    console.error(`\n${cause instanceof Error ? cause.message : cause}`);
    await cleanUp().catch(() => {});
    process.exit(1);
  });
}

async function signIn(label, attempt = 0) {
  const sb = client();
  const { data, error } = await sb.auth.signInAnonymously({
    options: { data: { harness_run: RUN } },
  });
  if (!error) {
    created.push(data.user.id);
    return { sb, user: data.user, token: data.session.access_token };
  }

  const throttled = /rate limit/i.test(error.message);
  if (throttled && attempt < 3) {
    const wait = 15_000 * (attempt + 1);
    console.log(`  … ${label}: ${error.message}. Retrying in ${wait / 1000}s.`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return signIn(label, attempt + 1);
  }
  if (throttled) {
    throw new Error(
      `${label} sign-in failed: ${error.message}.\n\n` +
        'This is the hosted project\'s hourly cap on anonymous sign-ins for this IP, ' +
        'not a fault in the code under test. Each pass of this harness creates seven ' +
        'accounts. Wait for the window to roll over and run it again.',
    );
  }
  throw new Error(`${label} sign-in failed: ${error.message}`);
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
async function playRankedGame(
  { sb, user, token },
  { assist = false, blind = true, challengeId = null, mode = null } = {},
) {
  const idempotencyKey = crypto.randomUUID();
  const { data: session, error } = await sb
    .from('game_sessions')
    .insert({
      user_id: user.id,
      status: 'in_progress',
      idempotency_key: idempotencyKey,
      // `mode` wins where it is given: the trigger derives `blind` from it, and
      // a gameday session cannot be described by `blind` at all.
      ...(mode ? { mode } : { blind }),
      challenge_id: challengeId,
    })
    .select('id')
    .single();
  if (error) throw new Error(`session insert failed: ${error.message}`);

  const selections = [];
  const spins = [];
  const filled = new Set();
  const usedEntities = new Set();

  for (let i = 0; i < SLOTS.length; i++) {
    const spun = await call('spin', token, { gameSessionId: session.id, assist });
    if (spun.status !== 200) throw new Error(`spin ${i + 1} failed: ${JSON.stringify(spun.body)}`);
    const { franchiseId, era, sequence } = spun.body.spin;
    spins.push({ sequence, franchiseId, era });

    const open = SLOTS.filter((s) => !filled.has(s));
    // Retired cards are excluded for the same reason a real client never sees
    // one: a rebuilt dataset no longer contains it, the bundle has never heard
    // of it, and `select` refuses it (0020). Without this the harness picks a
    // card no player could pick and reports the refusal as a failure.
    const { data: cards } = await sb
      .from('season_cards')
      .select('id, entity_id, position, rating')
      .eq('franchise_id', franchiseId)
      .eq('era_key', era)
      .is('retired_at', null)
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

  return { sessionId: session.id, idempotencyKey, selections, spins };
}

console.log('\n18-0 — SERVER END-TO-END VERIFICATION\n' + '='.repeat(64));

// ---------------------------------------------------------------------------
console.log('\nHAPPY PATH');
/**
 * Mark an account as having a real identity.
 *
 * The harness signs in anonymously, and 0011 keeps anonymous accounts off the
 * board on purpose. Rather than drive a real OAuth round trip for every test
 * account, this sets the flag the view actually reads. The trigger that
 * maintains it is exercised for real in scripts/verify/linking.mjs.
 */
async function markSignedIn(who) {
  if (!SERVICE) return;
  const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
  await admin.from('profiles').update({ is_permanent: true }).eq('id', who.user.id);
}

const alice = await signIn('alice');
await markSignedIn(alice);
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

// One player, one row. The board used to keep a row per distinct roster, so a
// single good afternoon could take the whole top ten and push everyone else off
// the first screen.
const second = await playRankedGame(alice);
const secondResult = await call('complete-game', alice.token, {
  gameSessionId: second.sessionId, idempotencyKey: second.idempotencyKey,
});
const { data: afterTwo } = await alice.sb
  .from('leaderboard_rating')
  .select('final_rating').eq('user_id', alice.user.id);
check('a second season does not take a second slot',
  (afterTwo ?? []).length === 1, `${(afterTwo ?? []).length} row(s) for one player`);

// And the row it keeps is the better one, not the newer one. Both ratings come
// from the server's own responses rather than from the board being tested.
const bestPlayed = Math.max(
  Number(completion.body.result.finalRating),
  Number(secondResult.body?.result?.finalRating ?? 0),
);
const shownRating = Number(afterTwo?.[0]?.final_rating ?? 0);
check('the row it keeps is their best', Math.abs(shownRating - bestPlayed) < 1e-3,
  `board ${shownRating}, best played ${bestPlayed.toFixed(4)}`);

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
  .from('season_cards').select('id, position, entity_id')
  .is('retired_at', null)
  .order('rating', { ascending: false }).limit(400);
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
//
// The card has to be chosen *after* the spin and checked against it. This
// previously took the best card for the slot and assumed it was elsewhere,
// which is true most of the time and false exactly when the spin lands on a
// franchise-era that happens to hold one -- Indianapolis 1999-2004 has Manning
// and Harrison in it. The pick was then legitimately eligible, the server
// correctly allowed it, and the check reported a forgery hole that was not
// there. A test that fails on the roll of a die teaches you to ignore it.
const bobSpun = await call('spin', bob.token, { gameSessionId: bobGame.sessionId });
const issued = bobSpun.body.spin;

const { data: elsewhere } = await bob.sb
  .from('season_cards')
  .select('id, position')
  .not('franchise_id', 'eq', issued.franchiseId)
  .eq('position', 'QB')
  .limit(1);
const wrongBucket = elsewhere?.[0]
  ? { slot: 'QB', cardId: elsewhere[0].id }
  : null;
const offSpin = wrongBucket
  ? await call('select', bob.token, {
      gameSessionId: bobGame.sessionId, slot: wrongBucket.slot, cardId: wrongBucket.cardId,
    })
  : { status: 0, body: { error: 'no card outside the spun franchise' } };
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

// The loop the feature actually is: a link, an answer on the same wheels, and
// a result that settles itself.
const token = challenge.data?.share_token;
const invite = await bob.sb.rpc('challenge_by_token', { p_token: token });
const invited = Array.isArray(invite.data) ? invite.data[0] : invite.data;
check('someone who was sent the link can read the challenge',
  invite.error === null && Boolean(invited), invite.error?.message ?? invited?.creator_handle);
check('the link shows the score to beat', Number(invited?.creator_rating) > 0,
  String(invited?.creator_rating));
check('the link does not carry the creator\'s roster',
  invited !== undefined && invited !== null && !Object.keys(invited).some((k) => /card|roster|selection/i.test(k)),
  Object.keys(invited ?? {}).join(','));

const strangerRead = await bob.sb.from('challenges').select('id').eq('share_token', token);
check('and still cannot read the row itself', (strangerRead.data ?? []).length === 0,
  `${(strangerRead.data ?? []).length} rows`);

const ownAnswer = await alice.sb.from('game_sessions').insert({
  user_id: alice.user.id, status: 'in_progress', idempotency_key: crypto.randomUUID(),
  blind: true, challenge_id: challenge.data?.id,
}).select('id');
check('you cannot answer your own challenge', ownAnswer.error !== null,
  ownAnswer.error?.code ?? 'insert allowed');

const answer = await playRankedGame(bob, { challengeId: challenge.data?.id });
const { data: aliceSpins } = await alice.sb.from('game_spins')
  .select('sequence, franchise_id, era_key').eq('game_session_id', game.sessionId).order('sequence');
const sameWheel = (aliceSpins ?? []).length === answer.spins.length
  && (aliceSpins ?? []).every((s, i) =>
    s.franchise_id === answer.spins[i].franchiseId && s.era_key === answer.spins[i].era);
check('the answer is dealt the same seven franchise-eras', sameWheel,
  (aliceSpins ?? []).map((s) => `${s.franchise_id}:${s.era_key}`).join(' '));

const answerResult = await call('complete-game', bob.token, {
  gameSessionId: answer.sessionId,
  idempotencyKey: answer.idempotencyKey,
  selections: answer.selections,
});
check('the answer scores', answerResult.status === 200, String(answerResult.status));

const { data: settled } = await alice.sb.from('my_challenges')
  .select('status, opponent_user_id, opponent_rating, creator_rating, winner_user_id')
  .eq('id', challenge.data?.id).maybeSingle();
check('finishing the answer settles the challenge, with no client call',
  settled?.status === 'complete' && settled?.opponent_user_id === bob.user.id,
  `${settled?.status} / ${settled?.opponent_user_id === bob.user.id ? 'bob' : settled?.opponent_user_id}`);
const higher = Number(settled?.opponent_rating) > Number(settled?.creator_rating)
  ? bob.user.id
  : Number(settled?.creator_rating) > Number(settled?.opponent_rating) ? alice.user.id : null;
check('and names the higher rating as the winner', settled?.winner_user_id === higher,
  `${settled?.creator_rating} vs ${settled?.opponent_rating}`);

const bobSees = await bob.sb.from('my_challenges').select('id').eq('id', challenge.data?.id);
check('both sides can see the settled challenge', (bobSees.data ?? []).length === 1,
  `${(bobSees.data ?? []).length} rows`);

const secondAnswer = await carol.sb.from('game_sessions').insert({
  user_id: carol.user.id, status: 'in_progress', idempotency_key: crypto.randomUUID(),
  blind: true, challenge_id: challenge.data?.id,
}).select('id');
check('a settled challenge cannot be answered again', secondAnswer.error !== null,
  secondAnswer.error?.code ?? 'insert allowed');

// The assisted spin is a solo affordance. Against another player it is theft.
const duel2 = await alice.sb.from('challenges').insert({
  creator_user_id: alice.user.id, creator_game_session_id: game.sessionId,
}).select('id').single();
const cheatSession = await bob.sb.from('game_sessions').insert({
  user_id: bob.user.id, status: 'in_progress', idempotency_key: crypto.randomUUID(),
  blind: true, challenge_id: duel2.data?.id,
}).select('id').single();
const cheat = await call('spin', bob.token, {
  gameSessionId: cheatSession.data?.id, assist: true,
});
check('the assisted spin is refused inside a challenge', cheat.status === 409,
  cheat.body?.error ?? String(cheat.status));

// ---------------------------------------------------------------------------
console.log('\nAUDIT TRAIL');

// The trail is service-role only. A signed-in player is still a client.
const auditRead = await alice.sb.from('audit_events').select('id').limit(1);
check('a player cannot read the audit trail',
  auditRead.error !== null || (auditRead.data ?? []).length === 0,
  auditRead.error ? auditRead.error.code : `${(auditRead.data ?? []).length} rows visible`);

const auditWrite = await alice.sb.from('audit_events')
  .insert({ request_id: crypto.randomUUID(), event: 'forged', outcome: 'ok' }).select();
check('a player cannot write to the audit trail', auditWrite.error !== null,
  auditWrite.error ? auditWrite.error.code : 'insert accepted');

const opsRead = await alice.sb.from('ops_events_hourly').select('hour').limit(1);
check('a player cannot read operational rollups',
  opsRead.error !== null || (opsRead.data ?? []).length === 0,
  opsRead.error ? opsRead.error.code : `${(opsRead.data ?? []).length} rows visible`);

// Everything the server decided for Alice's game should be reconstructible.
if (SERVICE) {
  const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
  const { data: trail } = await admin.from('audit_events')
    .select('event, outcome, subject_id, latency_ms, request_id')
    .eq('subject_id', game.sessionId)
    .order('id', { ascending: true });
  const events = (trail ?? []).map((r) => r.event);
  check('every spin was recorded',
    events.filter((e) => e === 'spin_issued').length === SLOTS.length,
    `${events.filter((e) => e === 'spin_issued').length} of ${SLOTS.length}`);
  check('every selection was recorded',
    events.filter((e) => e === 'selection_recorded').length === SLOTS.length,
    `${events.filter((e) => e === 'selection_recorded').length} of ${SLOTS.length}`);
  check('the completion was recorded', events.includes('game_completed'));
  check('every audited event carries a request id',
    (trail ?? []).every((r) => typeof r.request_id === 'string' && r.request_id.length === 36));
  check('every audited event carries a latency',
    (trail ?? []).every((r) => Number.isInteger(r.latency_ms) && r.latency_ms >= 0));

  const rejections = await admin.from('audit_events')
    .select('event, detail').eq('outcome', 'rejected').limit(200);
  check('refusals are recorded, not just returned',
    (rejections.data ?? []).length > 0,
    `${(rejections.data ?? []).length} rejections on the trail`);

  const tamper = await admin.from('audit_events').update({ outcome: 'ok' }).eq('outcome', 'rejected').select();
  check('not even the service role can rewrite the trail', tamper.error !== null,
    tamper.error ? tamper.error.message.slice(0, 48) : 'update accepted');

  const erase = await admin.from('audit_events').delete().eq('event', 'spin_issued').select();
  check('not even the service role can erase the trail', erase.error !== null,
    erase.error ? erase.error.message.slice(0, 48) : 'delete accepted');
} else {
  console.log('  · skipped trail inspection (set SERVICE_KEY to include it)');
}

// ---------------------------------------------------------------------------
console.log('\nIDENTITY AND HANDLES');

// Unique per run: unlike the local database, a hosted one keeps yesterday's
// handles, and a verification that only passes on a fresh database is not one.
const HANDLE = `verify_${crypto.randomUUID().slice(0, 8)}`;
const claim = await alice.sb.from('profiles')
  .upsert({ id: alice.user.id, handle: HANDLE }, { onConflict: 'id' }).select();
check('a player can claim a handle', claim.error === null,
  claim.error ? claim.error.message : HANDLE);

const badHandle = await bob.sb.from('profiles')
  .upsert({ id: bob.user.id, handle: '  padded' }, { onConflict: 'id' }).select();
check('a handle cannot be padded to fake sort order', badHandle.error !== null,
  badHandle.error ? badHandle.error.code : 'accepted');

const takenHandle = await bob.sb.from('profiles')
  .upsert({ id: bob.user.id, handle: HANDLE }, { onConflict: 'id' }).select();
check('a handle cannot be taken twice', takenHandle.error !== null,
  takenHandle.error ? takenHandle.error.code : 'accepted');

// Signing up assigns a `player-<hex>` placeholder, and nobody may claim one.
const reserved = await bob.sb.from('profiles')
  .update({ handle: 'player-0123456789ab' }).eq('id', bob.user.id).select();
check('a placeholder name cannot be claimed',
  /handle_not_allowed:reserved/.test(reserved.error?.message ?? ''),
  reserved.error ? reserved.error.message.slice(0, 40) : 'accepted');

// Claiming a real name over the placeholder does not start the clock (0008),
// so this next change is the free correction — and it arms the check below.
const RENAMED = `verify_${crypto.randomUUID().slice(0, 8)}`;
const firstRename = await alice.sb.from('profiles')
  .update({ handle: RENAMED }).eq('id', alice.user.id).select();
check('the first correction is free', firstRename.error === null,
  firstRename.error ? firstRename.error.message : RENAMED);

const secondRename = await alice.sb.from('profiles')
  .update({ handle: `verify_${crypto.randomUUID().slice(0, 8)}` }).eq('id', alice.user.id).select();
check('but the second is not for a month',
  /handle_cooldown:/.test(secondRename.error?.message ?? ''),
  secondRename.error ? secondRename.error.message.slice(0, 40) : 'accepted');

// The app renders the unlock date from this, and it must come from the server:
// a client that could write it could set its own cooldown to zero.
const { data: stamp } = await alice.sb.from('profiles')
  .select('handle_set_at').eq('id', alice.user.id).maybeSingle();
check('the rename is stamped by the server', Boolean(stamp?.handle_set_at),
  `${stamp?.handle_set_at}`);

const backdate = await alice.sb.from('profiles')
  .update({ handle_set_at: '2000-01-01T00:00:00Z' }).eq('id', alice.user.id).select();
check('a player cannot wind the cooldown back', backdate.error !== null,
  backdate.error ? backdate.error.code : 'accepted');

const impersonate = await bob.sb.from('profiles')
  .upsert({ id: alice.user.id, handle: 'not_alice' }, { onConflict: 'id' }).select();
check('a player cannot write another player\'s profile',
  impersonate.error !== null || (impersonate.data ?? []).length === 0,
  impersonate.error ? impersonate.error.code : `${(impersonate.data ?? []).length} rows`);

if (SERVICE) {
  const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
  await admin.from('profiles').update({ handle_status: 'hidden' }).eq('id', alice.user.id);
  const { data: hiddenBoard } = await alice.sb.from('leaderboard_rating').select('user_id');
  check('a hidden handle is dropped from the board',
    !(hiddenBoard ?? []).some((r) => r.user_id === alice.user.id));
  await admin.from('profiles').update({ handle_status: 'ok' }).eq('id', alice.user.id);
  const { data: restored } = await alice.sb.from('leaderboard_rating').select('user_id');
  check('restoring it puts them back',
    (restored ?? []).some((r) => r.user_id === alice.user.id));
}

// ---------------------------------------------------------------------------
console.log('\nMODERATION');

const banned = await bob.sb.from('profiles')
  .upsert({ id: bob.user.id, handle: 'the admin' }, { onConflict: 'id' }).select();
check('an impersonating handle is refused at claim time', banned.error !== null,
  banned.error ? banned.error.message.slice(0, 46) : 'accepted');

// Three distinct reporters should take a name off the board on their own.
const targets = await signIn('target');
const targetHandle = `target_${crypto.randomUUID().slice(0, 8)}`;
await targets.sb.from('profiles').upsert({ id: targets.user.id, handle: targetHandle }, { onConflict: 'id' });

const self = await targets.sb.from('handle_reports').insert({
  reported_user_id: targets.user.id, reporter_user_id: targets.user.id,
  reported_handle: targetHandle, reason: 'other',
}).select();
check('you cannot report yourself', self.error !== null,
  self.error ? self.error.code : 'accepted');

// Reporting now requires standing — one completed, unassisted game — so a
// throwaway identity cannot remove anyone from the board. bob never finished a
// game and carol's only run was assisted, so neither qualifies as they are;
// they earn standing here the same way a real player would.
const standing = await Promise.all([bob, carol].map(async (who) => {
  await markSignedIn(who);
  const g = await playRankedGame(who);
  await call('complete-game', who.token, { gameSessionId: g.sessionId, idempotencyKey: g.idempotencyKey });
  return who;
}));
check('a throwaway account cannot report', await (async () => {
  const nobody = await signIn('nobody');
  const attempt = await nobody.sb.from('handle_reports').insert({
    reported_user_id: targets.user.id, reporter_user_id: nobody.user.id,
    reported_handle: targetHandle, reason: 'offensive',
  }).select();
  return attempt.error !== null;
})(), 'no completed game, no report');

const reporters = [alice, ...standing];
for (const who of reporters) {
  await who.sb.from('handle_reports').insert({
    reported_user_id: targets.user.id, reporter_user_id: who.user.id,
    reported_handle: targetHandle, reason: 'offensive',
  });
}
const duplicate = await alice.sb.from('handle_reports').insert({
  reported_user_id: targets.user.id, reporter_user_id: alice.user.id,
  reported_handle: targetHandle, reason: 'offensive',
}).select();
check('the same person cannot report a handle twice', duplicate.error !== null,
  duplicate.error ? duplicate.error.code : 'accepted');

const forged = await alice.sb.from('handle_reports').insert({
  reported_user_id: targets.user.id, reporter_user_id: bob.user.id,
  reported_handle: targetHandle, reason: 'spam',
}).select();
check('a report cannot be filed in someone else\'s name', forged.error !== null,
  forged.error ? forged.error.code : 'accepted');

const others = await alice.sb.from('handle_reports')
  .select('id').eq('reported_user_id', targets.user.id).neq('reporter_user_id', alice.user.id);
check('you cannot read other people\'s reports', (others.data ?? []).length === 0,
  `${(others.data ?? []).length} visible`);

if (SERVICE) {
  const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
  const { data: flagged } = await admin.from('profiles')
    .select('handle_status').eq('id', targets.user.id).maybeSingle();
  check('three reporters take a handle off the board by themselves',
    flagged?.handle_status === 'flagged', `status ${flagged?.handle_status}`);

  const { data: queue } = await admin.from('ops_moderation_queue')
    .select('reported_user_id, reporters').eq('reported_user_id', targets.user.id).maybeSingle();
  check('the report reaches the moderation queue', (queue?.reporters ?? 0) >= 3,
    `${queue?.reporters ?? 0} reporters`);

  await admin.rpc('moderation_dismiss', { p_user: targets.user.id });
  const { data: restored } = await admin.from('profiles')
    .select('handle_status').eq('id', targets.user.id).maybeSingle();
  check('dismissing a report puts the handle back', restored?.handle_status === 'ok');

  const { data: emptied } = await admin.from('ops_moderation_queue')
    .select('reported_user_id').eq('reported_user_id', targets.user.id).maybeSingle();
  check('and closes it out of the queue', !emptied);

  await admin.rpc('moderation_uphold', { p_user: targets.user.id });
  const { data: hidden } = await admin.from('profiles')
    .select('handle_status').eq('id', targets.user.id).maybeSingle();
  check('upholding one hides the handle', hidden?.handle_status === 'hidden');
}

// The check this harness was missing. It proved a moderator *can* hide a
// handle and never that the hidden player cannot simply undo it — which they
// could, in production, with one PostgREST call.
if (SERVICE) {
  const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
  await admin.rpc('moderation_uphold', { p_user: targets.user.id });

  const selfRestore = await targets.sb.from('profiles')
    .update({ handle_status: 'ok' }).eq('id', targets.user.id).select();
  const { data: afterRestore } = await admin.from('profiles')
    .select('handle_status').eq('id', targets.user.id).maybeSingle();
  check('a hidden player cannot restore themselves',
    afterRestore?.handle_status === 'hidden',
    `status ${afterRestore?.handle_status}${selfRestore.error ? ` (${selfRestore.error.code})` : ''}`);

  // ...nor rename their way out of a decision a human made.
  await targets.sb.from('profiles')
    .update({ handle: `escaped_${crypto.randomUUID().slice(0, 8)}` }).eq('id', targets.user.id);
  const { data: afterRename } = await admin.from('profiles')
    .select('handle_status').eq('id', targets.user.id).maybeSingle();
  check('renaming does not launder a moderator decision',
    afterRename?.handle_status === 'hidden', `status ${afterRename?.handle_status}`);

  const stamped = await targets.sb.from('profiles')
    .update({ handle_set_at: '1999-01-01T00:00:00Z' }).eq('id', targets.user.id).select();
  const { data: afterStamp } = await admin.from('profiles')
    .select('handle_set_at').eq('id', targets.user.id).maybeSingle();
  check('a player cannot backdate when they last renamed',
    new Date(afterStamp?.handle_set_at ?? 0).getFullYear() > 2000,
    stamped.error ? stamped.error.code : `${afterStamp?.handle_set_at}`);

  await admin.rpc('moderation_dismiss', { p_user: targets.user.id });
}

const queuePeek = await alice.sb.from('ops_moderation_queue').select('reported_user_id').limit(1);
check('a player cannot read the moderation queue',
  queuePeek.error !== null || (queuePeek.data ?? []).length === 0,
  queuePeek.error ? queuePeek.error.code : `${(queuePeek.data ?? []).length} rows`);

const selfClear = await targets.sb.rpc('moderation_dismiss', { p_user: targets.user.id });
check('a player cannot clear their own flag', selfClear.error !== null,
  selfClear.error ? selfClear.error.code : 'accepted');

// ---------------------------------------------------------------------------
console.log('\nACCOUNT DELETION');

const doomed = await signIn('doomed');
const doomedGame = await playRankedGame(doomed);
await call('complete-game', doomed.token, {
  gameSessionId: doomedGame.sessionId, idempotencyKey: doomedGame.idempotencyKey,
});
const deletion = await call('delete-account', doomed.token, {});
check('an account can delete itself', deletion.status === 200,
  deletion.status === 200 ? `${deletion.body.sessionsRemoved} session(s) removed` : JSON.stringify(deletion.body));

if (SERVICE) {
  const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
  const { count: leftovers } = await admin.from('game_sessions')
    .select('id', { count: 'exact', head: true }).eq('user_id', doomed.user.id);
  check('their games are gone', leftovers === 0, `${leftovers} left`);
  const { data: orphanTrail } = await admin.from('audit_events')
    .select('actor_id').eq('subject_id', doomedGame.sessionId);
  check('the trail survives the account',
    (orphanTrail ?? []).length > 0,
    `${(orphanTrail ?? []).length} events kept`);
  // The trail is append-only, so the id it recorded stays. What changes is that
  // it now points at nothing: there is no account left to resolve it to.
  const { data: resolved } = await admin.auth.admin.getUserById(doomed.user.id).catch(() => ({ data: null }));
  check('the actor id no longer resolves to an account', !resolved?.user);
}

const afterDelete = await call('spin', doomed.token, { gameSessionId: doomedGame.sessionId });
check('their token stops working', afterDelete.status === 401 || afterDelete.status === 403,
  `status ${afterDelete.status}`);

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
console.log('\nOPERATOR CONSOLE');

// The console is the one place in this system that can delete somebody else's
// account, so the negative case matters more than the positive one: a signed-in
// player who is not on the operator list must get nothing from every function,
// including the ones that only read.
const notOperator = await Promise.all([
  bob.sb.rpc('is_admin'),
  bob.sb.rpc('admin_overview'),
  bob.sb.rpc('admin_players', { p_limit: 10, p_search: null }),
  bob.sb.rpc('admin_events', { p_limit: 10, p_only_failures: false }),
]);
check('a player is not an operator', notOperator[0].data === false, String(notOperator[0].data));
check('a player reading the overview gets nothing',
  (notOperator[1].data ?? []).length === 0, `${(notOperator[1].data ?? []).length} rows`);
check('a player cannot list every account',
  (notOperator[2].data ?? []).length === 0, `${(notOperator[2].data ?? []).length} rows`);
check('a player cannot read the trail through the console',
  (notOperator[3].data ?? []).length === 0, `${(notOperator[3].data ?? []).length} rows`);

const refusedWrites = await Promise.all([
  bob.sb.rpc('admin_set_handle_status', { p_user: alice.user.id, p_status: 'hidden' }),
  bob.sb.rpc('admin_void_season', { p_session: game.sessionId, p_reason: 'nope' }),
  bob.sb.rpc('admin_delete_player', { p_user: alice.user.id, p_reason: 'nope' }),
]);
check('a player cannot hide somebody else\'s handle', refusedWrites[0].error !== null,
  refusedWrites[0].error?.code ?? 'allowed');
check('a player cannot void a season', refusedWrites[1].error !== null,
  refusedWrites[1].error?.code ?? 'allowed');
check('a player cannot delete an account', refusedWrites[2].error !== null,
  refusedWrites[2].error?.code ?? 'allowed');

const stillThere = await alice.sb.from('profiles').select('handle_status').eq('id', alice.user.id).maybeSingle();
check('and none of that touched the account it aimed at', stillThere.data?.handle_status === 'ok',
  stillThere.data?.handle_status ?? 'gone');

const adminList = await bob.sb.from('admins').select('user_id');
check('the operator list itself is invisible',
  adminList.error !== null || (adminList.data ?? []).length === 0,
  adminList.error ? adminList.error.code : `${(adminList.data ?? []).length} rows`);

// The positive case, on a throwaway account rather than a real operator's.
if (SERVICE) {
  const asRoot = createClient(API, SERVICE, { auth: { persistSession: false } });
  await asRoot.from('admins').insert({ user_id: carol.user.id, note: 'harness' });

  const overview = await carol.sb.rpc('admin_overview');
  const seen = Array.isArray(overview.data) ? overview.data[0] : overview.data;
  check('an operator sees the overview', overview.error === null && Number(seen?.players) > 0,
    overview.error?.message ?? `${seen?.players} players`);

  const roster = await carol.sb.rpc('admin_players', { p_limit: 50, p_search: null });
  check('an operator sees every player', (roster.data ?? []).length > 0,
    `${(roster.data ?? []).length} rows`);

  const trail = await carol.sb.rpc('admin_events', { p_limit: 20, p_only_failures: true });
  check('an operator sees refusals on the trail', (trail.data ?? []).length > 0,
    `${(trail.data ?? []).length} refusals`);

  // Voiding takes a season off the board without destroying it.
  //
  // The row to void is read from the board rather than assumed to be alice's
  // first game: the board keeps one row per player and it is their *best*, and
  // she plays several. Asserting on the first one passed only while it happened
  // to also be the best, which is a test that fails on a good roll.
  const onBoard = await alice.sb.from('leaderboard_rating')
    .select('game_session_id').eq('user_id', alice.user.id).maybeSingle();
  const ranked = onBoard.data?.game_session_id;
  check('alice has a season on the board to void', Boolean(ranked), ranked ?? 'none');

  await carol.sb.rpc('admin_void_season', { p_session: ranked, p_reason: 'harness' });
  const afterVoid = await alice.sb.from('leaderboard_rating')
    .select('game_session_id').eq('game_session_id', ranked);
  check('voiding a season takes it off the board', (afterVoid.data ?? []).length === 0,
    `${(afterVoid.data ?? []).length} rows after`);

  const survives = await alice.sb.from('game_sessions').select('id, voided_at').eq('id', ranked).maybeSingle();
  check('but does not destroy it', Boolean(survives.data?.voided_at), survives.data?.voided_at ?? 'no row');

  await carol.sb.rpc('admin_restore_season', { p_session: ranked });
  const restored = await alice.sb.from('leaderboard_rating')
    .select('game_session_id').eq('game_session_id', ranked);
  check('and it can be put back', (restored.data ?? []).length === 1, `${(restored.data ?? []).length} rows`);

  const selfDelete = await carol.sb.rpc('admin_delete_player', { p_user: carol.user.id });
  check('an operator cannot delete themselves from the console', selfDelete.error !== null,
    selfDelete.error?.code ?? 'allowed');

  const trailHasIt = await asRoot.from('audit_events').select('event')
    .in('event', ['admin_void_season', 'admin_restore_season']).limit(2);
  check('every operator action is on the trail', (trailHasIt.data ?? []).length === 2,
    `${(trailHasIt.data ?? []).length} of 2`);

  await asRoot.from('admins').delete().eq('user_id', carol.user.id);
  const revoked = await carol.sb.rpc('is_admin');
  check('and the list can be revoked', revoked.data === false, String(revoked.data));
}

// ---------------------------------------------------------------------------
console.log('\nWHO QUALIFIES FOR THE BOARD');

if (SERVICE) {
  const admin = createClient(API, SERVICE, { auth: { persistSession: false } });

  // Ratings on screen means the best roster is the one that reads the biggest
  // numbers, so those seasons are recorded and not ranked.
  const sighted = await signIn('sighted');
  await markSignedIn(sighted);
  const rookieGame = await playRankedGame(sighted, { blind: false });
  const rookieDone = await call('complete-game', sighted.token, {
    gameSessionId: rookieGame.sessionId, idempotencyKey: rookieGame.idempotencyKey,
  });
  check('a Rookie season still scores', rookieDone.status === 200,
    rookieDone.status === 200 ? `${rookieDone.body.result.finalRating}` : JSON.stringify(rookieDone.body));

  const { data: rookieOnBoard } = await admin.from('leaderboard_rating')
    .select('user_id').eq('user_id', sighted.user.id);
  check('but a Rookie season does not reach the board',
    (rookieOnBoard ?? []).length === 0, `${(rookieOnBoard ?? []).length} row(s)`);

  // An anonymous account is free and unlimited, so a board of them ranks
  // persistence at making accounts.
  const drifter = await signIn('drifter');
  const drifterGame = await playRankedGame(drifter);
  await call('complete-game', drifter.token, {
    gameSessionId: drifterGame.sessionId, idempotencyKey: drifterGame.idempotencyKey,
  });
  const { data: anonOnBoard } = await admin.from('leaderboard_rating')
    .select('user_id').eq('user_id', drifter.user.id);
  check('an anonymous account does not reach the board',
    (anonOnBoard ?? []).length === 0, `${(anonOnBoard ?? []).length} row(s)`);

  // ...and the promise that makes that acceptable: signing in later brings
  // everything already played onto the board, rather than starting them over.
  await markSignedIn(drifter);
  const { data: afterSignIn } = await admin.from('leaderboard_rating')
    .select('final_rating').eq('user_id', drifter.user.id);
  check('signing in brings the seasons already played onto the board',
    (afterSignIn ?? []).length === 1,
    afterSignIn?.[0] ? `now ranked at ${afterSignIn[0].final_rating}` : 'still absent');

  /**
   * Signing in on a device with no session creates the account outright, with
   * is_anonymous already false and no UPDATE to react to. 0011's trigger only
   * watched for the flip, so every player who signed in on a fresh phone got a
   * profile marked as not permanent and never reached the board -- while the
   * app showed them signed in and everything looking fine.
   */
  const fresh = `verify-${crypto.randomUUID()}@example.invalid`;
  const { data: made, error: makeErr } = await admin.auth.admin.createUser({
    email: fresh,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  check('an account created by signing in is permanent from the start',
    !makeErr && Boolean(made?.user), makeErr ? makeErr.message.slice(0, 40) : 'created');

  if (made?.user) {
    created.push(made.user.id);
    const { data: profile } = await admin.from('profiles')
      .select('is_permanent').eq('id', made.user.id).maybeSingle();
    check('...and its profile says so, without any update',
      profile?.is_permanent === true, `is_permanent=${profile?.is_permanent}`);
  }

  // The bug 0011 tripped over: the reserved-placeholder rule fired on every
  // write to a profile, so moderating anyone who had not picked a name failed.
  const unnamed = await signIn('unnamed');
  const upheld = await admin.from('profiles')
    .update({ handle_status: 'hidden' }).eq('id', unnamed.user.id).select();
  check('a player who never chose a name can still be moderated',
    upheld.error === null, upheld.error ? upheld.error.message.slice(0, 44) : 'status set');
}

// ---------------------------------------------------------------------------
console.log('\nGAMEDAY');

/**
 * Gameday needs a gameday, and there is one on about 120 days a year.
 *
 * So the harness makes one: a synthetic window open right now, over franchises
 * it picks out of the real calendar's own reference tables. That is the whole
 * reason these checks need the service role -- everything they then assert is
 * done as an ordinary client, which is the point.
 *
 * The synthetic key is prefixed rather than dated so it can never collide with
 * a real gameday, and it is deleted at the end of the block.
 */
if (!SERVICE) {
  console.log('  · skipped (needs SERVICE_KEY to open a gameday window)');
} else {
  const admin = createClient(API, SERVICE, { auth: { persistSession: false } });

  // Whether a real gameday happens to be open decides one check below, so it
  // is read before anything is inserted.
  const { data: already } = await admin.rpc('current_gameday');
  const realDayOpen = Boolean(Array.isArray(already) ? already[0]?.key : already?.key);

  const stranger = await signIn('gameday-closed');
  if (!realDayOpen) {
    const tooEarly = await stranger.sb
      .from('game_sessions')
      .insert({
        user_id: stranger.user.id,
        status: 'in_progress',
        idempotency_key: crypto.randomUUID(),
        mode: 'gameday',
      })
      .select('id');
    check('a gameday session cannot open when no gameday is', tooEarly.error !== null,
      tooEarly.error ? tooEarly.error.message.slice(0, 48) : 'IT OPENED');
  } else {
    console.log('  · a real gameday is open, so the closed-window check is not asserted');
  }

  const key = `verify-${crypto.randomUUID().slice(0, 8)}`;
  const { data: pool } = await admin
    .from('franchise_eras')
    .select('franchise_id')
    .order('franchise_id')
    .limit(200);
  // Four franchises, so the seven slots are fillable from the day's wheel.
  const franchises = [...new Set((pool ?? []).map((r) => r.franchise_id))].slice(0, 4);

  const opened = await admin.from('gamedays').insert({
    key,
    season: 2099,
    week: 1,
    game_type: 'REG',
    weekday: 'Sunday',
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  await admin
    .from('gameday_franchises')
    .insert(franchises.map((franchise_id) => ({ gameday_key: key, franchise_id })));
  check('a gameday can be opened', opened.error === null && franchises.length === 4,
    opened.error ? opened.error.message.slice(0, 48) : `${franchises.length} franchises`);

  const carol = await signIn('gameday');
  await markSignedIn(carol);

  // A client naming its own gameday would be a client entering a board that
  // has already settled. There is no insert grant on the column at all.
  const forgedDay = await carol.sb
    .from('game_sessions')
    .insert({
      user_id: carol.user.id,
      status: 'in_progress',
      idempotency_key: crypto.randomUUID(),
      mode: 'gameday',
      gameday_key: key,
    })
    .select('id');
  check('a client cannot declare its own gameday', forgedDay.error !== null,
    forgedDay.error ? forgedDay.error.message.slice(0, 48) : 'IT WAS ACCEPTED');

  const dayGame = await playRankedGame(carol, { mode: 'gameday' });
  const { data: stamped } = await carol.sb
    .from('game_sessions')
    .select('gameday_key, mode, blind')
    .eq('id', dayGame.sessionId)
    .maybeSingle();
  check('the server stamps the gameday from its own clock', stamped?.gameday_key === key,
    String(stamped?.gameday_key));
  check('a gameday season is not blind', stamped?.mode === 'gameday' && stamped?.blind === false,
    `${stamped?.mode} / blind=${stamped?.blind}`);

  const strayed = dayGame.spins.filter((s) => !franchises.includes(s.franchiseId));
  check('every spin came from a franchise playing that day', strayed.length === 0,
    strayed.length ? strayed.map((s) => s.franchiseId).join(',') : `${dayGame.spins.length} spins`);

  const dayResult = await call('complete-game', carol.token, {
    gameSessionId: dayGame.sessionId,
    idempotencyKey: dayGame.idempotencyKey,
  });
  check('a gameday season is scored like any other', dayResult.status === 200,
    String(dayResult.body.result?.finalRating));

  const { data: dayBoard } = await carol.sb.rpc('leaderboard_gameday', { p_key: key });
  const onDayBoard = (Array.isArray(dayBoard) ? dayBoard : []).some((r) => r.user_id === carol.user.id);
  check('it lands on that gameday\'s board', onDayBoard);

  // The whole reason gameday is its own mode: a two-to-twenty-six franchise
  // wheel is a different game, and it must not be ranked with the rest.
  const { data: ratingBoard } = await carol.sb.from('leaderboard_rating').select('user_id');
  const { data: pointsBoard } = await carol.sb.from('leaderboard_points').select('user_id');
  check('and on no other board',
    !(ratingBoard ?? []).some((r) => r.user_id === carol.user.id) &&
      !(pointsBoard ?? []).some((r) => r.user_id === carol.user.id));

  // The three-finger spin is a solo indulgence, and a one-day board is not one.
  const dave = await signIn('gameday-assist');
  const { data: assistSession } = await dave.sb
    .from('game_sessions')
    .insert({
      user_id: dave.user.id,
      status: 'in_progress',
      idempotency_key: crypto.randomUUID(),
      mode: 'gameday',
    })
    .select('id')
    .single();
  const rigged = await call('spin', dave.token, { gameSessionId: assistSession.id, assist: true });
  check('a rigged spin is refused on a gameday',
    rigged.status === 409 && rigged.body.error === 'assist_not_allowed_in_gameday',
    `${rigged.status} ${rigged.body.error}`);

  // A challenge replays the creator's seven spins; a gameday deals from that
  // day's franchises. Both decide the wheel, so a session may not be both --
  // and the refusal is a trigger rather than a policy, which is easy to lose.
  const bothAtOnce = await carol.sb.from('game_sessions').insert({
    user_id: carol.user.id,
    status: 'in_progress',
    idempotency_key: crypto.randomUUID(),
    mode: 'gameday',
    challenge_id: challenge.data?.id,
  }).select('id');
  check('a challenge cannot be played as a gameday', bothAtOnce.error !== null,
    bothAtOnce.error?.code ?? 'allowed');

  // The screen that has to say something before anybody has finished a season
  // reads this, so an empty answer is a blank panel on the one day it matters.
  const { data: summaryRows } = await carol.sb.rpc('gameday_summary', { p_key: key });
  const summary = Array.isArray(summaryRows) ? summaryRows[0] : summaryRows;
  check('the day has a summary to show', Number(summary?.seasons) >= 1,
    `${summary?.players} player(s), ${summary?.seasons} season(s)`);

  // Deleting the day leaves the seasons pointing at a key that is gone, which
  // is deliberate: `gameday_key` carries no foreign key precisely so that a
  // rebuilt calendar can never take real seasons with it.
  await admin.from('gamedays').delete().eq('key', key);
  const { data: orphaned } = await admin
    .from('game_sessions')
    .select('id')
    .eq('id', dayGame.sessionId)
    .maybeSingle();
  check('a season survives its gameday being deleted', Boolean(orphaned?.id));
}

// ---------------------------------------------------------------------------
console.log('\nBROWSER ORIGINS');

// These endpoints answered every origin with `*` until the allow-list landed,
// and the first attempt at fixing that pinned them to one origin — which shut
// out local web development without failing a single check here. Both halves
// are asserted, because each one on its own is a bug.
const preflight = async (origin) => {
  const res = await fetch(`${API}/functions/v1/spin`, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
  });
  return res.headers.get('access-control-allow-origin');
};

const shipped = 'https://mutaaf.github.io';
const dev = 'http://localhost:8082';

for (const [label, origin] of [['the published site', shipped], ['local web development', dev]]) {
  const allowed = await preflight(origin);
  check(`${label} is allowed through`, allowed === origin, `${allowed}`);
}

// A browser compares this against its own origin, so anything but an exact
// match — including another site's origin — is a refusal.
const stranger = await preflight('https://evil.example');
check('an unknown origin is not', stranger !== 'https://evil.example' && stranger !== '*', `${stranger}`);

// ---------------------------------------------------------------------------
await cleanUp();

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(64));
console.log(`${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
