-- Respins, proved against a database: run after every migration has applied.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/respins.sql
--
-- LOCAL OR SCRATCH DATABASES ONLY. It creates users, sessions and ledger
-- rows, and it runs inside one transaction that is rolled back at the end, so
-- a clean database is left clean -- but it is still not something to point at
-- production. Every check raises on failure, so the first broken rule stops
-- the run with its name; reaching the last line means all of them held.
--
-- What it proves (docs/respins.md):
--   1. no client role can write the ledger, and nobody can rewrite it
--   2. a player reads their own balance and rows and nobody else's
--   3. a purchase is granted once per transaction id, to its own account
--   4. a ranked respin is applied only by the server, once per season, never
--      with a zero balance, never on a spin that has a pick
--   5. a client cannot stamp `respins_used` or rewrite a spin
--   6. a casual respin is debited once per turn, once per season
--   7. boards: the ↻ column, the clean filter, the perfect board clean-only,
--      and every filter the boards already had
--   8. an anonymous player's balance moves with their seasons

\set ON_ERROR_STOP 1
begin;

create schema respins_test;
grant usage on schema respins_test to public;

-- Runs `sql` as the current role and asserts it fails with `pattern` in the
-- message. Security invoker: it fails or succeeds with the caller's rights.
create function respins_test.refuses(label text, sql text, pattern text) returns void
language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then
      raise notice 'ok   %', label;
      return;
    end if;
    raise exception 'FAIL % -- refused, but with "%" (wanted "%")', label, sqlerrm, pattern;
  end;
  raise exception 'FAIL % -- was allowed', label;
end $$;

create function respins_test.check(label text, ok boolean) returns void
language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL %', label; end if;
  raise notice 'ok   %', label;
end $$;

grant execute on all functions in schema respins_test to public;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into public.eras (key, label, start_year, end_year, sort_order)
values ('t_e1', 'E1', 1990, 1994, 1), ('t_e2', 'E2', 1995, 1999, 2)
on conflict do nothing;
insert into public.franchises (id, abbreviation, display_name, nickname)
values ('t_f1', 'TF1', 'One', 'One'), ('t_f2', 'TF2', 'Two', 'Two'), ('t_f3', 'TF3', 'Three', 'Three')
on conflict do nothing;
insert into public.season_cards (id, entity_id, entity_type, display_name, position, franchise_id, season_year, era_key, rating, rating_model_version)
values ('t_c1', 't_p1', 'player', 'P One', 'QB', 't_f1', 1991, 't_e1', 90, 't'),
       ('t_c2', 't_p2', 'player', 'P Two', 'QB', 't_f2', 1991, 't_e1', 85, 't')
on conflict do nothing;

