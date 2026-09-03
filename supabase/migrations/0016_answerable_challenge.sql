-- The insert policy 0015 wrote could never pass.
--
-- It gated a challenge session on `exists (select 1 from public.challenges …)`,
-- and that subquery runs as the caller, under RLS. The only select policy on
-- challenges admits the creator and an already-attached opponent — which is
-- precisely everyone except the person holding the link. So the row the policy
-- was checking was invisible to the only user who would ever be checked
-- against it, the exists came back false, and answering a challenge failed
-- with "new row violates row-level security policy".
--
-- The same shape as the fix in 0012: a policy that has to see past the
-- caller's own visibility needs definer rights to do it. The predicate moves
-- into a function that has them, and the policy asks the function.

create or replace function public.challenge_answerable(p_challenge uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.challenges c
    where c.id = p_challenge
      and c.status = 'open'
      and c.opponent_user_id is null
      and c.creator_user_id <> p_user
      -- Matches challenge_expired(): an abandoned invitation stops being one.
      and c.created_at > now() - interval '30 days'
  )
$$;

revoke execute on function public.challenge_answerable(uuid, uuid) from public;
grant execute on function public.challenge_answerable(uuid, uuid) to authenticated;

drop policy if exists "open an empty session" on public.game_sessions;
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
    and (challenge_id is null or public.challenge_answerable(challenge_id, auth.uid()))
  );
