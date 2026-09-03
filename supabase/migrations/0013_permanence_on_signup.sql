-- An account that signs in fresh is permanent from its first row.
--
-- 0011 kept profiles.is_permanent in step with auth.users.is_anonymous using an
-- AFTER UPDATE trigger, which covers exactly one route: an anonymous account
-- linking an identity, where is_anonymous flips true to false.
--
-- It does not cover the other route, and the other route is the common one.
-- Signing in on a device with no session -- a new phone, or anyone who has
-- signed out -- creates the user with signInWithOAuth, so the row is INSERTed
-- with is_anonymous already false. Nothing is ever updated, the trigger never
-- fires, and handle_new_user writes the profile with is_permanent defaulting to
-- false.
--
-- The result: a player signs in with Apple or Google, everything appears to
-- work, and their seasons never reach the leaderboard, because the board reads
-- a flag that nothing set. Two accounts on the hosted project were in exactly
-- that state.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
  permanent boolean := new.is_anonymous is not true;
begin
  -- 12 hex characters: collisions are not a practical concern, and the loop
  -- below means a signup can never fail on a duplicate handle.
  candidate := 'player-' || substr(replace(new.id::text, '-', ''), 1, 12);
  begin
    insert into public.profiles (id, handle, is_permanent)
    values (new.id, candidate, permanent);
  exception when unique_violation then
    insert into public.profiles (id, handle, is_permanent)
    values (new.id,
            'player-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
            permanent)
    on conflict (id) do nothing;
  end;
  return new;
end $$;

-- Widened from `update of is_anonymous`. That form fires only when the column
-- appears in the statement's SET list, which makes the trigger dependent on how
-- the auth service happens to write the row rather than on whether the value
-- changed. The function already no-ops when nothing differs.
drop trigger if exists on_auth_user_identity_changed on auth.users;
create trigger on_auth_user_identity_changed
  after update on auth.users
  for each row execute function public.sync_profile_permanence();

-- The accounts already caught by this.
update public.profiles p
   set is_permanent = true
  from auth.users u
 where u.id = p.id
   and u.is_anonymous is not true
   and p.is_permanent = false;
