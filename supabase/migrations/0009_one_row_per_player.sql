-- The rating board shows each player once, at their best.
--
-- It previously deduped on (user_id, roster_fingerprint), so a player held one
-- slot per distinct roster they had ever built. That was a deliberate reading
-- of the game -- each roster is its own season -- and it makes a poor
-- leaderboard: one person with a good afternoon takes the whole top ten, and
-- everyone below is pushed off the first screen by someone they already lost to.
--
-- The fingerprint dedup existed to stop the same roster being replayed for
-- extra entries. Keeping only a player's best run makes that impossible by
-- construction, so nothing is lost by dropping it.
--
-- leaderboard_perfect is left alone: it already aggregates to one row per
-- player, and its own fingerprint dedup is what makes `distinct_rosters` an
-- honest count rather than a count of replays.

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
-- Ties go to whoever got there first, which is both the fairer rule and a
-- stable one: without it the row could change between two identical queries.
order by g.user_id, g.final_rating desc, g.completed_at asc;

comment on view public.leaderboard_rating is
  'One row per player: their highest-rated unassisted season. Ranking is done '
  'by the caller, which orders by final_rating.';

-- Windowed boards filter BEFORE deduping, so a player's best run three months
-- ago cannot suppress their qualifying run from this week.
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
    and (since is null or g.completed_at >= since)
  order by g.user_id, g.final_rating desc, g.completed_at asc;
$$;
