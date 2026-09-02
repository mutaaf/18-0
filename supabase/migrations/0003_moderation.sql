-- ---------------------------------------------------------------------------
-- Moderating the one piece of user-generated content in the game
--
-- A leaderboard handle is small, public, and permanent enough to be worth
-- abusing. App Store Review Guideline 1.2 asks three things of an app that
-- carries user-generated content: filter it, let people report it, and act on
-- reports in a timely way. This is all three, and the third one is the hard
-- one — "timely" cannot mean "whenever someone reads the queue", so a handle
-- that enough distinct people report comes off the board on its own and waits
-- for a human rather than the other way round.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Filtering, at the point a name is claimed
-- ---------------------------------------------------------------------------

create table public.handle_denylist (
  pattern     text primary key,
  kind        text not null check (kind in ('substring', 'regex')),
  reason      text not null check (reason in ('offensive', 'impersonation')),
  created_at  timestamptz not null default now()
);

alter table public.handle_denylist enable row level security;
revoke all on public.handle_denylist from anon, authenticated;

comment on table public.handle_denylist is
  'Substrings and patterns refused at claim time. Deliberately a table rather '
  'than a constant: the list will need to change without a deploy, and it '
  'should be possible to see what it currently contains.';

-- A starting list. It is not a content filter and does not pretend to be one —
-- it stops the names that impersonate the game or its operators, which is the
-- category a leaderboard actually attracts, and leaves the rest to reports.
insert into public.handle_denylist (pattern, kind, reason) values
  ('admin',      'substring', 'impersonation'),
  ('moderator',  'substring', 'impersonation'),
  ('official',   'substring', 'impersonation'),
  ('support',    'substring', 'impersonation'),
  ('staff',      'substring', 'impersonation'),
  ('18-0 team',  'substring', 'impersonation'),
  ('^18[-_ ]?0$', 'regex',    'impersonation');

/**
 * Refuse a disallowed handle at the moment it is claimed.
 *
 * A trigger rather than a CHECK constraint, because the rules live in a table
 * and CHECK cannot read one. Raises with a code the client can turn into a
 * sentence.
 */
create or replace function public.enforce_handle_policy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
begin
  if new.handle is null then
    return new;
  end if;

  select d.reason into v_reason
  from public.handle_denylist d
  where (d.kind = 'substring' and position(d.pattern in lower(new.handle)) > 0)
     or (d.kind = 'regex' and lower(new.handle) ~ d.pattern)
  limit 1;

  if v_reason is not null then
    raise exception 'handle_not_allowed:%', v_reason
      using errcode = 'check_violation';
  end if;

  -- Claiming a new name clears any moderation state attached to the old one:
  -- the decision was about a name, not about a person.
  if new.handle is distinct from old.handle then
    new.handle_status := 'ok';
    new.handle_set_at := now();
  end if;

  return new;
end;
$$;

create trigger profiles_handle_policy
  before insert or update of handle on public.profiles
  for each row execute function public.enforce_handle_policy();

-- ---------------------------------------------------------------------------
-- Reporting
-- ---------------------------------------------------------------------------

create table public.handle_reports (
  id               bigint generated always as identity primary key,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  -- Kept so the same person cannot report the same handle ten times, and
  -- nulled if they delete their account. The report survives the reporter.
  reporter_user_id uuid references auth.users(id) on delete set null,
  -- The handle as it read when it was reported. A report about a name that has
  -- since changed is about the old name, and a queue that cannot show what was
  -- actually reported is useless.
  reported_handle  text not null,
  reason           text not null check (reason in ('impersonation', 'offensive', 'spam', 'other')),
  note             text check (note is null or char_length(note) <= 280),
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz,
  resolution       text check (resolution in ('upheld', 'dismissed'))
);

create index handle_reports_queue_idx
  on public.handle_reports (created_at desc) where reviewed_at is null;
create index handle_reports_subject_idx on public.handle_reports (reported_user_id);

-- One open report per person per handle. Re-reporting the same name is not
-- more signal, it is the same signal twice.
create unique index handle_reports_one_open_per_reporter
  on public.handle_reports (reporter_user_id, reported_user_id)
  where reviewed_at is null;

alter table public.handle_reports enable row level security;

