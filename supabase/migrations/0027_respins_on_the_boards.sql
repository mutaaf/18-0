-- A respun season is marked on every board, and can be filtered out of each.
--
-- The owner's rule (docs/respins.md): a season that spent a respin still
-- ranks, carrying a ↻ beside it wherever it appears, and every board can be
-- read "clean only". The perfect-season board counts clean seasons and nothing
-- else, because "about once every 6,000 games" is a measurement of the wheel
-- with no second chances in it.
--
-- ---------------------------------------------------------------------------
-- EVERY FILTER, READ OFF THE LIVE DEFINITION
-- ---------------------------------------------------------------------------
--
-- Restated from the versions in force, not from memory -- the rule CLAUDE.md
-- records after 0009 and 0021 each dropped a filter doing exactly this:
--
--   leaderboard_rating, leaderboard_scout, leaderboard_points   0023
--   leaderboard_perfect                                         0024
--   leaderboard_rating_since, leaderboard_scout_since,
--   leaderboard_points_since, leaderboard_gameday               0019
--
--   status = 'completed'      a season that was scored
--   assisted = false          the three-finger spin sets no records
--   voided_at is null         an operator took it down
--   hidden_at is null         the player took it down (0021)
--   gameday_key is null       a restricted wheel is a different game (0019)
--     (gameday_key = the day, on the gameday board)
--   is_permanent              an anonymous account is free and unlimited
--   handle is not null        nothing unnamed on a public board
--   handle_status = 'ok'      moderation (0002, and dropped once before)
--
-- plus `blind = true` for the rating board and `mode = 'scout'` for scout.
--
-- ---------------------------------------------------------------------------
-- TWO FILTERS THE FUNCTIONS HAD LOST, PUT BACK
-- ---------------------------------------------------------------------------
--
-- Reading the four functions off 0019 turned up the same drift 0023 and 0024
-- fixed in the views: 0021 taught the *views* `hidden_at is null` and the
-- points multiplier and never touched the functions. So a hidden season has
-- still been showing on the week and month boards and on the gameday board,
-- and the windowed points board has been adding seasons up without the
-- multiplier the all-time one applies. The same season scored two ways on one
-- screen depending on which tab was open. Both are restated here as the views
-- state them, because a board that disagrees with itself about what hiding
-- means is the bug 0024 was written to end.
--
-- ---------------------------------------------------------------------------
-- HOW THE MARK AND THE FILTER ARE EXPOSED
-- ---------------------------------------------------------------------------
--
-- Views gain a column at the end (`respun`, or `respun_seasons` on points),
-- because CREATE OR REPLACE VIEW may only append. A clean board is not the
-- marked board with rows removed: a player whose best season was respun should
-- still appear, with their best *clean* season. That is a different
-- deduplication, so it is a parameter of the functions -- `clean => true` --
-- and the all-time clean board is the function with `since => null`.
-- Changing a function's result columns needs a DROP, so each is dropped and
-- recreated with its grants restated. Existing callers that pass only `since`
-- or `p_key` resolve to the new signature through its default.

create or replace view public.leaderboard_rating
with (security_invoker = on) as
select distinct on (g.user_id)
  g.id as game_session_id, g.user_id, p.handle, g.final_rating,
  g.record_wins, g.record_losses, g.ending_key, g.tier, g.completed_at,
  (g.respins_used > 0) as respun
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed'
  and g.assisted = false
  and g.blind = true
  and g.voided_at is null
  and g.hidden_at is null
  and g.gameday_key is null
  and p.is_permanent = true
  and p.handle is not null
  and p.handle_status = 'ok'
order by g.user_id, g.final_rating desc, g.completed_at asc;

create or replace view public.leaderboard_scout
with (security_invoker = on) as
select distinct on (g.user_id)
  g.id as game_session_id, g.user_id, p.handle, g.final_rating,
  g.record_wins, g.record_losses, g.ending_key, g.tier, g.completed_at,
  (g.respins_used > 0) as respun
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed'
  and g.assisted = false
  and g.mode = 'scout'
  and g.voided_at is null
  and g.hidden_at is null
  and g.gameday_key is null
  and p.is_permanent = true
  and p.handle is not null
  and p.handle_status = 'ok'
order by g.user_id, g.final_rating desc, g.completed_at asc;

-- Column order unchanged from 0023, `respun_seasons` appended after `level`.
create or replace view public.leaderboard_points
with (security_invoker = on) as
select
  g.user_id,
  p.handle,
  sum(round(public.season_points(g.final_rating, g.record_wins, g.ending_key)
            * g.points_multiplier))::bigint as points,
  count(*)::int as seasons,
  max(g.final_rating) as best_rating,
  max(g.completed_at) as last_played,
  public.level_for_points(
    sum(round(public.season_points(g.final_rating, g.record_wins, g.ending_key)
              * g.points_multiplier))::bigint) as level,
  (count(*) filter (where g.respins_used > 0))::int as respun_seasons
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed'
  and g.assisted = false
  and g.voided_at is null
  and g.hidden_at is null
  and g.gameday_key is null
  and p.is_permanent = true
  and p.handle is not null
  and p.handle_status = 'ok'
group by g.user_id, p.handle;

