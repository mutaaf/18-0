-- Challenges: close the loop.
--
-- The table has existed since 0001 and a challenge could be created, but there
-- was no way to answer one. There was no read path for a recipient (the select
-- policy only admits the creator and an already-attached opponent, so someone
-- holding a share link could not even see what they had been sent), no way to
-- be dealt the same wheel the creator was dealt, and nothing that resolved a
-- challenge once both sides had played. A share link led to the front page.
--
-- Four pieces, all server-side, because every one of them is a place a client
-- could otherwise lie:
--
--   1. `game_sessions.challenge_id`, so a session declares up front which
--      challenge it answers -- before it is played, not after it is scored.
--   2. `challenge_by_token`, a definer-rights read that gives a holder of the
--      link exactly what they need to decide: who, what score, still open?
--      Never the creator's roster, which is the answer sheet.
--   3. A resolver on the session itself, so a challenge closes the moment the
--      opponent's game is scored. Not a call the client makes afterwards, and
--      so not a call the client can decline to make after losing.
--   4. Expiry, computed rather than stored, so an abandoned challenge stops
--      being an open invitation without a job having to run.
--
-- The spin function is what makes the duel fair: it replays the creator's
-- franchise-era sequence for a session that carries a challenge_id. Both
-- rosters are then built from the same seven wheels, which is the only reading
-- of "head to head" this game can honestly support.

-- ---------------------------------------------------------------------------
-- 1. A session can answer a challenge
-- ---------------------------------------------------------------------------

alter table public.game_sessions
  add column if not exists challenge_id uuid references public.challenges(id) on delete set null;

create index if not exists game_sessions_challenge_idx
  on public.game_sessions (challenge_id)
  where challenge_id is not null;

-- Column grants are exhaustive on this table, so a new column is invisible and
-- unwritable until it is named here.
grant insert (challenge_id) on public.game_sessions to authenticated;
grant select (challenge_id) on public.game_sessions to anon, authenticated;

