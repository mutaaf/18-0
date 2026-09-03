# Working in this repository

Read this before changing anything. It is short on purpose: it holds the rules
that are expensive to discover by breaking them, and points at the files that
hold the rest.

## The three invariants

**1. A rating is deterministic.** The same seven cards earn the same record on
every device, forever, and the server recomputes the score from its own rows to
prove nobody cheated. Nothing may make a score depend on the clock, the device,
a random number, a network answer or a feature flag. The model is
`packages/domain` — pure, versioned, no I/O — and both the client preview and
the Edge Function run that exact bundle.

**2. The client is never trusted with anything that reaches a leaderboard.**
Spins are issued by the server, the roster is scored by the server, and
`assisted`, `mode` and `gameday_key` are server facts rather than client
claims. If a change lets a client assert something a leaderboard reads, it is
wrong however convenient it is.

**3. The game plays offline.** The dataset and the gameday calendar are bundled,
scoring is local, and no account is ever required. A feature that needs the
network must degrade to something honest, not to a spinner.

## Feature flags — the only way to gate a feature

Declare it in `apps/mobile/src/features/flags/registry.ts`, read it with
`useFlag('key')` or `flag('key')`. Never read a flag any other way: no
`process.env.EXPO_PUBLIC_FEATURE_*`, no ad-hoc remote config, no `__DEV__`
branch standing in for a rollout.

The registry requires a summary, an owner, a `removeBy` date and a fallback,
and an experiment additionally requires arms, a `control` and a metric that is
a real `EventName`. `registry.test.ts` enforces all of it, including that no
flag key appears in `packages/domain`, `packages/data` or `supabase/` — flags
reach the client's surface only, because of invariant 1.

Full pattern, and why PostHog rather than LaunchDarkly:
[`docs/feature-flags.md`](docs/feature-flags.md).

## Conventions that are load-bearing

- **Generated files are generated.** `packages/data/generated/*.json`,
  `supabase/seed/0001_dataset.sql`, `supabase/functions/_shared/domain.ts`,
  `constants/calibration.generated.ts` and everything the dataset build writes
  into `apps/mobile/public/` (`ledger.html`, `stat-lines.json`,
  `stat-lines-manifest.json`) are build outputs. Change the builder,
  re-run it, commit the result. Never hand-edit them.
- **Migrations are append-only and restate what they replace.** When replacing
  a view, read the version being replaced rather than the one you remember:
  0009 rebuilt a view from memory and silently dropped 0002's moderation filter
  for two migrations. Every board's filters are restated in full every time.
- **Nothing may truncate a reference table.** `game_selections` references
  `season_cards`; `game_spins` references `franchises` and `eras`. A
  `truncate … cascade` there deletes every pick and every spin ever made. The
  seed upserts, and a card the dataset drops is *retired* (0020), never removed.
- **Anything that changes a published score bumps `version`** in
  `packages/domain/src/constants/config.ts` — and when the card pool grows, the
  calibration curve and the perfection gates both need refitting, or the "once
  every 6,000 games" on the front page quietly stops being true. See
  [`docs/scoring-model.md`](docs/scoring-model.md).
- **No club names, marks, logos or colours.** Franchises are identified by city
  — "Baltimore", not the club — and palettes are generated per franchise. The
  statistics are facts; the club name is a trademark.
- **Enforce rules in the build, not in prose.** The precedents:
  `assertMonotonicCalibration()`, the append-only audit trigger, the era-story
  test that fails on an unknown franchise key, the schedule build that refuses
  overlapping windows, and the flag registry test. A rule with no test is a
  rule that is already being broken somewhere.

## Where the rest is written down

| | |
|---|---|
| [`docs/backlog.md`](docs/backlog.md) | **Open work, with the context to pick it up cold. Start here.** |
| [`docs/scoring-model.md`](docs/scoring-model.md) | How a season becomes a number, and what has to be refitted when the pool changes |
| [`docs/FINDINGS.md`](docs/FINDINGS.md) | What the simulation measured, and why the free pre-1999 source was rejected |
| [`docs/hydrating-seasons.md`](docs/hydrating-seasons.md) | Bringing a pre-1999 season in, and the licence it needs |
| [`docs/gameday.md`](docs/gameday.md) | The gameday mode, and the tiers of what a live event may change |
| [`docs/feature-flags.md`](docs/feature-flags.md) | Flags and experiments |
| [`docs/RUNNING.md`](docs/RUNNING.md) | Running it, deploying it, regenerating the model |
| `PRFAQ.md` | The original specification. Section numbers are cited throughout the code |

## Before saying it works

```bash
pnpm -r typecheck
pnpm -r test
```

Both must pass. For a change to the server layer,
`node scripts/verify/e2e.mjs` against a live instance is the real check — it
plays a ranked game and then tries to cheat it every way that matters.

Comments in this codebase explain *why*, usually by naming the thing that went
wrong without them. Match that. A comment restating the code is worse than no
comment; a comment recording the bug that made the code look strange is the
most valuable line in the file.
