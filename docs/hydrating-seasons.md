# Hydrating the pre-1999 eras

The 1980s and 1990s eras are defined, the model works on them, and they are off.
What is missing is not code — it is the right to use complete season files. See
[`FINDINGS.md` §7](FINDINGS.md#7-the-19801998-ingest-and-why-those-eras-are-switched-off).

This is the path that lets the eras fill in **one season at a time** while that
licence is being sorted out, without any route by which a half-built era reaches
a player.

```
data/raw/seasons/1980.json      ->  HYDRATE=1 build  ->  era is 2/10, and says so
data/raw/seasons/1981.json
```

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
HYDRATE=1 pnpm --filter @18-0/data build:dataset
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
false version of history"* this project refused to ship. Three fences, none of
which rely on anyone remembering:

1. **`HYDRATE` is off by default.** A plain `build:dataset` produces a dataset
   with no 1980s era in it at all, which is what gets committed and shipped.
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
  is carried by a single year.
- **The source is licensed for redistribution.** The files under
  `data/raw/seasons/` are gitignored precisely because they are only as
  redistributable as their source, and the repository must not become the thing
  that redistributes them.
- **The four dark components are understood.** QB `peak_dominance`, RB and WR
  `explosive`, and DEF `pressure` before 1982 have no season-summary equivalent.
  Measured on 2004 rated both ways, losing the EPA family moves raw ratings by
  1.6–2.1 and leaves rank order at ρ = 0.91–0.96. That is acceptable and it
  should be a stated fact about those eras, not a surprise.

## Appendix: producing a season file by hand

For evaluation, one season at a time, from a source you are reading in your own
browser. This is a stopgap for testing the pipeline — **not** an ingest, and its
output is not redistributable. A licensed feed replaces this appendix with a
converter that emits the same shape.

The mapping work is all in three tables: source abbreviation → `franchiseId`
(era-correct, per the warning above), source position → `QB|RB|WR|TE`, and source
column → `SeasonStats` key. Derive `seasonGames` from the data rather than
assuming 16, and derive `team_receiving_yards` and `target_share` by summing each
team's own rows — the model needs a denominator for share-of-offense and no
source hands you one.

Then confirm the file before trusting it:

```bash
node -e "
const f = require('./data/raw/seasons/1980.json');
const h = {}; for (const p of f.players) h[p.position] = (h[p.position] ?? 0) + 1;
console.log(f.year, 'games', f.seasonGames, '| teams', f.defenses.length, '|', JSON.stringify(h));
"
```

Twenty-eight teams for 1980–81, and a position histogram with all four groups in
it. A missing group means the position map dropped something.
