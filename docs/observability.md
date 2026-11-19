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
Do Not Track. Each carries `route` (the pattern, `card/[id]`, never the id) and
`scoring_version` from `context.ts`, plus everything every event carries.

#### What every event carries

`analytics.ts`'s `base()` puts these on **every** event sent to PostHog --
gameplay, flags and diagnostics alike -- so any tile can be split by build:

| Property | Value | From |
|---|---|---|
| `platform` | `ios`, `android`, `web` (an Apple TV is `ios`; see `device_class`) | `Platform.OS` |
| `app_version` / `$app_version` | Marketing version, `1.2.0` | native version, or `expo.version` on the web |
| `build` / `$app_build` | Store build number on native, the commit on the web, `dev` locally | `device.ts` `buildId()` |
| `os_version` / `$os_version` | `18.2` (iOS), `35` (Android API level), or on the web a family and major from the user agent: `iOS 18`, `Android 15`, `macOS`, `Windows`, `Linux`, `ChromeOS`, `other`. The user-agent string itself is never sent | `device.ts` |
| `device_class` | `phone`, `tablet`, `tv`, `web`. Android tablets are a short side of 600 dp or more | `device-math.ts` `classifyDevice` |
| `session_id` / `$session_id` | A UUIDv7 for one sitting: a cold start, or a return after 30 minutes in the background (PostHog's idle cut). Random, generated on the device, never stored | `device-math.ts` `SessionClock` |
| `dataset`, `model` | The dataset and rating-model versions | `telemetry.ts` |
| `$feature/<flag>` | The variant of each flag this device is in | `features/flags` |

The `$`-names are PostHog's own, which its built-in breakdowns, its sessions
table and error tracking's release filter read. `$session_id` is a v7 because
PostHog dates a session by its id.

#### The guard

`track()` runs every event's properties through `cleanProps`
(`diagnostics/guard.ts`) before the ring, Box Office or PostHog sees them: a
value that is not a string, a finite number or a boolean is dropped, and so is
a key named like something about a person (`email`, `name`, `phone`, `ip`,
`lat`, `user_id`, `device_id`, `handle`, `url`, `token`… -- `PII_KEY`). Strings
are capped at 300 characters. `guard.test.ts` also reads every `track()` and
`reportHealth()` call in the app and fails on a person-shaped key, so one is
caught in review rather than silently dropped on devices.

#### The events

| Event | When | What it says |
|---|---|---|
| `$exception` | An uncaught error (`ErrorUtils` on native, `window.onerror` on the web), an unhandled promise rejection (release builds; Hermes' tracker), a render error caught by a route's ErrorBoundary, or a JS fatal from the previous launch | Type, scrubbed message, raw stack, `$exception_source`, `$exception_level` (`fatal` or `error`), `occurrence`, `suppressed`. Built into `$exception_list` on the way out so PostHog's error tracking groups it |
| `app_unclean_exit` | A launch that finds the previous one died while in the foreground with no JS fatal recorded | `last_route`, `last_version`, `last_build`. This is the native crash, OOM and watchdog-kill count -- see "Still blind" |
| `app_started` | Once per launch, when fonts are loaded and the navigator has rendered | `ready_ms`, and `basis`: `navigation` (web, includes the network), `process` (native, from process start), `runtime` (native fallback) |
| `web_vitals` | Once per page load, when the page is hidden | `lcp_ms`, `cls`, `inp_ms`, `fcp_ms`, `ttfb_ms`, each with a `*_rating`; `viewport`, `embedded` |
| `server_call` | Every Edge Function call and the ranked-session insert (`ranked.ts`) | `fn`, `outcome` (`ok`/`refused`/`offline`), `ms`, `slow` (> 3 s), `reason` (the server's error code), `status`, `error_class`, and `request_id` when it failed or was slow |
| `season_downgraded` | A ranked season fell back to unranked, anywhere (open, spin, pick, reveal) | `cause` (`timeout`, `offline`, `session`, `version_mismatch`, `score_disagreement`, `gameday_closed`, `challenge_closed`, `refused`, `other`), `filled`, `mode` |
| `result_shared` | Every press of Share on the result screen | `outcome`: `image`, `text`, `link`, `copied`, `cancelled`, `failed` |
| `screen_ready` | Once per navigation, every platform (not the first screen of a launch -- that is `app_started`) | `route`, `from` (both patterns), `first_frame_ms` (navigation action to the first frame after the new screen committed), `settled_ms` (to the JS thread first going idle after that), `basis` (`action`: timed from React Navigation's `__unsafe_action__`; `commit`: no action was heard, e.g. a deep link or browser back -- not comparable), `idle` (`idle`, `timeout` after 3 s busy, or `timer` where there is no `requestIdleCallback`) |
| `ui_jank` | Phones, tablets and the web. One summary per screen: when it is left, every 30 touches, and on backgrounding | `route`, `why` (`route`/`touches`/`background`), `touches`, `navigations`, `windows`, `frames`, `hitches` (> 25 ms), `stalls` (> 50 ms), `hitch_pct`, `worst_frame_ms`, `js_median_ms`/`js_worst_ms` (how late a 0 ms timer set at the touch fired), `long_tasks` (web, Chromium only) |
| `tv_jank` | Apple TV only (`tv/jank.ts`, behind `tv_jank_probe`). The same shape after remote presses | `route` (a path, `/play`), `why`, `presses`, `frames`, `hitches`, `stalls`, `hitch_pct`, `worst_frame_ms`, `js_median_ms`, `js_worst_ms` |
| `memory_warning` | iOS warned the app about memory (AppState `memoryWarning`). At most one a minute | `count` (warnings since the last report), `launch_warnings`, `uptime_s`, `foreground`, `js_heap_mb` (Hermes, when it says) |
| `app_background_exit` | A launch that finds the previous one ended while in the background: the OS reclaiming it, or the player swiping it away (JS cannot tell which) | `last_route`, `last_version`, `last_build`, `memory_warnings`, `background_s` (from leaving the foreground to this launch), `launch_s` (how long the previous launch had lived) |

`app_unclean_exit` also carries `memory_warnings`, `likely_oom` (it died in the
foreground after a memory warning: almost always a jetsam kill rather than a
crash), `crashed_build` and `crashed_session`. A JS fatal sent on the next
launch carries `crashed_build` and `crashed_session` too, so a crash is
counted against the build and the sitting it happened in, not the one that
reported it.

#### How the probes stay cheap

Nothing here runs per frame while the app is idle.

- **`ui_jank`** opens a window on a touch starting anywhere (`onTouchStart` on
  the root view -- touch events bubble, so one handler hears all of them --
  and `pointerdown` on the web) or on a navigation, and closes it 1.5 s after
  the last. Only inside a window is a Reanimated frame callback active, and it
  folds each frame into four numbers in place on the UI thread (`addFrame`,
  no allocation, no `runOnJS`). The JS thread does a `Date.now()` and a 0 ms
  timer per touch, and one cross-thread read when a window closes. Measured
  in `jank.test.ts`: about **14 ns** of arithmetic per frame and **4 µs** to
  close a window and build a report (Node on an M-series Mac; Hermes is
  slower, the same order). The TV is left to `tv_jank`.
- **`screen_ready`** is one `requestAnimationFrame` and one idle callback per
  navigation.
- **`memory_warning`** runs nothing until iOS sends a warning; the Hermes heap
  is read only then.
- **The session clock** is one AppState listener; `base()` reads a memoised
  object and a field.
- All of it goes through `track()` into the same 15-second, 20-event batches
  as everything else, and all of it is behind `diagnostics` -- the kill
  switch stops the measuring, not only the sending.

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

**Proving it end to end.** On a device, `/admin` → Diagnostics has three
buttons that throw a render error, an uncaught error and an unhandled
rejection. Their messages start with `Operator test`, which every dashboard
tile filters out. `/admin` is stripped from the web export (`metro.config.js`),
so on the web throw from the browser console instead -- the same handlers
catch it: `setTimeout(() => { throw new Error('Operator test') })`.

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

## The dashboard's SQL

The **17-0 health** dashboard (`scripts/posthog-dashboards.ts`) has trend tiles
with alerts and, below them, these tables. Each query is also here to paste into
PostHog → SQL editor; the source of truth is `scripts/posthog-queries.ts`, and
`event-coverage.test.ts` fails if this page and that file disagree.

`HAVING` floors keep one device's bad afternoon from looking like a regression;
lower them while data is thin.

### Crash-free sessions by build (%)

Native sittings (session_id) per build, against those that ended in a JS fatal or an unclean exit (native crash, OOM, watchdog). A crash is reported on the next launch and filed under the build and session that crashed (crashed_build, crashed_session).

```sql
SELECT
  s.build AS build,
  s.sessions AS sessions,
  coalesce(c.crashed, 0) AS crashed_sessions,
  round(100 * (1 - coalesce(c.crashed, 0) / s.sessions), 2) AS crash_free_pct
FROM (
  SELECT properties.build AS build, count(DISTINCT properties.session_id) AS sessions
  FROM events
  WHERE timestamp > now() - INTERVAL 14 DAY
    AND properties.device_class IN ('phone', 'tablet', 'tv')
    AND properties.session_id IS NOT NULL
  GROUP BY build
) AS s
LEFT JOIN (
  SELECT
    coalesce(properties.crashed_build, properties.build) AS build,
    count(DISTINCT coalesce(properties.crashed_session, properties.session_id)) AS crashed
  FROM events
  WHERE timestamp > now() - INTERVAL 14 DAY
    AND (event = 'app_unclean_exit'
      OR (event = '$exception'
        AND properties.$exception_level = 'fatal'
        AND NOT startsWith(coalesce(properties.$exception_message, ''), 'Operator test')))
  GROUP BY build
) AS c ON c.build = s.build
WHERE s.sessions >= 20
ORDER BY s.sessions DESC
```

### Startup p50 / p95 by platform and build (ms)

app_started.ready_ms. basis is part of the key on purpose: navigation (web, includes the network), process (native, from process start) and runtime (native fallback) are different clocks.

```sql
SELECT
  properties.platform AS platform,
  properties.device_class AS device_class,
  properties.build AS build,
  properties.basis AS basis,
  count() AS launches,
  round(quantile(0.5)(toFloat(properties.ready_ms))) AS p50_ms,
  round(quantile(0.95)(toFloat(properties.ready_ms))) AS p95_ms
FROM events
WHERE event = 'app_started'
  AND timestamp > now() - INTERVAL 14 DAY
GROUP BY platform, device_class, build, basis
HAVING launches >= 20
ORDER BY platform, device_class, launches DESC
```

### Screen ready p50 / p95 by route (ms)

screen_ready, from the navigation action to the first frame and to the JS thread going idle. basis = action only: a navigation that started from a deep link or the browser's back button has no comparable start.

```sql
SELECT
  properties.route AS route,
  properties.device_class AS device_class,
  count() AS navigations,
  round(quantile(0.5)(toFloat(properties.first_frame_ms))) AS first_frame_p50,
  round(quantile(0.95)(toFloat(properties.first_frame_ms))) AS first_frame_p95,
  round(quantile(0.5)(toFloat(properties.settled_ms))) AS settled_p50,
  round(quantile(0.95)(toFloat(properties.settled_ms))) AS settled_p95
FROM events
WHERE event = 'screen_ready'
  AND properties.basis = 'action'
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY route, device_class
HAVING navigations >= 20
ORDER BY settled_p95 DESC
```

### Jank: hitch rate by route, platform and build (%)

ui_jank (phones, tablets, web: windows after touches and navigations) and tv_jank (Apple TV: windows after remote presses), pooled by frames. A hitch is a frame over 25 ms, a stall over 50 ms, on both. tv_jank routes are paths (/play), ui_jank routes are patterns (play).

```sql
SELECT
  properties.route AS route,
  properties.platform AS platform,
  properties.device_class AS device_class,
  properties.build AS build,
  count() AS reports,
  sum(toFloat(properties.frames)) AS frames,
  round(100 * sum(toFloat(properties.hitches)) / sum(toFloat(properties.frames)), 2) AS hitch_pct,
  round(100 * sum(toFloat(properties.stalls)) / sum(toFloat(properties.frames)), 2) AS stall_pct,
  round(quantile(0.95)(toFloat(properties.worst_frame_ms))) AS worst_frame_p95,
  round(quantile(0.95)(toFloat(properties.js_worst_ms))) AS js_delay_p95
FROM events
WHERE event IN ('ui_jank', 'tv_jank')
  AND timestamp > now() - INTERVAL 7 DAY
GROUP BY route, platform, device_class, build
HAVING frames >= 600
ORDER BY hitch_pct DESC
```

### Server calls: error rate and latency by function

server_call over the last day. error_pct is everything not ok (refusals by rule included: a jump in them is as much a bug as a 500); latency percentiles are over every call, so a timeout counts at the time it took.

```sql
SELECT
  properties.fn AS fn,
  count() AS calls,
  round(100 * countIf(properties.outcome != 'ok') / count(), 2) AS error_pct,
  round(100 * countIf(properties.outcome = 'offline') / count(), 2) AS offline_pct,
  round(100 * countIf(properties.outcome = 'refused') / count(), 2) AS refused_pct,
  round(quantile(0.5)(toFloat(properties.ms))) AS p50_ms,
  round(quantile(0.95)(toFloat(properties.ms))) AS p95_ms,
  round(quantile(0.99)(toFloat(properties.ms))) AS p99_ms
FROM events
WHERE event = 'server_call'
  AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY fn
ORDER BY calls DESC
```

### Server calls by hour: error rate and p95 (ms)

The same, hour by hour, for seeing when it started.

```sql
SELECT
  toStartOfHour(timestamp) AS hour,
  count() AS calls,
  round(100 * countIf(properties.outcome != 'ok') / count(), 2) AS error_pct,
  round(quantile(0.95)(toFloat(properties.ms))) AS p95_ms
FROM events
WHERE event = 'server_call'
  AND timestamp > now() - INTERVAL 3 DAY
GROUP BY hour
ORDER BY hour DESC
```

### Memory pressure by build

iOS memory warnings, unclean exits that followed one (likely_oom), and background exits: how long the app had been away when the OS reclaimed it. A build whose median background_s falls is a build holding more memory.

```sql
SELECT
  properties.build AS build,
  properties.device_class AS device_class,
  countIf(event = 'memory_warning') AS warning_reports,
  countIf(event = 'app_unclean_exit' AND properties.likely_oom = true) AS likely_oom_exits,
  countIf(event = 'app_background_exit') AS background_exits,
  countIf(event = 'app_background_exit' AND toFloat(properties.memory_warnings) > 0) AS background_exits_after_warning,
  round(quantile(0.5)(if(event = 'app_background_exit', toFloat(properties.background_s), NULL))) AS background_s_p50
FROM events
WHERE event IN ('memory_warning', 'app_unclean_exit', 'app_background_exit')
  AND timestamp > now() - INTERVAL 14 DAY
GROUP BY build, device_class
ORDER BY background_exits DESC
```

Splitting any of these further is a `GROUP BY` away: `os_version` for an OS
regression, `$feature/<flag>` for a variant, `session_id` for one sitting's
events in order.

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

### Screen ready / jank got worse

1) Which builds? Both tables have `build`; compare the newest with the one
before it on the same `device_class`. 2) One route or all? One route is that
screen's diff (`git log -- apps/mobile/app/<route>.tsx`); all of them is
something shared -- the root layout, a store subscription every screen reads,
a font or a theme. 3) `settled_ms` up with `first_frame_ms` flat is work
after the paint (effects, data); both up is the render itself. For jank,
`js_*` high with hitches low is a busy JS thread; hitches high with `js_*`
low is the UI thread (shadows, blur, layout).

### Memory warnings / background exits

1) `likely_oom` unclean exits, by build: a rise is a leak or a bigger working
set in that build. 2) `background_s_p50` falling by build means the OS is
reclaiming the app sooner after it leaves -- it is holding more memory in the
background. 3) `js_heap_mb` on the warnings says whether it is the JS heap or
native (images, Skia surfaces) -- a small heap at warning time points native.

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
  player tapped. No device model; the OS is a version number (a family and a
  major on the web), the device a class (`phone`, `tablet`, `tv`, `web`).
  `session_id` is random and lives for one sitting; it joins events to each
  other, never to a person.
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
  them; the app does not. `ui_jank`'s `stalls` and `js_worst_ms` see the
  short end of the same thing, inside its windows only.
- **Memory on Android and the web.** Only iOS sends a memory warning through
  React Native; Android's `onTrimMemory` is not passed on. Android OOM kills
  show as `app_unclean_exit` (foreground) or `app_background_exit` without a
  warning count.
- **Jank outside a window.** `ui_jank` measures after touches and navigations
  only, by design -- an animation running on its own with nobody touching is
  not sampled.
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
