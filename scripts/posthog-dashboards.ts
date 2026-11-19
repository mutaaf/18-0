/**
 * The health dashboard and its alerts, as code.
 *
 *   npx tsx scripts/posthog-dashboards.ts            # dry run: prints every insight and alert
 *   set -a; . .local/posthog.env; set +a
 *   npx tsx scripts/posthog-dashboards.ts --apply    # creates or updates them
 *
 * The same credential as `scripts/posthog-flags.ts`: a **personal** API key,
 * here with `dashboard:write`, `insight:write` and `alert:write` (and
 * `user:read`, to subscribe the key's owner to the alerts). The app's
 * `EXPO_PUBLIC_POSTHOG_KEY` is an ingestion token and can do none of this.
 *
 * ---------------------------------------------------------------------------
 *
 * Code rather than clicks for the reason the flags are: a dashboard built by
 * hand drifts from the events the moment one is renamed, and the drift is
 * silent -- the tile reads zero, and zero errors looks exactly like health.
 * Every event named here is checked against `EventName` by
 * `apps/mobile/src/features/event-coverage.test.ts`, and every diagnostic event
 * the app sends must appear here, so neither side can move alone.
 *
 * Idempotent, by name: re-running updates what exists and creates what does
 * not. It never deletes; a tile removed from this file is left for a human.
 *
 * The thresholds are first guesses written down, not measurements -- there is
 * no baseline yet, because nothing was measured before this. Revisit them
 * after two weeks of data; docs/observability.md says how.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SQL_TILES } from './posthog-queries';

const HOST = (process.env.POSTHOG_API_HOST ?? 'https://us.posthog.com').replace(/\/+$/, '');
const KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const APPLY = process.argv.includes('--apply');
const DASHBOARD = '17-0 health';

type Math = 'total' | 'dau' | 'median' | 'p75' | 'p90' | 'p95' | 'p99' | 'avg';
type Filter = { key: string; value: string | string[]; operator?: 'exact' | 'is_not' | 'regex' };

interface Series {
  kind: 'EventsNode';
  event: string;
  name: string;
  math: Math;
  math_property?: string;
  properties?: { key: string; value: string | string[]; operator: string; type: 'event' }[];
}

/** One event, counted or measured. `ev` is what the coverage test reads. */
function ev(event: string, math: Math = 'total', options: { property?: string; where?: Filter[] } = {}): Series {
  return {
    kind: 'EventsNode',
    event,
    name: event,
    math,
    ...(options.property ? { math_property: options.property } : {}),
    ...(options.where
      ? {
          properties: options.where.map((f) => ({
            key: f.key,
            value: f.value,
            operator: f.operator ?? 'exact',
            type: 'event' as const,
          })),
        }
      : {}),
  };
}

interface Alert {
  /** Fires when the value crosses this. */
  readonly upper?: number;
  readonly lower?: number;
  readonly interval: 'hourly' | 'daily';
  readonly why: string;
}

interface Tile {
  readonly name: string;
  readonly description: string;
  readonly query: Record<string, unknown>;
  readonly alert?: Alert;
}

const trend = (
  series: Series[],
  options: { formula?: string; breakdown?: string; interval?: 'hour' | 'day'; display?: string } = {},
) => ({
  kind: 'InsightVizNode',
  source: {
    kind: 'TrendsQuery',
    series,
    interval: options.interval ?? 'day',
    dateRange: { date_from: '-14d' },
    ...(options.breakdown ? { breakdownFilter: { breakdown: options.breakdown, breakdown_type: 'event' } } : {}),
    trendsFilter: {
      ...(options.formula ? { formula: options.formula } : {}),
      display: options.display ?? 'ActionsLineGraph',
    },
  },
});

const funnel = (series: Series[]) => ({
  kind: 'InsightVizNode',
  source: { kind: 'FunnelsQuery', series, dateRange: { date_from: '-14d' }, funnelsFilter: { funnelWindowInterval: 1, funnelWindowIntervalUnit: 'hour' } },
});

/** A SQL insight: a table from `posthog-queries.ts`. */
const sql = (query: string) => ({
  kind: 'DataVisualizationNode',
  source: { kind: 'HogQLQuery', query },
  display: 'ActionsTable',
});

