-- Gameday seasons are back off the all-time boards.
--
-- ---------------------------------------------------------------------------
-- WHAT HAPPENED
-- ---------------------------------------------------------------------------
--
-- 0021 restated all three boards to add `hidden_at is null` and the points
-- multiplier, and restated them from the version its author remembered rather
-- than the version that was there. 0019's `gameday_key is null` was not in that
-- memory, so it was dropped from `leaderboard_rating`, `leaderboard_scout` and
-- `leaderboard_points` -- and a gameday season, played on a wheel of as few as
-- two franchises, has been ranking against seasons drawn from all thirty-two.
--
-- This is the second time. CLAUDE.md records the first:
--
--   > Migrations are append-only and restate what they replace. When replacing
--   > a view, read the version being replaced rather than the one you
--   > remember: 0009 rebuilt a view from memory and silently dropped 0002's
--   > moderation filter for two migrations.
--
-- It was found by `scripts/verify/e2e.mjs`, which plays a real gameday season
-- and then checks it is on that day's board *and no other*. The check was
-- written when gameday was built, for exactly this, and it is the only reason
-- this was caught before anybody's board went wrong in a way they noticed.
--
-- ---------------------------------------------------------------------------
-- WHY A GAMEDAY SEASON IS NOT COMPARABLE
-- ---------------------------------------------------------------------------
--
-- Not a purity argument. The gameday wheel is restricted to the franchises
-- actually playing that day, so the pool of available cards is a small and
-- arbitrary slice of the dataset -- sometimes generous, usually not. A season
-- built from it is a different problem from one built from the whole league,
-- and averaging the two produces a ranking that means nothing in either
-- direction. That is the entire reason gameday has boards of its own.
--
-- ---------------------------------------------------------------------------
-- EVERY FILTER, READ OFF THE LIVE DEFINITION
-- ---------------------------------------------------------------------------
--
--   status = 'completed'      a season that was scored
--   assisted = false          the three-finger spin sets no records
--   voided_at is null         an operator took it down
--   hidden_at is null         the player took it down (0021)
--   gameday_key is null       a restricted wheel is a different game (0019)
--   is_permanent              an anonymous account is free and unlimited
--   handle is not null        nothing unnamed on a public board
--   handle_status = 'ok'      moderation (0002, and dropped once before)
--
-- plus `blind = true` for the rating board and `mode = 'scout'` for scout.

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
  g.record_wins, g.record_losses, g.ending_key, g.tier, g.completed_at
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

-- Column order is unchanged from 0021 on purpose: CREATE OR REPLACE VIEW may
-- only append, and renaming one in the middle is what it refuses. `level`
-- stays at the end for the same reason it landed there.
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
              * g.points_multiplier))::bigint) as level
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

/**
 * Your own standing, counted the way the board counts it.
 *
 * 0021 introduced this and gave it the same blind spot: it summed every
 * completed season including gameday ones, so a player's level on the account
 * screen could be several levels above the level next to their name on the
 * board, with nothing on either screen to explain the gap. A number the player
 * is shown about themselves has to come from the same rule as the number
 * everybody else sees.
 *
 * Hidden seasons are still counted in `hidden` and excluded from everything
 * else -- that is what hiding one is for.
 */
create or replace function public.my_progress()
returns table (
  points bigint, level int, level_floor bigint, next_level_at bigint,
  seasons int, hidden int, best_multiplier numeric
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select
      coalesce(sum(round(public.season_points(g.final_rating, g.record_wins, g.ending_key)
                         * g.points_multiplier))
               filter (where g.hidden_at is null), 0)::bigint as pts,
      count(*) filter (where g.hidden_at is null)::int as shown,
      count(*) filter (where g.hidden_at is not null)::int as hid,
      coalesce(max(g.points_multiplier) filter (where g.hidden_at is null), 1.00) as best
    from public.game_sessions g
    where g.user_id = auth.uid() and g.status = 'completed'
      and g.assisted = false
      and g.voided_at is null
      and g.gameday_key is null
  )
  select
    mine.pts,
    public.level_for_points(mine.pts),
    public.points_for_level(public.level_for_points(mine.pts)),
    public.points_for_level(public.level_for_points(mine.pts) + 1),
    mine.shown, mine.hid, mine.best
  from mine
  where auth.uid() is not null;
$$;

revoke execute on function public.my_progress() from public;
grant execute on function public.my_progress() to authenticated;
