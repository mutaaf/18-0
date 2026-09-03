-- A second board: points, accumulated across every season you finish.
--
-- The rating board answers "what is the best roster you have ever built",
-- which is a ceiling and rewards one good afternoon. This one answers "how
-- much good football have you played", which rewards coming back. They
-- deliberately disagree, and a player can be near the top of one and nowhere
-- on the other.
--
-- Rookie seasons count here. That is the point of having two boards: the
-- rating board ranks Player IQ only, because with the numbers on screen the
-- best roster is the one that reads them, and this one measures volume of
-- honest play rather than blind skill.
--
-- Assisted seasons never count, anywhere. The three-finger spin exists to let
-- someone see a perfect roster, not to bank it.

/**
 * What one finished season is worth.
 *
 * Rating carries most of it, because a season is mostly how good the roster
 * was. Wins add a floor so a close season still pays. A perfect season is worth
 * roughly another two seasons on its own -- it lands about once in six thousand
 * games, and the board should say so.
 *
 * Immutable and in SQL rather than in the app, so the two can never disagree
 * about what a season was worth.
 */
create or replace function public.season_points(
  final_rating numeric,
  record_wins int,
  ending_key text
) returns bigint
language sql
immutable
set search_path = public, pg_temp
as $$
  select greatest(0,
    round(coalesce(final_rating, 0) * 100)::bigint
    + coalesce(record_wins, 0)::bigint * 500
    + case when ending_key = 'PERFECT' then 25000 else 0 end
  )
$$;

comment on function public.season_points is
  'Points for one finished season. Rating x100, plus 500 a win, plus 25,000 for '
  'a perfect season. Assisted seasons are excluded by the views, not here.';

create or replace view public.leaderboard_points
with (security_invoker = on) as
select
  g.user_id,
  p.handle,
  sum(public.season_points(g.final_rating, g.record_wins, g.ending_key))::bigint as points,
  count(*)::int                                                                  as seasons,
  max(g.final_rating)                                                            as best_rating,
  max(g.completed_at)                                                            as last_played
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed'
  and g.assisted = false
  and p.is_permanent = true
  and p.handle is not null
  and p.handle_status = 'ok'
group by g.user_id, p.handle;

comment on view public.leaderboard_points is
  'Total points across every finished, unassisted season. Unlike '
  'leaderboard_rating this counts Rookie seasons too: it measures how much has '
  'been played, not how well one roster scored.';

-- Windowed, the same way the rating board is, and filtering before the sum so a
-- month total is a month's play rather than a lifetime's.
create or replace function public.leaderboard_points_since(since timestamptz default null)
returns table (
  user_id uuid, handle text, points bigint, seasons int,
  best_rating numeric, last_played timestamptz
)
language sql stable security invoker as $$
  select
    g.user_id,
    p.handle,
    sum(public.season_points(g.final_rating, g.record_wins, g.ending_key))::bigint,
    count(*)::int,
    max(g.final_rating),
    max(g.completed_at)
  from public.game_sessions g
  join public.profiles p on p.id = g.user_id
  where g.status = 'completed'
    and g.assisted = false
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
  group by g.user_id, p.handle;
$$;

grant select on public.leaderboard_points to anon, authenticated;
grant execute on function public.leaderboard_points_since(timestamptz) to anon, authenticated;
grant execute on function public.season_points(numeric, int, text) to anon, authenticated;
