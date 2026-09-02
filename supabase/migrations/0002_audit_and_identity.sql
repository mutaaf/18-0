-- ---------------------------------------------------------------------------
-- Audit, rate limiting, and the rules a public leaderboard needs
--
-- 0001 made a ranked game unforgeable. This makes it *accountable*: every
-- server decision leaves a record that cannot be edited afterwards, including
-- by the service role that wrote it, so "what happened in this game" is a
-- question with an answer rather than an opinion.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

create type public.audit_outcome as enum ('ok', 'rejected', 'error');

create table public.audit_events (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  -- Threaded through from the edge function, so every row belonging to one
  -- HTTP request can be pulled back out together.
  request_id   uuid not null,
  -- Who the server believed was acting. Null only for unauthenticated calls.
  --
  -- Deliberately NOT a foreign key. `on delete set null` would have to UPDATE
  -- this table when an account is deleted, and the triggers below forbid that —
  -- a trail a cascade can silently rewrite is not append-only, and account
  -- deletion would have failed outright. So the id is stored unconstrained: it
  -- stays readable while the account exists and resolves to nothing once it is
  -- gone, which is what an audit trail is supposed to do.
  actor_id     uuid,
  event        text not null,
  outcome      public.audit_outcome not null,
  subject_type text,
  subject_id   text,
  -- Never PII. Reasons, counts, versions, and the identifiers above.
  detail       jsonb not null default '{}'::jsonb,
  latency_ms   integer check (latency_ms is null or latency_ms >= 0),
  client       text
);

comment on table public.audit_events is
  'Append-only record of every server-side decision. See the triggers below: '
  'this table cannot be updated or deleted from, by anyone, including the '
  'service role. Deleting an account removes the account and its games; the '
  'trail keeps the opaque actor id, which afterwards resolves to nobody.';

create index audit_events_time_idx    on public.audit_events (occurred_at desc);
create index audit_events_actor_idx   on public.audit_events (actor_id, occurred_at desc);
create index audit_events_event_idx   on public.audit_events (event, outcome, occurred_at desc);
create index audit_events_request_idx on public.audit_events (request_id);
create index audit_events_subject_idx on public.audit_events (subject_type, subject_id);

/**
 * Append-only, enforced in the database rather than by convention.
 *
 * RLS alone would not do it: the edge functions hold the service role, and the
 * service role bypasses RLS. A trigger does not care who you are.
 */
create or replace function public.audit_events_are_append_only()
returns trigger
language plpgsql as $$
begin
  raise exception 'audit_events is append-only (attempted %)', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function public.audit_events_are_append_only();

create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function public.audit_events_are_append_only();

-- No policies are defined, so with RLS on, anon and authenticated can do
-- nothing at all here. The grants are removed as well, belt and braces.
alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Operational rollups
--
-- Reading raw audit rows to answer "is anything on fire" does not scale and
-- tempts people into granting wide access to the trail itself. These are the
-- only shape anyone should need, and they stay service-role only.
-- ---------------------------------------------------------------------------

create view public.ops_events_hourly as
select
  date_trunc('hour', occurred_at) as hour,
  event,
  outcome,
  count(*)                                                              as events,
  count(distinct actor_id)                                              as actors,
  percentile_disc(0.50) within group (order by latency_ms)              as p50_latency_ms,
  percentile_disc(0.95) within group (order by latency_ms)              as p95_latency_ms,
  max(latency_ms)                                                       as max_latency_ms
from public.audit_events
group by 1, 2, 3;

comment on view public.ops_events_hourly is
  'Per-hour volume and latency by event and outcome. Service role only.';

-- The single number worth alerting on: how much of what we are asked to do we
-- are refusing. A spike is either an attack or a regression, and both matter.
create view public.ops_rejection_rate as
select
  date_trunc('hour', occurred_at) as hour,
  event,
  count(*) filter (where outcome = 'rejected')::numeric
    / nullif(count(*), 0)                                 as rejection_rate,
  count(*) filter (where outcome = 'error')::numeric
    / nullif(count(*), 0)                                 as error_rate,
  count(*)                                                as events
