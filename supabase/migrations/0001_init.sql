-- 18-0 schema (PRFAQ §27, §36)
--
-- The client is fully playable offline against the bundled dataset. This
-- database exists only for what genuinely needs a server: cross-device history,
-- leaderboards and challenges.
--
-- THREAT MODEL (§36): a modified client must not be able to post a score it did
-- not earn. That requires three things, and all three are enforced here:
--   1. The client may only ever INSERT an *empty, in-progress* session. Result
--      columns are unwritable by any client role. RLS is row-level, not
--      column-level, so this is enforced with both a WITH CHECK predicate and
--      column-level GRANTs.
--   2. Spins are issued by the server and recorded in `game_spins`. A client
--      cannot declare which franchise-eras it was offered, so it cannot pick
--      the seven buckets holding the best cards in the dataset.
--   3. Results are written only by the `complete-game` Edge Function using the
--      service role, which re-derives the score from card ids.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Reference data (mirrors the bundled dataset, loaded by supabase/seed)
-- ---------------------------------------------------------------------------

create table public.eras (
  key         text primary key,
  label       text not null,
  start_year  int  not null,
  end_year    int  not null,
  sort_order  int  not null
);

create table public.franchises (
  id            text primary key,
  abbreviation  text not null,
  display_name  text not null,
  nickname      text not null,
  conference    text,
  primary_color text,
  logo_url      text
);

create table public.franchise_eras (
  franchise_id text not null references public.franchises(id) on delete cascade,
  era_key      text not null references public.eras(key) on delete cascade,
  spin_weight  numeric not null default 1,
  primary key (franchise_id, era_key)
);

create table public.season_cards (
  id                   text primary key,
  entity_id            text not null,
  entity_type          text not null check (entity_type in ('player','defense')),
  display_name         text not null,
  position             text not null check (position in ('QB','RB','WR','TE','DEF')),
  franchise_id         text not null references public.franchises(id),
  season_year          int  not null,
  era_key              text not null references public.eras(key),
  rating               numeric(5,2) not null,
  archetypes           text[] not null default '{}',
  rating_model_version text not null
);

create index season_cards_bucket_idx on public.season_cards (franchise_id, era_key, position, rating desc);
create index season_cards_entity_idx on public.season_cards (entity_id);

-- ---------------------------------------------------------------------------
-- Players and games
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  handle     text unique check (char_length(handle) between 2 and 32),
  created_at timestamptz not null default now()
);

create type public.game_status as enum ('in_progress','completed');

create table public.game_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  status                public.game_status not null default 'in_progress',
  created_at            timestamptz not null default now(),
  completed_at          timestamptz,
  rating_model_version  text,
  -- numeric(6,4) tops out at 99.9999; a perfect roster scores exactly 100.
  final_rating          numeric(8,4),
  record_wins           int,
  record_losses         int,
  ending_key            text,
  tier                  text,
  base_rating           numeric(8,4),
  weak_link_penalty     numeric(8,4),
  elite_bonus           numeric(8,4),
  chemistry_bonus       numeric(8,4),
  perfect_eligible      boolean,
  failed_gates          jsonb,
  -- The three-finger spin. Set server-side when a rigged spin is issued, so a
  -- client cannot claim an assisted run was clean.
  assisted              boolean not null default false,
  -- Mandatory, so a completion can never silently lose its replay protection.
  idempotency_key       text not null,
  roster_fingerprint    text,
  constraint completed_rows_are_scored check (
    status <> 'completed' or (
      final_rating is not null and record_wins is not null
      and record_losses is not null and ending_key is not null
      and roster_fingerprint is not null
    )
  )
);

-- Not partial: a NULL key would silently opt out of replay protection.
create unique index game_sessions_idempotency_idx
  on public.game_sessions (user_id, idempotency_key);

create index game_sessions_user_idx on public.game_sessions (user_id, completed_at desc);
create index game_sessions_leaderboard_idx
  on public.game_sessions (final_rating desc, completed_at asc)
  where status = 'completed' and assisted = false;

create table public.game_spins (
  id              uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions(id) on delete cascade,
  sequence        int  not null,
  franchise_id    text not null references public.franchises(id),
  era_key         text not null references public.eras(key),
  created_at      timestamptz not null default now(),
  unique (game_session_id, sequence)
);

create table public.game_selections (
  id              uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions(id) on delete cascade,
  roster_slot     text not null check (roster_slot in ('QB','RB1','RB2','WR1','WR2','TE1','DEF')),
  card_id         text not null references public.season_cards(id),
  spin_sequence   int  not null,
  unique (game_session_id, roster_slot)
);

-- ---------------------------------------------------------------------------
-- Challenges (PRFAQ §22.8)
-- ---------------------------------------------------------------------------

create table public.challenges (
  id                       uuid primary key default gen_random_uuid(),
  -- URL-safe: base64 would emit '+' and '/', which break a share link.
  share_token              text not null unique
                             default translate(encode(gen_random_bytes(9), 'base64'), '+/', '-_'),
  creator_user_id          uuid not null references public.profiles(id) on delete cascade,
  creator_game_session_id  uuid not null references public.game_sessions(id) on delete cascade,
  opponent_user_id         uuid references public.profiles(id) on delete set null,
  opponent_game_session_id uuid references public.game_sessions(id) on delete set null,
  status                   text not null default 'open' check (status in ('open','complete','expired')),
  created_at               timestamptz not null default now(),
  completed_at             timestamptz
);

create index challenges_creator_idx on public.challenges (creator_user_id, created_at desc);
create index challenges_opponent_idx on public.challenges (opponent_user_id);

