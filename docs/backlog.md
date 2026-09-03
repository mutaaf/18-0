# Backlog

Open work, with enough context to pick it up cold. Each item says what it is,
why it matters, what has already been decided, and how to know when it is done.

Last reviewed **2026-09-03**. This repository moves quickly — before acting on
an item, check the "still true?" line, because several things listed here in the
past were fixed by the time anybody read them.

Read first: [`CLAUDE.md`](../CLAUDE.md) for the invariants,
[`docs/gameday.md`](gameday.md) and [`docs/feature-flags.md`](feature-flags.md)
for the two most recent subsystems.

## Coordinates

| | |
|---|---|
| Live site | <https://18-0.co> (Vercel, deploys from `main`); mirror at <https://mutaaf.github.io/18-0/> |
| Supabase | project `keqwdtnyotdovrtcswel`, credentials in `.local/` (gitignored) |
| PostHog | US Cloud, project **402075** ("Default project"), token `phc_wwVMwmj7…` |
| Flags | `gameday` (865091), `gameday_cta` (865098) |
| Experiment | "Gameday marquee wording" (460866) — **draft** |
| Next gameday | **2026-09-09**, window opens `21:20Z` — a 2-franchise Wednesday |

---

## 1. Attach the experiment's primary metric

**Blocked until the first gameday.** The experiment is a draft with its
hypothesis, variants and rollout set, but no primary metric: `gameday_started`
is not in PostHog's event taxonomy because it has never fired, and the metric
picker only offers events it has seen. Nobody has been able to enter Gameday
yet — the mode shipped between windows.

Deliberately *not* worked around by sending a synthetic event: in an experiment
this small, one fabricated conversion is a real distortion.

**Do:** after the first real `gameday_started` lands, open experiment 460866 →
Add primary metric → Funnel → single step `gameday_started` → goal Increase.
Then launch it. Leave "Replay Vision" off; it bills ~$0.05 per scanned session.

**Done when:** the experiment is running and its exposure count is non-zero.

**Still true?** `grep gameday_started` in PostHog's event list, or check whether
experiment 460866 still says DRAFT.

## 2. Watch the first live gameday

**2026-09-09, from 21:20Z.** Everything about Gameday has been verified except
the one thing that cannot be simulated: a real window opening. The e2e harness
proves the mechanism against a synthetic gameday it inserts itself; this is the
first time the *generated calendar* drives it.

**Check, in order:**

- the marquee lights up on its own (it re-checks the clock every 30s, so no
  reload should be needed);
- `mode: 'gameday'` opens a session, and `game_sessions.gameday_key` is stamped
  `2026-09-09`;
- every spin's franchise is one of the two playing (`ne`, `sea`);
- the completed season appears on `leaderboard_gameday(null)` and on **no**
  other board;
- `$feature_flag_called` for `gameday_cta` starts appearing — and only from
  people who saw the panel live (see item 1 and the exposure rule in
  `docs/feature-flags.md`).

It is a two-franchise Wednesday, which is the narrowest wheel the mode will ever
offer: ~10 franchise-eras. If a roster proves unfillable, that is the finding.

## 3. A pre-relocation season shows the wrong city

The model's top-rated tight end is **Todd Christensen · Las Vegas 1983**. He
played in Los Angeles. The 1983 Colts render as Indianapolis, the mid-90s Rams
as Los Angeles, the 1980s Cardinals as Arizona.

It follows from folding relocations forward so a franchise-era is one continuous
history, and the no-club-names rule leaves no other label available. It only
started to bite when 1980–1998 came in.

`FINDINGS.md` rejected a 49%-complete data source for being "a plausible-looking,
quietly false version of history". This is the same objection at a smaller scale,
and it is currently on the front page of the README.

**Options, in increasing cost:** say the convention out loud on the card;
store an era-accurate display city per season alongside the franchise lineage;
or accept it and document it (a line in the README already states the rule,
which is the minimum and is done).