grant select on public.leaderboard_points to anon, authenticated;

-- Clean seasons only. The one board that is never marked, because it never
-- holds a respun season to mark.
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
    and g.hidden_at is null
    and g.gameday_key is null
    and g.respins_used = 0
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
  order by g.user_id, g.roster_fingerprint, g.final_rating desc
)
select
  d.user_id,
  p.handle,
  count(*) filter (where d.ending_key = 'PERFECT') as perfect_seasons,
  count(*) filter (where d.ending_key = 'HEARTBREAK') as heartbreaks,
  max(d.final_rating) as best_rating,
  count(*) as distinct_rosters
from distinct_rosters d
join public.profiles p on p.id = d.user_id
group by d.user_id, p.handle;

drop function if exists public.leaderboard_rating_since(timestamptz);

create or replace function public.leaderboard_rating_since(
  since timestamptz default null,
  clean boolean default false
)
returns table (
  game_session_id uuid, user_id uuid, handle text, final_rating numeric,
  record_wins int, record_losses int, ending_key text, tier text, completed_at timestamptz,
  respun boolean
)
language sql stable security invoker as $$
  select distinct on (g.user_id)
    g.id, g.user_id, p.handle, g.final_rating, g.record_wins,
    g.record_losses, g.ending_key, g.tier, g.completed_at,
    (g.respins_used > 0)
  from public.game_sessions g
  join public.profiles p on p.id = g.user_id
  where g.status = 'completed'
    and g.assisted = false
    and g.blind = true
    and g.voided_at is null
    and g.hidden_at is null
    and g.gameday_key is null
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
    and (not clean or g.respins_used = 0)
  order by g.user_id, g.final_rating desc, g.completed_at asc;
$$;

grant execute on function public.leaderboard_rating_since(timestamptz, boolean) to anon, authenticated;

drop function if exists public.leaderboard_scout_since(timestamptz);

create or replace function public.leaderboard_scout_since(
  since timestamptz default null,
  clean boolean default false
)
returns table (
  game_session_id uuid, user_id uuid, handle text, final_rating numeric,
  record_wins int, record_losses int, ending_key text, tier text, completed_at timestamptz,
  respun boolean
)
language sql stable security invoker as $$
  select distinct on (g.user_id)
    g.id, g.user_id, p.handle, g.final_rating, g.record_wins,
    g.record_losses, g.ending_key, g.tier, g.completed_at,
    (g.respins_used > 0)
  from public.game_sessions g
  join public.profiles p on p.id = g.user_id
  where g.status = 'completed'
    and g.assisted = false
    and g.mode = 'scout'
    and g.voided_at is null
    and g.hidden_at is null
    and g.gameday_key is null
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
    and (not clean or g.respins_used = 0)
  order by g.user_id, g.final_rating desc, g.completed_at asc;
$$;

grant execute on function public.leaderboard_scout_since(timestamptz, boolean) to anon, authenticated;

drop function if exists public.leaderboard_points_since(timestamptz);

create or replace function public.leaderboard_points_since(
  since timestamptz default null,
  clean boolean default false
)
returns table (
  user_id uuid, handle text, points bigint, seasons int,
  best_rating numeric, last_played timestamptz, respun_seasons int
)
language sql stable security invoker as $$
  select
    g.user_id,
    p.handle,
    sum(round(public.season_points(g.final_rating, g.record_wins, g.ending_key)
              * g.points_multiplier))::bigint,
    count(*)::int,
    max(g.final_rating),
    max(g.completed_at),
    (count(*) filter (where g.respins_used > 0))::int
  from public.game_sessions g
  join public.profiles p on p.id = g.user_id
  where g.status = 'completed'
    and g.assisted = false
    and g.voided_at is null
    and g.hidden_at is null
    and g.gameday_key is null
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
    and (not clean or g.respins_used = 0)
  group by g.user_id, p.handle;
$$;

grant execute on function public.leaderboard_points_since(timestamptz, boolean) to anon, authenticated;

drop function if exists public.leaderboard_gameday(text);

/**
 * One day's board. Restated from 0019 with the mark, the clean filter, and
 * `hidden_at is null`, which 0021 never brought here.
 */
create or replace function public.leaderboard_gameday(
  p_key text default null,
  clean boolean default false
)
returns table (
  gameday_key     text,
  game_session_id uuid,
  user_id         uuid,
  handle          text,
  final_rating    numeric,
  record_wins     int,
  record_losses   int,
  ending_key      text,
  tier            text,
  completed_at    timestamptz,
  respun          boolean
)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select distinct on (g.user_id)
    g.gameday_key, g.id, g.user_id, p.handle, g.final_rating, g.record_wins,
    g.record_losses, g.ending_key, g.tier, g.completed_at,
    (g.respins_used > 0)
  from public.game_sessions g
  join public.profiles p on p.id = g.user_id
  where g.status = 'completed'
    and g.assisted = false
    and g.voided_at is null
    and g.hidden_at is null
    and g.gameday_key = coalesce(p_key, (select key from public.current_gameday()))
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
    and (not clean or g.respins_used = 0)
  order by g.user_id, g.final_rating desc, g.completed_at asc;
$$;

grant execute on function public.leaderboard_gameday(text, boolean) to anon, authenticated;