-- The creator's half of a challenge is immutable once created; RLS cannot pin
-- individual columns, so a trigger does it.
create function public.challenges_guard() returns trigger
language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.share_token is distinct from old.share_token
     or new.creator_user_id is distinct from old.creator_user_id
     or new.creator_game_session_id is distinct from old.creator_game_session_id then
    raise exception 'challenge creator fields are immutable';
  end if;
  return new;
end $$;

create trigger challenges_guard_upd before update on public.challenges
  for each row execute function public.challenges_guard();

-- ---------------------------------------------------------------------------
-- Leaderboards
-- ---------------------------------------------------------------------------

-- `security_invoker` matters: without it a view runs with its OWNER's rights and
-- silently bypasses RLS on the tables beneath it.
create view public.leaderboard_rating
with (security_invoker = on) as
select distinct on (g.user_id, g.roster_fingerprint)
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
order by g.user_id, g.roster_fingerprint, g.final_rating desc, g.completed_at asc;

-- Windowed boards filter BEFORE deduping, so a player's best run three months
-- ago cannot suppress their qualifying run from this week.
create function public.leaderboard_rating_since(since timestamptz default null)
returns table (
  game_session_id uuid, user_id uuid, handle text, final_rating numeric,
  record_wins int, record_losses int, ending_key text, tier text, completed_at timestamptz
)
language sql stable security invoker as $$
  select distinct on (g.user_id, g.roster_fingerprint)
    g.id, g.user_id, p.handle, g.final_rating, g.record_wins,
    g.record_losses, g.ending_key, g.tier, g.completed_at
  from public.game_sessions g
  join public.profiles p on p.id = g.user_id
  where g.status = 'completed'
    and g.assisted = false
    and (since is null or g.completed_at >= since)
  order by g.user_id, g.roster_fingerprint, g.final_rating desc, g.completed_at asc;
$$;

-- Deduped by roster, so the same seven cards cannot be farmed for counts.
create view public.leaderboard_perfect
with (security_invoker = on) as
with distinct_rosters as (
  select distinct on (g.user_id, g.roster_fingerprint)
    g.user_id, g.ending_key, g.final_rating
  from public.game_sessions g
  where g.status = 'completed' and g.assisted = false
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

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles        enable row level security;
alter table public.game_sessions   enable row level security;
alter table public.game_spins      enable row level security;
alter table public.game_selections enable row level security;
alter table public.challenges      enable row level security;
alter table public.season_cards    enable row level security;
alter table public.franchises      enable row level security;
alter table public.franchise_eras  enable row level security;
alter table public.eras            enable row level security;

-- Reference data is public and read-only.
create policy "reference readable" on public.season_cards   for select using (true);
create policy "reference readable" on public.franchises     for select using (true);
create policy "reference readable" on public.franchise_eras for select using (true);
create policy "reference readable" on public.eras           for select using (true);

create policy "profiles readable" on public.profiles for select using (true);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- A client may open an EMPTY session and nothing else. Every result column must
-- be null at insert time; the Edge Function fills them with the service role.
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
  );

create policy "completed games readable" on public.game_sessions
  for select using (status = 'completed' or user_id = auth.uid());

-- No UPDATE or DELETE policy: results are service-role only.

create policy "own selections readable" on public.game_selections
  for select using (
    exists (select 1 from public.game_sessions g
            where g.id = game_session_id and (g.status = 'completed' or g.user_id = auth.uid()))
  );

create policy "own spins readable" on public.game_spins
  for select using (
    exists (select 1 from public.game_sessions g
            where g.id = game_session_id and (g.status = 'completed' or g.user_id = auth.uid()))
  );

-- Spins and selections are written by the server, never by a client.

create policy "own challenges readable" on public.challenges
  for select to authenticated
  using (creator_user_id = auth.uid() or opponent_user_id = auth.uid());

create policy "own challenge insert" on public.challenges
  for insert to authenticated
  with check (
    creator_user_id = auth.uid()
    and opponent_user_id is null
    and status = 'open'
    and exists (select 1 from public.game_sessions g
                where g.id = creator_game_session_id
                  and g.user_id = auth.uid()
                  and g.status = 'completed')
  );

create policy "join a challenge" on public.challenges
  for update to authenticated
  using (status = 'open' and opponent_user_id is null and creator_user_id <> auth.uid())
  with check (
    status = 'complete'
    and opponent_user_id = auth.uid()
    and exists (select 1 from public.game_sessions g
                where g.id = opponent_game_session_id
                  and g.user_id = auth.uid()
                  and g.status = 'completed')
  );

-- ---------------------------------------------------------------------------
-- Column-level grants — belt and braces behind the RLS predicates above
-- ---------------------------------------------------------------------------

revoke insert, update, delete on public.game_sessions from anon, authenticated;
grant insert (id, user_id, status, idempotency_key) on public.game_sessions to authenticated;

revoke select on public.game_sessions from anon, authenticated;
grant select (id, user_id, status, created_at, completed_at, rating_model_version,
              final_rating, record_wins, record_losses, ending_key, tier,
              base_rating, weak_link_penalty, elite_bonus, chemistry_bonus,
              perfect_eligible, failed_gates, assisted, roster_fingerprint)
  on public.game_sessions to anon, authenticated;

grant select on public.leaderboard_rating, public.leaderboard_perfect to anon, authenticated;
grant execute on function public.leaderboard_rating_since(timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- A profile for every new account
-- ---------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  candidate text;
begin
  -- 12 hex characters: collisions are not a practical concern, and the loop
  -- below means a signup can never fail on a duplicate handle.
  candidate := 'player-' || substr(replace(new.id::text, '-', ''), 1, 12);
  begin
    insert into public.profiles (id, handle) values (new.id, candidate);
  exception when unique_violation then
    insert into public.profiles (id, handle)
    values (new.id, 'player-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
    on conflict (id) do nothing;
  end;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
