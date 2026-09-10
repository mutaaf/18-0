-- Carrying ranked seasons from an anonymous account into the one you sign in to.
--
-- The moment this exists for: a player has been playing anonymously, signs in
-- with Google, and Supabase refuses to link because that identity already
-- belongs to another account -- which is simply what happens on a second
-- device. The honest next step is to sign in to the account that owns the
-- identity, and until now that meant abandoning every ranked season played on
-- the anonymous one.
--
-- ---------------------------------------------------------------------------
-- WHY THIS DOES NOT WEAKEN ANYTHING
-- ---------------------------------------------------------------------------
--
-- A ranked season on an anonymous account is a real season: the server issued
-- its spins, the server scored its roster, and the row records both. Moving it
-- changes exactly one column -- who owns it -- and nothing that was ever
-- verified about it. The rating is not recomputed, the spins are not reissued,
-- and the roster is untouched, so a transferred season is as provable
-- afterwards as it was before.
--
-- What cannot move is a casual season, and not because of a rule: the spins
-- were never issued by the server, so there is no row to move. That asymmetry
-- is the same one that makes opting *in* to the leaderboard after seeing a
-- score impossible.
--
-- Nor does it create a way to pool scores. Points are the sum of a player's
-- seasons and the best-of boards take a maximum, so merging N anonymous
-- accounts is worth exactly what playing those N seasons on one account was
-- worth. The multipliers stay as they were stamped, because they record the
-- streak that actually earned them.
--
-- ---------------------------------------------------------------------------
-- PROOF OF CONTROL, AND WHY IT IS A TICKET
-- ---------------------------------------------------------------------------
--
-- The giving account and the receiving account are never signed in at the same
-- time -- signing in to the second is what replaces the session of the first.
-- So control of the anonymous account has to be proven *before* it is left:
-- `offer_season_transfer` can only be called while holding that account's
-- session, and it returns a ticket. `claim_season_transfer` is then called by
-- whoever the player signs in as.
--
-- The ticket is short-lived and single-use, and the account that minted it is
-- emptied by the claim, so a ticket is worth one transfer and only the first
-- one.

create table if not exists public.season_transfers (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Long enough for an OAuth round trip on a bad connection, short enough that
  -- an abandoned ticket is not a standing offer to take an account's seasons.
  expires_at timestamptz not null default now() + interval '30 minutes',
  claimed_at timestamptz,
  seasons int not null default 0,
  check (to_user is null or to_user <> from_user)
);

comment on table public.season_transfers is
  'One-shot tickets moving completed ranked seasons off an anonymous account '
  'and onto the account its owner signs in to. Minted only by the account '
  'being left, which is what proves control of it.';

create index if not exists season_transfers_open_idx
  on public.season_transfers (from_user) where claimed_at is null;

alter table public.season_transfers enable row level security;

-- No direct reads or writes at all: both sides go through the definer
-- functions below, which is what lets them check the things a policy cannot.
revoke all on public.season_transfers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- What is there to carry
-- ---------------------------------------------------------------------------

/**
 * How many of the caller's seasons would move, and whether they may be moved.
 *
 * Called before offering the choice, because "bring your seasons with you" is
 * a promise and an account with nothing to bring should not be shown it.
 */
create or replace function public.transferable_seasons()
returns table (seasons int, eligible boolean)
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
    coalesce(bool_and(u.is_anonymous), false)
  from auth.users u
  left join public.game_sessions g on g.user_id = u.id
  where u.id = auth.uid();
$$;

revoke execute on function public.transferable_seasons() from public;
grant execute on function public.transferable_seasons() to authenticated;

-- ---------------------------------------------------------------------------
-- Minting
-- ---------------------------------------------------------------------------

/**
 * Offer this account's seasons to whoever the player signs in as next.
 *
 * Must be called while still holding the anonymous account's session. Any
 * earlier unclaimed ticket from the same account is expired first, so there is
 * never more than one live offer and an abandoned attempt cannot be picked up
 * later by someone else's claim.
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

  if v_count = 0 then
    raise exception 'nothing to carry' using errcode = '42501';
  end if;

  update public.season_transfers
     set expires_at = now()
   where from_user = v_user and claimed_at is null and expires_at > now();

  insert into public.season_transfers (from_user, seasons)
  values (v_user, v_count)
  returning id into v_ticket;

  insert into public.audit_events (request_id, actor_id, event, outcome, subject_type, subject_id, detail)
  values (gen_random_uuid(), v_user, 'season_transfer_offered', 'ok', 'season_transfer',
          v_ticket::text, jsonb_build_object('seasons', v_count));

  return v_ticket;
end $$;

revoke execute on function public.offer_season_transfer() from public;
grant execute on function public.offer_season_transfer() to authenticated;

-- ---------------------------------------------------------------------------
-- Claiming
-- ---------------------------------------------------------------------------

/**
 * Take the seasons named by a ticket onto the calling account.
 *
 * Returns how many actually moved, which is not always the number the ticket
 * was minted for: a season is skipped if the receiving account already holds
 * one with the same idempotency key, because that pair is unique per user and
 * the alternative to skipping is the whole claim failing over a collision that
 * means the two accounts already have the same season.
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

  update public.season_transfers
     set claimed_at = now(), to_user = v_user, seasons = v_moved
   where id = p_ticket;

  insert into public.audit_events (request_id, actor_id, event, outcome, subject_type, subject_id, detail)
  values (gen_random_uuid(), v_user, 'season_transfer_claimed', 'ok', 'season_transfer',
          p_ticket::text,
          jsonb_build_object('from', v_from, 'to', v_user, 'seasons', v_moved));

  return v_moved;
end $$;

revoke execute on function public.claim_season_transfer(uuid) from public;
grant execute on function public.claim_season_transfer(uuid) to authenticated;