const FATAL: Filter[] = [{ key: '$exception_level', value: 'fatal' }];
// The operator console's test buttons say so in the message (app/admin.tsx);
// they are somebody checking the pipe, not a player's bug.
const NOT_TEST: Filter[] = [{ key: '$exception_message', value: 'Operator test', operator: 'is_not' }];

/** Events whose names start with `rating_feedback`, read from the union so a rename cannot orphan the tile. */
function ratingFeedbackEvents(): string[] {
  const telemetry = readFileSync(resolve(import.meta.dirname ?? '.', '../apps/mobile/src/features/telemetry.ts'), 'utf8');
  return [...telemetry.matchAll(/\|\s*'(rating_feedback[^']*)'/g)].map((m) => m[1]!);
}

const TILES: Tile[] = [
  {
    name: 'Errors per 100 launches',
    description: 'Every $exception the app reported, per 100 app_started. The headline number: up means a release broke something.',
    query: trend([ev('$exception', 'total', { where: NOT_TEST }), ev('app_started')], { formula: 'A / B * 100' }),
    alert: { upper: 5, interval: 'daily', why: 'More than one launch in twenty hit an error yesterday.' },
  },
  {
    name: 'Errors by type',
    description: 'What is throwing. Click through to Error tracking for the stacks and the issue each one is grouped into.',
    query: trend([ev('$exception', 'total', { where: NOT_TEST })], { breakdown: '$exception_type', display: 'ActionsBar' }),
  },
  {
    name: 'Error spike',
    description: 'Exceptions per hour. A loop on one device is capped at a handful by the limiter, so a spike is many devices.',
    query: trend([ev('$exception', 'total', { where: NOT_TEST })], { interval: 'hour' }),
    alert: { upper: 60, interval: 'hourly', why: 'Over 60 error reports in an hour: something broke for a lot of people at once.' },
  },
  {
    name: 'Crash-free launches (%)',
    description:
      '100 minus JS fatals (sent the launch after) and unclean exits (native crash, OOM or watchdog kill), per app_started. Native only in practice: a browser tab does not crash this way.',
    query: trend(
      [ev('$exception', 'total', { where: [...FATAL, ...NOT_TEST] }), ev('app_unclean_exit'), ev('app_started', 'total', { where: [{ key: 'platform', value: ['ios', 'android'] }] })],
      { formula: '100 - (A + B) / C * 100' },
    ),
    alert: { lower: 99, interval: 'daily', why: 'Fewer than 99% of native launches ended cleanly yesterday.' },
  },
  {
    name: 'Unclean exits by version',
    description: 'Launches that found the previous one died in the foreground with no JS error. The stacks are in Xcode Organizer and Play Console vitals, not here.',
    query: trend([ev('app_unclean_exit')], { breakdown: 'last_version', display: 'ActionsBar' }),
  },
  {
    name: 'Spin latency p50 / p95 (ms)',
    description: 'server_call where fn = spin. The play screen waits 8 s before giving up and downgrading the season.',
    query: trend([
      ev('server_call', 'median', { property: 'ms', where: [{ key: 'fn', value: 'spin' }] }),
      ev('server_call', 'p95', { property: 'ms', where: [{ key: 'fn', value: 'spin' }] }),
    ], { interval: 'hour' }),
    alert: { upper: 3000, interval: 'hourly', why: 'Median spin over 3 s for an hour: ranked play feels broken.' },
  },
  {
    name: 'Server calls failing (%)',
    description: 'Every Edge Function call and the ranked insert that did not come back ok, by function. Refusals by rule are included on purpose: a jump in them is as much a bug as a 500.',
    query: trend(
      [ev('server_call', 'total', { where: [{ key: 'outcome', value: 'ok', operator: 'is_not' }] }), ev('server_call')],
      { formula: 'A / B * 100', interval: 'hour' },
    ),
    alert: { upper: 10, interval: 'hourly', why: 'One server call in ten failed over the last hour.' },
  },
  {
    name: 'Completion failures (%)',
    description: 'complete-game calls that did not score the season. Each is a ranked season that never reached the board.',
    query: trend(
      [
        ev('server_call', 'total', { where: [{ key: 'fn', value: 'complete-game' }, { key: 'outcome', value: 'ok', operator: 'is_not' }] }),
        ev('server_call', 'total', { where: [{ key: 'fn', value: 'complete-game' }] }),
      ],
      { formula: 'A / B * 100' },
    ),
    alert: { upper: 2, interval: 'daily', why: 'More than 2% of ranked completions failed yesterday.' },
  },
  {
    name: 'Downgrades by cause',
    description: 'Ranked seasons that fell back to unranked, by why (features/diagnostics/causes.ts). "timeout" is the server being slow; "other" means a new sentence needs a cause.',
    query: trend([ev('season_downgraded')], { breakdown: 'cause', display: 'ActionsBar' }),
  },
  {
    name: 'Scoring disagreements',
    description: 'score_disagreement and version_mismatch. The first should be zero forever: both sides run the same model. Any value is an incident.',
    query: trend([ev('score_disagreement'), ev('version_mismatch')]),
    alert: { upper: 0, interval: 'daily', why: 'The client and the server scored the same roster differently.' },
  },
  {
    name: 'Share funnel',
    description: 'Finished seasons that were shared, and how. result_shared carries outcome: image, text, link, copied, cancelled or failed.',
    query: funnel([ev('roster_completed'), ev('result_shared', 'total', { where: [{ key: 'outcome', value: ['image', 'text', 'link', 'copied'] }] })]),
  },
  {
    name: 'Share outcomes',
    description: 'Every press of Share, by what happened. "failed" is a share sheet that broke.',
    query: trend([ev('result_shared')], { breakdown: 'outcome', display: 'ActionsBar' }),
  },
  {
    name: 'App start (ms) by platform',
    description: 'Cold start to the first usable screen, p50 and p95. The basis differs by platform (startup.ts); compare a platform with itself.',
    query: trend([ev('app_started', 'median', { property: 'ready_ms' }), ev('app_started', 'p95', { property: 'ready_ms' })], { breakdown: 'platform' }),
  },
  {
    name: 'Web vitals p75',
    description: "LCP and INP in ms, and CLS (unitless, so read it on its own axis), at the 75th percentile -- Google's own cut. Safari reports none of the three.",
    query: trend([
      ev('web_vitals', 'p75', { property: 'lcp_ms' }),
      ev('web_vitals', 'p75', { property: 'inp_ms' }),
      ev('web_vitals', 'p75', { property: 'cls' }),
    ]),
    alert: { upper: 4000, interval: 'daily', why: 'LCP p75 over 4 s: the site is poor by Google\'s measure.' },
  },
  {
    name: 'Ranked completions deferred to the outbox',
    description: 'ranked_completion_deferred by outcome: queued in play, then scored or dropped by the outbox. Queued rising without scored following is seasons that never reach the board.',
    query: trend([ev('ranked_completion_deferred')], { breakdown: 'outcome', display: 'ActionsBar' }),
  },
  {
    name: 'Screen settled p95 (ms) by route',
    description: 'screen_ready.settled_ms: from the navigation to the JS thread going idle on the new screen. The table below has first-frame and p50 too.',
    query: trend([ev('screen_ready', 'p95', { property: 'settled_ms', where: [{ key: 'basis', value: 'action' }] })], { breakdown: 'route' }),
  },
  {
    name: 'Jank reports with a stall, by device class',
    description: 'ui_jank and tv_jank summaries that saw at least one frame over 50 ms. The hitch-rate table below is the precise read.',
    query: trend(
      [
        ev('ui_jank', 'total', { where: [{ key: 'stalls', value: '0', operator: 'is_not' }] }),
        ev('tv_jank', 'total', { where: [{ key: 'stalls', value: '0', operator: 'is_not' }] }),
      ],
      { breakdown: 'device_class' },
    ),
  },
  {
    name: 'Memory warnings and background exits',
    description: 'memory_warning reports (iOS) and launches that found the previous one gone from the background.',
    query: trend([ev('memory_warning'), ev('app_background_exit')], { breakdown: 'build' }),
  },
  ...SQL_TILES.map<Tile>((tile) => ({ name: tile.name, description: tile.description, query: sql(tile.query) })),
  ...ratingFeedbackEvents().map<Tile>((event) => ({
    name: `Rating feedback: ${event}`,
    description: 'How often players tell us a rating looks wrong, by day.',
    query: trend([ev(event)]),
  })),
];

