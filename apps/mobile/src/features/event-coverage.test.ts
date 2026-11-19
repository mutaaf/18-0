import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every event the app declares is an event the app sends.
 *
 * `EventName` is a union, so a typo in a `track()` call is a compile error --
 * but nothing stopped a name being declared and never sent. Six were: the
 * console's "Games finished" counted `result_revealed`, which nothing ever
 * fired, so it read zero on every device; `result_shared` was declared for the
 * share button and the share button never said a word. A dashboard built on
 * any of them would have been a flat line that looked like nobody doing the
 * thing, rather than nobody measuring it.
 *
 * So: a declared name must be sent from somewhere in `app/` or `src/`, or be
 * listed below with the reason it is not. And a listed name that *is* sent
 * fails too, so the list can only shrink.
 */

const APP = process.cwd();

/** Declared, deliberately unsent, and why. */
const DECLARED_UNSENT: Record<string, string> = {
  spin_started: 'Superseded by spin_completed and server_call(fn=spin); kept for old dashboards.',
  result_revealed: 'Superseded by roster_completed, which fires at the same moment.',
  build_another_tapped: 'Declared for the result screen; not wired yet.',
  leaderboard_viewed: 'Declared for the leaderboard tab; not wired yet.',
  profile_viewed: 'Declared for the account tab; not wired yet.',
};

/** Where each name may be sent from: `track('x'`, or the diagnostics module's own calls. */
const SENDERS = [/\btrack\(\s*'([^']+)'/g, /\breportHealth\(\s*'([^']+)'/g];

function sources(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full) && !full.endsWith('.test.ts')) out.push(full);
    }
  };
  walk(join(APP, 'src'));
  walk(join(APP, 'app'));
  return out.map((f) => readFileSync(f, 'utf8')).join('\n');
}

function declaredEvents(): string[] {
  const telemetry = readFileSync(resolve(APP, 'src/features/telemetry.ts'), 'utf8');
  const union = telemetry.slice(telemetry.indexOf('export type EventName'), telemetry.indexOf('export interface TelemetryEvent'));
  return [...union.matchAll(/\|\s*'([^']+)'/g)].map((m) => m[1]!);
}

describe('event coverage', () => {
  const declared = declaredEvents();
  const code = sources();
  const sent = new Set<string>();
  for (const pattern of SENDERS) for (const m of code.matchAll(pattern)) sent.add(m[1]!);

  it('parses the union it is checking', () => {
    expect(declared.length).toBeGreaterThan(30);
    expect(declared).toContain('$exception');
  });

  for (const name of declared) {
    it(`${name} is sent from somewhere, or says why not`, () => {
      if (name in DECLARED_UNSENT) {
        expect(sent.has(name), `${name} is sent now; take it off DECLARED_UNSENT`).toBe(false);
      } else {
        expect(sent.has(name), `${name} is declared and never sent. Send it, or list it with a reason.`).toBe(true);
      }
    });
  }

  it('lists nothing that is not declared', () => {
    for (const name of Object.keys(DECLARED_UNSENT)) expect(declared).toContain(name);
  });
});

/**
 * The health dashboard reads only events that exist, and every diagnostic
 * event has somewhere it is read.
 *
 * `scripts/posthog-dashboards.ts` defines the PostHog tiles and alerts. A tile
 * over a renamed event reads zero, and zero errors is indistinguishable from
 * health -- the worst way for a monitor to be wrong. And a diagnostic event no
 * tile reads is data collected for nobody.
 */
describe('the health dashboard', () => {
  const declared = new Set(declaredEvents());
  const script = readFileSync(resolve(APP, '../../scripts/posthog-dashboards.ts'), 'utf8');
  const queries = readFileSync(resolve(APP, '../../scripts/posthog-queries.ts'), 'utf8');
  // Trend tiles name an event with `ev('x'`; SQL tiles list theirs in `reads: [...]`.
  const read = new Set([
    ...[...script.matchAll(/\bev\(\s*'([^']+)'/g)].map((m) => m[1]!),
    ...[...queries.matchAll(/\breads:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((q) => q[1]!)),
  ]);

  it('reads only declared events', () => {
    expect(read.size).toBeGreaterThan(5);
    for (const name of read) expect(declared.has(name), `the dashboard reads "${name}", which is not an EventName`).toBe(true);
  });

  const MUST_BE_READ = [
    '$exception',
    'app_started',
    'app_unclean_exit',
    'web_vitals',
    'server_call',
    'season_downgraded',
    'score_disagreement',
    'version_mismatch',
    'result_shared',
    'screen_ready',
    'ui_jank',
    'tv_jank',
    'memory_warning',
    'app_background_exit',
  ];
  for (const name of MUST_BE_READ) {
    it(`has a tile for ${name}`, () => expect(read.has(name)).toBe(true));
  }
});

/**
 * The SQL on the dashboard is the SQL in the doc.
 *
 * docs/observability.md prints every query for pasting into PostHog, and
 * `scripts/posthog-queries.ts` is what the dashboard runs. A query fixed in one
 * and not the other is a doc that lies, so each must appear in the doc
 * verbatim, and each must only read events it declared in `reads` -- the list
 * the coverage check above trusts.
 */
describe('the dashboard SQL', () => {
  const declared = new Set(declaredEvents());
  const doc = readFileSync(resolve(APP, '../../docs/observability.md'), 'utf8');
  const source = readFileSync(resolve(APP, '../../scripts/posthog-queries.ts'), 'utf8');
  const tiles = [...source.matchAll(/name: '([^']+)'[\s\S]*?reads: \[([^\]]*)\][\s\S]*?query: `([^`]+)`/g)].map((m) => ({
    name: m[1]!,
    reads: [...m[2]!.matchAll(/'([^']+)'/g)].map((q) => q[1]!),
    query: m[3]!,
  }));
  const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

  it('finds the queries', () => expect(tiles.length).toBeGreaterThanOrEqual(5));

  for (const tile of tiles) {
    it(`"${tile.name}" is printed in docs/observability.md`, () => {
      expect(squash(doc).includes(squash(tile.query)), 'copy the query from scripts/posthog-queries.ts into the doc').toBe(true);
    });
    it(`"${tile.name}" reads only events it declares, and only declared events`, () => {
      const named = [...tile.query.matchAll(/event (?:=|IN) \(?([^)\n]+)/g)].flatMap((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((q) => q[1]!));
      for (const name of named) {
        expect(tile.reads, `${name} is read but not listed in reads`).toContain(name);
        expect(declared.has(name), `${name} is not an EventName`).toBe(true);
      }
    });
  }
});
