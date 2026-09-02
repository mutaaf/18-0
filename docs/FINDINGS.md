# Phase 0 findings — is the game mathematically sound?

Measured against a synthetic league, not real data. Every number here moves
when the real historical ratings land; the harness is built so it can be re-run
in one command when they do.

Run: `pnpm sim -- --draws=200000 --games=200000 --leagues=3` (600k spin
sequences, 600k played games, 3 independent leagues, model v1.0.0).

---

## 1. 18-0 is reachable, and roughly as rare as it should be

| | Rate | ≈ 1 in |
|---|---:|---:|
| Seven-spin draws where all gates are satisfiable (omniscient play) | 3.63% | 28 |
| ...and the roster also clears 99.25 (omniscient play) | 0.263% | 380 |
| Games actually finishing 18-0 (realistic play) | 0.009% | ~11,000 |
| Games finishing 17-1 | 1.95% | 51 |

The omniscient figure is a hard ceiling: it assumes the player can see every
card in every bucket before choosing. Real play lands ~30× below it.

**The concern that started this — that 18-0 might be unreachable — does not
hold.** One in ~11,000 is a good place to be: an engaged player who plays a few
hundred games has a real but slim chance, and a large user base produces a
steady trickle of legitimate perfect seasons for the leaderboard.

17-1 at 1-in-51 is the more important number. It is frequent enough that most
players will feel the near-miss, which is the retention loop.

## 2. The score, not the gates, is what makes 18-0 hard

3.63% of draws can satisfy every perfection gate, but only 0.263% can also
clear 99.25 — the gates cut the field by ~28×, the score cuts it by another
~14×. Filling all seven slots at their floors (96/98) is not nearly enough;
you need most of them near the top of the scale.

This is a good outcome for the design. It means the gates are doing what PRFAQ
§21 says they are for — explaining a near-miss — rather than functioning as an
arbitrary second lock.

## 3. The bottleneck is coverage, not talent

Slots fillable at their 18-0 floor, per seven-spin draw:

```
  4/7  ████                     13.4%
  5/7  ████████████             41.9%
  6/7  ██████████               36.8%
  7/7  █                         5.1%
```

Most draws get to five or six. The failure mode is almost always one position
the spins never offered at 96+, not a shortage of great players overall. That
is exactly the tension the game wants: *do I take this receiver now, or hold
out for the tight end I still need?*

## 4. Two harness bugs worth knowing about, because both are easy to repeat

**Every strategy took the best card in each bucket.** The first calibration
population therefore contained no mediocre rosters at all — raw scores spanned
only 92.5 to 100.8, and the fitted curve had to stretch eight raw points across
forty final points. The result was absurd: *a roster of seven First-Team
All-Pro seasons finished 1-17.* Fixed by offering every legal (slot, card) pair
and choosing among them by skill.

**Three discrete strategies produced a bimodal distribution.** With 20% random
and 80% near-optimal players, the raw scores formed two separate humps (10th
percentile 81.8, 25th percentile 96.2) and the curve inherited the gap.
Replaced with a continuous skill parameter driving a softmax over candidate
value, which is also a more honest model of a real user base.

Both are the same lesson: **a calibration curve is only as good as the
population it was fitted to.** Whoever re-runs this against real data should
sanity-check the played population's spread before trusting the curve.

## 5. Open product decisions

These are calibration choices, not bugs. Each is a one-line config change.

**The low-end anchors are invented.** PRFAQ §18 specifies the distribution from
the 50th percentile up. Everything below is mine, chosen so all 19 endings are
actually inhabited rather than decorative. What that currently means:

| Every slot rated | Scale meaning (§9) | Finishes |
|---:|---|---|
| 88 | Pro Bowl caliber | 6-12 |
| 94 | First-Team All-Pro | 9-9 |
| 97 | All-time elite | 14-4 |
| 99 | Historically dominant | 17-1 |

Seven All-Pro seasons finishing 9-9 is defensible — it *is* average for this
game — but it is a product call, and some players will read it as harsh. Moving
the sub-50th anchors up softens the whole bottom half without touching 18-0.

