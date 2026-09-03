-- The operator console.
--
-- Everything the server knows already exists -- sessions, spins, completions,
-- refusals, the audit trail -- and none of it was reachable from anywhere but
-- a psql prompt. The /admin screen was a local tuning tool that could only see
-- the device it ran on, which is no use at all for knowing what is happening
-- to other people.
--
-- This is the reachable version. It is a real boundary, not the client-side
-- PIN that gates the tuning screen: every function here runs with definer
-- rights and refuses outright unless `auth.uid()` is in `admins`, so the gate
-- is on the server and reading the bundle tells an attacker nothing they can
-- use. The admin list itself has RLS on and no policies at all, which means no
-- client can read it, add to it, or discover who is on it.
--
-- Bootstrapping is deliberately not in this file: seeding an owner here would
-- publish an account identifier in a public repository. Add the first admin
-- from a service-role connection:
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = '<the owner>';

-- ---------------------------------------------------------------------------
-- Who is an operator
-- ---------------------------------------------------------------------------

create table if not exists public.admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  note     text
);

alter table public.admins enable row level security;
-- No policies, on purpose. RLS with no policy denies everything to every
-- client role; the functions below reach it on definer rights and the service
-- role bypasses RLS entirely. There is no query a player can write that
-- reveals this table exists in any state other than empty.
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid())
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

/**
 * Every operator function starts here.
 *
 * Raising rather than returning empty on purpose: an operator whose console
 * silently shows zero users cannot tell "nothing is happening" from "you are
 * not an operator any more", and those need different reactions.
 */
create or replace function public.require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not an operator' using errcode = '42501';
  end if;
end $$;

revoke execute on function public.require_admin() from public;
grant execute on function public.require_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Voiding a season
-- ---------------------------------------------------------------------------

alter table public.game_sessions
  add column if not exists voided_at timestamptz,
  add column if not exists voided_reason text;

comment on column public.game_sessions.voided_at is
  'Set by an operator to take a season off every board without deleting it. '
  'The row, its spins and its selections all stay, because the evidence for '
  'why it was voided is the thing you most want afterwards.';

create index if not exists game_sessions_voided_idx
  on public.game_sessions (voided_at) where voided_at is not null;

grant select (voided_at) on public.game_sessions to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Every board has to honour it
-- ---------------------------------------------------------------------------
--
-- Rewritten in full rather than patched, and every existing condition is
-- restated. 0009 rebuilt a view from an older definition and silently dropped
-- the moderation filter 0002 had added; hidden handles were back on the public
-- board for two migrations. The rule since: when a view is replaced, read the
-- version being replaced, not the one you remember.

create or replace view public.leaderboard_rating
with (security_invoker = on) as
select distinct on (g.user_id)
  g.id as game_session_id, g.user_id, p.handle, g.final_rating,
  g.record_wins, g.record_losses, g.ending_key, g.tier, g.completed_at
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed'
  and g.assisted = false
  and g.blind = true
  and g.voided_at is null
  and p.is_permanent = true
  and p.handle is not null
  and p.handle_status = 'ok'
order by g.user_id, g.final_rating desc, g.completed_at asc;

create or replace view public.leaderboard_scout
with (security_invoker = on) as
select distinct on (g.user_id)
  g.id as game_session_id, g.user_id, p.handle, g.final_rating,
  g.record_wins, g.record_losses, g.ending_key, g.tier, g.completed_at
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed'
  and g.assisted = false
  and g.mode = 'scout'
  and g.voided_at is null
  and p.is_permanent = true
  and p.handle is not null
  and p.handle_status = 'ok'
order by g.user_id, g.final_rating desc, g.completed_at asc;

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
    and g.voided_at is null
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
  order by g.user_id, g.final_rating desc, g.completed_at asc;
$$;

create or replace function public.leaderboard_scout_since(since timestamptz default null)
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
    and g.mode = 'scout'
    and g.voided_at is null
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
  order by g.user_id, g.final_rating desc, g.completed_at asc;
$$;

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
    and g.voided_at is null
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

create or replace view public.leaderboard_points
with (security_invoker = on) as
select g.user_id, p.handle,
  sum(public.season_points(g.final_rating, g.record_wins, g.ending_key))::bigint as points,
  count(*)::int as seasons,
  max(g.final_rating) as best_rating,
  max(g.completed_at) as last_played
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed'
  and g.assisted = false
  and g.voided_at is null
  and p.is_permanent = true
  and p.handle is not null
  and p.handle_status = 'ok'