-- Five accounts: alice and bob are permanent with handles, carl and dana are
-- anonymous, erin is permanent and moderated.
insert into auth.users (id, aud, role, email, is_anonymous) values
  ('a0000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'a@t.test', false),
  ('b0000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'b@t.test', false),
  ('c0000000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated', null, true),
  ('d0000000-0000-4000-8000-00000000000d', 'authenticated', 'authenticated', null, true),
  ('e0000000-0000-4000-8000-00000000000e', 'authenticated', 'authenticated', 'e@t.test', false);
update public.profiles set handle = 'alice-t', is_permanent = true where id = 'a0000000-0000-4000-8000-00000000000a';
update public.profiles set handle = 'bob-t', is_permanent = true where id = 'b0000000-0000-4000-8000-00000000000b';
update public.profiles set handle = 'erin-t', is_permanent = true, handle_status = 'hidden' where id = 'e0000000-0000-4000-8000-00000000000e';

-- Alice's open ranked season, one spin landed on t_f1/t_e1, nothing picked.
insert into public.game_sessions (id, user_id, idempotency_key, mode)
values ('5a000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'k-a1', 'player_iq');
insert into public.game_spins (game_session_id, sequence, franchise_id, era_key)
values ('5a000000-0000-4000-8000-000000000001', 1, 't_f1', 't_e1');

-- Bob's open season, same shape.
insert into public.game_sessions (id, user_id, idempotency_key, mode)
values ('5b000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', 'k-b1', 'player_iq');
insert into public.game_spins (game_session_id, sequence, franchise_id, era_key)
values ('5b000000-0000-4000-8000-000000000001', 1, 't_f1', 't_e1');

-- ---------------------------------------------------------------------------
-- 1. Nobody writes the ledger directly
-- ---------------------------------------------------------------------------

set local role anon;
select respins_test.refuses('anon cannot insert a grant',
  $$insert into public.entitlements (user_id, kind, delta, source, reference, product_id, environment)
    values ('a0000000-0000-4000-8000-00000000000a', 'respin', 100, 'purchase', 'apple:forged', 'x', 'Production')$$,
  'permission denied');
select respins_test.refuses('anon cannot read the ledger', $$select * from public.entitlements$$, 'permission denied');
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-00000000000a';
select respins_test.refuses('a player cannot insert a grant for themselves',
  $$insert into public.entitlements (user_id, kind, delta, source, reference, product_id, environment)
    values ('a0000000-0000-4000-8000-00000000000a', 'respin', 100, 'purchase', 'apple:forged', 'x', 'Production')$$,
  'permission denied');
select respins_test.refuses('a player cannot call the purchase grant',
  $$select public.grant_respin_purchase('a0000000-0000-4000-8000-00000000000a', '1', 'com.eighteenzerodcai.app.respins.12', 12, 'Production', null)$$,
  'permission denied');
select respins_test.refuses('a player cannot apply a respin themselves (the server draws it)',
  $$select public.apply_respin('a0000000-0000-4000-8000-00000000000a', '5a000000-0000-4000-8000-000000000001', 1, 't_f1', 't_e1', 't_f2', 't_e1')$$,
  'permission denied');
select respins_test.refuses('a player cannot read another balance directly',
  $$select public.respin_balance_of('b0000000-0000-4000-8000-00000000000b')$$, 'permission denied');
reset role;

-- ---------------------------------------------------------------------------
-- 3. Purchases: once per transaction, to its own account
-- ---------------------------------------------------------------------------

set local role service_role;
select respins_test.check('first redeem of a transaction grants it',
  (select granted and balance = 3 from public.grant_respin_purchase(
     'a0000000-0000-4000-8000-00000000000a', '2000000000000001', 'com.eighteenzerodcai.app.respins.3', 3, 'Production',
     'a0000000-0000-4000-8000-00000000000a')));
select respins_test.check('the same transaction again grants nothing more',
  (select not granted and balance = 3 from public.grant_respin_purchase(
     'a0000000-0000-4000-8000-00000000000a', '2000000000000001', 'com.eighteenzerodcai.app.respins.3', 3, 'Production',
     'a0000000-0000-4000-8000-00000000000a')));
select respins_test.refuses('another account cannot redeem the same transaction',
  $$select public.grant_respin_purchase('b0000000-0000-4000-8000-00000000000b', '2000000000000001',
      'com.eighteenzerodcai.app.respins.3', 3, 'Production', null)$$, 'already_redeemed');
select respins_test.refuses('a purchase made for one account cannot be claimed by another',
  $$select public.grant_respin_purchase('b0000000-0000-4000-8000-00000000000b', '2000000000000002',
      'com.eighteenzerodcai.app.respins.3', 3, 'Production', 'a0000000-0000-4000-8000-00000000000a')$$, 'account_mismatch');
select respins_test.check('exactly one ledger row for that transaction',
  (select count(*) = 1 from public.entitlements where reference = 'apple:2000000000000001'));
select respins_test.refuses('the service role cannot rewrite a ledger row',
  $$update public.entitlements set delta = 100 where reference = 'apple:2000000000000001'$$, 'append-only');
select respins_test.refuses('the service role cannot delete a ledger row',
  $$delete from public.entitlements where reference = 'apple:2000000000000001'$$, 'append-only');
select respins_test.refuses('nobody can truncate the ledger', $$truncate public.entitlements$$, 'permission denied');
reset role;

-- ---------------------------------------------------------------------------
-- 2. Reading: your own, nobody else's
-- ---------------------------------------------------------------------------

set local role service_role;
select public.grant_respin_purchase('b0000000-0000-4000-8000-00000000000b', '2000000000000003',
  'com.eighteenzerodcai.app.respins.12', 12, 'Sandbox', null);
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-00000000000a';
select respins_test.check('my_respins() is my balance', public.my_respins() = 3);
select respins_test.check('I see my rows and none of bob''s',
  (select bool_and(user_id = 'a0000000-0000-4000-8000-00000000000a') and count(*) = 1 from public.entitlements));
set local request.jwt.claim.sub = 'b0000000-0000-4000-8000-00000000000b';
select respins_test.check('bob sees his own balance', public.my_respins() = 12);
reset role;

-- ---------------------------------------------------------------------------
-- 5. A client cannot stamp a season clean or rewrite a spin
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-00000000000a';
select respins_test.refuses('a client cannot open a session with respins_used set',
  $$insert into public.game_sessions (user_id, idempotency_key, respins_used)
    values ('a0000000-0000-4000-8000-00000000000a', 'k-forged', 0)$$, 'permission denied');
select respins_test.refuses('a client cannot reset respins_used',
  $$update public.game_sessions set respins_used = 0 where id = '5a000000-0000-4000-8000-000000000001'$$, 'permission denied');
-- RLS has no update policy on game_spins, so the update matches no rows
-- rather than erroring: what matters is that the spin is unchanged.
update public.game_spins set franchise_id = 't_f2' where game_session_id = '5a000000-0000-4000-8000-000000000001';
reset role;
select respins_test.check('a client cannot rewrite a spin (RLS: nothing changed)',
  (select franchise_id = 't_f1' from public.game_spins where game_session_id = '5a000000-0000-4000-8000-000000000001'));
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-00000000000a';
select respins_test.refuses('a client cannot write a respin record',
  $$insert into public.game_respins (game_session_id, sequence, discarded_franchise_id, discarded_era_key, franchise_id, era_key, ledger_reference)
    values ('5a000000-0000-4000-8000-000000000001', 1, 't_f1', 't_e1', 't_f2', 't_e1', 'apple:2000000000000001')$$, 'permission denied');
reset role;

-- ---------------------------------------------------------------------------
-- 4. A ranked respin, applied by the server
-- ---------------------------------------------------------------------------

set local role service_role;
select respins_test.check('a respin is applied: balance 3 -> 2, respins_used 1',
  (select balance = 2 and respins_used = 1 from public.apply_respin(
     'a0000000-0000-4000-8000-00000000000a', '5a000000-0000-4000-8000-000000000001', 1, 't_f1', 't_e1', 't_f2', 't_e1')));
select respins_test.check('the spin now holds the replacement',
  (select franchise_id = 't_f2' and era_key = 't_e1' from public.game_spins
    where game_session_id = '5a000000-0000-4000-8000-000000000001' and sequence = 1));
select respins_test.check('the discarded spin is kept, with the ledger row that paid for it',
  (select discarded_franchise_id = 't_f1' and franchise_id = 't_f2'
          and ledger_reference = 'spend:5a000000-0000-4000-8000-000000000001:1'
     from public.game_respins where game_session_id = '5a000000-0000-4000-8000-000000000001'));
select respins_test.check('one -1 spend row for it',
  (select count(*) = 1 and sum(delta) = -1 from public.entitlements
    where reference = 'spend:5a000000-0000-4000-8000-000000000001:1'));
select respins_test.refuses('the same turn cannot be respun twice',
  $$select public.apply_respin('a0000000-0000-4000-8000-00000000000a', '5a000000-0000-4000-8000-000000000001', 1, 't_f2', 't_e1', 't_f1', 't_e1')$$,
  'respin_already_used');

-- A pick, then the next spin: the season has spent its one respin.
insert into public.game_selections (game_session_id, roster_slot, card_id, spin_sequence)
values ('5a000000-0000-4000-8000-000000000001', 'QB', 't_c2', 1);
insert into public.game_spins (game_session_id, sequence, franchise_id, era_key)
values ('5a000000-0000-4000-8000-000000000001', 2, 't_f1', 't_e2');
select respins_test.refuses('a second respin in the same season is refused (one per season)',
  $$select public.apply_respin('a0000000-0000-4000-8000-00000000000a', '5a000000-0000-4000-8000-000000000001', 2, 't_f1', 't_e2', 't_f3', 't_e2')$$,
  'respin_already_used');
select respins_test.check('and alice was not charged for it', public.respin_balance_of('a0000000-0000-4000-8000-00000000000a') = 2);

-- Bob: a spin with a pick already made from it cannot be respun.
insert into public.game_selections (game_session_id, roster_slot, card_id, spin_sequence)
values ('5b000000-0000-4000-8000-000000000001', 'QB', 't_c1', 1);
select respins_test.refuses('a spin that already has a pick cannot be respun',
  $$select public.apply_respin('b0000000-0000-4000-8000-00000000000b', '5b000000-0000-4000-8000-000000000001', 1, 't_f1', 't_e1', 't_f2', 't_e1')$$,
  'spin_already_used');
insert into public.game_spins (game_session_id, sequence, franchise_id, era_key)
values ('5b000000-0000-4000-8000-000000000001', 2, 't_f3', 't_e2');
select respins_test.refuses('only the latest spin can be respun',
  $$select public.apply_respin('b0000000-0000-4000-8000-00000000000b', '5b000000-0000-4000-8000-000000000001', 1, 't_f1', 't_e1', 't_f2', 't_e1')$$,
  'spin_not_current');
select respins_test.refuses('a respin against a spin that changed underneath it is refused',
  $$select public.apply_respin('b0000000-0000-4000-8000-00000000000b', '5b000000-0000-4000-8000-000000000001', 2, 't_f1', 't_e1', 't_f2', 't_e1')$$,
  'spin_changed');
select respins_test.refuses('a player cannot spend on someone else''s season',
  $$select public.apply_respin('b0000000-0000-4000-8000-00000000000b', '5a000000-0000-4000-8000-000000000001', 2, 't_f1', 't_e2', 't_f3', 't_e2')$$,
  'forbidden');
reset role;

-- Dana (anonymous, never bought): balance 0.
insert into public.game_sessions (id, user_id, idempotency_key, mode)
values ('5d000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000d', 'k-d1', 'rookie');
insert into public.game_spins (game_session_id, sequence, franchise_id, era_key)
values ('5d000000-0000-4000-8000-000000000001', 1, 't_f1', 't_e1');
set local role service_role;
select respins_test.refuses('a respin with a balance of 0 is refused',
  $$select public.apply_respin('d0000000-0000-4000-8000-00000000000d', '5d000000-0000-4000-8000-000000000001', 1, 't_f1', 't_e1', 't_f2', 't_e1')$$,
  'no_respins');
select respins_test.check('and the refused respin changed nothing',
  (select franchise_id = 't_f1' from public.game_spins where game_session_id = '5d000000-0000-4000-8000-000000000001')
  and (select respins_used = 0 from public.game_sessions where id = '5d000000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.entitlements where user_id = 'd0000000-0000-4000-8000-00000000000d'));
select respins_test.refuses('a respin that lands where it started is refused',
  $$select public.apply_respin('d0000000-0000-4000-8000-00000000000d', '5d000000-0000-4000-8000-000000000001', 1, 't_f1', 't_e1', 't_f1', 't_e1')$$,
  'respin_same_bucket');
reset role;

-- A challenge season replays the creator's spins and has no respins.
insert into public.game_sessions (id, user_id, idempotency_key, mode, status, final_rating, record_wins, record_losses, ending_key, roster_fingerprint, completed_at)
values ('5b000000-0000-4000-8000-0000000000c0', 'b0000000-0000-4000-8000-00000000000b', 'k-b-creator', 'player_iq', 'completed', 80, 12, 5, 'CONTENDER', 'fp-b-creator', now());
insert into public.challenges (id, creator_user_id, creator_game_session_id)
values ('c4000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', '5b000000-0000-4000-8000-0000000000c0');
insert into public.game_sessions (id, user_id, idempotency_key, mode, challenge_id)
values ('5a000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-00000000000a', 'k-a-challenge', 'player_iq', 'c4000000-0000-4000-8000-000000000001');
insert into public.game_spins (game_session_id, sequence, franchise_id, era_key)
values ('5a000000-0000-4000-8000-0000000000c1', 1, 't_f1', 't_e1');
set local role service_role;
select respins_test.refuses('no respin in a challenge',
  $$select public.apply_respin('a0000000-0000-4000-8000-00000000000a', '5a000000-0000-4000-8000-0000000000c1', 1, 't_f1', 't_e1', 't_f2', 't_e1')$$,
  'respin_not_allowed_in_challenge');
reset role;

-- ---------------------------------------------------------------------------
-- 6. Casual respins: debited once per turn, once per season
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'b0000000-0000-4000-8000-00000000000b';
select respins_test.check('a casual respin debits one', public.spend_local_respin('1763318400000', 3) = 11);
select respins_test.check('the same tap again is not charged twice', public.spend_local_respin('1763318400000', 3) = 11);
select respins_test.refuses('a second casual respin in the same season is refused',
  $$select public.spend_local_respin('1763318400000', 4)$$, 'respin_already_used');
select respins_test.check('a new season may spend its own', public.spend_local_respin('1763318499999', 1) = 10);
select respins_test.refuses('a nonsense game id is refused', $$select public.spend_local_respin('x''; drop', 1)$$, 'invalid_game');
set local request.jwt.claim.sub = 'd0000000-0000-4000-8000-00000000000d';
select respins_test.refuses('a casual respin with a balance of 0 is refused',
  $$select public.spend_local_respin('1763318400000', 1)$$, 'no_respins');
reset role;
set local role anon;
select respins_test.refuses('anon cannot spend', $$select public.spend_local_respin('1763318400000', 1)$$, 'permission denied');
reset role;

-- ---------------------------------------------------------------------------
-- 7. Boards
-- ---------------------------------------------------------------------------

-- Alice: a respun 95 and a clean 90. Bob: a clean 88, a hidden 99, an
-- assisted 99.5, a voided 99.6. Erin (moderated): a clean 99.9. Carl
-- (anonymous): a clean 99.8. A perfect respun season for alice and a perfect
-- clean one for bob.
insert into public.game_sessions (id, user_id, idempotency_key, mode, status, final_rating, record_wins, record_losses, ending_key, tier, roster_fingerprint, completed_at, respins_used, hidden_at, assisted, voided_at)
values
  ('5a000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-00000000000a', 'k-a-b1', 'player_iq', 'completed', 95,   17, 0, 'PERFECT',   'S', 'fp-a1', now(), 1, null, false, null),
  ('5a000000-0000-4000-8000-0000000000b2', 'a0000000-0000-4000-8000-00000000000a', 'k-a-b2', 'player_iq', 'completed', 90,   15, 2, 'CONTENDER', 'A', 'fp-a2', now(), 0, null, false, null),
  ('5b000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-00000000000b', 'k-b-b1', 'player_iq', 'completed', 88,   17, 0, 'PERFECT',   'A', 'fp-b1', now(), 0, null, false, null),
  ('5b000000-0000-4000-8000-0000000000b2', 'b0000000-0000-4000-8000-00000000000b', 'k-b-b2', 'player_iq', 'completed', 99,   17, 0, 'PERFECT',   'S', 'fp-b2', now(), 0, now(), false, null),
  ('5b000000-0000-4000-8000-0000000000b3', 'b0000000-0000-4000-8000-00000000000b', 'k-b-b3', 'player_iq', 'completed', 99.5, 17, 0, 'PERFECT',   'S', 'fp-b3', now(), 0, null, true, null),
  ('5b000000-0000-4000-8000-0000000000b4', 'b0000000-0000-4000-8000-00000000000b', 'k-b-b4', 'player_iq', 'completed', 99.6, 17, 0, 'PERFECT',   'S', 'fp-b4', now(), 0, null, false, now()),
  ('5e000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-00000000000e', 'k-e-b1', 'player_iq', 'completed', 99.9, 17, 0, 'PERFECT',   'S', 'fp-e1', now(), 0, null, false, null),
  ('5c000000-0000-4000-8000-0000000000b1', 'c0000000-0000-4000-8000-00000000000c', 'k-c-b1', 'player_iq', 'completed', 99.8, 17, 0, 'PERFECT',   'S', 'fp-c1', now(), 0, null, false, null);

-- A gameday, open now, with one respun and one clean season on it.
insert into public.gamedays (key, season, week, game_type, weekday, opens_at, closes_at)
values ('2099-01-01', 2099, 1, 'REG', 'Sun', now() - interval '1 hour', now() + interval '5 hours');
insert into public.game_sessions (id, user_id, idempotency_key, mode, status, final_rating, record_wins, record_losses, ending_key, tier, roster_fingerprint, completed_at, respins_used)
values
  ('5a000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-00000000000a', 'k-a-d1', 'gameday', 'completed', 97, 16, 1, 'HEARTBREAK', 'S', 'fp-a-d1', now(), 1),
  ('5b000000-0000-4000-8000-0000000000d1', 'b0000000-0000-4000-8000-00000000000b', 'k-b-d1', 'gameday', 'completed', 70, 10, 7, 'CONTENDER', 'B', 'fp-b-d1', now(), 0);

set local role anon;
select respins_test.check('the rating board shows alice''s best season, the respun 95, marked',
  (select final_rating = 95 and respun from public.leaderboard_rating where handle = 'alice-t'));
select respins_test.check('the rating board shows bob''s clean 88, unmarked',
  (select final_rating = 88 and not respun from public.leaderboard_rating where handle = 'bob-t'));
select respins_test.check('clean only: alice''s best clean season (90), not her respun one',
  (select final_rating = 90 and not respun from public.leaderboard_rating_since(null, true) where handle = 'alice-t'));
select respins_test.check('clean only holds no respun season at all',
  not exists (select 1 from public.leaderboard_rating_since(null, true) where respun));
select respins_test.check('the windowed board without clean is the marked board',
  (select final_rating = 95 and respun from public.leaderboard_rating_since(now() - interval '1 day') where handle = 'alice-t'));
select respins_test.check('existing filters intact: hidden, assisted, voided, moderated, anonymous, gameday all absent',
  not exists (select 1 from public.leaderboard_rating where final_rating in (99, 99.5, 99.6, 99.9, 99.8, 97, 70))
  and not exists (select 1 from public.leaderboard_rating_since(null) where final_rating in (99, 99.5, 99.6, 99.9, 99.8, 97, 70))
  and not exists (select 1 from public.leaderboard_rating_since(null, true) where final_rating in (99, 99.5, 99.6, 99.9, 99.8, 97, 70)));
select respins_test.check('a hidden season is off the windowed board too (put back in 0027)',
  not exists (select 1 from public.leaderboard_rating_since(now() - interval '1 day') where game_session_id = '5b000000-0000-4000-8000-0000000000b2'));
select respins_test.check('the perfect board counts clean seasons only: alice''s respun 17-0 is not there',
  coalesce((select perfect_seasons = 0 from public.leaderboard_perfect where handle = 'alice-t'), true)
  and (select perfect_seasons = 1 from public.leaderboard_perfect where handle = 'bob-t'));
select respins_test.check('points: respun seasons counted and marked; clean only drops them',
  (select seasons = 2 and respun_seasons = 1 from public.leaderboard_points where handle = 'alice-t')
  and (select seasons = 1 and respun_seasons = 0 from public.leaderboard_points_since(null, true) where handle = 'alice-t'));
-- Bob's visible seasons are the clean 88 and the challenge he created (80);
-- the hidden, assisted, voided and gameday ones are not.
select respins_test.check('points board filters intact: bob counts his two visible seasons and nothing else',
  (select seasons = 2 from public.leaderboard_points where handle = 'bob-t')
  and (select seasons = 2 from public.leaderboard_points_since(null) where handle = 'bob-t'));
select respins_test.check('gameday board: alice''s respun season marked; clean only shows bob alone',
  (select respun from public.leaderboard_gameday('2099-01-01') where handle = 'alice-t')
  and (select count(*) = 1 and bool_and(handle = 'bob-t') from public.leaderboard_gameday('2099-01-01', true)));
select respins_test.check('the old call shapes still resolve (since only, p_key only)',
  (select count(*) >= 2 from public.leaderboard_rating_since(null))
  and (select count(*) = 2 from public.leaderboard_gameday('2099-01-01')));
reset role;

-- ---------------------------------------------------------------------------
-- 8. An anonymous player's balance moves with them
-- ---------------------------------------------------------------------------

set local role service_role;
select public.grant_respin_purchase('c0000000-0000-4000-8000-00000000000c', '2000000000000009',
  'com.eighteenzerodcai.app.respins.3', 3, 'Production', 'c0000000-0000-4000-8000-00000000000c');
reset role;

-- Dana: anonymous, no seasons, a balance: there is now something to carry.
set local role service_role;
select public.grant_respin_purchase('d0000000-0000-4000-8000-00000000000d', '2000000000000010',
  'com.eighteenzerodcai.app.respins.3', 3, 'Production', null);
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd0000000-0000-4000-8000-00000000000d';
select respins_test.check('an account with respins and no completed seasons is offered the carry-over',
  (select respins = 3 and eligible from public.transferable_seasons()));
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-00000000000c';
create temp table ticket as select public.offer_season_transfer() as id;
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-4000-8000-00000000000a';
select respins_test.check('claiming moves carl''s season', public.claim_season_transfer((select id from ticket)) = 1);
select respins_test.check('and his 3 respins: alice 2 -> 5', public.my_respins() = 5);
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-00000000000c';
select respins_test.check('carl''s anonymous account is left with none', public.my_respins() = 0);
reset role;
set local role service_role;
select respins_test.check('a purchase carl made under his anonymous account can still be redeemed by alice',
  (select granted from public.grant_respin_purchase('a0000000-0000-4000-8000-00000000000a', '2000000000000011',
     'com.eighteenzerodcai.app.respins.3', 3, 'Production', 'c0000000-0000-4000-8000-00000000000c')));
select respins_test.refuses('but not by an account carl never handed anything to',
  $$select public.grant_respin_purchase('b0000000-0000-4000-8000-00000000000b', '2000000000000012',
     'com.eighteenzerodcai.app.respins.3', 3, 'Production', 'c0000000-0000-4000-8000-00000000000c')$$, 'account_mismatch');
reset role;

select respins_test.check('the limit the app shows is the limit the database enforces', public.respins_per_season() = 1);

\echo
\echo 'ALL RESPIN CHECKS PASSED'
rollback;
