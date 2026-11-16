# Respins

A respin replaces the spin that just landed, before anything is picked from it:
that franchise-era is set aside and a new one is drawn for the same turn. They
are bought in the iOS app, held on the server, and spent anywhere. A season
that used one still counts, marked ↻ wherever it appears.

PRFAQ §44 listed "One Re-roll" as a future mode; this is it, paid, with the
owner's decisions of November 2026 (below). `docs/monetization.md` argued
against a paid reroll in ranked play on the grounds that it is a competitive
advantage. The owner's answer is the mark: it is allowed, and nobody can
mistake a respun season for a clean one, and the perfect board is clean only.

## The rules

| | |
|---|---|
| What it does | Replaces the current spin with a new franchise-era for the same turn |
| When | After a spin lands, before a pick is made from it |
| How many | One per season (`RESPINS_PER_SEASON`, and `respins_per_season()` in SQL; a test keeps them equal). Not part of scoring, so not in the model `version` |
| Where | Ranked (GM Mode, Scout, Gameday) and casual. **Not** in a challenge: a duel replays the creator's seven spins, and replacing one ends the duel |
| Odds | Uniform over every franchise-era that can still fill an open slot, except the one being replaced |
| Cost | Bought in packs: 3 for USD 0.99, 12 for USD 2.99 (consumable IAPs `com.eighteenzerodcai.app.respins.3` / `.12`) |
| Sold on | iOS only. The web has no payment account; Android is not on Play. Both spend a balance the account holds and say "Respins are sold in the iOS app" where the buy button would be |
| Offline | The balance is the server's, so spending needs a connection and the control says so. Nothing else about offline play changes |
| Flag | `respins` (toggle, fallback off) gates the control, the sheet and the Clean only switch. The ↻ mark is never gated: a mark that vanished with a toggle would let a respun season pass as clean |

## The odds, and the sentence the sheet shows

The server's spin (`supabase/functions/spin`) has always been uniform over
franchise-eras: it takes every live card that fits an open slot and is not an
identity already on the roster, collapses them to distinct franchise-eras, and
picks one with `Math.random()`. A bucket with forty cards is exactly as likely
as one with one. `franchise_eras.spin_weight` exists in the schema and nothing
reads it.

A respin draws through the same code: `_shared/wheel.ts` reads the candidates
for both `spin` and `respin`, and `drawUniform` from `packages/respins` picks for
both. The only difference is that a respin excludes the franchise-era it
replaces, because a paid draw that can land where it started charges for
nothing.

The purchase sheet says, verbatim (`oddsDisclosure` in `packages/respins/src/odds.ts`):

> A respin draws a new franchise-era for the same turn. Every franchise-era
> that can still fill one of your open slots, other than the one you are
> replacing, is equally likely. Right now that is N, so each is 1 in N.

N is counted on the device from the season in front of the player
(`openBuckets` in `state/game.ts`, the same set the server draws from). With
seven slots open and the whole league in play N is 7 eras × 32 franchises
less one, about 223; on a gameday it is far smaller. This is the disclosure
App Store Review Guideline 3.1.1 asks for on a randomized paid item.

## The ledger

`public.entitlements` (0026) is the docs/monetization.md sketch, made real.

- **Append-only.** Triggers refuse UPDATE and DELETE from everyone, the
  service role included, and TRUNCATE is revoked, exactly as for `audit_events`.
  `user_id` is deliberately not a foreign key for the same reason
  `audit_events.actor_id` is not: account deletion would otherwise fail.
- **Balance = `sum(delta)`.** Nothing stores a balance. `my_respins()` returns
  the caller's; RLS lets a player read their own rows and nobody else's.
- **`reference` is UNIQUE**, and is the idempotency:

  | source | delta | reference |
  |---|---|---|
  | `purchase` | +3 / +12 | `apple:<transactionId>` |
  | `spend` (ranked) | −1 | `spend:<session>:<sequence>` |
  | `spend` (casual) | −1 | `spend-local:<local game id>:<sequence>` |
  | `transfer` | −n / +n | `transfer-out:<ticket>` / `transfer-in:<ticket>` |
  | `refund` | −n | `apple-refund:<transactionId>` (manual, see the runbook) |
  | `promo` | +n | anything unique, e.g. `promo:<campaign>:<user>` |

- **No client writes.** Clients have SELECT on their own rows and nothing else.
  Every row is written by a security-definer function that checks what a
  policy cannot, under a per-player advisory lock so two devices cannot both
  spend the last respin:
  - `apply_respin(...)` — service role only, called by the `respin` function
  - `grant_respin_purchase(...)` — service role only, called by `redeem-purchase`
  - `spend_local_respin(game, sequence)` — any signed-in player, debit only
  - `claim_season_transfer(ticket)` — moves the balance with the seasons

## A ranked respin, end to end

