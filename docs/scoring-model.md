# Scoring model — v1.0.0

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
→ perfection gates 18-0 only if every gate also passes          (PRFAQ §21)
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
out: `96.499 → 16-2`, `96.500 → 17-1`, `99.249 → 17-1`, `99.250 → 18-0`.

## The gates are a narrative device, not the difficulty

Simulation (see `FINDINGS.md`) shows the score threshold, not the gates, is
what makes 18-0 rare: 3.6% of seven-spin draws can satisfy all seven gates,
but only 0.26% can also clear 99.25. The gates' real job is the one PRFAQ §21
describes — turning a near-miss into an explanation:

> **PERFECTION DENIED** — RB2 needed a 96.0 minimum for 18-0 eligibility.

## Calibration knobs, in order of leverage

| Knob | Where | Effect |
|---|---|---|
| `calibration.anchors` | generated | The entire rating-to-percentile relationship |
| `weakLink.scale` | `config.ts` | How much one bad slot costs relative to overall quality |
| `perfection.*` | `config.ts` | How reachable 18-0 is, and which near-miss story gets told |
| `recordBands` | `config.ts` | How wide each ending is |
| `eliteDepth`, `chemistry` | `config.ts` | Small, deliberately |

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
  hard upper bound on how often 18-0 is attainable.