group by g.user_id, p.handle;

-- ---------------------------------------------------------------------------
-- What is happening, right now
-- ---------------------------------------------------------------------------

create or replace function public.admin_overview()
returns table (
  players            bigint,
  named_players      bigint,
  hidden_handles     bigint,
  sessions_total     bigint,
  sessions_today     bigint,
  completions_total  bigint,
  completions_today  bigint,
  in_progress        bigint,
  challenges_open    bigint,
  challenges_settled bigint,
  voided             bigint,
  events_hour        bigint,
  refusals_hour      bigint,
  p95_latency_ms     integer,
  last_event_at      timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.profiles),
    (select count(*) from public.profiles where is_permanent),
    (select count(*) from public.profiles where handle_status <> 'ok'),
    (select count(*) from public.game_sessions),
    (select count(*) from public.game_sessions where created_at > now() - interval '24 hours'),
    (select count(*) from public.game_sessions where status = 'completed'),
    (select count(*) from public.game_sessions
      where status = 'completed' and completed_at > now() - interval '24 hours'),
    (select count(*) from public.game_sessions where status = 'in_progress'),
    (select count(*) from public.challenges where status = 'open'),
    (select count(*) from public.challenges where status = 'complete'),
    (select count(*) from public.game_sessions where voided_at is not null),
    (select count(*) from public.audit_events where occurred_at > now() - interval '1 hour'),
    (select count(*) from public.audit_events
      where occurred_at > now() - interval '1 hour' and outcome <> 'ok'),
    (select percentile_disc(0.95) within group (order by latency_ms)::int
       from public.audit_events
      where occurred_at > now() - interval '1 hour' and latency_ms is not null),
    (select max(occurred_at) from public.audit_events)
  where public.is_admin();
$$;

/**
 * Every player, with enough of their behaviour to recognise a problem.
 *
 * No email, no auth identity, no roster. An operator needs to know who is
 * playing, how much, and whether anything about it looks wrong -- none of
 * which requires knowing who they are outside this game.
 */
