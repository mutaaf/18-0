/**
 * Carrying seasons from an anonymous account to the one you sign in to.
 *
 *   node scripts/verify/transfer.mjs
 *
 * Every check here is about a rule the migration claims and a policy cannot
 * express, which is why the functions are `security definer` in the first
 * place: who may hand seasons over, who may take them, and how many times.
 *
 * Sessions are inserted with the service role rather than played. This file is
 * testing the transfer, not the game -- `e2e.mjs` plays real ranked seasons and
 * would take minutes to set up two accounts' worth of history here.
 */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
/**
 * The same three variables `e2e.mjs` takes, from the same place.
 *
 *   set -a; . .local/hosted.env; set +a; node scripts/verify/transfer.mjs
 */
function env() {
  const url = process.env.API_URL;
  const anon = process.env.ANON_KEY;
  const service = process.env.SERVICE_KEY;
  if (!url || !anon || !service) {
    throw new Error(
      'Missing API_URL, ANON_KEY or SERVICE_KEY.\n\n' +
        'Run it the way e2e.mjs is run:\n' +
        '  set -a; . .local/hosted.env; set +a; node scripts/verify/transfer.mjs',
    );
  }
  return { url, anon, service };
}

const { url, anon, service } = env();

/**
 * Make an account permanent, the way signing in does.
 *
 * Not through the admin API: `updateUserById` will happily attach an email and
 * confirm it and `is_anonymous` stays true -- GoTrue only clears that flag when
 * an identity is linked through a real auth flow. Asserting against the admin
 * API therefore tests nothing, and the first version of this file passed a
 * check it was not exercising.
 *
 * `is_anonymous` is what `0011` keys `profiles.is_permanent` off and what the
 * transfer functions read, so the honest way to test the rule is to set it.
 */
function makePermanent(userId) {
  const dsn = process.env.DB_URL;
  if (!dsn) return false;
  execFileSync('psql', [dsn, '-tAc', `update auth.users set is_anonymous = false where id = '${userId}'`], {
    stdio: 'pipe',
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? '' },
  });
  return true;
}
const admin = createClient(url, service, { auth: { persistSession: false } });

const RUN = `transfer-${Date.now()}`;
const created = [];
let failures = 0;

