-- A display name can be changed once a month, and profile columns are
-- published deliberately rather than by default.
--
-- 0004 started stamping handle_set_at so that a cooldown could be measured
-- from a value the renamer does not control. This is the cooldown.

-- ---------------------------------------------------------------------------
-- Only these columns are public.
--
-- Supabase grants SELECT on every column of every table in `public` to `anon`
-- and `authenticated` by default. Nothing sensitive is in `profiles` today, so
-- this changes no behaviour at all right now — which is the point of doing it
-- now. The next column somebody adds here is private until it appears on this
-- list, instead of being world-readable the moment it exists.
revoke select on public.profiles from anon, authenticated;
grant select (id, handle, handle_status, handle_set_at, created_at)
  on public.profiles to anon, authenticated;

comment on column public.profiles.handle_set_at is
  'When the handle was last changed. Stamped by enforce_handle_policy, never '
  'accepted from the client, because a cooldown measured from a client-supplied '
  'timestamp is not a cooldown. Null means the profile predates the trigger; '
  'those players get one rename before the clock starts.';

-- ---------------------------------------------------------------------------
/**
 * The handle policy, now with a rename cooldown.
 *
 * Thirty days, not "once per calendar month": a calendar month is between 28
 * and 31 days and resets on a boundary, so a rename on the 31st and another on
 * the 1st would both be allowed. A fixed interval since the last change is what
 * "once a month" actually means to the person waiting.
 *
 * Three cases deliberately skip the wait:
 *
 *   - The first claim. There is nothing to cool down from.
 *   - A profile with no handle_set_at, which predates the stamping added in
 *     0004. Those players get one rename, and then the clock starts.
 *   - A handle that is flagged or hidden. Making somebody wait a month to
 *     replace a name that moderation has already taken off the board would
 *     leave them stuck with it and no way back. This is not a way around the
 *     cooldown: `flagged` needs three separate reporters who each have standing
 *     (0005), and `hidden` survives the rename (0004), so nobody can reach
 *     either state on their own or profit from it.
 */
create or replace function public.enforce_handle_policy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_next   timestamptz;
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

  if tg_op = 'INSERT' then
    new.handle_set_at := now();
    return new;
  end if;

  -- handle_status is deliberately NOT defended here. The column grants in 0004
  -- already stop a client writing it, and a trigger that also "preserved" it
  -- would silently revert public.moderation_uphold() -- which runs SECURITY
  -- DEFINER and updates that column directly.
  if new.handle is distinct from old.handle then
    if old.handle is not null
       and old.handle_set_at is not null
       and coalesce(old.handle_status, 'ok') = 'ok'
    then
      v_next := old.handle_set_at + interval '30 days';
      if v_next > now() then
        -- The timestamp is in the message so the app can say *when*, rather
        -- than only that the answer is no.
        raise exception 'handle_cooldown:%',
          to_char(v_next at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          using errcode = 'check_violation';
      end if;
    end if;

    new.handle_set_at := now();
    -- An automatic flag is cleared by a rename; a human's decision is not.
    if old.handle_status = 'flagged' then
      new.handle_status := 'ok';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_handle_policy() from public;
