-- Respins: a balance players buy, and a season that remembers spending one.
--
-- docs/respins.md is the long version. In one paragraph: a respin replaces the
-- spin that just landed, before anything is picked from it. The landed
-- franchise-era is set aside and a new one is drawn for the same turn. Packs
-- are sold through Apple in-app purchase and the balance is held here, on the
-- account, so a ranked season can spend one without the client being trusted
-- with anything (invariant 2). A season that spent one is marked on every
-- board (0027) and never reaches the perfect-season board.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT TOUCH
-- ---------------------------------------------------------------------------
--
-- Scoring. A respin changes which seven buckets a roster was built from, not
-- what the roster scores: complete-game recomputes from `game_spins` and
-- `game_selections` exactly as before, and the model version is unchanged.

-- ---------------------------------------------------------------------------
-- The limit, stated where the spend is checked
-- ---------------------------------------------------------------------------

/**
 * How many respins one season may spend.
 *
 * A function rather than a literal in `apply_respin` so the number has one
 * name in SQL. `packages/respins/test/rules.test.ts` reads this definition and
 * fails when it disagrees with RESPINS_PER_SEASON, which is what the app shows.
 */
create or replace function public.respins_per_season()
returns int
language sql immutable
as $$ select 1 $$;

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

/**
 * Every grant and every spend, never a balance column.
 *
 * The shape docs/monetization.md sketched, with `kind` kept so the next
 * consumable is a check-constraint edit rather than a second ledger. A balance
 * is `sum(delta)`; nothing stores it, so nothing can drift from the rows that
 * justify it.
 *
 * `reference` is UNIQUE and is the idempotency. A purchase is keyed by Apple's
 * transactionId, so the app re-sending an unfinished transaction on every
 * launch grants once. A spend is keyed by season and turn, so a retried respin
 * cannot be charged twice.
 *
 * `user_id` is deliberately not a foreign key, for the reason 0002 gives for
 * `audit_events.actor_id`: a cascade from a deleted account would have to
 * delete or rewrite rows the triggers below forbid touching, and account
 * deletion would fail outright. What is left after a deletion is a purchase
 * record with an id that resolves to nobody -- which is what accounting and a
 * refund dispute need, and all they get. The privacy policy says so.
 */
create table public.entitlements (
  id              bigint generated always as identity primary key,
  user_id         uuid not null,
  kind            text not null check (kind in ('respin')),
  delta           int  not null check (delta <> 0),
  source          text not null check (source in ('purchase', 'spend', 'promo', 'refund', 'transfer')),
  reference       text not null unique check (char_length(reference) between 3 and 200),
  -- Purchases: which pack, and which App Store environment granted it, so a
  -- Sandbox grant (App Review, TestFlight) is always distinguishable from a
  -- paid one.
  product_id      text,
  environment     text check (environment is null or environment in ('Production', 'Sandbox', 'Xcode', 'LocalTesting')),
  -- Spends: which season. Not a foreign key either: an abandoned session is
  -- reaped (0005) and the spend it carried is still a spend.
  game_session_id uuid,
  created_at      timestamptz not null default now(),
  check (
    (source = 'purchase' and delta > 0 and product_id is not null and environment is not null)
    or (source = 'refund' and delta < 0)
    or (source = 'spend' and delta = -1)
    or (source = 'promo' and delta > 0)
    or (source = 'transfer')
  )
);

comment on table public.entitlements is
  'Append-only ledger of respin grants and spends. Balance = sum(delta). '
  'Written only by security-definer functions; cannot be updated, deleted or '
  'truncated by anyone. See docs/respins.md.';

create index entitlements_user_idx on public.entitlements (user_id, kind, created_at desc);

create or replace function public.entitlements_are_append_only()
returns trigger
language plpgsql as $$
begin
  raise exception 'entitlements is append-only (attempted %)', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger entitlements_no_update
  before update on public.entitlements
  for each row execute function public.entitlements_are_append_only();

create trigger entitlements_no_delete
  before delete on public.entitlements
  for each row execute function public.entitlements_are_append_only();

alter table public.entitlements enable row level security;

-- A player reads their own rows, and nothing else. No insert, update or delete
-- policy exists, and the grants are gone too: every row is written by one of
-- the definer functions below, which check what a policy cannot.
create policy "own entitlements readable" on public.entitlements
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.entitlements from anon, authenticated;
grant select on public.entitlements to authenticated;
-- TRUNCATE fires no row trigger (0005 learned this for the audit trail).
revoke truncate on public.entitlements from service_role, anon, authenticated;

