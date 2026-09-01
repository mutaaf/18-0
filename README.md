<div align="center">

# 18-0

**Spin history. Build seven. Chase perfection.**

An NFL historical roster game. Spin for a franchise and an era, take one player,
fill seven slots, and receive a deterministic rating mapped to an 18-game record
from 0-18 to 18-0.

No possession simulation. No random losses. The same roster always earns the
same record — so every choice is yours.

</div>

---

## The loop

> **Spin** a franchise and an era → **take one player** → **fill seven slots** →
> **reveal** your season.

Seven positions: QB, two running backs, two receivers, a tight end, and a team
defense. Each spin gives you exactly one pick, and there are no takebacks. The
tension is entirely in the question *"do I take this receiver now, or hold out
for the tight end I still need?"*

### Perfection is gated, not lucky

A high score is necessary but not sufficient. To finish 18-0 a roster must also
have no weakness anywhere:

| Gate | Requirement |
|---|---|
| Score | ≥ 98.5 |
| Every slot | ≥ 93 — First-Team All-Pro caliber |
| QB and defense | ≥ 96 — all-time elite |
| At least four positions | ≥ 96 |

Miss one and you get 17-1 with the blocker named:

> **PERFECTION DENIED** — RB2 needed a 93.0 minimum for 18-0 eligibility.

Measured against the real dataset: **18-0 lands about once in 6,300 games, 17-1
about once in 49.**

---

## The ratings are real

Every card is a real NFL season, rated against **its own era**. The model asks
*"how dominant was this season relative to what was possible at this position in
this year"* — not *"who piled up the biggest totals"* — so a 1999 receiver and a
2024 receiver are directly comparable.

Each metric is z-scored against the same-position league environment for that
exact season, then combined through the position weight tables. The model's own
verdict on the best seasons in the data:

| Position | Top-rated season |
|---|---|
| QB | Tom Brady, 2007 New England |
| RB | Marshall Faulk, 2000 St. Louis |
| WR | Cooper Kupp, 2021 Los Angeles |
| TE | Rob Gronkowski, 2011 New England |
| DEF | 2006 Baltimore |

Nobody hand-picked those. They fell out of the model.

**2,994 rated seasons · 157 franchise-era combinations · 1999–2025**, built from
[nflverse](https://nflverse.com).

### The eras

| Era | Named for |
|---|---|
| **The Greatest Show** · 1999–2004 | Warner's Rams outrunning everyone, Baltimore's record defense answering |
| **Chasing Perfect** · 2005–2009 | Manning against Brady, 16-0, and the one that got away |
| **The Passing Boom** · 2010–2014 | 5,000-yard seasons, until the Legion of Boom answered |
| **The Torch Pass** · 2015–2019 | 28-3, and a kid from Texas Tech taking the league |
| **The Mahomes Era** · 2020–2025 | Kansas City on top, and a seventeenth game |

---

## Play it

```bash
pnpm install
cd apps/mobile && npx expo start
```

Scan the QR code with **Expo Go**. That is where it belongs — the haptics, the
three-finger spin and the reveal do not land in a browser.

`npx expo start --web` for the desktop build, which is a different composition
rather than a stretched phone: a left nav rail, and the lineup graphic beside
the eligible list so a pick never costs a scroll.

### Modes

**Player IQ** hides every rating and stat line — a name, a team and a year, and
nothing else. You pick on what you actually know about football, and the numbers
arrive with your record. **Rookie** shows everything, and is labelled as the
beginner path.

### The three-finger spin

Hold three fingers while tapping Spin — or Shift-click on a pointer device — and
the wheel lands on whichever franchise-era holds the best card still available
for a slot you have not filled.

It is a cheat and the game says so: any run that uses it is flagged, cannot set
a record, and is excluded from every leaderboard at the database level.

---

## How it is built

```
packages/domain    The scoring model. Pure, versioned, no I/O — the client
                   preview and the server's authoritative score run this exact
                   code, so they cannot drift.
packages/data      The historical dataset and the ingest that produces it.
apps/mobile        Expo Router client: iOS, Android and web from one codebase.
supabase           Schema, RLS, and the Edge Functions that own a ranked game.
scripts/verify     End-to-end verification of the server's threat model.
```

**The game is fully playable offline.** The dataset is bundled and the scoring is
local, so a spin, an eligible list and a final rating never touch the network. No
account is required to play, ever. The server exists only for cross-device
history, leaderboards and challenges.

### The server owns a ranked game

A modified client must not be able to post a score it did not earn, which takes
three things:

1. It may only ever create an **empty** session — every result column is
   unwritable by any client role, enforced by RLS predicates *and* column grants.
2. **Spins are issued by the server.** Otherwise a client would simply declare
   the seven franchise-eras holding the best cards in the dataset and earn a
   genuine near-perfect score from a roster it could never have been dealt.
3. The score is **recomputed server-side** from the recorded roster.

`scripts/verify/e2e.mjs` plays a full ranked game against a live instance and
then tries to cheat it every way that matters — 22 checks, every forgery
refused.

---

## Working on it

```bash
pnpm -r test                                    # 125 tests
pnpm -r typecheck

data/raw/fetch.sh                               # re-fetch nflverse CSVs
pnpm --filter @18-0/data build:dataset          # rebuild the cards
pnpm --filter @18-0/data analyze -- --write     # refit the calibration curve
pnpm --filter @18-0/data tune                   # re-measure 18-0's rarity
pnpm --filter @18-0/domain regen:fixtures       # move the seed fixtures with it
```

Anything that changes a published score bumps `version` in
`packages/domain/src/constants/config.ts`.

Bringing the server up locally, and everything else operational, is in
[`docs/RUNNING.md`](docs/RUNNING.md). The scoring model is documented in
[`docs/scoring-model.md`](docs/scoring-model.md), and
[`docs/FINDINGS.md`](docs/FINDINGS.md) records what the simulation harness found
— including the fact that the perfection gates as originally specified produced
**zero** 18-0 seasons in 600,000 games.

---

## Known limits

**The dataset starts at 1999.** Pro-Football-Reference is the only complete
source back to 1920 and it blocks automated access; ESPN's historical endpoints
return modern players for old seasons. Rather than author statistics from
memory into a game whose whole value is a trustworthy rating, the eras stop
where the open data does. Extending back needs a licensed source — the ingest
takes a flat stats bag and does not care where the numbers come from.

**Seven rating components are not measurable** from the available data — awards,
tight-end blocking, red-zone and third-down defense among them. They were
removed rather than left in the model silently scoring zero, so the published
weight tables are the ones that actually run.

---

## Licence

MIT. Statistics from [nflverse](https://nflverse.com) under CC BY 4.0. NFL team
names and marks belong to their respective owners; this project is unaffiliated
with the National Football League.
