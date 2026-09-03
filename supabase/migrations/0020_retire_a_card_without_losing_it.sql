-- A card can leave the dataset. A season that was played with it cannot.
--
-- The seed used to open with
--
--   truncate table season_cards, franchise_eras, franchises, eras cascade;
--
-- which is correct exactly once, on an empty database, and catastrophic every
-- time after. `game_selections.card_id` references `season_cards`, and
-- `game_spins` references `franchises` and `eras`, so that CASCADE does not
-- merely reset the reference data: it deletes every pick and every spin any
-- player has ever made. On a fresh instance nobody notices. On this one it
-- would take the leaderboard, the challenges and the evidence behind them.
--
-- And the dataset really does move. The rating change that took it from 2,994
-- cards to 3,279 also dropped 119 of the old ones -- a season that no longer
-- qualifies, or that lost its franchise-era to a teammate whose rating
-- overtook it. Those rows cannot be deleted (a played selection may point at
-- them) and they cannot be left offerable either: the wheel would deal a card
-- the client's bundle has never heard of.
--
-- So a card that leaves the dataset is *retired*. The row stays, so history
-- resolves; the wheel stops offering it; and if a future rebuild brings it
-- back the seed clears the mark.

alter table public.season_cards
  add column if not exists retired_at timestamptz;

comment on column public.season_cards.retired_at is
  'Set when a rebuilt dataset no longer contains this card. The row is kept so '
  'a season played with it still resolves, and the spin and select endpoints '
  'refuse it so it can never be dealt again. Cleared if a rebuild brings the '
  'card back.';

-- The spin's candidate query filters on this, so it wants to be cheap.
create index if not exists season_cards_live_idx
  on public.season_cards (franchise_id, era_key, position, rating desc)
  where retired_at is null;

grant select (retired_at) on public.season_cards to anon, authenticated;