/** One player's balance. Internal: callers below take the lock first. */
create or replace function public.respin_balance_of(p_user uuid)
returns bigint
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(delta), 0)::bigint
  from public.entitlements
  where user_id = p_user and kind = 'respin';
$$;

revoke execute on function public.respin_balance_of(uuid) from public, anon, authenticated;

/**
 * Serialises every change to one player's balance.
 *
 * A balance check followed by an insert is a race under concurrency: two
 * respins from two devices could both see a balance of one and both spend it.
 * A transaction-scoped advisory lock on the player makes the check and the
 * debit one step, without locking a row that does not exist yet.
 */
create or replace function public.lock_respin_balance(p_user uuid)
returns void
language sql volatile
as $$ select pg_advisory_xact_lock(hashtextextended('entitlements:respin:' || p_user::text, 0)) $$;

revoke execute on function public.lock_respin_balance(uuid) from public, anon, authenticated;

/** The caller's own balance. Zero for anyone who has never bought one. */
create or replace function public.my_respins()
returns bigint
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null then 0::bigint else public.respin_balance_of(auth.uid()) end;
$$;

revoke execute on function public.my_respins() from public;
grant execute on function public.my_respins() to authenticated;

-- ---------------------------------------------------------------------------
-- The season remembers
-- ---------------------------------------------------------------------------

alter table public.game_sessions
  add column if not exists respins_used int not null default 0 check (respins_used >= 0);

comment on column public.game_sessions.respins_used is
  'How many respins this season spent. Written only by apply_respin(); there '
  'is no insert or update grant on it, so a client cannot claim a clean season.';

-- Readable like every other result column; never writable by a client (0001
-- grants insert on a named column list, and this is not on it).
grant select (respins_used) on public.game_sessions to anon, authenticated;

/**
 * Every spin a respin set aside, and what replaced it.
 *
 * The replacement is written over the row in `game_spins` rather than beside
 * it, and that is deliberate. Four readers key a spin by (session, sequence) --
 * `spin` counts them, `select` takes the latest, `complete-game` maps picks to
 * them and a challenge replays them -- and a second row at the same sequence
 * would be a fifth thing for each of them to get right. So `game_spins` stays
 * "the spins this roster was built from", and the discarded one is kept here,
 * with the ledger row that paid for it, and on the audit trail.
 */
create table public.game_respins (
  id                   bigint generated always as identity primary key,
  game_session_id      uuid not null references public.game_sessions(id) on delete cascade,
  sequence             int  not null,
  discarded_franchise_id text not null references public.franchises(id),
  discarded_era_key      text not null references public.eras(key),
  franchise_id         text not null references public.franchises(id),
  era_key              text not null references public.eras(key),
  ledger_reference     text not null references public.entitlements(reference),
  created_at           timestamptz not null default now(),
  unique (game_session_id, sequence),
  check ((discarded_franchise_id, discarded_era_key) is distinct from (franchise_id, era_key))
);

create trigger game_respins_no_update
  before update on public.game_respins
  for each row execute function public.entitlements_are_append_only();

alter table public.game_respins enable row level security;

-- Readable on exactly the terms its spins are (0001): your own, or anyone's
-- finished season.
create policy "respins readable with their spins" on public.game_respins
  for select using (
    exists (select 1 from public.game_sessions g
            where g.id = game_session_id and (g.status = 'completed' or g.user_id = auth.uid()))
  );

revoke all on public.game_respins from anon, authenticated;
grant select on public.game_respins to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Spending one in a ranked season
-- ---------------------------------------------------------------------------

/**
 * Replace a ranked season's current spin, and pay for it, in one transaction.
 *
 * Called only by the `respin` Edge Function, with the service role, after it
 * has drawn the replacement with the same code and the same candidates a
 * normal spin uses. Everything that decides whether the respin is allowed is
 * checked here, under locks, rather than there: the function cannot be called
 * twice into a state the second call would not have allowed.
 *
 *   the season is the caller's, open, and not a challenge (a duel replays the
 *     creator's seven spins; replacing one is no longer the same duel)
 *   the spin named is the latest, nothing has been picked from it, and it is
 *     still the franchise-era the function drew against (a race otherwise)
 *   the season has respins left (`respins_per_season()`)
 *   the player's balance is at least one
 *
 * Errors are raised with the reason as the message, which the Edge Function
 * hands back to the app as `{ error: reason }` like every other refusal.
 */
