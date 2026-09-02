-- ---------------------------------------------------------------------------
-- Close the moderation bypass
--
-- Verified live before this migration: a player whose handle had been hidden by
-- public.moderation_uphold() could restore themselves to the leaderboard with a
-- single PostgREST call —
--
--     update public.profiles set handle_status = 'ok' where id = <their own id>
--
-- Three faults lined up to allow it, and all three are fixed here.
--
--   1. anon and authenticated held UPDATE and INSERT on *every* column of
--      public.profiles, including handle_status. 0001 was careful to revoke and
--      re-grant column by column on game_sessions and never did the same here.
--   2. The "own profile update" policy had USING but no WITH CHECK, so the row
--      being written was never re-checked.
--   3. profiles_handle_policy is BEFORE INSERT OR UPDATE **OF handle**, so an
--      update that touched only handle_status did not fire it at all.
--
-- The fix is column grants rather than a cleverer trigger: moderation state is
-- simply not writable by a client, and Postgres enforces that without anything
-- having to remember to check.
-- ---------------------------------------------------------------------------

-- --- 1. A client may write its own handle, and nothing else ----------------

revoke insert, update on public.profiles from anon, authenticated;

-- `id` is required for both: PostgREST compiles .upsert({id, handle}) into
-- INSERT ... ON CONFLICT (id) DO UPDATE SET id = excluded.id, handle = ...
-- It is safe to grant because the policies below pin it to auth.uid().
grant insert (id, handle) on public.profiles to authenticated;
grant update (id, handle) on public.profiles to authenticated;

-- handle_status, handle_set_at and created_at are now server-owned. The
-- moderation functions are SECURITY DEFINER and run as the owner, so they are
-- unaffected.

-- --- 2. Re-check the row on the way in -------------------------------------

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- --- 3. The trigger watches the whole row, not one column ------------------

drop trigger if exists profiles_handle_policy on public.profiles;
create trigger profiles_handle_policy
  before insert or update on public.profiles
  for each row execute function public.enforce_handle_policy();

/**
 * Renaming clears an automatic flag, but never a human decision.
 *
 * The previous version reset handle_status to 'ok' on any handle change, on the
 * reasoning that a moderation decision was about a name rather than a person.
 * That is true of `flagged`, which is set automatically by three reporters and
 * may simply be wrong. It is not true of `hidden`, which a human set by
 * upholding a report — and leaving it resettable made renaming a laundering
 * path: be hidden, pick a new name, return to the board unreviewed.
 *
 * `hidden` now persists across renames until public.moderation_dismiss() lifts
 * it. handle_set_at is stamped here rather than accepted from the client, so a
 * future rename cooldown cannot be dodged by sending a backdated value.
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

  if tg_op = 'INSERT' then
    new.handle_set_at := now();
    return new;
  end if;

  -- handle_status is deliberately NOT defended here. The column grants above
  -- already stop a client writing it, and a trigger that also "preserved" it
  -- would silently revert public.moderation_uphold() -- which runs SECURITY
  -- DEFINER and updates that column directly. Belt and braces became belt
  -- around the braces: the first version of this migration broke moderation
  -- while claiming to protect it.
  if new.handle is distinct from old.handle then
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
