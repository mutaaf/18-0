-- Levels, streak multipliers, and letting a player take a season off the board.
--
-- Three things, and the first one decides the shape of the other two.
--
-- **A multiplier is stamped, never computed on read.** `season_points()` is
-- immutable and evaluated every time a board is queried, so a multiplier
-- expressed there would not reward a streak -- it would silently rewrite the
-- lifetime total of every player who ever had one, every time the number was
-- looked at. The backlog warned about this before anything was built. So the
-- multiplier is decided once, by the server, at the moment a season is scored,
-- and stored on the row. What you earned on Tuesday stays what you earned.
--
-- **Multipliers reward returning, not grinding.** Points are already the sum of
-- every season, so volume is rewarded linearly by construction; a per-hour
-- bonus on top of that would pay twice for the same thing and make a marathon
-- worth more than a habit. The streak terms are therefore the large ones and
-- the volume terms are small and capped -- enough to notice a sitting, not
-- enough to make farming the dominant strategy.
--
-- **A player may hide a season, never reveal one.** Opting *out* after seeing a
-- score is safe: a best-of board keeps your best, and points are a sum of
-- positive terms, so hiding only ever costs you. Opting *in* after seeing a
-- score is the oldest cheat there is -- play ten, submit the good one -- and it
-- is not merely disallowed here, it is impossible: a casual season's spins were
-- never issued by the server, so there is nothing to verify.

-- ---------------------------------------------------------------------------
-- What a season was worth, and whether its owner wants it seen
-- ---------------------------------------------------------------------------

alter table public.game_sessions
  add column if not exists points_multiplier numeric(4,2) not null default 1.00
    check (points_multiplier >= 1.00 and points_multiplier <= 3.00),
  add column if not exists multiplier_detail jsonb,
  add column if not exists hidden_at timestamptz;

comment on column public.game_sessions.points_multiplier is
  'Stamped by complete-game from the server clock when the season was scored, '
  'and never recomputed. A streak earned in September is still worth what it '
  'was worth in September.';

comment on column public.game_sessions.hidden_at is
  'Set by the player to take their own season off every board. Distinct from '
  'voided_at, which is an operator action: this one is self-inflicted, always '
  'costs the player points, and is therefore safe to allow after a score is '
  'known.';

-- The client may write neither. The multiplier is a server fact, and hiding
-- goes through an RPC so it can be audited.
grant select (points_multiplier, multiplier_detail, hidden_at)
  on public.game_sessions to anon, authenticated;

create index if not exists game_sessions_hidden_idx
  on public.game_sessions (hidden_at) where hidden_at is not null;

-- ---------------------------------------------------------------------------
-- Deciding the multiplier
-- ---------------------------------------------------------------------------

/**
 * What a player's next season is worth, right now.
 *
 * Called by complete-game with the service role at the moment of scoring, and
 * by the client read-only so a player can see what they are playing for before
 * they play. Both get the same answer because both ask the same question of the
 * same clock -- the number is not negotiated between them.
 *
 * The terms, and why they are sized the way they are:
 *
 *   days in a row    +6% each, to +60%   the habit this is trying to build
 *   weeks in a row   +8% each, to +40%   the longer version of the same habit
 *   seasons today    +2% each, to +10%   acknowledges a sitting
 *   seasons this hour +1% each, to +5%   the smallest term on purpose
 *
 * A day counts when a season was completed on it, in UTC. Not the player's
 * local midnight: the server has no reliable idea where they are, and a
 * client-supplied timezone is a client-supplied streak.
 */
create or replace function public.points_multiplier_for(p_user uuid)
returns table (multiplier numeric, day_streak int, week_streak int, today int, this_hour int)
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_days int := 0;
  v_weeks int := 0;
  v_today int := 0;
  v_hour int := 0;
  d date;
  w date;
begin
  select count(*) into v_today
    from public.game_sessions
   where user_id = p_user and status = 'completed'
     and completed_at >= date_trunc('day', now());

  select count(*) into v_hour
    from public.game_sessions
   where user_id = p_user and status = 'completed'
     and completed_at >= now() - interval '1 hour';

  -- Walk back from today while each day has a season on it. Counting distinct
  -- days and comparing to a span would call a fortnight with a hole in it a
  -- fourteen-day streak.
  d := current_date;
  loop
    exit when not exists (
      select 1 from public.game_sessions
       where user_id = p_user and status = 'completed'
         and completed_at >= d and completed_at < d + 1
    );
    v_days := v_days + 1;
    d := d - 1;
    -- A streak is a habit, not a monument. Past the cap it stops paying, so
    -- there is no need to count into the thousands.
    exit when v_days >= 10;
  end loop;

  w := date_trunc('week', current_date)::date;
  loop
    exit when not exists (
      select 1 from public.game_sessions
       where user_id = p_user and status = 'completed'
         and completed_at >= w and completed_at < w + 7
    );
    v_weeks := v_weeks + 1;
    w := w - 7;
    exit when v_weeks >= 5;
  end loop;

  return query select
    round(
      1.00
      + least(v_days, 10) * 0.06
      + least(v_weeks, 5)  * 0.08
      + least(v_today, 5)  * 0.02
      + least(v_hour, 5)   * 0.01
    , 2),
    v_days, v_weeks, v_today, v_hour;
end $$;

