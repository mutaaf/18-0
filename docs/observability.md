# Observability

When something breaks or slows down for players -- a crash, a JS error, a spin
that hangs, a completion that fails, a page that takes six seconds, a dead site
or function, a broken build or schedule -- we should hear about it within the
hour, with enough context to fix it, without anybody watching a screen.

Three layers, each with one place to look:

| Layer | What it sees | Where to look | How it gets your attention |
|---|---|---|---|
| **Synthetic monitor** | The site, a full casual season in a real browser, the Edge Functions, Auth, a leaderboard read, the TestFlight schedule, CI on main | GitHub issues labelled [`incident`](https://github.com/mutaaf/18-0/issues?q=label%3Aincident) | One issue per outage, plus the failed-run email when it opens |
| **Client diagnostics** | Errors, crashes, start-up time, web vitals, every server call's latency and outcome, downgrades, shares -- from real players' devices | PostHog: the **17-0 health** dashboard, and Error tracking | PostHog alerts, emailed to the owner |
| **Server logs** | One line per Edge Function request, every decision on the audit trail | Supabase → Edge Functions → Logs; `/admin` for the audit trail | Through the two above: a server failure shows up as failing `server_call`s and, if total, as a monitor incident |

Nothing here is a new vendor. PostHog was already the analytics processor,
Supabase already logged, GitHub already ran the schedule. No Sentry, no
Datadog, no SDK.

## What is measured

### From players' devices (`apps/mobile/src/features/diagnostics`)

Every event below passes one gate, `diagnosticsAllowed()`: the `diagnostics`
flag is on, and on the web the browser has not sent Global Privacy Control or
Do Not Track. Each carries `app_version`, `build` (store build number on
native, commit on the web), `route` (the pattern, `card/[id]`, never the id),
`scoring_version`, `platform`, the dataset and rating-model versions that every
event carries, and the `$feature/<flag>` variants.

| Event | When | What it says |
|---|---|---|
| `$exception` | An uncaught error (`ErrorUtils` on native, `window.onerror` on the web), an unhandled promise rejection (release builds; Hermes' tracker), a render error caught by a route's ErrorBoundary, or a JS fatal from the previous launch | Type, scrubbed message, raw stack, `$exception_source`, `$exception_level` (`fatal` or `error`), `occurrence`, `suppressed`. Built into `$exception_list` on the way out so PostHog's error tracking groups it |
| `app_unclean_exit` | A launch that finds the previous one died while in the foreground with no JS fatal recorded | `last_route`, `last_version`, `last_build`. This is the native crash, OOM and watchdog-kill count -- see "Still blind" |
| `app_started` | Once per launch, when fonts are loaded and the navigator has rendered | `ready_ms`, and `basis`: `navigation` (web, includes the network), `process` (native, from process start), `runtime` (native fallback) |
| `web_vitals` | Once per page load, when the page is hidden | `lcp_ms`, `cls`, `inp_ms`, `fcp_ms`, `ttfb_ms`, each with a `*_rating`; `viewport`, `embedded` |
| `server_call` | Every Edge Function call and the ranked-session insert (`ranked.ts`) | `fn`, `outcome` (`ok`/`refused`/`offline`), `ms`, `slow` (> 3 s), `reason` (the server's error code), `status`, `error_class`, and `request_id` when it failed or was slow |
| `season_downgraded` | A ranked season fell back to unranked, anywhere (open, spin, pick, reveal) | `cause` (`timeout`, `offline`, `session`, `version_mismatch`, `score_disagreement`, `gameday_closed`, `challenge_closed`, `refused`, `other`), `filled`, `mode` |
| `result_shared` | Every press of Share on the result screen | `outcome`: `image`, `text`, `link`, `copied`, `cancelled`, `failed` |

`score_disagreement` and `version_mismatch` existed before and are on the
dashboard with an alert at any non-zero value.

**Rate limiting.** A bug in a render loop cannot flood: per device, the same
error (same type, source and message with its numbers removed) is sent on its
1st, 10th and 100th occurrence only, carrying the count; at most 5 reports a
minute and 25 a launch; anything held back is counted and the count rides on
the next report (`errors.ts`, `Limiter`, tested).

**The kill switch.** `diagnostics` in `features/flags/registry.ts`. Off in
PostHog stops every report on every device that can reach PostHog, without a
release.

**Proving it end to end.** `/admin` → Diagnostics has three buttons that throw
a render error, an uncaught error and an unhandled rejection. Their messages
start with `Operator test`, which every dashboard tile filters out.

### From the server (`supabase/functions/_shared/observability.ts`)

Every function is wrapped in `instrument()`, which writes one line per request:

```json
{"level":"info","function":"spin","event":"request_finished","status":200,"outcome":"ok","duration_ms":143,"request_id":"…","client":"ios"}
```

and `request_crashed` with `error_class` when a handler throws -- which used to
be a bare 500 with no line at all. The client sends `x-request-id` on every
call, so a failing `server_call` in PostHog and its line in the function logs
share an id. The decisions themselves (spin issued, pick recorded, roster
scored, refusals) were already on the audit trail.

`functions/health` answers `GET /functions/v1/health` with no auth: the scoring
bundle's version, and a card count through the service role with its latency.
200 or 503.

### Synthetic (`scripts/monitor/checks.mjs`, `.github/workflows/monitor.yml`)

Every 15 minutes, at :07, :22, :37 and :52. Each failing check is retried once
after 45 s before it counts.

| Group | Check | Fails when |
|---|---|---|
| site | home page serves the app | not 200, or no app shell in the HTML |
| site | privacy policy serves | not 200, or the policy text is missing |
| site | ledger serves | not 200, or suspiciously small |
| site | stat-lines manifest serves | not 200, or not JSON |
| browser | boots and plays a casual season offline | headless Chrome at a phone's size cannot reach the home screen, start a Rookie season with the ranked switch proved off, pick seven players and reach the result screen; or any uncaught error was thrown on the way |
| server | health endpoint | not 200 / `ok: false`. A 404 is a warning ("not deployed"), not an incident |
| server | `<fn>` is deployed and refuses a stranger | the preflight is not 200, or a POST with only the public key is not refused with 401 `unauthenticated` |
| server | auth answers | `/auth/v1/health` not 200 |
| server | a leaderboard reads | `leaderboard_rating?limit=1` not 200 JSON |
| builds | TestFlight schedule is not failing | the last two scheduled `ios-github.yml` runs both failed |
| builds | CI on main is green | the latest completed CI run on main failed |

The monitor **never plays a ranked game and never writes to production**: the
browser blocks Supabase entirely (so the casual season is also a check that the
game plays offline), and it refuses to start unless the ranked switch reads
off. It blocks PostHog, Box Office and the ad hosts too, so a synthetic visit
is never a player, a page view or an ad impression.

## Where to look

- **Is it down?** Open issues labelled `incident`. The issue body is the table
  from the latest run; its comments are the outage's timeline.
- **What is breaking for players?** PostHog → Dashboards → **17-0 health**,
  then Error tracking for stacks and grouping.
- **What did the server do with request X?** Supabase → Edge Functions →
  Logs, search the `request_id`; `/admin` for the audit rows of that request.
- **Native crashes with stacks:** Xcode → Organizer → Crashes (and TestFlight
  feedback) for iOS; Play Console → Android vitals → Crashes & ANRs.
- **From a laptop:** `node --env-file=apps/mobile/.env scripts/monitor/checks.mjs`
  runs exactly what the workflow runs.

Supabase log queries worth keeping (Logs Explorer, `function_logs`):

```sql
-- every server failure in the last day
select timestamp, event_message from function_logs
where event_message like '%"outcome":"error"%' or event_message like '%request_crashed%'
order by timestamp desc limit 100;

-- one request, end to end
select timestamp, event_message from function_logs
where event_message like '%<request_id>%' order by timestamp;
```

## Runbook

Every alert, what it most likely means, and the first three things to do.

### Monitor: home page / privacy / ledger / manifest

The site is not serving. 1) Open https://18-0.co yourself. 2) Vercel →
Deployments: did the latest one fail or get rejected? A `vercel.json` that
breaks the schema is rejected silently and the last good build stays up -- but a
DNS or domain change is not (`docs/hosting.md`). 3) If Vercel is down, the
GitHub Pages mirror is at mutaaf.github.io/18-0.

### Monitor: boots and plays a casual season offline

The site serves but the game does not work in a browser. The detail says how
far it got. 1) Reproduce: `node scripts/monitor/checks.mjs --only browser`
(add `MONITOR_SITE=http://localhost:…` against a local `pnpm verify:web`
export). 2) "uncaught error" -- the message and file are in the detail; the
same error will be in PostHog Error tracking from real players. 3) "never
showed the ranked switch" with no error is usually a bundle that failed to load
-- check the browser console on the live site. If the accessible labels the
check drives changed (`Play for the leaderboard`, `Play Rookie`, `Spin the
wheel`, ` slot. Empty.`, `Reveal your result`, `Build another roster`), update
`inPage()` in the same pull request.

