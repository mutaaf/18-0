-- ---------------------------------------------------------------------------
-- Rating feedback: players telling us a card's rating looks wrong.
--
-- Players asked for the ratings to be "more realistic". The honest way to act
-- on that is evidence, not a mood: after a season a player can mark any of
-- their seven as rated too low or too high, and this table collects it.
--
-- It changes nothing by itself, on purpose. A rating is deterministic
-- (CLAUDE.md, invariant 1) and every published score depends on it, so
-- feedback is read by a person when the model is next refitted
-- (docs/scoring-model.md, "Player feedback"), and a change it motivates ships
-- as a new model version like any other. Nothing here is read by a
-- leaderboard, a score or the client's preview.
-- ---------------------------------------------------------------------------

create table public.rating_feedback (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  card_id        text not null references public.season_cards(id),
  -- The model that produced the rating the player saw. Feedback on 1.4.0 is
  -- about 1.4.0: once a refit moves a card, older opinions of it are about a
  -- number nobody sees any more, and the summary reads one version at a time.
  model_version  text not null check (char_length(model_version) between 1 and 20),
  -- The rating as displayed, so a reviewer sees what the player was reacting
  -- to without reconstructing it from the version.
  rating_shown   numeric(5, 1) not null check (rating_shown between 0 and 120),
  verdict        text not null check (verdict in ('too_low', 'too_high')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One opinion per person per card per model. Changing your mind updates it;
-- tapping the same arrow twice is the same opinion, not twice the signal.
create unique index rating_feedback_one_per_player
  on public.rating_feedback (user_id, card_id, model_version);
create index rating_feedback_card_idx on public.rating_feedback (model_version, card_id);

alter table public.rating_feedback enable row level security;

create policy "give feedback as yourself" on public.rating_feedback
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "change your own feedback" on public.rating_feedback
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "withdraw your own feedback" on public.rating_feedback
  for delete to authenticated
  using (auth.uid() = user_id);

create policy "read your own feedback" on public.rating_feedback
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.rating_feedback from anon;
revoke insert, update on public.rating_feedback from authenticated;
-- The client upserts, and PostgREST's upsert names every column it sent in its
-- ON CONFLICT ... DO UPDATE, so update needs the key columns too. The policy's
-- check still pins user_id to the caller; updated_at is the trigger's.
grant insert (user_id, card_id, model_version, rating_shown, verdict),
      update (user_id, card_id, model_version, rating_shown, verdict)
  on public.rating_feedback to authenticated;

/**
 * A brake on automation, not on opinions: a person rating seven cards after
 * every season for an evening stays far under it, and a script does not.
 */
create or replace function public.rating_feedback_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.consume_rate_limit(new.user_id, 'rating_feedback', 120, '1 hour') then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger rating_feedback_guard
  before insert or update on public.rating_feedback
  for each row execute function public.rating_feedback_guard();

-- ---------------------------------------------------------------------------
-- What a reviewer reads: per card, per model, how many distinct people think
-- it is too low or too high. Operators only.
-- ---------------------------------------------------------------------------

create view public.ops_rating_feedback as
select
  f.model_version,
  f.card_id,
  c.display_name,
  c.position,
  c.season_year,
  c.franchise_id,
  c.rating                                                       as rating_now,
  round(avg(f.rating_shown), 1)                                  as rating_shown,
  count(*) filter (where f.verdict = 'too_low')                  as too_low,
  count(*) filter (where f.verdict = 'too_high')                 as too_high,
  count(*)                                                       as voters,
  count(*) filter (where f.verdict = 'too_low')
    - count(*) filter (where f.verdict = 'too_high')             as net,
  max(f.updated_at)                                              as last_at
from public.rating_feedback f
join public.season_cards c on c.id = f.card_id
group by f.model_version, f.card_id, c.display_name, c.position, c.season_year, c.franchise_id, c.rating
order by f.model_version desc, count(*) desc, abs(
  count(*) filter (where f.verdict = 'too_low') - count(*) filter (where f.verdict = 'too_high')
) desc;

revoke all on public.ops_rating_feedback from anon, authenticated;
