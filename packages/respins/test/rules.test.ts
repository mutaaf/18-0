import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RESPIN_PACKS,
  RESPINS_PER_SEASON,
  bucketKey,
  distinctBuckets,
  drawUniform,
  ledgerReference,
  oddsDisclosure,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = resolve(HERE, '..');
const ROOT = resolve(PACKAGE, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

describe('one respin per season, stated once', () => {
  it('the SQL limit and the app limit agree', () => {
    // The last migration to define the function is the one in force.
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    let stated: number | null = null;
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
      const match = sql.match(/function public\.respins_per_season\(\)[\s\S]*?\$\$\s*select\s+(\d+)\s*;?\s*\$\$/i);
      if (match) stated = Number(match[1]);
    }
    expect(stated, 'public.respins_per_season() is not defined in any migration').not.toBeNull();
    expect(stated).toBe(RESPINS_PER_SEASON);
  });

  it('the packs are the two the owner priced', () => {
    expect(RESPIN_PACKS.map((p) => [p.productId, p.respins, p.usd])).toEqual([
      ['com.eighteenzerodcai.app.respins.3', 3, '0.99'],
      ['com.eighteenzerodcai.app.respins.12', 12, '2.99'],
    ]);
  });

  it('a spend reference names the season and the turn, so a retry cannot charge twice', () => {
    expect(ledgerReference.rankedSpend('s', 3)).toBe(ledgerReference.rankedSpend('s', 3));
    expect(ledgerReference.rankedSpend('s', 3)).not.toBe(ledgerReference.rankedSpend('s', 4));
    expect(ledgerReference.purchase('1')).not.toBe(ledgerReference.refund('1'));
  });
});

describe('the wheel is uniform over franchise-eras', () => {
  const candidates = [
    { franchiseId: 'BAL', era: 'e1', rating: 99 },
    { franchiseId: 'BAL', era: 'e1', rating: 80 },
    { franchiseId: 'BAL', era: 'e1', rating: 70 },
    { franchiseId: 'DEN', era: 'e2', rating: 90 },
    { franchiseId: 'SEA', era: 'e3', rating: 60 },
  ];

  it('counts a bucket once however many cards it holds', () => {
    expect(distinctBuckets(candidates).map(bucketKey)).toEqual(['BAL:e1', 'DEN:e2', 'SEA:e3']);
  });

  it('draws every bucket with equal frequency', () => {
    const buckets = distinctBuckets(candidates);
    const counts = new Map<string, number>();
    // Every value of random() across [0, 1) in even steps: exactly uniform.
    for (let i = 0; i < 3000; i++) {
      const b = drawUniform(buckets, [], () => i / 3000)!;
      counts.set(bucketKey(b), (counts.get(bucketKey(b)) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([1000, 1000, 1000]);
  });

  it('a respin never lands where it started, and the rest stay equally likely', () => {
    const buckets = distinctBuckets(candidates);
    const counts = new Map<string, number>();
    for (let i = 0; i < 2000; i++) {
      const b = drawUniform(buckets, [{ franchiseId: 'BAL', era: 'e1' }], () => i / 2000)!;
      counts.set(bucketKey(b), (counts.get(bucketKey(b)) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({ 'DEN:e2': 1000, 'SEA:e3': 1000 });
  });

  it('returns null when nothing else is left', () => {
    expect(drawUniform([{ franchiseId: 'BAL', era: 'e1' }], [{ franchiseId: 'BAL', era: 'e1' }])).toBeNull();
    expect(drawUniform([], [], () => 0.5)).toBeNull();
  });

  it('states the odds it actually draws with', () => {
    expect(oddsDisclosure(231)).toContain('Right now that is 230, so each is 1 in 230.');
    expect(oddsDisclosure(null)).not.toContain('1 in');
  });
});

describe('the edge bundle is this package, not a copy of it that drifted', () => {
  it('matches what build:edge produces from the current source', () => {
    const script: string = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')).scripts['build:edge'];
    const committed = join(ROOT, 'supabase/functions/_shared/respins.ts');
    const out = join(mkdtempSync(join(tmpdir(), 'respins-edge-')), 'respins.ts');
    execSync(script.replace(/--outfile=\S+/, `--outfile=${out}`), { cwd: PACKAGE, stdio: 'pipe' });
    expect(
      readFileSync(committed, 'utf8') === readFileSync(out, 'utf8'),
      'supabase/functions/_shared/respins.ts is stale: run `pnpm --filter @17-0/respins build:edge` and commit it',
    ).toBe(true);
  });
});