### Monitor: health endpoint / functions / auth / leaderboard

1) https://status.supabase.com. 2) Supabase → Edge Functions → Logs for
`request_crashed`. 3) A function that is not deployed answers 404 to the
preflight: `supabase functions deploy <fn>` (`docs/RUNNING.md`). Health
reporting 0 cards means the seed is gone -- every spin would dead-end; reseed
from `supabase/seed` (it upserts; never truncate, CLAUDE.md).

### Monitor: TestFlight schedule / CI on main

1) Open the run linked in the detail. 2) For the schedule, the usual causes are
an expired certificate or profile, an Apple outage, or an Xcode image change
(`.github/workflows/ios-github.yml`). 3) For CI, `pnpm -r typecheck && pnpm -r
test` locally on main.

### PostHog: Errors per 100 launches > 5 / Error spike > 60 an hour

1) Error tracking, sorted by occurrences in the last 24 h: one issue usually
dominates. 2) Break it down by `app_version` and `platform`: a new release on
one platform is the common case. 3) If it is a loop flooding the quota and the
fix is not quick, switch `diagnostics` off in PostHog -- the reports stop, the
game is unaffected -- and switch it back on with the fix.

### PostHog: Crash-free launches < 99%

1) Is it `$exception` with `$exception_level = fatal` (a JS fatal -- the stack
is in Error tracking) or `app_unclean_exit` (native -- the stack is in Xcode
Organizer or Android vitals)? 2) Break down by `last_version`. 3) A native
crash that started with a release is usually a native module or an SDK bump in
that release's diff.

