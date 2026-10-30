# Making money from 18-0

The full plan, with the numbers and the sequencing, is here:
**https://claude.ai/code/artifact/db87a775-ee71-4fe8-88f7-365c54142d7b**

This file is the short version, for whoever is about to write the code.

## Live now: web display ads through Marquee (2026-10-30)

The owner decided on 2026-10-30 to monetize the whole collection through Marquee,
the ad server at `mutaafaziz.com/ads` (contract: the marquee repo's `AGENTS.md`).
On the **web build only** (`apps/mobile/src/features/ads.ts`, `ads-policy.ts`):

- The loader `https://mutaafaziz.com/ads/v1/ads.js`, `data-app="18-0"`, injected by
  `startAds()` from the root layout. Only on `18-0.co` and the Pages mirror; never
  in a native build, a Vercel preview, localhost or the `/embed` frame.
- Slots: `results` (banner under the result actions, `AdSlot`) and
  `between-seasons` (interstitial on Build Another; never the first season of a
  visit, at most every 4 minutes, plus Marquee's own per-slot cap). Both resolve
  at once with no fill, and a break that has not started in 1.5 s is abandoned.
- No rewarded slot yet: a reward that touches ranked play needs the server-side
  ledger below, and Marquee's web rewarded has no signed callback.
- `apps/mobile/public/ads.txt` is served at `https://18-0.co/ads.txt` by Vercel
  (Expo copies `public/` to the export root; the SPA rewrite runs only after real
  files). Add Google's line there once the AdSense publisher id exists.
- The privacy page says so, and the home footer links to `mutaafaziz.com/ads/privacy/`.

## Two constraints decide the architecture

**Sportsbook offers cannot live inside the app.** App Store rule 3.1.1 requires any
in-app digital unlock to go through in-app purchase, and "deposit with DraftKings,
get 10 free spins" unlocks an in-app feature through an outside transaction. 3.1.3
separately restricts steering users to an outside purchase, and 5.3 plus Play's
real-money gambling policy treat a sportsbook-promoting app as gambling-adjacent:
18+, geo-restricted, and often rejected when the publisher is not the operator.

So sportsbook affiliate offers go on the **web build only**, age-gated and geo-gated.
Rewarded video goes in the app. Both are fine where they are; neither is fine where
the other one is.

**Nothing bought or earned may affect a ranked run.** The leaderboard is the reason
anyone comes back. A purchasable advantage turns it into a table of who spent most.

## The reward that works

Reward **extra ranked attempts**, not extra spins. An extra spin inside a run rerolls
a bad franchise-era, which is a direct competitive advantage; an extra attempt leaves
every individual run clean. That needs a daily cap, which is the one real product risk
in the plan, so set it from session data rather than guessing and ship the cap and the
grant in the same release.

Cosmetics are the zero-risk version and need no cap at all, which is why they go first.

Note that `assisted` already exists for exactly this class of problem: the server sets
it, the client cannot clear it, and every leaderboard view filters on it. A paid reroll
could reuse it, but the run would then not count, which makes the reward pointless.

## What to build

An append-only ledger, not a balance column:

```sql
create table public.entitlements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('ranked_attempt')),
  delta       int  not null check (delta <> 0),   -- + grant, - spend
  source      text not null check (source in
                ('daily_refill','rewarded_video','promo','spend')),
  reference   text unique,                        -- ad network transaction id
  created_at  timestamptz not null default now()
);
```

Two things this stands or falls on:

- **Server-side verification.** AdMob and AppLovin post a signed callback when an ad
  actually completed. Granting on the client's word means anyone with a proxy grants
  themselves unlimited attempts.
- **The unique `reference`.** Ad networks retry their callbacks. Without the index,
  every retry is another free attempt.

Grants must be issued server-side, for the same reason spins are (see
`supabase/functions/spin`): a client that can hand itself a spin can hand itself a
perfect roster.

## Before any of this ships

`digitalcraftai.com/privacy` currently states, accurately, that the game carries no
ads, no advertising identifiers and no third-party analytics. An ad SDK makes that
false. The policy and the App Store privacy answers are part of the same release as
the SDK, not a follow-up.
