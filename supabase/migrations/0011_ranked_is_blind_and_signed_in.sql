-- The board is for Player IQ seasons played by somebody with an account.
--
-- Two conditions, for two different reasons.
--
-- **Blind.** With ratings on screen, the highest-rated roster is the one that
-- reads the biggest numbers, and the leaderboard measures who is willing to do
-- that rather than who knows football. Player IQ shows a name, a team and a
-- year, so ranking on it means ranking on what people actually know.
--
-- **Signed in.** An anonymous account is free and unlimited, which makes a
-- leaderboard of anonymous accounts a leaderboard of however many attempts
-- somebody was willing to make. It also means the top of the board is held by
-- accounts that vanish with the browser cache.
--
-- Nothing is deleted and nothing is blocked: an anonymous player still plays
-- ranked and their seasons are still recorded. Signing in later brings every
-- qualifying season they already played onto the board at once.

-- ---------------------------------------------------------------------------
-- First, a bug this migration walked straight into.
--
-- 0008 reserved the `player-<hex>` shape so nobody could claim a name that
-- looks system-generated. It checks `is_placeholder_handle(new.handle)` on
-- every UPDATE, not only when the handle changes -- so *any* write to a profile
-- row still carrying its generated name is rejected with
-- `handle_not_allowed:reserved`.
--
-- The backfill below is one such write. So is public.moderation_uphold(), which
-- sets handle_status on a profile without touching the handle: moderating a
-- player who never chose a name has been failing since 0008. The moderation
-- tests all claim a handle first, so nothing caught it.
--
-- The rule was only ever about what a player may rename themselves to.
create or replace function public.enforce_handle_policy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_next   timestamptz;
begin
  if new.handle is null then
    return new;
  end if;

  select d.reason into v_reason
  from public.handle_denylist d
  where (d.kind = 'substring' and position(d.pattern in lower(new.handle)) > 0)
     or (d.kind = 'regex' and lower(new.handle) ~ d.pattern)
  limit 1;

  if v_reason is not null then
    raise exception 'handle_not_allowed:%', v_reason
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    new.handle_set_at := null;
    return new;
  end if;

  if new.handle is distinct from old.handle then
    -- Only a *change* to a placeholder-shaped name is reserved. Leaving one
    -- alone while writing another column is not.
    if public.is_placeholder_handle(new.handle) then
      raise exception 'handle_not_allowed:reserved'
        using errcode = 'check_violation';
    end if;

    if old.handle is null or public.is_placeholder_handle(old.handle) then
      new.handle_set_at := null;
      return new;
    end if;

    if old.handle_set_at is not null
       and coalesce(old.handle_status, 'ok') = 'ok'
    then
      v_next := old.handle_set_at + interval '30 days';
      if v_next > now() then
        raise exception 'handle_cooldown:%',
          to_char(v_next at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          using errcode = 'check_violation';
      end if;
    end if;

    new.handle_set_at := now();
    if old.handle_status = 'flagged' then
      new.handle_status := 'ok';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_handle_policy() from public;

-- ---------------------------------------------------------------------------
-- What mode a season was built in.
--
-- Set by the client when the session is opened, before a single spin has been
-- issued, and never writable afterwards: the insert grant below covers this
-- column and there is no update grant on this table at all, so a player cannot
-- decide a run was blind after seeing what it scored. That is the same
-- guarantee `assisted` has.
--
-- It is a *declaration*, not a proof, and this is worth being plain about. The
-- card ratings are in the bundled dataset on the device, so a modified client
-- can always see them whatever it tells the server. Hiding them in the spin
-- response would not change that. What this rules out is the ordinary case --
-- playing with the numbers on screen and then claiming the board -- not a
-- determined liar.
alter table public.game_sessions
  add column if not exists blind boolean not null default false;

comment on column public.game_sessions.blind is
  'Player IQ: the client showed no ratings or stat lines. Declared at session '
  'creation and immutable, because there is no update grant on this table. A '
  'declaration rather than a proof -- the dataset is bundled, so a modified '
  'client can always read the ratings.';

grant insert (blind) on public.game_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- Whether the account is more than a browser session.
--
-- Denormalised onto profiles rather than joined from auth.users, because these
-- views run with security_invoker and a player has no access to auth.users --
-- the join would simply fail for everyone who is not the service role.
alter table public.profiles
  add column if not exists is_permanent boolean not null default false;

comment on column public.profiles.is_permanent is
  'True once a real identity is linked (Apple, Google, email). Mirrors '
  'auth.users.is_anonymous, kept in step by on_auth_user_identity_changed. '
  'Never writable by a client: 0004 revoked update on this table except for '
  'the handle column.';

create or replace function public.sync_profile_permanence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles
     set is_permanent = (new.is_anonymous is not true)
   where id = new.id
     and is_permanent is distinct from (new.is_anonymous is not true);
  return new;
end $$;

revoke execute on function public.sync_profile_permanence() from public;

drop trigger if exists on_auth_user_identity_changed on auth.users;
create trigger on_auth_user_identity_changed
  after update of is_anonymous on auth.users
  for each row execute function public.sync_profile_permanence();

-- Existing accounts. Anyone who linked an identity before this migration.
update public.profiles p
   set is_permanent = true
  from auth.users u
 where u.id = p.id
   and u.is_anonymous is not true
   and p.is_permanent = false;

-- security_invoker means the caller reads these columns directly.
grant select (id, handle, handle_status, handle_set_at, created_at, is_permanent)
  on public.profiles to anon, authenticated;

-- ---------------------------------------------------------------------------
create or replace view public.leaderboard_rating
with (security_invoker = on) as
select distinct on (g.user_id)
  g.id            as game_session_id,
  g.user_id,
  p.handle,
  g.final_rating,
  g.record_wins,
  g.record_losses,
  g.ending_key,
  g.tier,
  g.completed_at
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed'
  and g.assisted = false
  and g.blind = true
  and p.is_permanent = true
  and p.handle is not null
  and p.handle_status = 'ok'
order by g.user_id, g.final_rating desc, g.completed_at asc;

comment on view public.leaderboard_rating is
  'One row per player: their highest-rated Player IQ season, for accounts with '
  'a linked identity, excluding handles moderation has flagged or hidden.';

create or replace function public.leaderboard_rating_since(since timestamptz default null)
returns table (
  game_session_id uuid, user_id uuid, handle text, final_rating numeric,
  record_wins int, record_losses int, ending_key text, tier text, completed_at timestamptz
)
language sql stable security invoker as $$
  select distinct on (g.user_id)
    g.id, g.user_id, p.handle, g.final_rating, g.record_wins,
    g.record_losses, g.ending_key, g.tier, g.completed_at
  from public.game_sessions g
  join public.profiles p on p.id = g.user_id
  where g.status = 'completed'
    and g.assisted = false
    and g.blind = true
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
  order by g.user_id, g.final_rating desc, g.completed_at asc;
$$;

-- The career board counts the same seasons the rating board ranks, or the two
-- disagree about what a season is.
create or replace view public.leaderboard_perfect
with (security_invoker = on) as
with distinct_rosters as (
  select distinct on (g.user_id, g.roster_fingerprint)
    g.user_id, g.ending_key, g.final_rating
  from public.game_sessions g
  join public.profiles p on p.id = g.user_id
  where g.status = 'completed'
    and g.assisted = false
    and g.blind = true
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
  order by g.user_id, g.roster_fingerprint, g.final_rating desc
)
select
  d.user_id,
  p.handle,
  count(*) filter (where d.ending_key = 'PERFECT')    as perfect_seasons,
  count(*) filter (where d.ending_key = 'HEARTBREAK') as heartbreaks,
  max(d.final_rating)                                  as best_rating,
  count(*)                                             as distinct_rosters
from distinct_rosters d
join public.profiles p on p.id = d.user_id
group by d.user_id, p.handle;
