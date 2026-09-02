-- Put the moderation filter back on the rating board.
--
-- 0009 changed the dedup to one row per player and, in doing so, rebuilt these
-- two definitions from the 0001 text. 0002 had since added
--
--   and p.handle is not null
--   and p.handle_status = 'ok'
--
-- and copying the older body dropped both, which put every hidden and flagged
-- handle straight back onto the public leaderboard. A moderator upholding a
-- report would have taken the name off the board for as long as it took to
-- deploy the next migration.
--
-- The check that caught this is 'a hidden handle is dropped from the board'.
-- It exists because this is exactly the kind of thing that gets rebuilt from
-- the wrong copy, and it failed the first time it was run afterwards.

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
  and p.handle is not null
  and p.handle_status = 'ok'
-- Ties go to whoever got there first: fairer, and stable across two identical
-- queries, which an unordered tiebreak would not be.
order by g.user_id, g.final_rating desc, g.completed_at asc;

comment on view public.leaderboard_rating is
  'One row per player: their highest-rated unassisted season, excluding handles '
  'that moderation has flagged or hidden. Ranking is done by the caller.';

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
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
  order by g.user_id, g.final_rating desc, g.completed_at asc;
$$;