from public.audit_events
group by 1, 2;

revoke all on public.ops_events_hourly, public.ops_rejection_rate from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rate limiting
--
-- A public board is worth farming. This is a fixed-window counter, which is
-- coarse on purpose: it is a brake on automation, not an accounting system.
-- ---------------------------------------------------------------------------

create table public.rate_limits (
  actor_id     uuid not null,
  bucket       text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (actor_id, bucket, window_start)
);

alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

create index rate_limits_sweep_idx on public.rate_limits (window_start);

/**
 * Consume one unit from a caller's bucket. Returns false when they are over.
 *
 * The insert-on-conflict is what makes this safe under concurrency: two
 * simultaneous requests cannot both read a stale count and both decide there
 * was room.
 */
create or replace function public.consume_rate_limit(
  p_actor  uuid,
  p_bucket text,
  p_limit  integer,
  p_window interval default '1 minute'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz := date_trunc('second', now())
    - make_interval(secs => mod(extract(epoch from now())::bigint, greatest(extract(epoch from p_window)::bigint, 1)));
  v_count integer;
begin
  insert into public.rate_limits (actor_id, bucket, window_start, count)
  values (p_actor, p_bucket, v_window_start, 1)
  on conflict (actor_id, bucket, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.consume_rate_limit(uuid, text, integer, interval)
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Display names
--
-- A handle on a public board is user-generated content, which brings rules
-- with it. The column carries its own moderation state so a name can be pulled
-- from the board without touching the player's games or their history.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column handle_status text not null default 'ok'
    check (handle_status in ('ok', 'flagged', 'hidden')),
  add column handle_set_at timestamptz;

-- Printable, no leading or trailing padding to fake rank order, no control
-- characters, no lookalike whitespace runs.
alter table public.profiles
  add constraint profiles_handle_shape check (
    handle is null
    or handle ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,30}[A-Za-z0-9]$'
  );

-- ---------------------------------------------------------------------------
-- Boards exclude anything that has been pulled
--
-- Recreated rather than patched in place, because a view that silently keeps
-- its old definition after a moderation column is added is exactly the kind of
-- gap that ships a hidden name to the top of a leaderboard.
-- ---------------------------------------------------------------------------

create or replace view public.leaderboard_rating
with (security_invoker = on) as
select distinct on (g.user_id, g.roster_fingerprint)
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
  and p.handle is not null
  and p.handle_status = 'ok'
order by g.user_id, g.roster_fingerprint, g.final_rating desc, g.completed_at asc;

create or replace function public.leaderboard_rating_since(since timestamptz default null)
returns table (
  game_session_id uuid, user_id uuid, handle text, final_rating numeric,
  record_wins int, record_losses int, ending_key text, tier text, completed_at timestamptz
)
language sql stable security invoker as $$
  select distinct on (g.user_id, g.roster_fingerprint)
    g.id, g.user_id, p.handle, g.final_rating, g.record_wins,
    g.record_losses, g.ending_key, g.tier, g.completed_at
  from public.game_sessions g
  join public.profiles p on p.id = g.user_id
  where g.status = 'completed'
    and g.assisted = false
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
  order by g.user_id, g.roster_fingerprint, g.final_rating desc, g.completed_at asc;
$$;

create or replace view public.leaderboard_perfect
with (security_invoker = on) as
with distinct_rosters as (
  select distinct on (g.user_id, g.roster_fingerprint)
    g.user_id, g.ending_key, g.final_rating
  from public.game_sessions g
  where g.status = 'completed' and g.assisted = false
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
where p.handle is not null
  and p.handle_status = 'ok'
group by d.user_id, p.handle;

grant select on public.leaderboard_rating, public.leaderboard_perfect to anon, authenticated;
grant execute on function public.leaderboard_rating_since(timestamptz) to anon, authenticated;
