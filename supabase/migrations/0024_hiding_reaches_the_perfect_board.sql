-- Hiding a season reaches the perfect board too.
--
-- Split out of 0023 rather than appended to it: that file had already been
-- applied, and the CLI tracks migrations by filename -- editing one that has
-- run is a change that silently never happens.
-- ---------------------------------------------------------------------------
-- The fourth board, which hiding never reached
-- ---------------------------------------------------------------------------
--
-- Found while checking the three above: 0021 taught `leaderboard_rating`,
-- `leaderboard_scout` and `leaderboard_points` about `hidden_at` and left
-- `leaderboard_perfect` alone. So a player could take a season off the board
-- and still find it counted in their perfect-season and heartbreak totals,
-- which is the one place those endings are ever displayed.
--
-- Hiding has to mean the same thing on every board or it does not mean
-- anything. Restated in full, with every filter read off the live definition.

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