**Decide before submission.**

## 4. Nothing enforces the published rarity

The README, the home screen and the stats screen all say 18-0 lands about once
every 6,000 games and 17-1 about once every 49. Those numbers are a function of
the card pool, and the pool has grown twice this month — each time silently
falsifying them until somebody measured. The last drift was a factor of four.

CI runs `pnpm --filter @18-0/data tune` on every push, but it **prints and never
asserts**, so a green build says nothing about whether the front page is true.

**Do:** assert a band in that job — fail if 18-0 falls outside roughly 1 in
4,000–9,000, which is wide enough for the ~1.4× spread between the two harnesses
(`tune` and `analyze` disagree systematically; see `docs/scoring-model.md`) and
tight enough to catch a real drift.

**Note:** retuning is two steps in order — `analyze --write` refits the curve
(which governs 17-1), then `tune` picks the gates (which govern 18-0). Bump the
model version, freeze the outgoing config in the registry the way 1.2.0 is
frozen, and regenerate the fixtures.

## 5. Gameday specials beyond the wheel

`docs/gameday.md` has the tier ladder that was agreed before any of this was
built. Tier 0 (presentational) and tier 1 (spin pool) have shipped. Still open:

- **Tier 2 — points and event boards.** A double-points window, or a board for a
  weekend. Fine to build, with one rule: the multiplier must be **stored per
  session**, never applied by editing `season_points()`, which is evaluated on
  read and would rewrite every player's lifetime total retroactively.
- **Tier 3 — scoring modifiers.** Only ever as their own mode with its own board
  and its own model version, never on the ranked rating board. The precedent for
  the shape is Scout (0017) and Gameday (0019).

## 6. Turning a flag off in PostHog does not turn it off

**A real bug, diagnosed 3 September 2026.** Both gameday flags were disabled in
the PostHog console and the marquee kept showing.

PostHog omits a disabled flag from `/decide` rather than returning it as false.
Confirmed against the live project:

```
POST /decide/?v=3  ->  { "featureFlags": {} }
```

`resolveFlag()` then reads `remote?.[key]`, gets `undefined`, and falls through
to `definition.fallback` — which is `true` for `gameday`. So the kill switch
cannot work: an absent key is indistinguishable from "PostHog never answered",
and both resolve to the shipped default.

The fallback is right for the case it was written for. `startFlags()` already
knows which case it is in — `fetchRemoteFlags()` returns `null` on failure and a
map on success — but that knowledge is thrown away before resolution, which only
ever looks at whether the *key* is present.

**Do:** carry the distinction into `resolveFlag()`.

- `remote === null` (never answered: offline, first launch) -> `fallback`
- `remote !== null`, key absent -> the flag is **not active**: `false` for a
  boolean, the control arm for a multivariate one

Keep the offline-first behaviour exactly as it is; only stop treating a
successful empty answer as silence.

**Until then, two workarounds:** in PostHog leave the flag *enabled* and set the
release condition to **0% rollout**, which returns an explicit `false` that the
current code honours; or use the device-local override in the operator console.

**Also worth knowing while testing:** flags are fetched once per launch and
cached across cold starts, on purpose — a variant that changes mid-session
measures nothing. So any flag change needs a full relaunch of the installed app,
not a refresh, and the previous answer survives until a fetch succeeds.

## 7. Player photographs are hot-linked from the NFL's CDN

`packages/data/src/headshots.ts` carries 1,626 image URLs and its own header
says the images "are not ours to redistribute". They are fetched from the NFL's
CDN when a card is opened.

This was a deliberate proof-of-concept decision — *"pull it once to prove the
POC, then we'll do the paid route"* — taken when nothing was public. The app is
now installable from the web, on a phone, and instrumented for launch, so the
POC window has closed.