function check(what, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${what}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function anonUser(label) {
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInAnonymously({
    options: { data: { harness_run: RUN } },
  });
  if (error) throw new Error(`${label}: ${error.message}`);
  created.push(data.user.id);
  return { sb, id: data.user.id };
}

/** A completed season, inserted rather than played. */
async function season(userId, rating) {
  const { error } = await admin.from('game_sessions').insert({
    user_id: userId,
    status: 'completed',
    completed_at: new Date().toISOString(),
    final_rating: rating,
    record_wins: 12,
    record_losses: 6,
    ending_key: 'GOOD',
    tier: 'B',
    assisted: false,
    idempotency_key: `${RUN}-${userId}-${rating}-${Math.random()}`,
    roster_fingerprint: `${RUN}-${rating}`,
  });
  if (error) throw new Error(`seeding a season failed: ${error.message}`);
}

async function ownedBy(userId) {
  const { count } = await admin
    .from('game_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  return count ?? 0;
}

async function cleanUp() {
  await Promise.all(created.map((id) => admin.auth.admin.deleteUser(id).catch(() => {})));
}

for (const signal of ['uncaughtException', 'unhandledRejection']) {
  process.on(signal, async (cause) => {
    console.error(`\n${cause instanceof Error ? cause.message : cause}`);
    await cleanUp().catch(() => {});
    process.exit(1);
  });
}

console.log('\n18-0 — CARRYING SEASONS ACROSS');
console.log('='.repeat(64));

const alice = await anonUser('alice');
const bob = await anonUser('bob');
await season(alice.id, 81.5);
await season(alice.id, 74.25);

console.log('\nWHAT CAN BE CARRIED');
{
  const { data } = await alice.sb.rpc('transferable_seasons');
  const row = Array.isArray(data) ? data[0] : data;
  check('an anonymous account counts its completed seasons', Number(row?.seasons) === 2, `${row?.seasons}`);
  check('and is allowed to hand them over', row?.eligible === true);
}
{
  const { data } = await bob.sb.rpc('transferable_seasons');
  const row = Array.isArray(data) ? data[0] : data;
  check('an account with no seasons offers nothing', Number(row?.seasons) === 0);
}

console.log('\nMINTING');
let ticket = null;
{
  const { data, error } = await alice.sb.rpc('offer_season_transfer');
  ticket = data;
  check('the account being left can mint a ticket', Boolean(data) && !error, error?.message ?? '');
}
{
  const { error } = await bob.sb.rpc('offer_season_transfer');
  check('an account with nothing to carry cannot', Boolean(error), error?.message ?? 'no error');
}
{
  // A second offer must retire the first, or an abandoned attempt stays live.
  const { data: second } = await alice.sb.rpc('offer_season_transfer');
  const { error } = await bob.sb.rpc('claim_season_transfer', { p_ticket: ticket });
  check('minting again retires the previous ticket', Boolean(error), error?.message ?? 'no error');
  ticket = second;
}

console.log('\nCLAIMING');
{
  const { error } = await alice.sb.rpc('claim_season_transfer', { p_ticket: ticket });
  check('you cannot claim your own ticket', Boolean(error), error?.message ?? 'no error');
}
{
  const { data, error } = await bob.sb.rpc('claim_season_transfer', { p_ticket: ticket });
  check('the account signed in to takes the seasons', Number(data) === 2 && !error, `moved ${data}`);
  check('they left the account that gave them up', (await ownedBy(alice.id)) === 0);
  check('and arrived on the one that claimed', (await ownedBy(bob.id)) === 2);
}
{
  const { error } = await bob.sb.rpc('claim_season_transfer', { p_ticket: ticket });
  check('a ticket is worth exactly one transfer', Boolean(error), error?.message ?? 'no error');
}

console.log('\nWHAT A TICKET MAY NOT DO');
{
  const carol = await anonUser('carol');
  await season(carol.id, 90.1);
  const { data: t } = await carol.sb.rpc('offer_season_transfer');

  // Expiring it by hand is the only way to test the window without waiting
  // half an hour, and the service role is the only thing that can reach the
  // table -- every grant on it was revoked.
  await admin.from('season_transfers').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', t);
  const { error } = await bob.sb.rpc('claim_season_transfer', { p_ticket: t });
  check('an expired ticket is refused', Boolean(error), error?.message ?? 'no error');
  check('and the seasons stayed put', (await ownedBy(carol.id)) === 1);
}
{
  const dave = await anonUser('dave');
  await season(dave.id, 66.0);
  const { data: stale } = await dave.sb.rpc('offer_season_transfer');

  if (!makePermanent(dave.id)) {
    console.log('  · skipped the permanent-account rules: set DB_URL and PGPASSWORD to test them');
  } else {
    const { error } = await bob.sb.rpc('claim_season_transfer', { p_ticket: stale });
    check('a ticket from an account that became permanent is refused', Boolean(error), error?.message ?? 'no error');
    check('and those seasons stayed put too', (await ownedBy(dave.id)) === 1);

    const { error: offerError } = await dave.sb.rpc('offer_season_transfer');
    check(
      'a permanent account cannot mint one at all',
      /anonymous/i.test(offerError?.message ?? ''),
      offerError?.message ?? 'no error',
    );

    const { data } = await dave.sb.rpc('transferable_seasons');
    const row = Array.isArray(data) ? data[0] : data;
    check('and does not advertise its seasons as carryable', row?.eligible === false);
  }
}
{
  const { error } = await bob.sb.rpc('claim_season_transfer', {
    p_ticket: '00000000-0000-0000-0000-000000000000',
  });
  check('an invented ticket is refused', Boolean(error), error?.message ?? 'no error');
}

console.log('\nTHE RACE THE CLIENT HAS TO SURVIVE');
{
  // On web the session is parsed out of the redirect *after* the account screen
  // mounts, so the first claim can arrive with no `auth.uid()` at all. The
  // client keeps the ticket and retries when that happens, and it decides which
  // failures are worth retrying by reading the message -- so the message is
  // part of the contract, not an implementation detail.
  const stranger = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await stranger.rpc('claim_season_transfer', {
    p_ticket: '00000000-0000-0000-0000-000000000000',
  });
  check(
    'a claim with no session says so, so the client knows to try again',
    /unauthenticated/i.test(error?.message ?? ''),
    error?.message ?? 'no error',
  );
}

console.log('\nTHE TABLE ITSELF');
{
  const { error } = await bob.sb.from('season_transfers').select('id').limit(1);
  check('nobody can read the tickets directly', Boolean(error), error?.message ?? 'no error');
}

await cleanUp();

console.log('\n' + '='.repeat(64));
console.log(failures === 0 ? 'Seasons carry across, and only the way they are meant to.' : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
