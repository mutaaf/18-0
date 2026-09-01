-- 18-0 schema (PRFAQ §27, §36)
--
-- The client is fully playable offline against the bundled dataset. This
-- database exists for the things that genuinely need a server: cross-device
-- history, leaderboards, and challenges. The server is authoritative for every
-- number that can be competed over.

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

-- One row per rated card. `rating` is the authoritative value: the client's
-- copy is a convenience, never a source of truth (PRFAQ §36).
create table public.season_cards (
  id                  text primary key,
  entity_id           text not null,
  entity_type         text not null check (entity_type in ('player','defense')),
  display_name        text not null,
  position            text not null check (position in ('QB','RB','WR','TE','DEF')),
  franchise_id        text not null references public.franchises(id),
  season_year         int  not null,
  era_key             text not null references public.eras(key),
  rating              numeric(5,2) not null,
  archetypes          text[] not null default '{}',
  rating_model_version text not null
);

create index season_cards_bucket_idx on public.season_cards (franchise_id, era_key, position, rating desc);
create index season_cards_entity_idx on public.season_cards (entity_id);

-- ---------------------------------------------------------------------------
-- Players and games
-- ---------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  handle       text unique check (char_length(handle) between 2 and 24),
  created_at   timestamptz not null default now()
);

create type public.game_status as enum ('in_progress','completed');

create table public.game_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references auth.users(id) on delete cascade,
  status                public.game_status not null default 'in_progress',
  created_at            timestamptz not null default now(),
  completed_at          timestamptz,
  rating_model_version  text,
  final_rating          numeric(6,4),
  record_wins           int,
  record_losses         int,
  ending_key            text,
  tier                  text,
  base_rating           numeric(6,4),
  weak_link_penalty     numeric(6,4),
  elite_bonus           numeric(6,4),
  chemistry_bonus       numeric(6,4),
  perfect_eligible      boolean,
  failed_gates          jsonb,
  -- The three-finger spin. Assisted runs are kept off every leaderboard.
  assisted              boolean not null default false,
  -- Blocks duplicate completion (PRFAQ §36).
  idempotency_key       text,
  -- Identifies the exact roster, so the same seven cards cannot be farmed.
  roster_fingerprint    text
);

create unique index game_sessions_idempotency_idx
  on public.game_sessions (user_id, idempotency_key)
  where idempotency_key is not null;

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
  share_token              text not null unique default encode(gen_random_bytes(9), 'base64'),
  creator_user_id          uuid not null references auth.users(id) on delete cascade,
  creator_game_session_id  uuid not null references public.game_sessions(id) on delete cascade,
  opponent_user_id         uuid references auth.users(id) on delete set null,
  opponent_game_session_id uuid references public.game_sessions(id) on delete set null,
  status                   text not null default 'open' check (status in ('open','complete','expired')),
  created_at               timestamptz not null default now(),
  completed_at             timestamptz
);

create index challenges_creator_idx on public.challenges (creator_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Leaderboards
-- ---------------------------------------------------------------------------

-- Only one entry per distinct roster per player, so spamming the same seven
-- cards cannot dominate the board (PRFAQ §22.7).
create view public.leaderboard_rating as
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

create view public.leaderboard_perfect as
select
  g.user_id,
  p.handle,
  count(*) filter (where g.ending_key = 'PERFECT')    as perfect_seasons,
  count(*) filter (where g.ending_key = 'HEARTBREAK') as heartbreaks,
  max(g.final_rating)                                  as best_rating,
  count(*)                                             as games_played
from public.game_sessions g
join public.profiles p on p.id = g.user_id
where g.status = 'completed' and g.assisted = false
group by g.user_id, p.handle;

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

-- Reference data is public and read-only to clients.
create policy "reference readable" on public.season_cards   for select using (true);
create policy "reference readable" on public.franchises     for select using (true);
create policy "reference readable" on public.franchise_eras for select using (true);
create policy "reference readable" on public.eras           for select using (true);

create policy "profiles readable" on public.profiles for select using (true);
create policy "own profile write" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- A completed game is public (it is on the leaderboard); an in-progress one is not.
create policy "completed games readable" on public.game_sessions
  for select using (status = 'completed' or user_id = auth.uid());
create policy "own games insert" on public.game_sessions
  for insert with check (user_id = auth.uid());
-- Deliberately no client UPDATE policy: results are written by the
-- complete-game Edge Function using the service role. A modified client
-- cannot post its own rating (PRFAQ §36).

create policy "own selections readable" on public.game_selections
  for select using (
    exists (select 1 from public.game_sessions g
            where g.id = game_session_id and (g.status = 'completed' or g.user_id = auth.uid()))
  );
create policy "own selections insert" on public.game_selections
  for insert with check (
    exists (select 1 from public.game_sessions g where g.id = game_session_id and g.user_id = auth.uid())
  );

create policy "own spins readable" on public.game_spins
  for select using (
    exists (select 1 from public.game_sessions g
            where g.id = game_session_id and (g.status = 'completed' or g.user_id = auth.uid()))
  );
create policy "own spins insert" on public.game_spins
  for insert with check (
    exists (select 1 from public.game_sessions g where g.id = game_session_id and g.user_id = auth.uid())
  );

create policy "challenges readable" on public.challenges for select using (true);
create policy "own challenge insert" on public.challenges
  for insert with check (creator_user_id = auth.uid());
create policy "join a challenge" on public.challenges
  for update using (status = 'open') with check (opponent_user_id = auth.uid());

-- A profile row for every new account.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, handle)
  values (new.id, 'player-' || substr(new.id::text, 1, 6))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
