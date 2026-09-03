import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DATASET } from './index.js';
import { datasetFingerprint } from './fingerprint.js';

/**
 * The ledger is a public page that argues these ratings are real, which makes
 * it the one page in the project that must never be out of date. It is written
 * by `build:dataset`, in the same run that writes the dataset, so the failure
 * this file guards is not "the generator is broken" -- it is "somebody edited
 * the page by hand, or shipped a dataset without rebuilding it," and the page
 * went on looking authoritative while describing a set of cards that moved.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '../../../apps/mobile');
const LEDGER = join(APP, 'public/ledger.html');
const TEMPLATE = join(HERE, 'ledger.template.html');

const page = readFileSync(LEDGER, 'utf8');

/** The payload the page was generated with. */
const payload = (() => {
  const match = page.match(/const D = (\{.*?\});\n/s);
  if (!match) throw new Error('ledger.html carries no payload');
  return JSON.parse(match[1]!) as {
    fingerprint: string; version: string; model: string; combos: number;
    coverage: { firstSeason: number; lastSeason: number };
    eras: { k: string; p: boolean }[];
    cards: unknown[]; provenance: unknown[];
  };
})();

describe('the ledger is a complete document', () => {
  it('is a whole page, not the fragment the template is', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page.trimEnd().endsWith('</html>')).toBe(true);
    expect(page).toContain('<meta charset="utf-8">');
  });

  it('asks not to be indexed, because nothing links to it', () => {
    expect(page).toMatch(/<meta name="robots" content="noindex/);
  });

  it('still has the placeholder the generator fills', () => {
    expect(readFileSync(TEMPLATE, 'utf8')).toContain('/*__DATA__*/');
  });
});

describe('the ledger agrees with the dataset it claims to describe', () => {
  it('carries every card', () => {
    expect(payload.cards.length).toBe(DATASET.cards.length);
  });

  it('reports the same versions', () => {
    expect(payload.version).toBe(DATASET.version);
    expect(payload.model).toBe(DATASET.ratingModelVersion);
  });

  it('reports the same eras, and their provisional state', () => {
    expect(payload.eras.map((e) => e.k).sort()).toEqual(DATASET.eras.map((e) => e.key).sort());
    for (const era of DATASET.eras) {
      const shown = payload.eras.find((e) => e.k === era.key)!;
      expect(shown.p).toBe(!!era.provisional);
    }
  });

  it('reports the same coverage and combo count', () => {
    expect(payload.coverage).toEqual(DATASET.coverage);
    expect(payload.combos).toBe(DATASET.combos.length);
  });

  it('publishes the dataset\'s own fingerprint', () => {
    expect(payload.fingerprint).toBe(DATASET.fingerprint);
    expect(payload.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not hardcode an era as live', () => {
    // The state chip is read from the era. A literal would make the proof page
    // the one place that hides an era still filling up.
    expect(page).not.toMatch(/chip ok">Live/);
  });
});

describe('the ledger is reachable by URL and by nothing else', () => {
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) sources.push(full);
    }
  };
  walk(join(APP, 'app'));
  walk(join(APP, 'src'));

  it('is linked from nowhere in the app', () => {
    const linking = sources.filter((f) => readFileSync(f, 'utf8').includes('ledger.html'));
    expect(linking).toEqual([]);
  });

  it('links nowhere back into the app', () => {
    const hrefs = [...page.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    const offsite = hrefs.filter((h) => !h.startsWith('https://fonts.'));
    expect(offsite).toEqual([]);
  });
});

/**
 * The fingerprint replaced a wall-clock stamp so that a build is reproducible:
 * same inputs, same bytes, and a diff that means a rating actually moved. If it
 * ever stops being derived from the content it is worse than the timestamp was,
 * because it looks like a guarantee.
 */
describe('the fingerprint is derived from the cards, not stamped on', () => {
  const live = () => DATASET.cards.map((c) => ({
    id: c.id, position: c.position, franchiseId: c.franchiseId,
    era: c.era, year: c.year, rating: c.rating,
  }));

  it('is what the shipped dataset carries', () => {
    expect(datasetFingerprint(DATASET.eras, DATASET.combos, live())).toBe(DATASET.fingerprint);
  });

  it('is stable across calls', () => {
    expect(datasetFingerprint(DATASET.eras, DATASET.combos, live()))
      .toBe(datasetFingerprint(DATASET.eras, DATASET.combos, live()));
  });

  it('does not depend on the order cards arrive in', () => {
    const shuffled = [...live()].reverse();
    expect(datasetFingerprint(DATASET.eras, DATASET.combos, shuffled)).toBe(DATASET.fingerprint);
  });

  it('moves when a single rating moves', () => {
    const nudged = live();
    nudged[0] = { ...nudged[0]!, rating: nudged[0]!.rating + 0.01 };
    expect(datasetFingerprint(DATASET.eras, DATASET.combos, nudged)).not.toBe(DATASET.fingerprint);
  });

  it('moves when a card disappears', () => {
    expect(datasetFingerprint(DATASET.eras, DATASET.combos, live().slice(1)))
      .not.toBe(DATASET.fingerprint);
  });

  it('is not a timestamp', () => {
    expect(DATASET.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect((DATASET as unknown as { generatedAt?: string }).generatedAt).toBeUndefined();
  });
});
