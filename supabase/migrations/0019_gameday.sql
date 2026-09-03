-- Gameday: the mode that only exists while the league is playing.
--
-- Every other mode is available at three in the morning in July. This one
-- opens three hours before the first kickoff of a real NFL gameday, restricts
-- the wheel to the franchises playing that day, and closes six hours after the
-- last whistle -- and it ranks on a board that belongs to that day and no
-- other. Tuesday's board is still there on Wednesday; it is simply finished.
--
-- Three deliberate decisions, in the order they matter.
--
-- **A gameday season reaches no other board.** Not the rating board, not
-- Scout's, not points. The wheel it was dealt from held two to twenty-six
-- franchises instead of thirty-two, which is a different game, and mixing the
-- two would quietly rank them together -- the mistake 0017 refused to make
-- when Scout arrived. Gameday seasons are kept, they are ranked, and they are
-- ranked among themselves.
--
-- **The server decides which gameday it is.** `gameday_key` has no insert
-- grant and is stamped by a trigger from the server's own clock. A client that
-- could name its own gameday could name last Sunday's, when the board is
-- already settled and the answer is known -- the same argument that made
-- `mode` a declaration and `assisted` a server fact.
--
-- **The calendar is a table, not a feed.** It is generated from nflverse's
-- schedule file by `pnpm --filter @18-0/data build:schedule` and loaded by the
-- same seed that loads the cards, so the client can read it offline, the
-- server reads the identical rows, and the window a season was played in can
-- be recomputed from the repository a year later.

-- ---------------------------------------------------------------------------
-- The calendar
-- ---------------------------------------------------------------------------

create table if not exists public.gamedays (
  -- The Eastern calendar date, `YYYY-MM-DD`: readable in a log, unique, and
  -- the same string the client resolves locally.
  key         text primary key,
  season      int  not null,
  week        int  not null,
  game_type   text not null check (game_type in ('REG','WC','DIV','CON','SB')),
  weekday     text not null,
  opens_at    timestamptz not null,
  closes_at   timestamptz not null,
  constraint gameday_window_is_forwards check (closes_at > opens_at)
);

comment on table public.gamedays is
  'One row per real NFL gameday, generated from the nflverse schedule. The '
  'window opens three hours before the first kickoff and closes six hours '
  'after the last, so a night game still gets a full run.';

create index if not exists gamedays_window_idx on public.gamedays (opens_at, closes_at);

create table if not exists public.gameday_franchises (
  gameday_key  text not null references public.gamedays(key) on delete cascade,
  franchise_id text not null references public.franchises(id),
  primary key (gameday_key, franchise_id)
);

comment on table public.gameday_franchises is
  'Which franchises play on a gameday. This is the spin pool for a gameday '
  'session: the wheel offers these franchises and no others.';

alter table public.gamedays          enable row level security;
alter table public.gameday_franchises enable row level security;

-- Idempotent, to match the `if not exists` above: this migration should be
-- re-runnable against a database where half of it already landed.
drop policy if exists "reference readable" on public.gamedays;
drop policy if exists "reference readable" on public.gameday_franchises;
create policy "reference readable" on public.gamedays           for select using (true);
create policy "reference readable" on public.gameday_franchises for select using (true);

grant select on public.gamedays, public.gameday_franchises to anon, authenticated;

/**
 * Which gameday it is, according to the server.
 *
 * `stable` rather than `immutable` because it reads the clock, and the trigger
 * below is the only thing whose answer must be authoritative -- the client
 * resolves the same question against the bundled calendar to decide what to
 * put on screen, and the two agree because they are built from one file.
 */
create or replace function public.current_gameday()
returns public.gamedays
language sql stable
set search_path = public, pg_temp
as $$
  select g.* from public.gamedays g
   where now() between g.opens_at and g.closes_at
   -- Most recently opened. The generated calendar has no overlapping windows
   -- -- the build refuses to write one -- so this only ever chooses between
   -- rows a human or a harness inserted, and the newest is the right answer
   -- there too.
   order by g.opens_at desc
   limit 1
$$;

grant execute on function public.current_gameday() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The column, and who is allowed to write it
-- ---------------------------------------------------------------------------

alter table public.game_sessions
  add column if not exists gameday_key text;

comment on column public.game_sessions.gameday_key is
  'The gameday this season was played on, stamped by the server from its own '
  'clock. Null for every ordinary season. Never client-writable: there is no '
  'insert grant on this column, and a client that could name its own gameday '
  'could enter a board that has already settled.';

-- Deliberately no foreign key. `gameday_franchises` cascades from `gamedays`
-- because it is derived from it, but a session is evidence and must survive
-- the calendar being rebuilt -- and a `truncate ... cascade` on `gamedays`
-- with a reference here would take real seasons with it. The trigger only
-- ever writes a key it has just read out of the table.
create index if not exists game_sessions_gameday_idx
  on public.game_sessions (gameday_key, final_rating desc)
  where gameday_key is not null;

grant select (gameday_key) on public.game_sessions to anon, authenticated;

-- `mode` gains a fourth value. The constraint arrived inline with the column
-- in 0017, so it is found by definition rather than by a name this file would
-- have to guess.
do $$
declare victim text;
begin
  for victim in
    select conname from pg_constraint
     where conrelid = 'public.game_sessions'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%player_iq%'
  loop
    execute format('alter table public.game_sessions drop constraint %I', victim);
  end loop;
end $$;

alter table public.game_sessions
  drop constraint if exists game_sessions_mode_check;

