# Hydrating the pre-1999 eras

The 1980s and 1990s eras are defined, the model works on them, and they are off
by default. What was missing was never code — it was the right to use complete
season files. See
[`FINDINGS.md` §7](FINDINGS.md#7-the-19801998-ingest-and-why-those-eras-are-switched-off).

**Status.** Pro-Football-Reference has licensed the season tables and confirmed
the reading method below. **Both eras are hydrated and live**: 1980–1989 at 10 of
10 seasons and 1990–1998 at 9 of 9, 9,586 player-seasons across 19 files. They
build by default whenever the files are present, carry no `provisional` flag, and
seed to the server like any other era.

The eras fill in **one season at a time**, and a part-hydrated era can be played
locally without any route by which it reaches a player.

```
data/raw/seasons/1980.json      ->  build  ->  era is 2/10, and says so
data/raw/seasons/1981.json                     ...  10/10 when it is done
```

Hydration is on whenever the files are there — the same rule the modern seasons
follow, since `data/raw` is gitignored either way. `HYDRATE=0` builds without
them, for checking what the dataset looks like on modern data alone.

## The contract

One file per year, at `data/raw/seasons/<year>.json`. The keys inside `stats`
are the **`SeasonStats` keys the rating models consult**, verbatim — there is no
column mapping in the loader to get wrong, because the mapping happens once, in
whatever converter produces the file.

```json
{
  "year": 1980,
  "source": "where these numbers came from, and under what terms",
  "seasonGames": 16,
  "players": [
    {
      "id": "SipeBr00",
      "name": "Brian Sipe",
      "position": "QB",
      "franchiseId": "cle",
      "stats": { "games": 16, "attempts": 554, "passing_yards": 4132, "passing_tds": 30 }
    }
  ],
  "defenses": [
    { "franchiseId": "phi", "stats": { "games": 16, "points_allowed": 222, "yards_allowed": 4443 } }
  ]
}
```

Four things this stands or falls on:

- **`id` must be stable across years and unique within one.** The build collapses
  a franchise-era to one card per identity, so an id that changes between seasons
  turns one player into several cards, and an id shared by two people merges two
  players into one. A source's own player id is the right answer; a slug of the
  name is a collision waiting to happen over ten seasons.
- **`franchiseId` is the lineage, not the city.** The 1980 San Diego Chargers are
  `lac`, the Houston Oilers are `ten`, the Baltimore Colts are `ind`, and the
  St. Louis Cardinals are `ari`. Watch this one: several sources use
  abbreviations that mean a *different* franchise in the modern era — `STL` is the
  Cardinals in 1980 and the Rams in 1999, `HOU` is the Oilers then and the Texans
  now, `BAL` is the Colts then and the Ravens now. Do not reuse
  `TEAM_TO_FRANCHISE` for a pre-1999 file; it is keyed on modern abbreviations.
- **`seasonGames` is per file, because it varies.** The qualification floors scale
  by it (PRFAQ §12). 1982 played nine games and 1987 played fifteen; holding
  either to a sixteen-game bar throws away most of the league.
- **Absent is absent.** Leave a stat key out rather than writing `0`. A zero that
  means "not recorded" is the bug that cost this dataset six seasons of receivers
  — see `recorded()` in `packages/data/src/build.ts`.

Anything malformed is **rejected by the whole year**, loudly, rather than
half-loaded. The 49%-complete mirror looked fine in aggregate and was missing
Emmitt Smith; a partial parse is the failure this format exists to prevent.

The full field list, with what each one feeds and what breaks without it, is in
the field manifest: <https://claude.ai/code/artifact/a6baada2-d4cc-4d10-85f7-a204c987eab3>

## Building with it

```bash
pnpm --filter @18-0/data build:dataset
```

```
  hydrated 934 seasons from 2 year file(s): 1980, 1981
    source: <whatever the files declare>
  ~~ 1980_1989 is PROVISIONAL: 2/10 seasons hydrated — local play only, refused by seed:sql
  186 valid franchise-era combos across 6 eras
```

Then run the app as usual. The 1980s franchise-eras spin, deal and score.

Drop in `1982.json` and rebuild — the era becomes 3/10. No code change, no flag,
no migration. Coverage is counted from the files that exist.

## Why a provisional era cannot escape

An era part-way through hydration is exactly the *"plausible-looking, quietly
false version of history"* this project refused to ship. Both eras have since
finished filling and the flag is off them, but the machinery stays for the next
one. Three fences, none of which rely on anyone remembering:

1. **A provisional era needs season files to exist at all.** Without them the
   build produces no pre-1999 era, which is the state of any machine that has
   not hydrated. `HYDRATE=0` forces that state deliberately.
2. **`provisional: true` is stamped on the era** in `dataset.json`, and only ever
   when true — so a shipped dataset carries no such flag.
3. **`seed:sql` refuses outright.** It exits non-zero and writes nothing:

   ```
   refusing to emit seed SQL: the dataset contains provisional era(s) 1980_1989 (1980–1989).
   ```

   This is the fence that actually matters. `season_cards` is what the server
   scores **ranked** games against, so seeding a two-of-ten era would put
   incomplete history onto the leaderboard, and `rating_model_version` would not
   even flag it. Local play against a bundled JSON is casual and offline;
   the database is the leaderboard.

A provisional era is also exempt from `MIN_ERA_COVERAGE`, since being incomplete
is its whole state, and exempt from the per-position thinness warning, since it
already announced itself.

## Before it can be turned on for good

Remove `provisional: true` from the era in `packages/data/src/eras.ts` when, and
only when:

- **Eight of the ten seasons are hydrated.** `MIN_ERA_COVERAGE` is 0.8 and a
  finished era has to clear it on its own merits, at every position — the
  per-position check exists because an era can look covered while one position
  is carried by a single year. *(1980–1989: satisfied, 10/10 at every position.)*
- **The licence covers redistribution, not just reading.** This is the open
  question and it is a different question from the one already answered. Reading
  the tables is licensed. Removing the flag ships the era: the derived ratings
  and a short stat line per card go into a committed `dataset.json`, a public
  GitHub Pages build, two app stores and the seeded database. The files under
  `data/raw/seasons/` stay gitignored either way — they are only as
  redistributable as their source, and the repository must not become the thing
  that redistributes them. Get this in writing before flipping the flag.
- **The four dark components are understood.** QB `peak_dominance`, RB and WR
  `explosive`, and DEF `pressure` before 1982 have no season-summary equivalent.
  Measured on 2004 rated both ways, losing the EPA family moves raw ratings by
  1.6–2.1 and leaves rank order at ρ = 0.91–0.96. That is acceptable and it
  should be a stated fact about those eras, not a surprise.

## Producing a season file

There is no API. The licensed route is to read the four season tables —
`passing`, `rushing`, `receiving` and `opp` — in a browser and convert them, one
year at a time. That is slower than a feed and it is completely adequate: NFL
history is immutable, so every season is read exactly once and never again.

The mapping work is three tables: source abbreviation → `franchiseId`
(era-correct, per the warning above), source position → `QB|RB|WR|TE`, and source
column → `SeasonStats` key. Two things must be **derived rather than assumed**:
`seasonGames`, from the maximum games any team played, because 1982 played nine
and 1987 played fifteen; and `team_receiving_yards` and `target_share`, by
summing each team's own rows, because the model needs a denominator for
share-of-offense and no source hands you one.

Practical notes from doing the decade:

- **Three seasons per pass.** Four table fetches plus `DOMParser` on each is
  roughly ten seconds a season; eight seasons in one go exceeds the tool's
  45-second ceiling. Accumulate onto `window` and export once at the end.
- **One download, not many.** Several blob downloads fired together and only the
  first arrived. Bundle the years into a single JSON and split it on disk.
- **Read the audit, not the file.** Each pass should report player count, team
  count, derived `seasonGames`, and any unmapped team code. Twenty-eight teams
  and an empty unmapped list is the pass condition; a stray code means a
  franchise silently vanished.

Then confirm the file before trusting it:

```bash
node -e "
const f = require('./data/raw/seasons/1984.json');
const h = {}; for (const p of f.players) h[p.position] = (h[p.position] ?? 0) + 1;
console.log(f.year, 'games', f.seasonGames, '| teams', f.defenses.length, '|', JSON.stringify(h));
"
```

Twenty-eight teams through 1994, and a position histogram with all four groups in
it. A missing group means the position map dropped something. Then spot-check a
season everyone knows — Marino's 1984 is 5,084 yards and 48 touchdowns, Dickerson
that year is 2,105 rushing — because a plausible-looking file with the wrong year
in it is the failure that survives every structural check.

## Known gaps in the hydrated eras

- **Team sacks are absent.** They are not in the `opp` team-stats table at all,
  so the defence `pressure` component (9.5% of a defence rating) is dropped for
  every hydrated season and its weight redistributed. Sacks became official in
  1982, so 1982 onward could be closed by summing player sacks from the season's
  defensive table. Within an era the omission is uniform, so it costs ordering
  nothing; it is worth closing for cross-era honesty rather than for ranking.
- **The EPA family cannot be closed.** `passing_epa`, `rushing_epa` and
  `receiving_epa` need play-by-play. QB `peak_dominance` and RB/WR `explosive`
  stay dark. Measured on 2004 rated both ways, this shifts raw ratings by 1.6–2.1
  and leaves rank order at ρ = 0.91–0.96.
