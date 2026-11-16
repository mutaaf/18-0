import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every board's filters, checked against the definition actually in force.
 *
 * Three migrations have now dropped a board filter by restating a view from
 * memory: 0009 lost moderation, 0021 lost the gameday filter, and 0021 never
 * taught the windowed functions about hiding at all (found and restated in
 * 0027). Each was caught late, by hand or by e2e against a live database. This
 * reads the last definition of every board out of supabase/migrations -- the
 * one Postgres will be running -- and fails the build if a filter is missing,
 * so the next restatement that forgets one fails here instead of on a board.
 *
 * Text, not a database: it is a check on what the migrations *say*, which is
 * what a reviewer reads and what gets restated next time.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '../../../supabase/migrations');

function latestDefinition(name: string): { file: string; sql: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  let found: { file: string; sql: string } | null = null;
  const head = new RegExp(`create (or replace )?(view|function) public\\.${name}\\b`, 'i');
  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS, file), 'utf8');
    let index = text.search(head);
    while (index >= 0) {
      const rest = text.slice(index);
      // A function body ends at its closing `$$;`, a view at the first `;`.
      const end = /function/i.test(rest.slice(0, 40)) ? rest.indexOf('$$;') + 3 : rest.indexOf(';') + 1;
      found = { file, sql: rest.slice(0, end) };
      const next = rest.slice(1).search(head);
      index = next < 0 ? -1 : index + 1 + next;
    }
  }
  if (!found) throw new Error(`no definition of public.${name}`);
  return found;
}

const COMMON = [
  "g.status = 'completed'",
  'g.assisted = false',
  'g.voided_at is null',
  'g.hidden_at is null',
  'p.is_permanent = true',
  'p.handle is not null',
  "p.handle_status = 'ok'",
];

const BOARDS: Record<string, { filters: string[]; respun: 'column' | 'clean' | 'excluded' | 'count' }[]> = {
  leaderboard_rating: [{ filters: [...COMMON, 'g.blind = true', 'g.gameday_key is null'], respun: 'column' }],
  leaderboard_scout: [{ filters: [...COMMON, "g.mode = 'scout'", 'g.gameday_key is null'], respun: 'column' }],
  leaderboard_points: [{ filters: [...COMMON, 'g.gameday_key is null', 'g.points_multiplier'], respun: 'count' }],
  leaderboard_perfect: [{ filters: [...COMMON, 'g.blind = true', 'g.gameday_key is null'], respun: 'excluded' }],
  leaderboard_rating_since: [{ filters: [...COMMON, 'g.blind = true', 'g.gameday_key is null'], respun: 'clean' }],
  leaderboard_scout_since: [{ filters: [...COMMON, "g.mode = 'scout'", 'g.gameday_key is null'], respun: 'clean' }],
  leaderboard_points_since: [{ filters: [...COMMON, 'g.gameday_key is null', 'g.points_multiplier'], respun: 'clean' }],
  leaderboard_gameday: [{ filters: [...COMMON, 'g.gameday_key = coalesce(p_key'], respun: 'clean' }],
};

describe('every board keeps every filter', () => {
  for (const [name, [expected]] of Object.entries(BOARDS)) {
    it(`${name}`, () => {
      const { file, sql } = latestDefinition(name);
      const flat = sql.replace(/\s+/g, ' ');
      for (const filter of expected!.filters) {
        expect(flat.includes(filter), `${name} (last defined in ${file}) has lost \`${filter}\``).toBe(true);
      }
      switch (expected!.respun) {
        case 'column':
          expect(flat, `${name} must carry the ↻ mark`).toContain('(g.respins_used > 0) as respun');
          break;
        case 'count':
          expect(flat, `${name} must count respun seasons`).toContain('filter (where g.respins_used > 0)');
          break;
        case 'excluded':
          expect(flat, `${name} counts clean seasons only`).toContain('g.respins_used = 0');
          break;
        case 'clean':
          expect(flat, `${name} must take the clean filter`).toContain('(not clean or g.respins_used = 0)');
          break;
      }
    });
  }
});
