# Running 18-0

## On your phone (recommended — this is where it's designed to live)

```bash
pnpm install
cd apps/mobile
npx expo start
```

Scan the QR code with **Expo Go** (App Store / Play Store). Haptics, the
three-finger spin and the reveal all land properly on a real device; none of
them do in a browser.

Same network for phone and Mac. If that fails: `npx expo start --tunnel`.

## In a browser

```bash
cd apps/mobile
npx expo start --web
```

The desktop layout is a different composition, not a scaled phone — left nav
rail, two-column gameplay, hover states.

## The three-finger spin

Hold three fingers anywhere on screen while tapping **Spin** and the wheel
lands on whichever franchise-era holds the best card still available for a slot
you have not filled. On a pointer device, Shift-click Spin.

Any run that uses it is flagged **assisted**: it saves and shows its result but
cannot set a best rating, a best record, or a perfect-season count, and the
database keeps it off every leaderboard.

## Bringing the server online (optional)

The game is complete without it — the dataset is bundled and scoring is local.
Supabase only adds cross-device history, leaderboards and challenges.

```bash
supabase start
supabase db push                                   # schema + RLS
psql "$DATABASE_URL" -f supabase/seed/0001_dataset.sql   # 6,209 cards
pnpm --filter @18-0/domain build:edge              # bundle scoring for Deno
supabase functions deploy complete-game
```

Then set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in
`apps/mobile/.env` (see `.env.example`).

**Not yet verified against a live project.** The schema, function and client
typecheck and the SQL is generated from the real dataset, but nothing here has
been run against a running Supabase instance.

## Regenerating the model

```bash
data/raw/fetch.sh                                    # re-fetch nflverse CSVs
pnpm --filter @18-0/data build:dataset               # rebuild the bundled cards
pnpm --filter @18-0/data analyze -- --write          # refit the calibration curve
pnpm --filter @18-0/data tune                        # re-measure the 18-0 gates
pnpm --filter @18-0/domain regen:fixtures            # move the seed fixtures with it
pnpm -r test
```

Anything that changes a published score should bump `version` in
`packages/domain/src/constants/config.ts`.