**`weakLink.scale` is still 0.02, a placeholder.** The model currently derives
most of its spread from the base rating. Raising the scale makes the game more
about avoiding a weak slot and less about accumulating stars. Worth a deliberate
decision once real ratings exist.

**Elite density is the single most sensitive input.** The synthetic pool assumes
~58 seasons at 96+ and ~16 at 98+ per position across all of NFL history, spread
evenly across franchise-decades. Real greatness clusters. A clustering sweep
(`--clustering=0.4`, `--clustering=0.8`) moved the omniscient 18-0 rate between
1-in-380 and 1-in-830, so the conclusion is directionally stable — but the
absolute rarity of 18-0 will not be known until the ingest pipeline runs.

## 6. What this does not tell you

The pool is synthetic. It says the *mechanism* is sound: the loop produces a
usable distribution, all 19 endings are reachable, and perfection is rare
without being impossible. It does not say what the real rarity will be. That
needs the historical dataset — the largest remaining piece of work.

---

## 7. The 1980–1998 ingest, and why those eras are switched off

The dataset stops at 1999 because that is where nflverse starts. The obvious
next move is to fill 1980–1998 from somewhere else, and the pipeline for it is
built: `packages/data/src/legacy.ts` reads NFL.com's own season files from a
public mirror, maps every franchise name used since 1980 through its
relocations, derives team defence from game-log scorelines, and joins nflverse
rosters — which *do* go back to 1920 — for the positions the mirror leaves
blank. Two new eras are defined for it, **The 46 and the Catch** (1980–89) and
**Three Rings and Four Falls** (1990–98).

It runs. `LEGACY_SEASONS=1 pnpm --filter @18-0/data build:dataset` produces
5,551 extra seasons and **201 franchise-era combinations across 7 eras**,
against 157 across 5.

**It is off by default, because the source is 49% complete.**

Counting distinct skill players per season against the nflverse rosters for the
same years:

| | |
|---|---|
| Skill players on 1980–1998 rosters | 10,582 |
| Present in the mirror | 5,183 |
| **Coverage** | **49.0%** |

Per-season coverage never rises above 53% or falls below 44%. If the omissions
were the marginal half of a roster that would be survivable — a spin only needs
the best player at each position. They are not:

- **Emmitt Smith** — zero rows. The all-time leading rusher.
- **Joe Montana** — zero rows.
- **Brent Jones** — zero rows.

The consequences are exactly as bad as they sound. 1990s Dallas has **no
qualifying running back at all**, so the franchise-era is dropped; the best
Dallas back the file knows about is Tommie Agee. San Francisco 1990–98 cannot
field a tight end and is dropped too, taking Jerry Rice's 1,848-yard 1995 with
it. Nine franchises fall out of that era and six out of the 1980s. The two eras
that survive are a plausible-looking, quietly false version of NFL history —
and a game whose entire claim is *the ratings are real* cannot ship that.

Checked and ruled out as alternatives: nflverse publishes 25 data releases and
**none carries pre-1999 statistics** (rosters are the only asset that goes
back); Pro-Football-Reference blocks automated access; ESPN's historical
endpoints return modern players for old seasons. The same mirror's game-log
files — a separate 22 MB of it — have the identical gaps, so the shortfall is in
the original scrape, not in which file was chosen.

**The remaining work is a licensed source, not more code.** The loader takes a
flat stats bag and does not care where the numbers come from; point
`data/raw/nfl` at complete season files and the eras turn on with an
environment variable.

### Two bugs the exercise did surface

Both were in the legacy loader and both are fixed, and both are the kind that
would have been invisible in the output:

1. **Trick plays minted quarterbacks.** Any passing row became a QB card, so
   Jerry Rice's two 1986 attempts and Barry Sanders' one 1996 attempt produced
   quarterback cards. Now a passing row needs a roster position of QB, or 100
   attempts where the roster is silent.
2. **Mid-season trades lost half a season.** Season rows were keyed on player
   and year but not team, so a traded player's two rows overwrote each other —
   Eric Dickerson's 1987 was three Rams games *or* nine Colts games depending on
   file order, never both.
