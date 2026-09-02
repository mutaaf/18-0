-- Replacing the auto-generated placeholder is not "a change".
--
-- 0007 moved the cooldown so the first correction was free, and the
-- verification promptly showed it had not worked. Signing up does not leave
-- the handle empty: 0001 gives every new account `player-<hex>`. So the
-- player's first real claim was already an UPDATE, it spent the free change,
-- and the typo trap 0007 set out to remove was still there one step later.
--
-- A name nobody chose is not a name. Naming yourself over the placeholder
-- leaves the clock unstarted, and the first correction after that is the free
-- one -- which is what "the first correction is free" was supposed to mean.

/**
 * The shape 0001 generates: 'player-' plus 12 or 16 hex characters.
 *
 * Deliberately narrow. A handle is only treated as a placeholder if it looks
 * exactly like one the database made.
 */
create or replace function public.is_placeholder_handle(p_handle text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$ select p_handle ~ '^player-[0-9a-f]{12}([0-9a-f]{4})?$' $$;

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

  -- The placeholder shape is reserved, and only on UPDATE. On INSERT it has to
  -- stay legal, because the thing that generates it is itself an INSERT (0001,
  -- handle_new_user) -- blocking it there would break signing up. A client
  -- cannot get an INSERT in anyway: the row already exists by then, so an
  -- upsert arrives as an UPDATE and lands here.
  --
  -- Without this, naming yourself something placeholder-shaped would earn one
  -- extra free rename, because of how the stamping below reads the old value.
  if tg_op = 'UPDATE' and public.is_placeholder_handle(new.handle) then
    raise exception 'handle_not_allowed:reserved'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    new.handle_set_at := null;
    return new;
  end if;

  -- handle_status is deliberately NOT defended here. The column grants in 0004
  -- already stop a client writing it, and a trigger that also "preserved" it
  -- would silently revert public.moderation_uphold() -- which runs SECURITY
  -- DEFINER and updates that column directly.
  if new.handle is distinct from old.handle then
    -- Claiming a name over the placeholder: the clock does not start.
    if old.handle is null or public.is_placeholder_handle(old.handle) then
      new.handle_set_at := null;
      return new;
    end if;

    -- A null stamp is the free correction.
    if old.handle_set_at is not null
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
revoke execute on function public.is_placeholder_handle(text) from public;