create or replace function public.admin_players(p_limit int default 100, p_search text default null)
returns table (
  user_id       uuid,
  handle        text,
  handle_status text,
  is_permanent  boolean,
  created_at    timestamptz,
  sessions      bigint,
  completions   bigint,
  assisted      bigint,
  voided        bigint,
  best_rating   numeric,
  last_seen     timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    p.id, p.handle, p.handle_status, p.is_permanent, p.created_at,
    count(g.id),
    count(g.id) filter (where g.status = 'completed'),
    count(g.id) filter (where g.assisted),
    count(g.id) filter (where g.voided_at is not null),
    max(g.final_rating),
    greatest(max(g.completed_at), max(g.created_at), p.created_at)
  from public.profiles p
  left join public.game_sessions g on g.user_id = p.id
  where public.is_admin()
    and (p_search is null or p.handle ilike '%' || p_search || '%')
  group by p.id, p.handle, p.handle_status, p.is_permanent, p.created_at
  order by greatest(max(g.completed_at), max(g.created_at), p.created_at) desc nulls last
  limit greatest(1, least(p_limit, 500));
$$;

/** The trail, newest first, optionally only the things that went wrong. */
create or replace function public.admin_events(
  p_limit int default 100, p_only_failures boolean default false
)
returns table (
  occurred_at  timestamptz,
  event        text,
  outcome      text,
  actor_id     uuid,
  actor_handle text,
  subject_type text,
  subject_id   text,
  detail       jsonb,
  latency_ms   integer,
  request_id   uuid
)
language sql stable security definer set search_path = public as $$
  select
    e.occurred_at, e.event, e.outcome::text, e.actor_id, p.handle,
    e.subject_type, e.subject_id, e.detail, e.latency_ms, e.request_id
  from public.audit_events e
  left join public.profiles p on p.id = e.actor_id
  where public.is_admin()
    and (not p_only_failures or e.outcome <> 'ok')
  order by e.occurred_at desc
  limit greatest(1, least(p_limit, 500));
$$;

/** What kind of thing is happening, by the hour, for the last two days. */
create or replace function public.admin_activity()
returns table (hour timestamptz, event text, outcome text, count bigint)
language sql stable security definer set search_path = public as $$
  select date_trunc('hour', e.occurred_at), e.event, e.outcome::text, count(*)
  from public.audit_events e
  where public.is_admin()
    and e.occurred_at > now() - interval '48 hours'
  group by 1, 2, 3
  order by 1 desc, 4 desc;
$$;

-- ---------------------------------------------------------------------------
-- Acting on it
-- ---------------------------------------------------------------------------
--
-- Three of these are irreversible. Each one writes to the audit trail first
-- and does the work second, so the record of an operator action cannot be
-- lost to a failure halfway through -- and the trail is append-only even to
-- the service role, so it cannot be tidied up afterwards either.

create or replace function public.admin_set_handle_status(p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();
  if p_status not in ('ok', 'flagged', 'hidden') then
    raise exception 'unknown handle status %', p_status;
  end if;

  insert into public.audit_events (request_id, actor_id, event, outcome, subject_type, subject_id, detail)
  values (gen_random_uuid(), auth.uid(), 'admin_set_handle_status', 'ok', 'profile', p_user::text,
          jsonb_build_object('status', p_status));

  update public.profiles set handle_status = p_status where id = p_user;
end $$;

/**
 * Takes a season off every board without destroying the evidence.
 *
 * Deliberately not a delete: the reason a season needed voiding is usually
 * visible in its spins and its picks, and those are exactly what a delete
 * would take with it.
 */
create or replace function public.admin_void_season(p_session uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();

  insert into public.audit_events (request_id, actor_id, event, outcome, subject_type, subject_id, detail)
  values (gen_random_uuid(), auth.uid(), 'admin_void_season', 'ok', 'game_session', p_session::text,
          jsonb_build_object('reason', p_reason));

  update public.game_sessions
     set voided_at = now(), voided_reason = p_reason
   where id = p_session;
end $$;

create or replace function public.admin_restore_season(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_admin();

  insert into public.audit_events (request_id, actor_id, event, outcome, subject_type, subject_id, detail)
  values (gen_random_uuid(), auth.uid(), 'admin_restore_season', 'ok', 'game_session', p_session::text, '{}'::jsonb);

  update public.game_sessions set voided_at = null, voided_reason = null where id = p_session;
end $$;

/**
 * Deletes an account and everything that cascades from it.
 *
 * Irreversible, and the audit trail is what survives: the row written here
 * outlives the account, because actor_id and subject_id are deliberately not
 * foreign keys and the trail cannot be rewritten by anyone, service role
 * included.
 *
 * An operator cannot delete themselves through this. That is not paternalism:
 * the console is reached through the account, and an operator who deletes it
 * has locked everyone out of the console with no way back that does not
 * involve a service-role connection.
 */
create or replace function public.admin_delete_player(p_user uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  doomed_handle text;
begin
  perform public.require_admin();
  if p_user = auth.uid() then
    raise exception 'an operator cannot delete their own account from the console';
  end if;

  select handle into doomed_handle from public.profiles where id = p_user;

  insert into public.audit_events (request_id, actor_id, event, outcome, subject_type, subject_id, detail)
  values (gen_random_uuid(), auth.uid(), 'admin_delete_player', 'ok', 'profile', p_user::text,
          jsonb_build_object('handle', doomed_handle, 'reason', p_reason));

  delete from auth.users where id = p_user;
end $$;

revoke execute on function public.admin_overview() from public;
revoke execute on function public.admin_players(int, text) from public;
revoke execute on function public.admin_events(int, boolean) from public;
revoke execute on function public.admin_activity() from public;
revoke execute on function public.admin_set_handle_status(uuid, text) from public;
revoke execute on function public.admin_void_season(uuid, text) from public;
revoke execute on function public.admin_restore_season(uuid) from public;
revoke execute on function public.admin_delete_player(uuid, text) from public;

grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_players(int, text) to authenticated;
grant execute on function public.admin_events(int, boolean) to authenticated;
grant execute on function public.admin_activity() to authenticated;
grant execute on function public.admin_set_handle_status(uuid, text) to authenticated;
grant execute on function public.admin_void_season(uuid, text) to authenticated;
grant execute on function public.admin_restore_season(uuid) to authenticated;
grant execute on function public.admin_delete_player(uuid, text) to authenticated;