create or replace function public.apply_respin(
  p_user            uuid,
  p_session         uuid,
  p_sequence        int,
  p_from_franchise  text,
  p_from_era        text,
  p_to_franchise    text,
  p_to_era          text
)
returns table (balance bigint, respins_used int)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_session  public.game_sessions%rowtype;
  v_spin     public.game_spins%rowtype;
  v_latest   int;
  v_balance  bigint;
  v_ref      text := 'spend:' || p_session::text || ':' || p_sequence::text;
begin
  -- The session row is the season-level lock: two respins on one season queue.
  select * into v_session from public.game_sessions where id = p_session for update;
  if not found then raise exception 'unknown_session'; end if;
  if v_session.user_id <> p_user then raise exception 'forbidden'; end if;
  if v_session.status <> 'in_progress' then raise exception 'already_completed'; end if;
  if v_session.challenge_id is not null then raise exception 'respin_not_allowed_in_challenge'; end if;
  if v_session.respins_used >= public.respins_per_season() then raise exception 'respin_already_used'; end if;

  select max(sequence) into v_latest from public.game_spins where game_session_id = p_session;
  if v_latest is null then raise exception 'spin_first'; end if;
  if p_sequence <> v_latest then raise exception 'spin_not_current'; end if;

  select * into v_spin from public.game_spins
   where game_session_id = p_session and sequence = p_sequence
   for update;
  if exists (select 1 from public.game_selections
              where game_session_id = p_session and spin_sequence = p_sequence) then
    raise exception 'spin_already_used';
  end if;
  if v_spin.franchise_id <> p_from_franchise or v_spin.era_key <> p_from_era then
    raise exception 'spin_changed';
  end if;
  if p_to_franchise = p_from_franchise and p_to_era = p_from_era then
    raise exception 'respin_same_bucket';
  end if;

  perform public.lock_respin_balance(p_user);
  v_balance := public.respin_balance_of(p_user);
  if v_balance < 1 then raise exception 'no_respins'; end if;

  insert into public.entitlements (user_id, kind, delta, source, reference, game_session_id)
  values (p_user, 'respin', -1, 'spend', v_ref, p_session);

  insert into public.game_respins (
    game_session_id, sequence, discarded_franchise_id, discarded_era_key,
    franchise_id, era_key, ledger_reference
  ) values (
    p_session, p_sequence, p_from_franchise, p_from_era, p_to_franchise, p_to_era, v_ref
  );

  update public.game_spins
     set franchise_id = p_to_franchise, era_key = p_to_era
   where id = v_spin.id;

  update public.game_sessions
     set respins_used = v_session.respins_used + 1
   where id = p_session;

  return query select v_balance - 1, v_session.respins_used + 1;
end $$;