grant execute on function public.points_multiplier_for(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Levels
-- ---------------------------------------------------------------------------

/**
 * The level a points total has earned.
 *
 * Each level costs more than the last, so the number keeps moving early and
 * still means something late: level n begins at 1000 * (n-1)^1.6 -- level 2 at
 * 1,000, level 10 at about 33,600, level 25 at about 154,000. One finished
 * season is worth roughly 10,000-13,000 points before any multiplier, so a
 * first game lands somewhere around level 5 and nobody stares at level 1.
 *
 * Deliberately a pure function of points rather than a stored column: a level
 * that could drift out of step with the total it describes is a level nobody
 * can trust, and there is nothing here worth caching.
 */
create or replace function public.level_for_points(p_points bigint)
returns int language sql immutable parallel safe as $$
  select greatest(1, floor(power(greatest(coalesce(p_points, 0), 0) / 1000.0, 1.0 / 1.6)) + 1)::int
$$;

create or replace function public.points_for_level(p_level int)
returns bigint language sql immutable parallel safe as $$
  select case when p_level <= 1 then 0
              else round(1000.0 * power(p_level - 1, 1.6))::bigint end
$$;

grant execute on function public.level_for_points(bigint) to anon, authenticated;
grant execute on function public.points_for_level(int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Hiding a season
-- ---------------------------------------------------------------------------

/**
 * Takes one of your own seasons off every board.
 *
 * Definer rights because `game_sessions` has no update grant at all -- results
 * are service-role only, and that is what stops a client editing a score. This
 * function is the one exception, and it is a safe one: it writes a single
 * timestamp on a row the caller owns, and the effect is always to lower them.
 */
create or replace function public.hide_own_season(p_session uuid, p_hidden boolean default true)
returns void language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  update public.game_sessions
     set hidden_at = case when p_hidden then now() else null end
   where id = p_session
     and user_id = auth.uid()
     and status = 'completed';

  if not found then
    raise exception 'no completed season of yours with that id' using errcode = '42501';
  end if;

  insert into public.audit_events (request_id, actor_id, event, outcome, subject_type, subject_id, detail)
  values (gen_random_uuid(), auth.uid(), 'season_visibility_changed', 'ok', 'game_session',
          p_session::text, jsonb_build_object('hidden', p_hidden));
end $$;

revoke execute on function public.hide_own_season(uuid, boolean) from public;
grant execute on function public.hide_own_season(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Every board honours both
-- ---------------------------------------------------------------------------
--
-- Restated in full, as always: 0009 rebuilt a view from a remembered version
-- and dropped a moderation filter for two migrations.

create or replace view public.leaderboard_rating
with (security_invoker = on) as
select distinct on (g.user_id)
  g.id as game_session_id, g.user_id, p.handle, g.final_rating,
  g.record_wins, g.record_losses, g.ending_key, g.tier, g.completed_at
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed' and g.assisted = false and g.blind = true
  and g.voided_at is null and g.hidden_at is null
  and p.is_permanent = true and p.handle is not null and p.handle_status = 'ok'
order by g.user_id, g.final_rating desc, g.completed_at asc;

create or replace view public.leaderboard_scout
with (security_invoker = on) as
select distinct on (g.user_id)
  g.id as game_session_id, g.user_id, p.handle, g.final_rating,
  g.record_wins, g.record_losses, g.ending_key, g.tier, g.completed_at
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed' and g.assisted = false and g.mode = 'scout'
  and g.voided_at is null and g.hidden_at is null
  and p.is_permanent = true and p.handle is not null and p.handle_status = 'ok'
order by g.user_id, g.final_rating desc, g.completed_at asc;

-- Points now multiply each season by what it was stamped with, and carry the
-- level the total has earned so no caller has to know the curve.
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
  -- Appended rather than placed next to `points` where it belongs: CREATE OR
  -- REPLACE VIEW may only add columns at the end, and renaming one in the
  -- middle is what it refuses. Position in a view is not worth a drop-cascade.
  public.level_for_points(
    sum(round(public.season_points(g.final_rating, g.record_wins, g.ending_key)
              * g.points_multiplier))::bigint) as level
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed' and g.assisted = false
  and g.voided_at is null and g.hidden_at is null
  and p.is_permanent = true and p.handle is not null and p.handle_status = 'ok'
group by g.user_id, p.handle;

grant select on public.leaderboard_points to anon, authenticated;

/**
 * Your own standing, including the seasons nobody else can see.
 *
 * The account screen needs a level, the points behind it, and how far the next
 * one is. Reading that off the public board would be wrong twice: it excludes
 * a hidden season (correct for others, misleading for you) and it does not
 * exist at all until a handle is claimed.
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
      -- Hidden seasons are counted but not paid for, which is the whole point
      -- of being able to hide one. Filtering them in the WHERE clause instead
      -- made `hidden` structurally zero.
      coalesce(sum(round(public.season_points(g.final_rating, g.record_wins, g.ending_key)
                         * g.points_multiplier))
               filter (where g.hidden_at is null), 0)::bigint as pts,
      count(*) filter (where g.hidden_at is null)::int as shown,
      count(*) filter (where g.hidden_at is not null)::int as hid,
      coalesce(max(g.points_multiplier) filter (where g.hidden_at is null), 1.00) as best
    from public.game_sessions g
    where g.user_id = auth.uid() and g.status = 'completed'
      and g.assisted = false and g.voided_at is null
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