-- You may file a report as yourself, about somebody else.
create policy "file a report" on public.handle_reports
  for insert to authenticated
  with check (
    auth.uid() = reporter_user_id
    and reported_user_id <> auth.uid()
  );

-- And read back only your own, so the app can say "you reported this".
create policy "own reports readable" on public.handle_reports
  for select to authenticated
  using (auth.uid() = reporter_user_id);

revoke update, delete on public.handle_reports from anon, authenticated;
-- A reporter sets nothing but the report itself; the review columns are ours.
revoke insert on public.handle_reports from anon, authenticated;
grant insert (reported_user_id, reporter_user_id, reported_handle, reason, note)
  on public.handle_reports to authenticated;

/**
 * Take a handle off the board once enough distinct people have objected.
 *
 * This is the answer to "timely". A queue that only moves when a human reads
 * it is not timely at three in the morning, and the cost of provisionally
 * hiding a name that turns out to be fine is that somebody is briefly not on a
 * leaderboard. The cost of the other mistake is worse.
 */
create or replace function public.auto_flag_reported_handle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reporters integer;
begin
  select count(distinct reporter_user_id) into v_reporters
  from public.handle_reports
  where reported_user_id = new.reported_user_id
    and reviewed_at is null;

  if v_reporters >= 3 then
    update public.profiles
       set handle_status = 'flagged'
     where id = new.reported_user_id
       and handle_status = 'ok';
  end if;

  return new;
end;
$$;

create trigger handle_reports_auto_flag
  after insert on public.handle_reports
  for each row execute function public.auto_flag_reported_handle();

-- ---------------------------------------------------------------------------
-- The queue, and the two things a human can do with it
-- ---------------------------------------------------------------------------

create view public.ops_moderation_queue as
select
  r.reported_user_id,
  p.handle              as current_handle,
  p.handle_status,
  count(*)                              as reports,
  count(distinct r.reporter_user_id)    as reporters,
  min(r.created_at)                     as first_reported_at,
  max(r.created_at)                     as last_reported_at,
  array_agg(distinct r.reason)          as reasons,
  array_agg(distinct r.reported_handle) as handles_reported
from public.handle_reports r
left join public.profiles p on p.id = r.reported_user_id
where r.reviewed_at is null
group by r.reported_user_id, p.handle, p.handle_status
order by count(distinct r.reporter_user_id) desc, min(r.created_at) asc;

revoke all on public.ops_moderation_queue from anon, authenticated;

comment on view public.ops_moderation_queue is
  'Open reports, worst first. Service role only. Act on it with '
  'public.moderation_uphold() or public.moderation_dismiss().';

/** Hide the handle and close every open report against it. */
create or replace function public.moderation_uphold(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_closed integer;
begin
  update public.profiles set handle_status = 'hidden' where id = p_user;
  update public.handle_reports
     set reviewed_at = now(), resolution = 'upheld'
   where reported_user_id = p_user and reviewed_at is null;
  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;

/** Put the handle back and close every open report against it. */
create or replace function public.moderation_dismiss(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_closed integer;
begin
  update public.profiles set handle_status = 'ok' where id = p_user;
  update public.handle_reports
     set reviewed_at = now(), resolution = 'dismissed'
   where reported_user_id = p_user and reviewed_at is null;
  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;

revoke execute on function public.moderation_uphold(uuid) from anon, authenticated;
revoke execute on function public.moderation_dismiss(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Closing the grant that was never actually revoked
--
-- PostgreSQL grants EXECUTE on a new function to PUBLIC. Revoking it from
-- `anon, authenticated` — which is what 0002 did, and what the first draft of
-- this migration did — therefore achieves nothing: those roles were never
-- using a grant of their own, they were using PUBLIC's. Verification caught it
-- on `moderation_dismiss`, where any signed-in player could clear the flag on
-- their own handle, and the same hole was already live on
-- `consume_rate_limit`, where a player could burn through somebody else's rate
-- limit and lock them out.
--
-- PUBLIC is the revoke that matters. The others are kept for the reader.
-- ---------------------------------------------------------------------------

revoke execute on function public.moderation_uphold(uuid) from public;
revoke execute on function public.moderation_dismiss(uuid) from public;
revoke execute on function public.consume_rate_limit(uuid, text, integer, interval) from public;