Worth naming the inconsistency: the codebase avoids club names, marks and
colours on the grounds that *"the statistics are facts; the club name is a
trademark"*, and then displays copyrighted photographs of the players. Photos
are the larger exposure of the two, and unlike a rejection it is the kind of
thing that gets an app pulled after it is live.

**Cheap to remove.** `CollectibleCard` already degrades — `{photo ? … : null}`,
with the comment *"a missing one simply leaves the wash"* — and every team
defence card has run without a photo since the first build, so the fallback is
proven in production. Making `headshotUrl()` return null is a one-line change.

**Decide before the binary is public.** Options: remove them; licence a source;
or replace them with something generated that is ours.

## 8. The two store forms

Every value is written out in [`submission.md`](submission.md) — the privacy
declarations, the listing copy, the age rating and why the answer to "used for
tracking" is no. Neither form can be filled from a repository.

- **App Store Connect -> App Privacy**: Usage Data -> Product Interaction, and
  Identifiers -> User ID. Both linked to the user, both **not** used for
  tracking.
- **Play Console -> Data safety**: App activity -> App interactions, and Device
  or other IDs. Collected, not shared, deletion available in-app.

## 9. Two branches want a decision

- `fix/receiver-gap-and-season-hydration` — **delete it.** Its work is already on
  main under different commits. Merging it now would revert the dataset from
  4,872 cards to 3,279 and the model from 1.2.0 to 1.1.0.
- `chore/vercel-18-0-co` — moving to a custom domain is not just a deploy
  target. It changes the manifest's `start_url` and `scope`, the service
  worker's shell path, every absolute Open Graph URL, the Supabase redirect
  allow-list and CORS origins, and Apple's Services ID return URL. The branch
  carries the first four and added checks to `web-head.mjs`; the last two are
  console configuration no branch can carry. Land it deliberately, and re-run
  `scripts/verify/linking.mjs` afterwards.

## 10. Three agents share one working tree

Not a code problem, but it has cost real time twice: a commit landed on another
agent's feature branch because the branch was switched underneath it, and a
stale branch nearly reverted 1,593 cards. Give each agent its own clone or
`git worktree`, and branch from `origin/main` rather than from whatever is
checked out.

## 11. Smaller things

- **One PostHog project takes everything** — local dev, the e2e harness and live
  traffic all write to 402075. Fine today; if funnels get muddy, make a dev
  project and point `apps/mobile/.env` at it. The GitHub repo variable keeps
  production clean either way.
- **Retired cards accumulate.** 119 rows carry `retired_at` and no path removes
  them. Harmless — they are excluded from the wheel and from `select` — but a
  card retired for good, referenced by nothing, could eventually be deleted.
- **The flags expire on purpose.** `gameday_cta` on **2026-12-01** and `gameday`
  on **2027-03-01**; `registry.test.ts` fails the build the day after. That is
  the mechanism, not a bug: delete the flag, ship the winner, or move the date
  deliberately.
- **`scoringConfigForVersion()` has no runtime callers.** Both versions are now
  frozen and tested, so the guarantee holds; nothing re-derives an old result
  from a stored version yet. Only worth building if a feature needs it.
- **A reseed and a client release have to land together.** The server scores
  from `season_cards` and the client previews from the bundle; ship them apart
  and `version_mismatch` fires (correctly) and previews disagree with results.

## Gotchas that cost time

- **A service worker caches the dev bundle.** Editing a file and reloading
  `localhost:8099` can keep showing the *old* build through several reloads —
  it looks exactly like the change not applying. Hard reload (`cmd+shift+R`).
- **Metro in CI mode disables reloads.** `CI=1 npx expo start` will not pick up
  edits at all.
- **The e2e gameday checks need `SERVICE_KEY`.** Without it the whole block is
  skipped, and the run still passes — read the output, not the exit code.
- **Do not commit another author's in-flight hunks.** This tree regularly holds
  two people's work in the same files; stage by path.
