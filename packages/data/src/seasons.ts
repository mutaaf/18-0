import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Position, SeasonStats } from '@18-0/domain';

/**
 * Hydrated season files: one year at a time, from whatever source you have.
 *
 * `legacy.ts` reads one specific mirror of NFL.com's career files and knows its
 * column names. That was right for a proof of concept and wrong as the place a
 * licensed feed lands, because every new source would mean another loader that
 * knows another set of column names.
 *
 * This reads a **canonical** file instead. The keys are the `SeasonStats` keys
 * the rating models actually consult, so there is no column mapping here to get
 * wrong — the mapping happens once, in whatever converter produces the file,
 * and the thing it has to produce is documented rather than inferred. Point a
 * new source at this shape and nothing downstream changes.
 *
 * It also means the era hydrates **one season at a time**. Coverage is counted
 * from the files that exist, so dropping `1982.json` in is the whole operation:
 * no code change, no flag to flip, no schema migration.
 *
 * ```
 * data/raw/seasons/1980.json
 * data/raw/seasons/1981.json      <- the era is 2/10 covered, and says so
 * ```
 *
 * Gitignored, deliberately. These files are only as redistributable as their
 * source, and the repository must not become the thing that redistributes them.
 * See `docs/hydrating-seasons.md`.
 */

export const SEASONS_DIR = 'seasons';

/** One player-season. `stats` keys are `SeasonStats` keys, verbatim. */
export interface SeasonFilePlayer {
  /**
   * Stable across years for the same person. The build collapses a franchise-era
   * to one card per identity, so an id that changes between seasons turns one
   * player into several cards, and an id shared by two people merges them.
   */
  readonly id: string;
  readonly name: string;
  readonly position: Position;
  /** Franchise lineage id, e.g. `lac` for the 1980 San Diego Chargers. */
  readonly franchiseId: string;
  readonly stats: SeasonStats;
}

/** One team defense-season. Collapsed on the franchise, so it needs no id. */
export interface SeasonFileDefense {
  readonly franchiseId: string;
  readonly stats: SeasonStats;
}

export interface SeasonFile {
  readonly year: number;
  /**
   * Where the numbers came from, in plain words, and under what terms. Recorded
   * because a dataset built from three sources with different licences is a
   * question somebody will eventually have to answer.
   */
  readonly source: string;
  /**
   * Games in the regular season that year. The qualification floors scale by
   * it (PRFAQ §12), so a strike year must say so: 1982 played 9 games and its
   * receivers cannot be held to a 16-game floor.
   */
  readonly seasonGames: number;
  readonly players: readonly SeasonFilePlayer[];
  readonly defenses: readonly SeasonFileDefense[];
}

export interface HydratedSeason {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly franchiseId: string;
  readonly year: number;
  readonly seasonGames: number;
  readonly stats: SeasonStats;
}

export interface HydrationReport {
  readonly seasons: readonly HydratedSeason[];
  /** Years found on disk, ascending. */
  readonly years: readonly number[];
  readonly sources: readonly string[];
  /** Files that were present and rejected, with why. */
  readonly rejected: readonly string[];
}

const POSITIONS = new Set<Position>(['QB', 'RB', 'WR', 'TE', 'DEF']);

/**
 * Rejects rather than repairs.
 *
 * A season file that is half-parsed is the failure mode this whole exercise
 * exists to avoid: the 49%-complete mirror looked fine in aggregate and was
 * missing Emmitt Smith. Anything malformed is refused by the year, loudly, so a
 * bad convert cannot quietly become a thin era.
 */
function validate(file: unknown, name: string): { ok: true; file: SeasonFile } | { ok: false; why: string } {
  if (file === null || typeof file !== 'object') return { ok: false, why: 'not an object' };
  const f = file as Partial<SeasonFile>;

  if (typeof f.year !== 'number' || !Number.isInteger(f.year)) return { ok: false, why: 'missing integer `year`' };
  if (!name.startsWith(String(f.year))) return { ok: false, why: `\`year\` ${f.year} does not match the filename` };
  if (typeof f.source !== 'string' || !f.source.trim()) return { ok: false, why: 'missing `source`' };
  if (typeof f.seasonGames !== 'number' || f.seasonGames < 1 || f.seasonGames > 17) {
    return { ok: false, why: 'missing plausible `seasonGames`' };
  }
  if (!Array.isArray(f.players) || !Array.isArray(f.defenses)) return { ok: false, why: 'missing `players` or `defenses`' };

  for (const p of f.players) {
    if (!p || typeof p.id !== 'string' || !p.id) return { ok: false, why: 'a player has no `id`' };
    if (typeof p.name !== 'string' || !p.name) return { ok: false, why: `player ${p.id} has no \`name\`` };
    if (!POSITIONS.has(p.position) || p.position === 'DEF') {
      return { ok: false, why: `player ${p.id} has position ${String(p.position)}` };
    }
    if (typeof p.franchiseId !== 'string' || !p.franchiseId) return { ok: false, why: `player ${p.id} has no \`franchiseId\`` };
    if (!p.stats || typeof p.stats !== 'object') return { ok: false, why: `player ${p.id} has no \`stats\`` };
  }
  for (const d of f.defenses) {
    if (!d || typeof d.franchiseId !== 'string' || !d.franchiseId) return { ok: false, why: 'a defense has no `franchiseId`' };
    if (!d.stats || typeof d.stats !== 'object') return { ok: false, why: `defense ${d.franchiseId} has no \`stats\`` };
  }

  // A duplicate id inside one season silently merges two players into one card.
  const seen = new Set<string>();
  for (const p of f.players) {
    const key = `${p.id}:${p.franchiseId}`;
    if (seen.has(key)) return { ok: false, why: `duplicate player id ${p.id} at ${p.franchiseId}` };
    seen.add(key);
  }

  return { ok: true, file: f as SeasonFile };
}

/**
 * Loads every hydrated season on disk.
 *
 * Absent directory is not an error — it is the normal state of a fresh clone,
 * which is why the pre-1999 eras are off by default.
 */
export function loadHydratedSeasons(rawDir: string): HydrationReport {
  const dir = join(rawDir, SEASONS_DIR);
  if (!existsSync(dir)) return { seasons: [], years: [], sources: [], rejected: [] };

  const files = readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f)).sort();
  const seasons: HydratedSeason[] = [];
  const years: number[] = [];
  const sources = new Set<string>();
  const rejected: string[] = [];

  for (const name of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (error) {
      rejected.push(`${name}: unparseable (${(error as Error).message})`);
      continue;
    }

    const checked = validate(parsed, name);
    if (!checked.ok) {
      rejected.push(`${name}: ${checked.why}`);
      continue;
    }

    const { year, seasonGames, source, players, defenses } = checked.file;
    years.push(year);
    sources.add(source);

    for (const p of players) {
      seasons.push({
        playerId: p.id,
        name: p.name,
        position: p.position,
        franchiseId: p.franchiseId,
        year,
        seasonGames,
        stats: p.stats,
      });
    }
    for (const d of defenses) {
      seasons.push({
        // Matches the id the modern defense loader mints, so the collapse key
        // and the card id read the same across every era.
        playerId: `def-${d.franchiseId}-${year}`,
        name: d.franchiseId,
        position: 'DEF',
        franchiseId: d.franchiseId,
        year,
        seasonGames,
        stats: d.stats,
      });
    }
  }

  return { seasons, years: [...years].sort((a, b) => a - b), sources: [...sources], rejected };
}
