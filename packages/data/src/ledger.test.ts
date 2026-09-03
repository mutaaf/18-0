import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DATASET } from './index.js';

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
    version: string; model: string; combos: number;
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