-- A session may only point at a challenge that is open, that someone else
-- created, and that this player has not already answered. Everything the insert
-- policy checked before still has to hold, so the whole policy is restated.
drop policy if exists "open an empty session" on public.game_sessions;
create policy "open an empty session" on public.game_sessions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'in_progress'
    and assisted = false
    and completed_at is null
    and final_rating is null
    and record_wins is null and record_losses is null
    and ending_key is null and tier is null
    and base_rating is null and weak_link_penalty is null
    and elite_bonus is null and chemistry_bonus is null
    and perfect_eligible is null and failed_gates is null
    and roster_fingerprint is null
    and rating_model_version is null
    and (
      challenge_id is null
      or exists (
        select 1 from public.challenges c
        where c.id = challenge_id
          and c.status = 'open'
          and c.creator_user_id <> auth.uid()
          and c.created_at > now() - interval '30 days'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Reading a challenge you were sent
-- ---------------------------------------------------------------------------

/**
 * An open challenge goes stale rather than staying an open invitation forever.
 * Computed, not stored: a stored flag needs a job to set it, and a job that
 * does not run is a challenge that never expires.
 */
create or replace function public.challenge_expired(
  status text, created_at timestamptz
) returns boolean language sql immutable parallel safe as $$
  select status = 'open' and created_at <= now() - interval '30 days'
$$;

/**
 * What a link holder is allowed to know.
 *
 * Definer rights, because the point is to show a challenge to someone who is
 * not yet party to it -- which is precisely who the select policy excludes.
 * The exposure is deliberately narrow: who made it, what they scored, whether
 * it is still open, and whether you have already answered. Never the creator's
 * roster or the cards behind their score, which would turn a duel into a copy.
 */
create or replace function public.challenge_by_token(p_token text)
returns table (
  id                uuid,
  status            text,
  created_at        timestamptz,
  creator_handle    text,
  creator_rating    numeric,
  creator_wins      int,
  creator_losses    int,
  creator_ending    text,
  creator_tier      text,
  creator_assisted  boolean,
  opponent_handle   text,
  opponent_rating   numeric,
  opponent_wins     int,
  opponent_losses   int,
  viewer_is_creator boolean,
  viewer_session_id uuid,
  viewer_status     text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    case when public.challenge_expired(c.status, c.created_at) then 'expired' else c.status end,
    c.created_at,
    cp.handle,
    cg.final_rating,
    cg.record_wins,
    cg.record_losses,
    cg.ending_key,
    cg.tier,
    cg.assisted,
    op.handle,
    og.final_rating,
    og.record_wins,
    og.record_losses,
    c.creator_user_id = auth.uid(),
    mine.id,
    mine.status::text
  from public.challenges c
  join public.profiles      cp on cp.id = c.creator_user_id
  join public.game_sessions cg on cg.id = c.creator_game_session_id
  left join public.profiles      op on op.id = c.opponent_user_id
  left join public.game_sessions og on og.id = c.opponent_game_session_id
  -- Your own attempt at this challenge, if you have one. Most recent wins, so
  -- an abandoned session does not hide a finished one.
  left join lateral (
    select g.id, g.status
    from public.game_sessions g
    where g.challenge_id = c.id
      and g.user_id = auth.uid()
    order by (g.status = 'completed') desc, g.created_at desc
    limit 1
  ) mine on true
  where c.share_token = p_token
$$;

revoke execute on function public.challenge_by_token(text) from public;
grant execute on function public.challenge_by_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Resolving, at the moment the answer is scored
-- ---------------------------------------------------------------------------

/**
 * Attaches a finished session to the challenge it declared.
 *
 * On the session, not on a client call. A challenge that resolved because the
 * loser remembered to report it is not a challenge; this fires inside the same
 * transaction that scores the game, so the only way to avoid recording a loss
 * is to not finish the game.
 *
 * First finisher takes the slot. A challenge is one-to-one by its own columns,
 * and re-opening it for a better attempt would let a player grind the same
 * link until they won.
 */
create or replace function public.resolve_challenge() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.challenge_id is null or new.status <> 'completed' then
    return new;
  end if;

  update public.challenges
     set opponent_user_id         = new.user_id,
         opponent_game_session_id = new.id,
         status                   = 'complete',
         completed_at             = now()
   where id = new.challenge_id
     and status = 'open'
     and opponent_user_id is null
     and creator_user_id <> new.user_id;

  return new;
end $$;

drop trigger if exists resolve_challenge_on_completion on public.game_sessions;
create trigger resolve_challenge_on_completion
  after update of status on public.game_sessions
  for each row
  when (new.status = 'completed' and new.challenge_id is not null)
  execute function public.resolve_challenge();

-- The creator half is immutable, and the guard from 0001 says so. It must keep
-- saying so now that the opponent half is written by a trigger rather than by
-- the "join a challenge" policy, which the trigger bypasses on definer rights.

-- ---------------------------------------------------------------------------
-- 4. Your own challenges, both sides of them
-- ---------------------------------------------------------------------------

/**
 * Every challenge you are party to, with both scores and who won.
 *
 * A view rather than a query in the client because "who won" is a rule, and a
 * rule that lives in the client is a rule each screen gets to reinvent.
 */
create or replace view public.my_challenges
with (security_invoker = on) as
select
  c.id,
  c.share_token,
  case when public.challenge_expired(c.status, c.created_at) then 'expired' else c.status end as status,
  c.created_at,
  c.completed_at,
  c.creator_user_id,
  c.opponent_user_id,
  cp.handle          as creator_handle,
  cg.final_rating    as creator_rating,
  cg.record_wins     as creator_wins,
  cg.record_losses   as creator_losses,
  op.handle          as opponent_handle,
  og.final_rating    as opponent_rating,
  og.record_wins     as opponent_wins,
  og.record_losses   as opponent_losses,
  case
    when c.opponent_game_session_id is null then null
    when og.final_rating > cg.final_rating  then c.opponent_user_id
    when cg.final_rating > og.final_rating  then c.creator_user_id
    else null                                       -- a genuine tie, to the decimal
  end as winner_user_id
from public.challenges c
join public.profiles      cp on cp.id = c.creator_user_id
join public.game_sessions cg on cg.id = c.creator_game_session_id
left join public.profiles      op on op.id = c.opponent_user_id
left join public.game_sessions og on og.id = c.opponent_game_session_id;

grant select on public.my_challenges to authenticated;
grant execute on function public.challenge_expired(text, timestamptz) to anon, authenticated;
