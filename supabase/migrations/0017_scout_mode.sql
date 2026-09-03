-- Scout: the mode between Rookie and Player IQ.
--
-- Rookie shows you the rating, which teaches the model but decides the pick
-- for you. Player IQ shows you a name and a year and nothing else, which is
-- the real game and also a wall. There was nothing in between, and the thing
-- in between is what most people actually want: the stat line, no grade. You
-- read 69 receptions for 1,313 yards and 17 touchdowns and you decide what
-- that is worth.
--
-- The server has to know which of the three a season was played in, for the
-- same reason it had to know whether a season was blind: a mode declared after
-- the score is not a mode, it is a claim. `blind` was a boolean, and three
-- states do not fit in one, so the column becomes derived and `mode` becomes
-- the thing the client declares.

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------

alter table public.game_sessions
  add column if not exists mode text
    check (mode is null or mode in ('rookie', 'scout', 'player_iq'));

comment on column public.game_sessions.mode is
  'What the player could see while picking: rookie shows ratings, scout shows '
  'stat lines only, player_iq shows neither. Declared when the session opens '
  'and never updatable, because a mode chosen after the score is not a mode.';

-- Every season played before this migration was one of the two old modes, and
-- `blind` already says which.
update public.game_sessions set mode = case when blind then 'player_iq' else 'rookie' end
 where mode is null;

/**
 * `blind` stops being something a client sets and becomes something `mode`
 * implies.
 *
 * Everything already built reads `blind` -- three leaderboard views, a
 * function, the harness -- and rewriting all of it to read `mode` would be a
 * wide change for no gain. Deriving it keeps one source of truth and leaves
 * those readers correct: blind is exactly player_iq, and always was.
 */
create or replace function public.session_mode_implies_blind() returns trigger
language plpgsql as $$
begin
  if new.mode is not null then
    new.blind := (new.mode = 'player_iq');
  elsif new.blind then
    -- An older client that still declares only `blind`. Honour it.
    new.mode := 'player_iq';
  else
    new.mode := 'rookie';
  end if;
  return new;
end $$;

drop trigger if exists session_mode_sets_blind on public.game_sessions;
create trigger session_mode_sets_blind
  before insert on public.game_sessions
  for each row execute function public.session_mode_implies_blind();

grant insert (mode) on public.game_sessions to authenticated;
grant select (mode) on public.game_sessions to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Its own board
-- ---------------------------------------------------------------------------

/**
 * Scout seasons rank against Scout seasons.
 *
 * Not against Player IQ ones: a stat line is a real advantage, and a single
 * board would quietly rank two different games together and make the harder
 * one look worse. Rookie still ranks nowhere -- a rating on screen turns the
 * pick into a reading test, and that has not changed.
 */
create or replace view public.leaderboard_scout
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
  and g.mode = 'scout'
  and p.is_permanent = true
  and p.handle is not null
  and p.handle_status = 'ok'
order by g.user_id, g.final_rating desc, g.completed_at asc;

comment on view public.leaderboard_scout is
  'One row per player: their highest-rated Scout season -- stat lines visible, '
  'ratings hidden -- under the same account and moderation rules as the '
  'Player IQ board.';

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
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
  order by g.user_id, g.final_rating desc, g.completed_at asc;
$$;

grant select on public.leaderboard_scout to anon, authenticated;
grant execute on function public.leaderboard_scout_since(timestamptz) to anon, authenticated;
