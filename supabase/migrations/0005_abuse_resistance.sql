-- ---------------------------------------------------------------------------
-- Make the cheap attacks expensive
--
-- 0004 stopped a player undoing moderation against themselves. This closes the
-- opposite direction — using moderation, and the write paths around it, against
-- everybody else — plus the write paths that reach Postgres directly and were
-- therefore never rate limited at all.
--
-- The common thread is that anonymous sign-in is free and instant, so anything
-- keyed only on "who is asking" costs an attacker nothing. Each fix below
-- attaches a cost that a throwaway identity cannot pay.
-- ---------------------------------------------------------------------------

-- --- 1. Reporting requires standing ----------------------------------------

/**
 * Has this account actually played?
 *
 * Three reporters take a handle off the board. Sign-in is free, so that was
 * three throwaway identities and any player — including whoever is top of the
 * leaderboard — could be removed by anyone, at no cost, in under a minute.
 *
 * Standing is one completed, unassisted ranked game. That is deliberately
 * something a griefer cannot mint: it needs seven server-issued spins, seven
 * recorded picks and a server-side score, and the assisted flag is set by the
 * server rather than claimed by the client. A real player has it already
 * without ever being asked for it.
 */
create or replace function public.has_standing(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.game_sessions
    where user_id = p_user and status = 'completed' and assisted = false
  );
$$;

revoke execute on function public.has_standing(uuid) from public;

create or replace function public.enforce_report_standing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The server role reports on nobody's behalf; this guards client inserts.
  if auth.uid() is null then
    return new;
  end if;
  if not public.has_standing(new.reporter_user_id) then
    raise exception 'report_requires_a_completed_game'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger handle_reports_require_standing
  before insert on public.handle_reports
  for each row execute function public.enforce_report_standing();

-- Historical rows predate the rule, so the flag count is recomputed over
-- reporters who would qualify today rather than trusting the raw count.
create or replace function public.auto_flag_reported_handle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reporters integer;
begin
  select count(distinct r.reporter_user_id) into v_reporters
  from public.handle_reports r
  where r.reported_user_id = new.reported_user_id
    and r.reviewed_at is null
    and public.has_standing(r.reporter_user_id);

  if v_reporters >= 3 then
    update public.profiles
       set handle_status = 'flagged'
     where id = new.reported_user_id
       and handle_status = 'ok';
  end if;

  return new;
end;
$$;

-- --- 2. Throttle the writes that never touch an Edge Function --------------

/**
 * A rate limit for the paths that reach PostgREST directly.
 *
 * spin, select and complete-game are throttled inside the Edge Functions, but
 * four client writes go straight to Postgres and had no ceiling of any kind:
 * opening a game session, creating a challenge, filing a report, and claiming a
 * handle. Opening a session was a plain database-fill vector.
 *
 * SECURITY DEFINER on purpose: 0003 revoked EXECUTE on consume_rate_limit from
 * PUBLIC, so an invoker-rights trigger would fail for the very callers it is
 * meant to police.
 */
create or replace function public.throttle_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_ok boolean;
begin
  if v_actor is null then
    return new;                              -- server-side callers are trusted
  end if;
  select public.consume_rate_limit(
    v_actor, tg_argv[0], tg_argv[1]::integer, (tg_argv[2])::interval
  ) into v_ok;
  if not v_ok then
    raise exception 'rate_limited:%', tg_argv[0]
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.throttle_insert() from public;

create trigger game_sessions_throttle before insert on public.game_sessions
  for each row execute function public.throttle_insert('open_session', '20', '1 hour');
create trigger challenges_throttle before insert on public.challenges
  for each row execute function public.throttle_insert('challenge', '20', '1 hour');
create trigger handle_reports_throttle before insert on public.handle_reports
  for each row execute function public.throttle_insert('report', '10', '1 hour');
create trigger profiles_throttle before insert on public.profiles
  for each row execute function public.throttle_insert('profile', '10', '1 hour');

-- --- 3. Abandoned sessions are reaped, not accumulated ---------------------

/**
 * Sweep this player's own stale sessions when they open a new one.
 *
 * Half the rows on the live database were in_progress games nobody finished and
 * nothing removed. pg_cron is available on this project but not installed, so
 * the sweep is opportunistic: it costs one indexed delete on the path that
 * creates the problem, and it only ever touches the caller's own rows.
 */
create or replace function public.reap_abandoned_sessions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.game_sessions
  where user_id = new.user_id
    and status = 'in_progress'
    and created_at < now() - interval '24 hours';
  return new;
end;
$$;

revoke execute on function public.reap_abandoned_sessions() from public;

create trigger game_sessions_reap before insert on public.game_sessions
  for each row execute function public.reap_abandoned_sessions();

-- --- 4. The audit trail is append-only for everyone, TRUNCATE included -----

-- TRUNCATE does not fire row triggers, so audit_events_no_delete never saw it
-- and `service_role` could empty the table outright. The trail's guarantee was
-- therefore true only for DELETE, which is not what it says.
revoke truncate on public.audit_events from service_role, anon, authenticated;

comment on table public.audit_events is
  'Append-only record of every server-side decision. Cannot be updated, deleted '
  'from, or truncated by anyone, including the service role. Retention is not '
  'yet bounded: growth is ~18 rows per completed ranked game, and pruning needs '
  'monthly partitioning with DROP PARTITION rather than a DELETE path, because '
  'a sanctioned DELETE would reopen exactly what the triggers close.';