revoke execute on function public.apply_respin(uuid, uuid, int, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_respin(uuid, uuid, int, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Spending one in a season the server never saw
-- ---------------------------------------------------------------------------

/**
 * Pay for a respin in a casual season, or a ranked one that fell back offline.
 *
 * The spin itself is local -- that season's wheel has always turned on the
 * device, and nothing it produces reaches a board -- so all the server does is
 * debit the balance it holds. Still a definer function rather than an insert
 * grant: the per-season limit and the balance are checked here, under the
 * player's lock, and the reference makes a retried tap free.
 *
 * Returns the balance after the spend. A repeat of a spend already recorded
 * returns the balance without charging again.
 */
create or replace function public.spend_local_respin(p_game text, p_sequence int)
returns bigint
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_ref     text;
  v_prefix  text;
  v_balance bigint;
begin
  if v_user is null then raise exception 'unauthenticated' using errcode = '42501'; end if;
  if p_game is null or p_game !~ '^[A-Za-z0-9_-]{6,64}$' then raise exception 'invalid_game'; end if;
  if p_sequence is null or p_sequence < 1 or p_sequence > 7 then raise exception 'invalid_sequence'; end if;

  v_prefix := 'spend-local:' || p_game || ':';
  v_ref := v_prefix || p_sequence::text;

  perform public.lock_respin_balance(v_user);

  if exists (select 1 from public.entitlements where reference = v_ref and user_id = v_user) then
    return public.respin_balance_of(v_user);
  end if;
  if (select count(*) from public.entitlements
       where user_id = v_user and source = 'spend' and starts_with(reference, v_prefix))
     >= public.respins_per_season() then
    raise exception 'respin_already_used';
  end if;

  v_balance := public.respin_balance_of(v_user);
  if v_balance < 1 then raise exception 'no_respins'; end if;

  insert into public.entitlements (user_id, kind, delta, source, reference)
  values (v_user, 'respin', -1, 'spend', v_ref);

  return v_balance - 1;
end $$;

revoke execute on function public.spend_local_respin(text, int) from public, anon;
grant execute on function public.spend_local_respin(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Granting a purchase
-- ---------------------------------------------------------------------------

/**
 * Credit a verified App Store purchase, once.
 *
 * Called only by the `redeem-purchase` Edge Function, after it has verified
 * the StoreKit 2 JWS against Apple's root and checked the bundle, product,
 * environment and revocation. This function decides only who gets it.
 *
 * `p_token` is the purchase's appAccountToken, which the app sets to the
 * account id it was signed in as when it bought. A different caller may claim
 * it only if that account handed its seasons to this one (0022): an anonymous
 * player who buys and then signs in has an unfinished transaction that names
 * the account they left. Anyone else is refused, so a JWS lifted from someone
 * else's device is worth nothing.
 *
 * Idempotent on the transaction id. A repeat by the same player reports
 * `granted = false` and the balance, and the app finishes the transaction; a
 * repeat by somebody else is refused.
 */
create or replace function public.grant_respin_purchase(
  p_user           uuid,
  p_transaction_id text,
  p_product_id     text,
  p_respins        int,
  p_environment    text,
  p_token          uuid
)
returns table (granted boolean, balance bigint)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_ref    text := 'apple:' || p_transaction_id;
  v_holder uuid;
begin
  if p_respins is null or p_respins < 1 then raise exception 'invalid_grant'; end if;

  if p_token is not null and p_token <> p_user and not exists (
    select 1 from public.season_transfers t
     where t.from_user = p_token and t.to_user = p_user and t.claimed_at is not null
  ) then
    raise exception 'account_mismatch';
  end if;

  perform public.lock_respin_balance(p_user);

  select user_id into v_holder from public.entitlements where reference = v_ref;
  if v_holder is not null then
    if v_holder <> p_user then raise exception 'already_redeemed'; end if;
    return query select false, public.respin_balance_of(p_user);
    return;
  end if;

  insert into public.entitlements (user_id, kind, delta, source, reference, product_id, environment)
  values (p_user, 'respin', p_respins, 'purchase', v_ref, p_product_id, p_environment);

  return query select true, public.respin_balance_of(p_user);
end $$;

revoke execute on function public.grant_respin_purchase(uuid, text, text, int, text, uuid) from public, anon, authenticated;
grant execute on function public.grant_respin_purchase(uuid, text, text, int, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- An anonymous player's balance follows them when they sign in
-- ---------------------------------------------------------------------------
--
-- 0022 moves seasons from an anonymous account to the one its owner signs in
-- to. A balance has to move with them: respins bought while anonymous are the
-- player's, not the throwaway account's, and leaving them behind would be
-- selling something and then losing it on the player's behalf.
--
-- All three functions restated in full from 0022, the version in force, with
-- the respin balance added. The transfer moves the balance as two ledger rows
-- (out of one account, into the other) under a reference built from the
-- ticket, so the ledger stays append-only and a replayed claim moves nothing.

alter table public.season_transfers
  add column if not exists respins bigint not null default 0;

drop function if exists public.transferable_seasons();

/**
 * How many of the caller's seasons would move, and whether they may be moved.
 *
 * Called before offering the choice, because "bring your seasons with you" is
 * a promise and an account with nothing to bring should not be shown it.
 * `respins` is the balance that would move with them (0026).
 */
create or replace function public.transferable_seasons()
returns table (seasons int, eligible boolean, respins bigint)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(count(g.id) filter (
      where g.status = 'completed' and g.voided_at is null
    ), 0)::int,
    -- Only an anonymous account may give its seasons away. A permanent one
    -- signing into a different permanent one is an account merge, which is a
    -- different feature with different consequences and no undo.
    coalesce(bool_and(u.is_anonymous), false),
    greatest(public.respin_balance_of(auth.uid()), 0)
  from auth.users u
  left join public.game_sessions g on g.user_id = u.id
  where u.id = auth.uid();
$$;

revoke execute on function public.transferable_seasons() from public;
grant execute on function public.transferable_seasons() to authenticated;

/**
 * Offer this account's seasons to whoever the player signs in as next.
 *
 * Must be called while still holding the anonymous account's session. Any
 * earlier unclaimed ticket from the same account is expired first, so there is
 * never more than one live offer and an abandoned attempt cannot be picked up
 * later by someone else's claim.
 *
 * An account with no seasons but a respin balance has something to carry too
 * (0026), so "nothing to carry" now means neither.
 */
create or replace function public.offer_season_transfer()
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_anon boolean;
  v_count int;
  v_respins bigint;
  v_ticket uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select u.is_anonymous into v_anon from auth.users u where u.id = v_user;
  if v_anon is not true then
    raise exception 'only an anonymous account may hand over its seasons'
      using errcode = '42501';
  end if;

  select count(*) into v_count
    from public.game_sessions
   where user_id = v_user and status = 'completed' and voided_at is null;

  v_respins := greatest(public.respin_balance_of(v_user), 0);

  if v_count = 0 and v_respins = 0 then
    raise exception 'nothing to carry' using errcode = '42501';
  end if;

  update public.season_transfers
     set expires_at = now()
   where from_user = v_user and claimed_at is null and expires_at > now();

  insert into public.season_transfers (from_user, seasons, respins)
  values (v_user, v_count, v_respins)
  returning id into v_ticket;

  insert into public.audit_events (request_id, actor_id, event, outcome, subject_type, subject_id, detail)
  values (gen_random_uuid(), v_user, 'season_transfer_offered', 'ok', 'season_transfer',
          v_ticket::text, jsonb_build_object('seasons', v_count, 'respins', v_respins));

  return v_ticket;
end $$;

revoke execute on function public.offer_season_transfer() from public;
grant execute on function public.offer_season_transfer() to authenticated;

/**
 * Take the seasons named by a ticket onto the calling account.
 *
 * Returns how many actually moved, which is not always the number the ticket
 * was minted for: a season is skipped if the receiving account already holds
 * one with the same idempotency key, because that pair is unique per user and
 * the alternative to skipping is the whole claim failing over a collision that
 * means the two accounts already have the same season.
 *
 * The respin balance moves too (0026): whatever the account being left holds
 * at claim time, not at offer time, so a respin spent in between is not
 * carried twice.
 */
create or replace function public.claim_season_transfer(p_ticket uuid)
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_from uuid;
  v_moved int;
  v_respins bigint;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Locked, so two tabs finishing the same sign-in cannot both claim it.
  select from_user into v_from
    from public.season_transfers
   where id = p_ticket
     and claimed_at is null
     and expires_at > now()
   for update;

  if v_from is null then
    raise exception 'that transfer has expired or was already used'
      using errcode = '42501';
  end if;

  if v_from = v_user then
    raise exception 'those seasons are already on this account' using errcode = '42501';
  end if;

  -- Re-checked at claim time rather than trusted from minting: the account
  -- could have become permanent in between, and a permanent account's seasons
  -- are not something a stale ticket gets to move.
  if (select u.is_anonymous from auth.users u where u.id = v_from) is not true then
    raise exception 'that account is no longer anonymous' using errcode = '42501';
  end if;

  with moved as (
    update public.game_sessions g
       set user_id = v_user
     where g.user_id = v_from
       and g.status = 'completed'
       and g.voided_at is null
       and not exists (
         select 1 from public.game_sessions mine
          where mine.user_id = v_user
            and mine.idempotency_key = g.idempotency_key
       )
    returning 1
  )
  select count(*)::int into v_moved from moved;

  -- Both balances locked, in a fixed order so two crossing claims cannot
  -- deadlock each other.
  if v_from < v_user then
    perform public.lock_respin_balance(v_from);
    perform public.lock_respin_balance(v_user);
  else
    perform public.lock_respin_balance(v_user);
    perform public.lock_respin_balance(v_from);
  end if;
  v_respins := greatest(public.respin_balance_of(v_from), 0);
  if v_respins > 0 then
    insert into public.entitlements (user_id, kind, delta, source, reference)
    values (v_from, 'respin', -v_respins, 'transfer', 'transfer-out:' || p_ticket::text),
           (v_user, 'respin',  v_respins, 'transfer', 'transfer-in:'  || p_ticket::text);
  end if;

  update public.season_transfers
     set claimed_at = now(), to_user = v_user, seasons = v_moved, respins = v_respins
   where id = p_ticket;

  insert into public.audit_events (request_id, actor_id, event, outcome, subject_type, subject_id, detail)
  values (gen_random_uuid(), v_user, 'season_transfer_claimed', 'ok', 'season_transfer',
          p_ticket::text,
          jsonb_build_object('from', v_from, 'to', v_user, 'seasons', v_moved, 'respins', v_respins));

  return v_moved;
end $$;

revoke execute on function public.claim_season_transfer(uuid) from public;
grant execute on function public.claim_season_transfer(uuid) to authenticated;
