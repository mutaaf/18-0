# Scoring model — v1.3.0

Everything here lives in `packages/domain`. It is pure: no clock, no
randomness, no I/O. The client preview and the server-authoritative result run
the same `scoreRoster()`, so a disagreement can only ever mean a model-version
mismatch.

## Pipeline

```
base_rating        weighted average of the seven slot ratings   (PRFAQ §13)
  - weak_link      max(0, 90 - r)^1.35 * posFactor * scale      (PRFAQ §14)
  + elite_depth    tiered bonus for stacked lineups, capped     (PRFAQ §15)
  + chemistry      archetype pairings, clamped to [-1, +1]      (PRFAQ §16)
= raw_team_rating
→ calibrate()      monotonic piecewise-linear curve             (PRFAQ §17)
= final_rating     clamped [0, 100], rounded to 4dp
→ record band      highest floor at or below the rating         (PRFAQ §20)
→ perfection gates 17-0 only if every gate also passes          (PRFAQ §21)
```

Nothing above is a code constant. `packages/domain/src/constants/config.ts`
holds the whole model as one versioned `ScoringConfig`, and every completed
game stores the version that produced it.

## Why the calibration curve is piecewise-linear

`calibrate()` maps raw scores onto the published distribution (PRFAQ §18)
through anchor points, interpolating between them. Compared with a fitted
polynomial it is:

- **inspectable** — you can read the curve and see what a raw 97 becomes;
- **guaranteed monotonic** — a better roster can never score worse, and
  `assertMonotonicCalibration()` fails the build if an anchor set breaks that;
- **refittable** — `pnpm calibrate` regenerates the anchors from simulated
  roster percentiles without anyone reasoning about coefficients.

The anchors live in `constants/calibration.generated.ts`. Do not hand-edit
them; regenerate, and bump the model version when you do.

## Record bands are floors, not ranges

PRFAQ §20's table has gaps (`61–62.9`, then `63–64.9`). Bands are stored as
inclusive floors and the highest floor at or below the rating wins, which
closes the gaps deterministically and reproduces every boundary the spec calls
out: `96.499 → 15-2`, `96.500 → 16-1`, `98.999 → 16-1`, `99.000 → 17-0`. The
perfect band's floor and `perfection.minFinalRating` are deliberately the same
number: a rating inside the 17-0 band that cannot clear the score gate would be
an 17-0 that is always denied, which reads as a bug.

## Retuning is not optional when the dataset grows

The gates are fitted to a distribution, so every time the card pool changes they
stop meaning what they meant. Between them, five eras becoming seven and the
rating model's metric fallback took the dataset from 2,994 cards to 4,872 and
17-0 from 1 in 12,000 to 1 in 1,690 — against a README, a home screen and a
stats screen that all say *about once every 6,000 games*.

The fix is both halves, in order:

```bash
pnpm --filter @17-0/data analyze -- --games=150000 --write   # refit the curve
pnpm --filter @17-0/data tune -- --games=400000              # then pick floors
pnpm --filter @17-0/domain regen:fixtures                    # move the fixtures
```

The curve is what governs 16-1 (a band boundary); the gates govern 17-0. Tuning
only the gates leaves the near-miss twice as common as the copy claims.

**The two harnesses disagree by about 1.4x, consistently.** On the shipped
config over 400,000 games each, `tune` reports 17-0 at 1 in 5,797 and `analyze`
at 1 in 8,333; they agree closely on 16-1 (1 in 51 against 1 in 50). The gap is
systematic rather than noise -- it shows up at every gate setting -- and comes
from the two harnesses drawing play differently. Neither is wrong; they bracket
the answer. This is written down so the next person to notice does not spend an
afternoon "fixing" a number that is behaving exactly as it always has.

## The gates are a narrative device, not the difficulty

Simulation (see `FINDINGS.md`) shows the score threshold, not the gates, is
what makes 17-0 rare: 3.6% of seven-spin draws can satisfy all seven gates,
but only 0.26% can also clear 99.25. The gates' real job is the one PRFAQ §21
describes — turning a near-miss into an explanation:

> **PERFECTION DENIED** — RB2 needed a 94.0 minimum for 17-0 eligibility.

## Calibration knobs, in order of leverage

| Knob | Where | Effect |
|---|---|---|
| `calibration.anchors` | generated | The entire rating-to-percentile relationship |
| `weakLink.scale` | `config.ts` | How much one bad slot costs relative to overall quality |
| `perfection.*` | `config.ts` | How reachable 17-0 is, and which near-miss story gets told |
| `recordBands` | `config.ts` | How wide each ending is |
| `eliteDepth`, `chemistry` | `config.ts` | Small, deliberately |

## Player feedback

After a season, a player can open "Ratings look off?" under the roster and
mark any of their seven as deserving a higher (▲) or lower (▼) rating
(`app/result.tsx`, `features/rating-feedback.ts`, flag `rating_feedback`).
Each opinion is one row in `rating_feedback` (migration 0025): one per player,
per card, per model version, changed or withdrawn by tapping again. Votes made
offline queue on the device and go with the next flush.

Gut Check (`app/rate.tsx`, `features/gut-check.ts`, flag `gut_check`) is the
same evidence collected as a game: ten cards, swipe right if the rating is
right, left if not and then up or down. Migration 0028 adds the verdict
`fair` for a swipe right, which gives every complaint its denominator, and a
`source` column (`result` or `swipe`). The view's `fair` and `from_swipe`
columns count them. Read the two sources separately before you add them
together: a verdict on your own seven straight after a season is not the same
evidence as a swipe on a stranger's card. "Don't know" records nothing.

It changes nothing by itself. A rating is deterministic and every published
score depends on it, so feedback is *evidence for the next refit*, read by a
person:

```sql
select * from ops_rating_feedback where model_version = '1.4.0' limit 50;
```

`net` is too-low minus too-high among distinct voters; `rating_now` is the
card's current rating beside the average `rating_shown`. What to do with it:

- **Ignore small numbers.** A handful of votes on a card is taste. Look for
  cards with many voters and a lopsided `net`, and for *patterns* across
  cards -- a whole position, era or archetype leaning one way says more about
  the model than any single season does.
- **Fix the model, not the card.** A hand-edited rating is exactly what
  invariant 1 forbids. A pattern points at an input (a weight, an era
  adjustment, a position curve); change that, rebuild the dataset, refit the
  calibration and the gates, and bump `version`.
- **Read the next version afresh.** Feedback is keyed by model version, so the
  summary of a new model starts empty and says whether the refit landed.

## Commands

```bash
pnpm test                                  # 98 tests: every boundary and gate
pnpm typecheck
pnpm calibrate -- --games=250000 --leagues=4 --write   # refit the curve
pnpm sim -- --draws=200000 --games=200000 --leagues=3  # reachability + distribution
pnpm sim -- --clustering=0.8                           # concentrate elite talent
```

## Simulation harness

`packages/domain/src/sim` builds a synthetic league so the model can be
measured before the real historical dataset exists:

- `franchises.ts` — 32 franchise lineages and their valid decades. 221 legal
  franchise-era combinations; `JAX + 1970s` and `CAR + 1960s` cannot occur.
- `pool.ts` — a stand-in ratings dataset. `PoolSpec` declares how many
  qualifying seasons a franchise-decade yields per position and how ratings
  are distributed within them. **Replace these numbers with measured ones as
  soon as the ingest pipeline lands** — every figure the harness reports is a
  function of this spec.
- `play.ts` — spins, a continuous player-skill model, and an omniscient
  reachability solver (bipartite matching over spins and slots) that gives a
  hard upper bound on how often 17-0 is attainable.

## Respins do not touch any of this

A respin (docs/respins.md) replaces which franchise-era a turn was dealt, not
how a roster is scored, so it changes nothing here and never bumps `version`.
It does change the wheel a season was built from: "about once every 6,000
games" is measured on seven spins with no second chance, so it describes clean
seasons only, and the perfect-season board counts only those
(`leaderboard_perfect`, 0027). The simulation is not rerun for respins: a
respun season is a different game, marked ↻, not a sample of this one.