### PostHog: Spin latency median > 3 s

1) Is it every `fn` or only `spin`? All of them is Supabase; only spin is the
spin function or its queries. 2) Take a slow event's `request_id` to the
function logs: `duration_ms` there versus `ms` here separates server time from
network time. 3) `/admin` shows p95 by event from the audit trail.

### PostHog: Server calls failing > 10% / Completion failures > 2%

1) Break down by `fn` and `reason`. A `reason` is the server's own refusal code
(`rate_limited`, `audit_unavailable`, `already_completed`…); `offline` with a
`status` of 5xx is the platform. 2) `audit_unavailable` means audit writes are
failing -- the database, not the function. 3) A jump in one refusal right after
a client release is a client sending something the server's rules now refuse.

### PostHog: Scoring disagreements > 0

Both sides run the same deterministic model, so this is never noise.
1) `version_mismatch` too? Then a client and the server are on different model
versions: was a function deployed without `pnpm --filter @17-0/domain
build:edge`, or a reseed done without an app release? (`docs/scoring-model.md`.)
2) `score_disagreement` alone, with matching versions, is a determinism bug --
take the season's `request_id` from `server_call` (fn `complete-game`) to the
audit trail and re-score the roster locally. 3) Do not void anything until the
cause is known.

### PostHog: Web vitals LCP p75 > 4 s

1) Break down by `viewport` and `embedded`. 2) Compare against the deploy
history: a bigger bundle is the usual cause. 3) `pnpm verify:fold` covers the
layout side.

## What is deliberately not collected

- No email, sign-in identity, roster, card id or exact rating, in any report.
  Ratings leave the device as bands only, which is why a downgrade sends a
  `cause` and never the sentence the player saw (one of them quotes both
  scores).
- Error messages are scrubbed on the device: emails, JWTs, UUIDs, API keys,
  query strings and long opaque tokens are replaced before the text is stored,
  compared or sent (`errors.ts`, tested).
- No session replay in the apps, no screenshots, no breadcrumbs of what the
  player tapped, no device model or OS build beyond the platform.
- The route is a pattern (`card/[id]`), not a path.
- Request ids go to PostHog only when a call failed or was slow -- the only time
  anybody needs to look one up.
- Nothing at all on the web when GPC or DNT is set, and nothing anywhere when
  the `diagnostics` flag is off.
- The synthetic monitor sends nothing to PostHog and writes nothing to the
  database.

`apps/mobile/public/privacy.html` ("Error and performance reports") and the
App Store / Play labels in `docs/submission.md` say the same thing; change all
three together.

## Still blind

- **Native crash stacks.** A crash in Swift, Objective-C, Kotlin, Java or C++,
  an out-of-memory kill and an iOS watchdog kill run no JavaScript, so nothing
  here can catch them. `app_unclean_exit` counts them (with route and version)
  the next launch; the stacks are only in Xcode Organizer and Play Console
  vitals, which nothing here reads. Closing this means a native module reading
  MetricKit on iOS and `ApplicationExitInfo` on Android -- possible as a local
  Expo module like `modules/fold`, not done yet.
- **ANRs and hangs.** Android vitals and Xcode Organizer's Hangs report have
  them; the app does not.
- **Minified stacks.** The web bundle and the Hermes bytecode are minified and
  no source maps are uploaded, so frames read `index-<hash>.js:2:123456`. Error
  grouping does not depend on them (the fingerprint is type + source + message),
  but reading a stack does. Uploading source maps to PostHog is a build step
  with a personal key, not done yet.
- **iOS Safari web vitals.** Safari implements none of LCP, CLS or INP; iPhone
  browser visits report TTFB and FCP only.
- **Players who never reach PostHog** (offline, blocked, GPC/DNT) are invisible
  by design. The local ring buffer in `/admin` still has everything for a
  device in hand.
- **Edge Function cold starts** are inside `server_call.ms` but not separated
  from it.
- **The monitor's own schedule.** GitHub disables scheduled workflows in a
  repository with no activity for 60 days, and can delay a run by up to ~15
  minutes under load.