1. The app calls `respin` with the session id. Nothing else.
2. The function reads the session, its spins and its picks, refuses early if
   the season is not the caller's, not open, a challenge, has used its respin,
   or the latest spin already has a pick.
3. It reads the wheel exactly as `spin` would (`readWheel`), and draws with
   `drawUniform`, leaving out the current franchise-era.
4. `apply_respin` does the rest in one transaction, re-checking every
   condition under `SELECT … FOR UPDATE` on the session and the player's
   balance lock: inserts the −1 ledger row, inserts the `game_respins` row
   (discarded and replacement franchise-era, and the ledger reference),
   rewrites the `game_spins` row in place, and stamps
   `game_sessions.respins_used`.
5. An audit row `respin_issued` records the same facts.

Why the spin row is rewritten rather than a second row added beside it:
`spin` counts spins, `select` takes the latest, `complete-game` maps picks to
spins by sequence, and a challenge replays them by sequence. A second row at
the same sequence is a fifth thing for each of those to get right, and one
that got it wrong would score from the discarded franchise-era. So
`game_spins` stays "the spins this roster was built from", and the discarded
one is kept, never deleted, in `game_respins` (append-only) and on the audit
trail.

`complete-game` is unchanged. It recomputes from server rows as before, and
nothing the client says about respins is read anywhere.

## Purchases: verification without new keys

StoreKit 2 hands the app every transaction as a JWS. The `redeem-purchase`
function verifies it offline, with no App Store Server API key:

1. `x5c` is exactly three certificates; the third is byte-identical to Apple
   Root CA - G3, which is embedded (`packages/respins/src/apple-root.ts`, SHA-256
   `63343ABF…3E9179`, checked by a test).
2. The intermediate carries Apple's WWDR OID `1.2.840.113635.100.6.2.1` and is a
   CA; the leaf carries the receipt-signing OID `1.2.840.113635.100.6.11.1`.
3. Each certificate was valid when the transaction was signed, the root signed
   the intermediate, the intermediate signed the leaf, and the leaf's P-256 key
   signed the JWS (ES256).
4. The payload is this bundle, one of the two packs, a `Consumable`, not
   revoked, and from an accepted environment.
5. `grant_respin_purchase` credits it once, by transaction id. The
   `appAccountToken` (set by the app to the account id it bought under) must be
   the caller, or an anonymous account whose seasons the caller claimed (0022) —
   so a JWS lifted from someone else's device grants nothing.

The app finishes the transaction only after the server confirms (or refuses
for good: revoked, wrong app, unknown product, redeemed by another account).
Anything else stays in StoreKit's queue and is re-sent at the next launch.

The verifier is `packages/respins/src/apple.ts` (+ `x509.ts`), bundled into
`supabase/functions/_shared/respins.ts` by `pnpm --filter @17-0/respins build:edge`.
Its tests sign real JWSs with a test chain shaped like Apple's
(`test/fixtures/make-chain.sh`) and verify Apple's real WWDR G6 certificate
against the embedded root.

### Environments

| Variable | Effect |
|---|---|
| (none) | Production only |
| `IAP_ACCEPT_SANDBOX=true` | Also Sandbox: **App Review and TestFlight buy in Sandbox.** Must be on in production before the IAPs are reviewed, or the reviewer's purchase fails. With it on, a TestFlight tester's free purchase grants real respins; every grant records its `environment`, so they can be found |
| `IAP_ACCEPT_XCODE=true` + `IAP_XCODE_ROOT_CERT=<base64 DER>` | Xcode's local StoreKit testing, which Xcode signs with its own certificate (Debug → StoreKit → Manage Transactions → Export Certificate). Local development only; never in production |

## Boards (0027)

- `leaderboard_rating`, `leaderboard_scout`: column `respun` (the mark).
- `leaderboard_points`: column `respun_seasons`.
- `leaderboard_perfect`: `respins_used = 0`. Clean seasons only, never marked.
- `leaderboard_rating_since`, `leaderboard_scout_since`, `leaderboard_points_since`,
  `leaderboard_gameday`: a `clean boolean default false` parameter and the
  `respun` / `respun_seasons` column. The app's Clean only switch calls these
  (with `since => null` for all time), because a clean board is each player's
  best *clean* season — a different deduplication, not the marked board with
  rows struck out.
- Reading the four functions off 0019 found they had never been taught
  `hidden_at is null` (nor, for points, the multiplier) when 0021 taught the
  views. 0027 restates them with both. `packages/respins/test/boards.test.ts`
  now checks every board's live definition for every filter.

The "about once every 6,000 games" claim is a measurement of the wheel with no
second chances (`docs/scoring-model.md`). It describes clean seasons, which is
why the perfect board counts only those.

## Anonymous players

