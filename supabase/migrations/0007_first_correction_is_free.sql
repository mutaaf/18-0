-- The cooldown starts at the first change, not at the first claim.
--
-- 0006 stamped handle_set_at when the profile was created, so the thirty days
-- began the instant somebody typed a name for the first time. A player who
-- misspelled their own name on the way in was stuck with it for a month, and
-- the only way out was deleting the account and losing their ranked history --
-- a worse outcome, for them and for the board, than the rename we refused.
--
-- Leaving the stamp null on INSERT means the first correction is free and the
-- clock starts from it. In steady state this is still "once a month"; it just
-- does not spend the allowance on the claim itself.

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

  -- Not stamped. The first change is the one that starts the clock.
  if tg_op = 'INSERT' then
    new.handle_set_at := null;
    return new;
  end if;

  -- handle_status is deliberately NOT defended here. The column grants in 0004
  -- already stop a client writing it, and a trigger that also "preserved" it
  -- would silently revert public.moderation_uphold() -- which runs SECURITY
  -- DEFINER and updates that column directly.
  if new.handle is distinct from old.handle then
    -- A null stamp is the free one: either the first correction, or a profile
    -- created before any of this existed.
    if old.handle is not null
       and old.handle_set_at is not null
       and coalesce(old.handle_status, 'ok') = 'ok'
    then
      v_next := old.handle_set_at + interval '30 days';
      if v_next > now() then
        raise exception 'handle_cooldown:%',
          to_char(v_next at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          using errcode = 'check_violation';
      end if;
    end if;

    new.handle_set_at := now();
    if old.handle_status = 'flagged' then
      new.handle_status := 'ok';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_handle_policy() from public;

comment on column public.profiles.handle_set_at is
  'When the handle was last changed -- null until the first change, so the '
  'initial claim does not spend the monthly allowance. Stamped by '
  'enforce_handle_policy, never accepted from the client, because a cooldown '
  'measured from a client-supplied timestamp is not a cooldown.';
