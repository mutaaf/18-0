import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSITION_MODELS, type Position } from '@18-0/domain';
import { SEASONS_DIR } from './seasons.js';
import type { Dataset, DatasetCard } from './schema.js';

/**
 * The season ledger: every rated card, and the case for its rating.
 *
 * A standalone page served beside `privacy.html`, reachable only by URL --
 * Expo Router never sees it and nothing in the game links to it. It exists so
 * that "the ratings are real" is a claim somebody can check rather than take,
 * which means it has to say what the *current* dataset says.
 *
 * So it is generated here, in the same function that writes `dataset.json`,
 * rather than by hand. A ledger built once is a souvenir: it agrees with the
 * game on the day it is made and drifts silently afterwards, and the drift is
 * invisible precisely because the page looks authoritative.
 *
 * The template is a static shell with one `/*__DATA__*\/` placeholder; only the
 * payload below changes between builds.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(HERE, 'ledger.template.html');
const OUT_LEDGER = resolve(HERE, '../../../apps/mobile/public/ledger.html');

const POSITIONS: readonly Position[] = ['QB', 'RB', 'WR', 'TE', 'DEF'];

/** One hydrated season file, described well enough to be checked against. */
interface Provenance {
  readonly year: number;
  readonly source: string;
  readonly seasonGames: number;
  readonly players: number;
  readonly defenses: number;
  readonly bytes: number;
  readonly sha256: string;
}

/**
 * Hashes whatever hydrated seasons this machine built from.
 *
 * A clone with no `data/raw/seasons` still produces a valid ledger -- it simply
 * has no pre-1999 provenance to show, which is the truth on that machine.
 */
function provenance(rawDir: string): Provenance[] {
  const dir = join(rawDir, SEASONS_DIR);
  if (!existsSync(dir)) return [];

  const out: Provenance[] = [];
  for (const name of readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f)).sort()) {
    const buf = readFileSync(join(dir, name));
    let parsed: { year?: number; source?: string; seasonGames?: number;
      players?: unknown[]; defenses?: unknown[] };
    try {
      parsed = JSON.parse(buf.toString('utf8'));
    } catch {
      continue; // `loadHydratedSeasons` already reports and rejects these.
    }
    out.push({
      year: parsed.year ?? Number(name.slice(0, 4)),
      source: parsed.source ?? 'unrecorded',
      seasonGames: parsed.seasonGames ?? 0,
      players: parsed.players?.length ?? 0,
      defenses: parsed.defenses?.length ?? 0,
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
    });
  }
  return out;
}

/**
 * Writes the ledger for a dataset that has just been built.
 *
 * `cards` carries the component breakdowns, which the boot dataset drops -- the
 * page needs them, because a rating with no components behind it is exactly the
 * assertion this page exists to avoid making.
 */
export function writeLedger(
  dataset: Dataset,
  cards: readonly DatasetCard[],
  rawDir: string,
): { path: string; bytes: number; cards: number } {
  // Component and metric names, taken from the models rather than restated, so
  // a renamed component cannot leave the page describing one that is gone.
  const compKeys: string[] = [];
  const compLabel: Record<string, string> = {};
  const metricKeys: string[] = [];
  const metricLabel: Record<string, string> = {};
  for (const position of POSITIONS) {
    for (const component of POSITION_MODELS[position].components) {
      if (!compKeys.includes(component.key)) compKeys.push(component.key);
      compLabel[component.key] = component.label;
      for (const metric of component.metrics) {
        if (!metricKeys.includes(metric.key)) metricKeys.push(metric.key);
        metricLabel[metric.key] = metric.label;
      }
      if (component.percentileOf && !metricKeys.includes(component.percentileOf)) {
        metricKeys.push(component.percentileOf);
        metricLabel[component.percentileOf] ??= component.percentileOf;
      }
    }
  }
  const ci = new Map(compKeys.map((k, i) => [k, i]));
  const mi = new Map(metricKeys.map((k, i) => [k, i]));

  const eras = dataset.eras.map((e) => ({
    k: e.key, n: e.name, l: e.label, s: e.startYear, e: e.endYear, p: !!e.provisional,
  }));
  const franchises = dataset.franchises.map((f) => ({ id: f.id, ab: f.abbr, nm: f.name }));
  const fi = new Map(franchises.map((f, i) => [f.id, i]));
  const ei = new Map(eras.map((e, i) => [e.k, i]));

  const rows = cards
    .map((c) => [
      c.name, c.year, fi.get(c.franchiseId), POSITIONS.indexOf(c.position), ei.get(c.era),
      c.rating, c.games,
      c.stats.map((s) => [s.label, s.value]),
      c.components.map((x) => [ci.get(x.k) ?? -1, x.s, x.w, x.m === null ? -1 : (mi.get(x.m) ?? -1), x.z]),
      c.unavailable.map((k) => ci.get(k) ?? -1),
    ])
    .sort((a, b) => (b[5] as number) - (a[5] as number));

  // Seasons represented per position per era: the check that catches an era
  // looking covered while one position is carried by a single year.
  const cov = eras.map((e) => ({
    k: e.k,
    span: e.e - e.s + 1,
    pos: POSITIONS.map(
      (p) => new Set(cards.filter((c) => c.era === e.k && c.position === p).map((c) => c.year)).size,
    ),
  }));

  const payload = {
    fingerprint: dataset.fingerprint,
    version: dataset.version,
    model: dataset.ratingModelVersion,
    coverage: dataset.coverage,
    combos: dataset.combos.length,
    eras, franchises, pos: POSITIONS,
    compKeys, compLabel, metricKeys, metricLabel,
    cards: rows,
    provenance: provenance(rawDir),
    cov,
  };

  const template = readFileSync(TEMPLATE, 'utf8');
  const marker = '/*__DATA__*/';
  if (!template.includes(marker)) {
    throw new Error(`${TEMPLATE} has no ${marker} placeholder to fill`);
  }
  const body = template.replace(marker, JSON.stringify(payload));

  // The template is a fragment; the served page needs a document around it.
  // `noindex` because a page nothing links to should not be found by a crawler
  // either -- reachable by URL is the whole point.
  const split = body.indexOf('<header class="top">');
  if (split < 0) throw new Error('ledger template has no <header class="top"> to split on');
  const page =
    '<!doctype html>\n<html lang="en">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<meta name="color-scheme" content="dark light">\n' +
    '<meta name="robots" content="noindex,nofollow">\n' +
    '<meta name="description" content="Every rated season in 18-0, and the source file each one was built from.">\n' +
    body.slice(0, split).trim() +
    '\n</head>\n<body>\n' +
    body.slice(split).trim() +
    '\n</body>\n</html>\n';

  writeFileSync(OUT_LEDGER, page);
  return { path: OUT_LEDGER, bytes: page.length, cards: rows.length };
}