A balance belongs to the auth user. An anonymous player who buys and then
signs in carries it over with their seasons: `offer_season_transfer` now offers
when there is a balance even with no seasons, and `claim_season_transfer` moves
whatever balance the anonymous account holds *at claim time* as two ledger
rows. `transferable_seasons()` gained a `respins` column. An unfinished
transaction bought under the anonymous account is still redeemable after
sign-in (see `appAccountToken` above).

Most players never need this: signing in from an anonymous account *links*
the provider to that same account, so the balance never moves at all. The
transfer is for the other case, signing in to an account that already exists;
the Account screen now offers to bring respins along even when there are no
seasons to bring (`AccountPanel.tsx`). The embedded frame's carry-over
(`CarryOver.tsx`) still counts seasons only — respins cannot be bought in a
frame, so it only matters for a player who bought in the app and then played
in a frame on the same anonymous account, which cannot happen (the frame is
the web).

## Testing a purchase without App Store Connect

`apps/mobile/store/Respins.storekit` is a StoreKit configuration with both
packs (a test keeps it equal to `RESPIN_PACKS`). After `expo prebuild`, open
`ios/*.xcworkspace`, Product → Scheme → Edit Scheme → Run → Options →
StoreKit Configuration → choose that file, and run on a simulator: the sheet
shows the packs at the file's prices and purchases complete locally.

Those transactions are signed by Xcode, not Apple, so a server only accepts
them with `IAP_ACCEPT_XCODE=true` and Xcode's certificate in
`IAP_XCODE_ROOT_CERT` (Debug → StoreKit → Manage Transactions → Editor →
Save Public Certificate, then base64 it). Use a local Supabase for that, never
production. Prebuild regenerates the scheme, so the choice is per checkout.

The app code is `apps/mobile/src/features/respins/` (`store.ios.ts` on iOS,
`store.ts` everywhere else, so expo-iap is never in the web bundle) and
`components/Respin.tsx`. The library is `expo-iap` (StoreKit 2, an Expo
module, no third-party account): it needs iOS 15 and pulls OpenIAP as a Swift
package during `pod install`.

## Getting the packs live (the owner's steps)

1. **Agreements.** Paid Applications agreement, banking and tax forms active
   in App Store Connect → Business. Without them the products can be created
   and never become purchasable.
2. **Create the products.** `set -a; . .local/asc.env; set +a`, then
   `node scripts/store/iap.mjs` (dry run, reads only) and
   `node scripts/store/iap.mjs --apply`. It never submits.
3. **Review screenshot.** Each IAP needs a screenshot of the purchase sheet
   (any device size), attached in App Store Connect → In-App Purchases.
4. **Deploy the server** (see `docs/RUNNING.md`): `supabase db push` (0026,
   0027), `pnpm --filter @17-0/respins build:edge`, then
   `supabase functions deploy spin respin redeem-purchase`, and
   `supabase secrets set IAP_ACCEPT_SANDBOX=true`.
5. **Flag.** `npx tsx scripts/posthog-flags.ts --apply` with a personal
   PostHog key creates `respins`, off. Turn it on for the review build's
   audience once the products are attached to the version in review, so the
   reviewer can find the button.
6. **Submit** the IAPs with the next app version.
7. **App Privacy.** Add *Purchases → Purchase History*, linked to the user
   (the account id), used for App Functionality, not tracking.

## Runbook

**"I paid and got nothing."** Look the player up by account id:

```sql
select * from entitlements where user_id = '<uuid>' order by created_at desc;
select * from audit_events where actor_id = '<uuid>'
  and event like 'purchase_%' order by occurred_at desc limit 20;
```

A `purchase_redeem_requested` / `rejected` row names the reason. An
`environment_not_accepted` means a Sandbox purchase with `IAP_ACCEPT_SANDBOX`
off. Nothing at all means the app never reached the server: the transaction is
still unfinished and is re-sent at the next launch with a connection.

**Grant goodwill respins:**

```sql
insert into entitlements (user_id, kind, delta, source, reference)
values ('<uuid>', 'respin', 3, 'promo', 'promo:support:<ticket-or-date>:<uuid>');
```

**A refund** (Apple refunded; until App Store Server Notifications are wired,
by hand). Take back what is left, up to the pack size; the balance may go to
zero but the ledger never lies about what was spent:

```sql
insert into entitlements (user_id, kind, delta, source, reference)
select user_id, 'respin', -least(<pack size>, greatest(respin_balance_of(user_id), 0)), 'refund',
       'apple-refund:<transactionId>'
from entitlements where reference = 'apple:<transactionId>';
```

(Skip it if that computes to 0: `delta <> 0` refuses the row.)

**Follow-up, not built: App Store Server Notifications V2.** Apple can post
`REFUND` notifications to a URL, signed with the same chain this verifier
already checks. It needs a URL set in App Store Connect (App Information →
App Store Server Notifications), which is owner setup, so it is not built yet.
When it is: a function that verifies `signedPayload`, then its
`data.signedTransactionInfo`, and writes the refund row above with the same
reference.
