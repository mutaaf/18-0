/**
 * Prove that signing in does not cost a player their ranked history.
 *
 * This is the one thing the social login work could get wrong in a way nobody
 * notices until it has already happened: `signInWithIdToken` is the obvious
 * call, it returns a *different* user, and the anonymous account holding every
 * ranked season the player earned is left behind with no route back to it.
 *
 *   node scripts/verify/linking.mjs seed     # make an account with history
 *   node scripts/verify/linking.mjs check <user-id>
 *   node scripts/verify/linking.mjs clean <user-id>
 *
 * `seed` prints a session to paste into the browser, because the middle step is
 * a real OAuth round trip and a person has to click Continue. `check` reads the
 * result out of the database rather than out of the app, so a UI that merely
 * looks right cannot pass it.
 */
import { createClient } from '@supabase/supabase-js';

const API = process.env.API_URL;
const ANON = process.env.ANON_KEY;
const SERVICE = process.env.SERVICE_KEY;
const FUNCTIONS = `${API}/functions/v1`;

const SLOTS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1', 'DEF'];
const SLOT_POSITION = { QB: 'QB', RB1: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR', TE1: 'TE', DEF: 'DEF' };

const call = async (fn, token, body) => {
  const res = await fetch(`${FUNCTIONS}/${fn}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function seed() {
  const sb = createClient(API, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInAnonymously({
    options: { data: { harness_run: 'linking-test' } },
  });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  const { user, session } = data;
  const token = session.access_token;

  const handle = `linktest_${crypto.randomUUID().slice(0, 6)}`;
  await sb.from('profiles').update({ handle }).eq('id', user.id);

  const idempotencyKey = crypto.randomUUID();
  const { data: game, error: gameErr } = await sb
    .from('game_sessions')
    .insert({ user_id: user.id, status: 'in_progress', idempotency_key: idempotencyKey })
    .select('id').single();
  if (gameErr) throw new Error(`session insert failed: ${gameErr.message}`);

  const filled = new Set();
  const used = new Set();
  for (let i = 0; i < SLOTS.length; i++) {
    const spun = await call('spin', token, { gameSessionId: game.id });
    if (spun.status !== 200) throw new Error(`spin failed: ${JSON.stringify(spun.body)}`);
    const { franchiseId, era } = spun.body.spin;
    const open = SLOTS.filter((s) => !filled.has(s));
    const { data: cards } = await sb.from('season_cards')
      .select('id, entity_id, position, rating')
      .eq('franchise_id', franchiseId).eq('era_key', era)
      .in('position', [...new Set(open.map((s) => SLOT_POSITION[s]))])
      .order('rating', { ascending: false });
    const card = (cards ?? []).find((c) => !used.has(c.entity_id));
    if (!card) throw new Error('no playable card');
    const slot = open.find((s) => SLOT_POSITION[s] === card.position);
    const picked = await call('select', token, { gameSessionId: game.id, slot, cardId: card.id });
    if (picked.status !== 200) throw new Error(`select failed: ${JSON.stringify(picked.body)}`);
    filled.add(slot); used.add(card.entity_id);
  }
  const done = await call('complete-game', token, { gameSessionId: game.id, idempotencyKey });
  if (done.status !== 200) throw new Error(`complete failed: ${JSON.stringify(done.body)}`);

  console.log(JSON.stringify({
    userId: user.id,
    handle,
    rating: done.body.result.finalRating,
    record: done.body.result.record,
    storageKey: `sb-${new URL(API).hostname.split('.')[0]}-auth-token`,
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: 'bearer',
      user,
    },
  }, null, 2));
}

async function check(userId) {
  const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
  let failed = 0;
  const ok = (label, pass, detail = '') => {
    console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? `  — ${detail}` : ''}`);
    if (!pass) failed++;
  };

  const { data: got } = await admin.auth.admin.getUserById(userId);
  const u = got?.user;
  ok('the account still exists under the same id', Boolean(u), userId);
  if (!u) { process.exit(1); }

  const providers = (u.identities ?? []).map((i) => i.provider);
  ok('a social identity is attached', providers.some((p) => p !== 'anonymous'), providers.join(', '));
  ok('it is no longer anonymous', u.is_anonymous === false, `is_anonymous=${u.is_anonymous}`);
  ok('an email address came back from the provider', Boolean(u.email), u.email ? 'present' : 'none');

  const { data: rows } = await admin.from('leaderboard_rating')
    .select('handle, final_rating, record_wins, record_losses').eq('user_id', userId);
  ok('the ranked season is still on the board under this account',
    (rows ?? []).length === 1,
    rows?.[0] ? `${rows[0].handle} ${rows[0].record_wins}-${rows[0].record_losses} @ ${rows[0].final_rating}` : 'no row');

  // The failure this whole design exists to prevent: a second account holding
  // the same provider, with the first one orphaned and its history stranded.
  const { data: page } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const sameEmail = (page?.users ?? []).filter((o) => u.email && o.email === u.email);
  ok('sign-in did not create a second account', sameEmail.length === 1,
    `${sameEmail.length} account(s) with that email`);

  console.log(failed === 0
    ? '\nSigning in kept the history.\n'
    : `\n${failed} problem(s): signing in did NOT behave as designed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

async function clean(userId) {
  const admin = createClient(API, SERVICE, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.deleteUser(userId);
  // Deleting the account also releases the provider identity, so the same
  // Google or Apple account can be used again for a real sign-in afterwards.
  console.log(error ? `could not delete: ${error.message}` : `deleted ${userId}`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'seed') await seed();
else if (cmd === 'check') await check(arg);
else if (cmd === 'clean') await clean(arg);
else { console.error('usage: linking.mjs seed | check <user-id> | clean <user-id>'); process.exit(2); }