alter table public.game_sessions
  add constraint game_sessions_mode_check
  check (mode is null or mode in ('rookie', 'scout', 'player_iq', 'gameday'));

/**
 * Declaring Gameday stamps the day, or the session does not open.
 *
 * Raising rather than falling back to an ordinary season on purpose: a player
 * who tapped Gameday and got a normal run with a normal wheel has been handed
 * a different game than the one they asked for, and would only find out when
 * the board they expected to be on did not have them. Better to refuse the
 * session while nothing has been played.
 *
 * Gameday shows stat lines and withholds ratings -- Scout's visibility, which
 * is what makes a one-day board a fair contest without needing a mode column
 * of its own on top of this one. It is therefore not blind.
 */
create or replace function public.session_mode_implies_blind() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare today public.gamedays;
begin
  if new.mode = 'gameday' then
    -- A challenge is a duel replayed on the creator's seven spins, and a
    -- gameday run has to be dealt from that day's franchises. They cannot both
    -- decide the wheel, so a session is never both.
    if new.challenge_id is not null then
      raise exception 'a challenge cannot be played as a gameday'
        using errcode = '22023';
    end if;
    select * into today from public.current_gameday();
    if today.key is null then
      raise exception 'no gameday is open' using errcode = '22023';
    end if;
    new.gameday_key := today.key;
    new.blind := false;
  elsif new.mode is not null then
    -- Only the trigger writes this column, and only for a gameday.
    new.gameday_key := null;
    new.blind := (new.mode = 'player_iq');
  elsif new.blind then
    -- An older client that still declares only `blind`. Honour it.
    new.mode := 'player_iq';
    new.gameday_key := null;
  else
    new.mode := 'rookie';
    new.gameday_key := null;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Every board has to honour it
-- ---------------------------------------------------------------------------
--
-- Rewritten in full with every existing condition restated, for the reason
-- 0018 wrote down: 0009 rebuilt a view from a remembered definition and
-- silently dropped 0002's moderation filter for two migrations. The version
-- being replaced is the one to read.
--
-- The rating, Scout and perfect boards would already exclude a gameday season
-- by its mode. The filter is stated anyway, because "excluded as a side effect
-- of another predicate" is exactly how the moderation filter went missing.

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
  and g.gameday_key is null
  and p.is_permanent = true
  and p.handle is not null
  and p.handle_status = 'ok'
order by g.user_id, g.final_rating desc, g.completed_at asc;

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
    and g.blind = true
    and g.voided_at is null
    and g.gameday_key is null
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
  order by g.user_id, g.final_rating desc, g.completed_at asc;
$$;

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
    and g.voided_at is null
    and g.gameday_key is null
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
  order by g.user_id, g.final_rating desc, g.completed_at asc;
$$;

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
    and g.gameday_key is null
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
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
group by d.user_id, p.handle;

-- The points board is the one that would otherwise have swallowed gameday
-- seasons: it has no mode filter at all, on purpose, because it counts
-- everything a player finishes. Everything played on the same wheel.
create or replace view public.leaderboard_points
with (security_invoker = on) as
select g.user_id, p.handle,
  sum(public.season_points(g.final_rating, g.record_wins, g.ending_key))::bigint as points,
  count(*)::int as seasons,
  max(g.final_rating) as best_rating,
  max(g.completed_at) as last_played
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed'
  and g.assisted = false
  and g.voided_at is null
  and g.gameday_key is null
  and p.is_permanent = true
  and p.handle is not null
  and p.handle_status = 'ok'
group by g.user_id, p.handle;

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
    and g.voided_at is null
    and g.gameday_key is null
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
    and (since is null or g.completed_at >= since)
  group by g.user_id, p.handle;
$$;

-- ---------------------------------------------------------------------------
-- The board that belongs to one day
-- ---------------------------------------------------------------------------

/**
 * One day's board.
 *
 * `p_key` null means "whichever gameday is open now", which is what the app
 * asks for; naming a key reads a finished day, because a board that vanishes
 * at midnight is a board nobody can be shown they won.
 *
 * Same account and moderation rules as every other board, and the same refusal
 * to rank an assisted run: the three-finger spin is for looking at a perfect
 * roster, never for banking one.
 */
create or replace function public.leaderboard_gameday(p_key text default null)
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
  completed_at    timestamptz
)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select distinct on (g.user_id)
    g.gameday_key, g.id, g.user_id, p.handle, g.final_rating, g.record_wins,
    g.record_losses, g.ending_key, g.tier, g.completed_at
  from public.game_sessions g
  join public.profiles p on p.id = g.user_id
  where g.status = 'completed'
    and g.assisted = false
    and g.voided_at is null
    and g.gameday_key = coalesce(p_key, (select key from public.current_gameday()))
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok'
  order by g.user_id, g.final_rating desc, g.completed_at asc;
$$;

grant execute on function public.leaderboard_gameday(text) to anon, authenticated;

/**
 * How busy a gameday was, for the screen that has to say something when a
 * player has not finished a season yet.
 */
create or replace function public.gameday_summary(p_key text default null)
returns table (players bigint, seasons bigint, best_rating numeric)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select count(distinct g.user_id), count(*), max(g.final_rating)
  from public.game_sessions g
  join public.profiles p on p.id = g.user_id
  where g.status = 'completed'
    and g.assisted = false
    and g.voided_at is null
    and g.gameday_key = coalesce(p_key, (select key from public.current_gameday()))
    and p.is_permanent = true
    and p.handle is not null
    and p.handle_status = 'ok';
$$;

grant execute on function public.gameday_summary(text) to anon, authenticated;