// ---------------------------------------------------------------------------

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${HOST}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function projectId(): Promise<string> {
  const explicit = process.env.POSTHOG_PROJECT_ID;
  if (explicit) return explicit;
  const body = (await api('/api/projects/')) as { results?: { id: number; name: string }[] };
  const projects = body.results ?? [];
  if (projects.length === 1) return String(projects[0]!.id);
  throw new Error(`This key sees ${projects.length} projects. Set POSTHOG_PROJECT_ID (17-0 is 402075, docs/analytics.md).`);
}

function alertPayload(tile: Tile, insight: number, user: number) {
  const alert = tile.alert!;
  return {
    name: `${tile.name}: ${alert.why}`,
    insight,
    subscribed_users: [user],
    enabled: true,
    calculation_interval: alert.interval,
    condition: { type: 'absolute_value' },
    config: { type: 'TrendsAlertConfig', series_index: 0 },
    threshold: {
      configuration: {
        type: 'absolute',
        bounds: { ...(alert.upper !== undefined ? { upper: alert.upper } : {}), ...(alert.lower !== undefined ? { lower: alert.lower } : {}) },
      },
    },
  };
}

async function main(): Promise<void> {
  console.log(`\n17-0 — POSTHOG HEALTH DASHBOARD  (${APPLY ? 'APPLY' : 'dry run'})\n` + '='.repeat(64));
  for (const tile of TILES) {
    const bound = tile.alert ? ` -- alert ${tile.alert.interval} when ${tile.alert.upper !== undefined ? `> ${tile.alert.upper}` : `< ${tile.alert.lower}`}` : '';
    console.log(`\n  ${tile.name}${bound}\n    ${tile.description}`);
  }
  if (ratingFeedbackEvents().length === 0) {
    console.log('\n  (No rating_feedback* event is declared yet, so that tile is left out. Re-run once it is.)');
  }
  if (!APPLY) {
    console.log('\n  Dry run. Nothing was sent. Re-run with --apply and POSTHOG_PERSONAL_API_KEY set.\n');
    return;
  }
  if (!KEY) throw new Error('POSTHOG_PERSONAL_API_KEY is not set. See the header of this file.');

  const project = await projectId();
  const me = (await api('/api/users/@me/')) as { id: number };

  const dashboards = (await api(`/api/projects/${project}/dashboards/?limit=200`)) as { results?: { id: number; name: string; deleted?: boolean }[] };
  let dashboard = (dashboards.results ?? []).find((d) => d.name === DASHBOARD && !d.deleted)?.id;
  if (dashboard === undefined) {
    dashboard = (await api(`/api/projects/${project}/dashboards/`, {
      method: 'POST',
      body: JSON.stringify({ name: DASHBOARD, description: 'Errors, crashes and the key path. Generated by scripts/posthog-dashboards.ts; edit there, not here.' }),
    })).id as number;
    console.log(`\n  created dashboard ${DASHBOARD}`);
  }

  const alerts = (await api(`/api/projects/${project}/alerts/?limit=200`)) as { results?: { id: string; name: string; insight: { id: number } | number }[] };

  for (const tile of TILES) {
    const found = (await api(`/api/projects/${project}/insights/?saved=true&search=${encodeURIComponent(tile.name)}`)) as {
      results?: { id: number; name: string; dashboards?: number[] }[];
    };
    const existing = (found.results ?? []).find((i) => i.name === tile.name);
    const payload = {
      name: tile.name,
      description: tile.description,
      query: tile.query,
      saved: true,
      dashboards: [...new Set([...(existing?.dashboards ?? []), dashboard])],
    };
    const insight = existing
      ? ((await api(`/api/projects/${project}/insights/${existing.id}/`, { method: 'PATCH', body: JSON.stringify(payload) })).id as number)
      : ((await api(`/api/projects/${project}/insights/`, { method: 'POST', body: JSON.stringify(payload) })).id as number);
    console.log(`  ${existing ? 'updated' : 'created'}  ${tile.name}`);

    if (!tile.alert) continue;
    const body = alertPayload(tile, insight, me.id);
    const current = (alerts.results ?? []).find((a) => (typeof a.insight === 'number' ? a.insight : a.insight?.id) === insight);
    if (current) {
      await api(`/api/projects/${project}/alerts/${current.id}/`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await api(`/api/projects/${project}/alerts/`, { method: 'POST', body: JSON.stringify(body) });
    }
    console.log(`           alert ${current ? 'updated' : 'created'}`);
  }
  console.log(`\n  Done. ${HOST}/project/${project}/dashboard/${dashboard}\n`);
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
