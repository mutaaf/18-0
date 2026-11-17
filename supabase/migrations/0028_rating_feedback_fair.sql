-- ---------------------------------------------------------------------------
-- Rating feedback, part two: "fair", and where an opinion came from.
--
-- Gut Check (apps/mobile/app/rate.tsx) is a swipe-through of ten cards: right
-- if the rating looks right, left if it does not, then up or down for which
-- way. A swipe right is an opinion too, and the more useful one for a refit:
-- 0025 could only count complaints, so a card two people called too high
-- looked the same whether two or two hundred had seen it. `fair` gives every
-- complaint its denominator.
--
-- `source` keeps the two ways in apart. A verdict on one of your own seven,
-- after a season that just went well or badly, is not the same evidence as a
-- verdict on a stranger's card in a quick game, and the reviewer should be
-- able to read them separately rather than discover the mix later.
--
-- Still nothing here is read by a score, a board or the client's preview
-- (invariant 1). The view is restated in full from 0025, the version it
-- replaces, with the two new columns added.
-- ---------------------------------------------------------------------------

alter table public.rating_feedback
  drop constraint rating_feedback_verdict_check;
alter table public.rating_feedback
  add constraint rating_feedback_verdict_check check (verdict in ('too_low', 'too_high', 'fair'));

alter table public.rating_feedback
  add column source text not null default 'result' check (source in ('result', 'swipe'));

revoke insert, update on public.rating_feedback from authenticated;
grant insert (user_id, card_id, model_version, rating_shown, verdict, source),
      update (user_id, card_id, model_version, rating_shown, verdict, source)
  on public.rating_feedback to authenticated;

drop view public.ops_rating_feedback;
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
  count(*) filter (where f.verdict = 'fair')                     as fair,
  count(*)                                                       as voters,
  count(*) filter (where f.verdict = 'too_low')
    - count(*) filter (where f.verdict = 'too_high')             as net,
  count(*) filter (where f.source = 'swipe')                     as from_swipe,
  max(f.updated_at)                                              as last_at
from public.rating_feedback f
join public.season_cards c on c.id = f.card_id
group by f.model_version, f.card_id, c.display_name, c.position, c.season_year, c.franchise_id, c.rating
order by f.model_version desc, count(*) desc, abs(
  count(*) filter (where f.verdict = 'too_low') - count(*) filter (where f.verdict = 'too_high')
) desc;

revoke all on public.ops_rating_feedback from anon, authenticated;
