/**
 * The HogQL behind the health dashboard's tables, in one place.
 *
 * `scripts/posthog-dashboards.ts` turns each into a SQL insight, and
 * docs/observability.md prints each one for pasting into PostHog's SQL editor.
 * `apps/mobile/src/features/event-coverage.test.ts` fails if the two drift --
 * a query fixed on the dashboard and not in the doc is the doc lying -- and if
 * a query reads an event that is not an `EventName`.
 *
 * Properties are read through `toFloat()` because PostHog types a property by
 * the first value it saw, and a percentile over a string column is an error
 * rather than a number. Every table has a floor (`HAVING ... >= n`) so one
 * device's bad afternoon is not a row that looks like a regression.
 */

export interface SqlTile {
  readonly name: string;
  readonly description: string;
  /** The events the query reads. Checked against `EventName`. */
  readonly reads: readonly string[];
  readonly query: string;
}

export const SQL_TILES: readonly SqlTile[] = [
  {
    name: 'Crash-free sessions by build (%)',
    description:
      'Native sittings (session_id) per build, against those that ended in a JS fatal or an unclean exit (native crash, OOM, watchdog). A crash is reported on the next launch and filed under the build and session that crashed (crashed_build, crashed_session).',
    reads: ['app_unclean_exit', '$exception'],
    query: `SELECT
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
ORDER BY s.sessions DESC`,
  },
  {
    name: 'Startup p50 / p95 by platform and build (ms)',
    description:
      'app_started.ready_ms. basis is part of the key on purpose: navigation (web, includes the network), process (native, from process start) and runtime (native fallback) are different clocks.',
    reads: ['app_started'],
    query: `SELECT
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
ORDER BY platform, device_class, launches DESC`,
  },
  {
    name: 'Screen ready p50 / p95 by route (ms)',
    description:
      'screen_ready, from the navigation action to the first frame and to the JS thread going idle. basis = action only: a navigation that started from a deep link or the browser\'s back button has no comparable start.',
    reads: ['screen_ready'],
    query: `SELECT
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
ORDER BY settled_p95 DESC`,
  },
  {
    name: 'Jank: hitch rate by route, platform and build (%)',
    description:
      'ui_jank (phones, tablets, web: windows after touches and navigations) and tv_jank (Apple TV: windows after remote presses), pooled by frames. A hitch is a frame over 25 ms, a stall over 50 ms, on both. tv_jank routes are paths (/play), ui_jank routes are patterns (play).',
    reads: ['ui_jank', 'tv_jank'],
    query: `SELECT
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
ORDER BY hitch_pct DESC`,
  },
  {
    name: 'Server calls: error rate and latency by function',
    description:
      'server_call over the last day. error_pct is everything not ok (refusals by rule included: a jump in them is as much a bug as a 500); latency percentiles are over every call, so a timeout counts at the time it took.',
    reads: ['server_call'],
    query: `SELECT
  properties['fn'] AS function,
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
GROUP BY function
ORDER BY calls DESC`,
  },
  {
    name: 'Server calls by hour: error rate and p95 (ms)',
    description: 'The same, hour by hour, for seeing when it started.',
    reads: ['server_call'],
    query: `SELECT
  toStartOfHour(timestamp) AS hour,
  count() AS calls,
  round(100 * countIf(properties.outcome != 'ok') / count(), 2) AS error_pct,
  round(quantile(0.95)(toFloat(properties.ms))) AS p95_ms
FROM events
WHERE event = 'server_call'
  AND timestamp > now() - INTERVAL 3 DAY
GROUP BY hour
ORDER BY hour DESC`,
  },
  {
    name: 'Memory pressure by build',
    description:
      'iOS memory warnings, unclean exits that followed one (likely_oom), and background exits: how long the app had been away when the OS reclaimed it. A build whose median background_s falls is a build holding more memory.',
    reads: ['memory_warning', 'app_unclean_exit', 'app_background_exit'],
    query: `SELECT
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
ORDER BY background_exits DESC`,
  },
];
