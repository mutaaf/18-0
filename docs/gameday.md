# Gameday

A mode that only exists while the league is playing.

It opens three hours before the first kickoff of a real NFL gameday and closes
six hours after the last. The wheel narrows to the franchises actually on the
field that day. The season ranks on a board belonging to that date and no
other, and it is kept afterwards — a board that vanished at midnight would be a
board nobody could be shown they had won.

```
gamedays              one row per real gameday, with its window
gameday_franchises    who is playing — the spin pool for the day
game_sessions
  .mode = 'gameday'   declared by the client before the first spin
  .gameday_key        stamped by the server from its own clock
leaderboard_gameday() one day's board, live or finished
```

## Why the calendar is a table and not a feed

`data/raw/games.csv` is nflverse's schedule file, and it already carried every
fixture through the following season with kickoff times, both teams and the
week. `pnpm --filter @18-0/data build:schedule` turns it into
`packages/data/generated/schedule.json`, which is bundled into the app and
loaded into Postgres by the same seed that loads the cards.

Three things that buys, all of which the rest of the game already depends on:

- **Determinism.** Two devices asked at the same instant agree, and so does the
  server. A feed can be slow, wrong or rate-limited, and none of those should
  be able to decide which franchises are on somebody's wheel.
- **Offline.** The home screen knows when the lights come on with no connection
  at all. An unranked gameday run works on a plane.
- **Auditability.** The window a season was played in can be recomputed from a
  file in the repository a year later.

The cost is that a flexed kickoff or a postponement needs a rebuild to reach
players. For a wheel and a daily board that is a fair trade — nothing here
decides a rating.

Kickoffs are stated in Eastern with no offset attached, so `easternToUtc()`
converts them at build time and everything downstream handles UTC instants
only. Getting the daylight-saving rule wrong would move a Sunday board onto a
Monday for everyone west of the league.

## Four rules, and where each one comes from

**A gameday season reaches no other board.** Not the rating board, not Scout's,
not points. The wheel it was dealt from held two to twenty-six franchises
instead of thirty-two, which is a different game — and 0017 already refused to
rank two different games together when Scout arrived. Every board restates
`gameday_key is null` even where another predicate would already have excluded
it, because "excluded as a side effect" is exactly how the moderation filter
went missing for two migrations.

**The server decides which gameday it is.** `gameday_key` has no insert grant
and is written by a trigger from `now()`. A client that could name its own
gameday could name last Sunday's, when the board has settled and the target is
known. Declaring `mode = 'gameday'` outside any window raises rather than
falling back to an ordinary season: a player who tapped Gameday and quietly got
a normal wheel would only find out when the board they expected to be on did
not have them.

**A session is never both a gameday and a challenge.** A challenge is a duel
replayed on the creator's seven spins; a gameday run must be dealt from that
day's franchises. They cannot both decide the wheel.

**The calendar upserts; it never truncates.** Real seasons carry a
`gameday_key`, and `game_sessions.gameday_key` deliberately has no foreign key:
`truncate ... cascade` on a rebuilt calendar would otherwise take the evidence
of what people played with it. A season outliving its gameday row is the
intended behaviour, and `scripts/verify/e2e.mjs` asserts it.

## What it deliberately does not do

Nothing about a gameday touches a rating. The wheel changes; the model does
not, so 18-0 is exactly as rare on a Sunday as it is on a Tuesday and the
all-time boards are untouched.

That was a choice, and the ladder it sits on is worth writing down, because the
next idea in this space will want a rung further up:

| Tier | What it changes | Verdict |
|---|---|---|
| Presentational | The marquee, the copy, a themed panel | Free. Ships whenever. |
| Spin pool | Which franchise-eras the wheel offers | **This.** Server-issued already, so the pool is a filter on a query the server was already running. |
| Points and boards | What a season is worth, which board it lands on | Fine, if the multiplier is stored *per session*. `season_points()` is evaluated on read, so editing it rewrites every player's lifetime total retroactively. |
| Scoring | Weights, ratings, gates | Not on a ranked board. If it ever exists, it is its own mode with its own board and its own model version — the shape this one already has. |

## The version handshake, which arrived with it

The client previews a score from a dataset baked into the app; the server
scores from rows in Postgres. Shipping an app release and reseeding the database
cannot be simultaneous, so there is always a window where the two sides are
working from different inputs — and nothing used to notice. A player saw one
number, the board showed another, and neither side could say why.

`complete-game` now takes the client's `modelVersion` and `datasetModelVersion`
as advisory values, compares them with its own and with the
`rating_model_version` on the cards it just scored, records a `version_mismatch`
event on the trail when they disagree, and returns the comparison. The client
turns it into a sentence naming both versions.

Reported, not refused: the server's answer already wins, and refusing every
completion during a rollout would take the game down to protect a rounding
difference. What matters is that the disagreement is visible — as a spike on the
trail for whoever is deploying, and as an explanation for whoever is playing.

## Still open

- **`scoringConfigForVersion()` has no callers.** Sessions store the model
  version that scored them and the registry holds one entry, but nothing ever
  reads a historical config back. The first real model change therefore turns
  the all-time rating board into a mix of two models. Freezing boards per
  version and rescoring are both defensible; doing neither is not.
- **The gameday board has no windowed variant**, because a gameday *is* a
  window. If a week-long "gameday of the week" board is ever wanted, it wants
  its own function rather than a period chip over this one.
