/**
 * Builds the bundled gameday calendar from the nflverse schedule file.
 *
 *   pnpm --filter @18-0/data build:schedule
 *
 * Separate from the dataset build on purpose. The dataset is history and does
 * not move; the schedule does -- a new season is published every spring -- and
 * rebuilding 2,994 ratings to pick up next year's fixtures would be a very
 * long way round.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { easternToUtc, parseCsv } from './csv.js';
import { franchiseForTeam } from './teams.js';
// The dataset directly rather than through `index.ts`: that module re-exports
// `schedule.ts`, which loads the very file this script writes.
import dataset from '../generated/dataset.json' with { type: 'json' };
import type { Gameday, GamedayType, ScheduledGame } from './schedule.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = resolve(HERE, '../../../data/raw');
const OUT = resolve(HERE, '../generated/schedule.json');

/**
 * How far back to keep gamedays.
 *
 * Old boards are worth keeping -- a gameday leaderboard is a record of what
 * happened that day and deleting it deletes the point of having one -- but the
 * file is bundled into the app, so it holds recent seasons rather than all
 * twenty-seven. The server keeps every gameday it has ever stamped.
 */
const FIRST_SEASON = Number(process.env.SCHEDULE_FIRST_SEASON ?? 2025);

/** Preseason is not a gameday. Nobody is chasing perfection in August. */
const PLAYABLE: readonly GamedayType[] = ['REG', 'WC', 'DIV', 'CON', 'SB'];

/** The board opens before the first kickoff and closes after the last. */
const OPENS_BEFORE_MS = 3 * 60 * 60 * 1000;
const CLOSES_AFTER_MS = 6 * 60 * 60 * 1000;

interface Row {
  season: string; game_type: string; week: string; gameday: string;
  weekday: string; gametime: string; away_team: string; home_team: string;
}

function main(): void {
  const rows = parseCsv(join(RAW, 'games.csv')) as unknown as Row[];
  const known = new Set((dataset as { franchises: { id: string }[] }).franchises.map((f) => f.id));

  const byDate = new Map<string, { row: Row; game: ScheduledGame }[]>();
  let skippedTeams = 0;

  for (const row of rows) {
    if (Number(row.season) < FIRST_SEASON) continue;
    if (!PLAYABLE.includes(row.game_type as GamedayType)) continue;
    if (!row.gameday || !row.gametime) continue;

    const away = franchiseForTeam(row.away_team);
    const home = franchiseForTeam(row.home_team);
    // A franchise the dataset cannot field is a franchise the wheel must not
    // offer. Better to drop the fixture than to stamp a gameday whose spin
    // pool is empty.
    if (!away || !home || !known.has(away) || !known.has(home)) {
      skippedTeams++;
      continue;
    }

    const game: ScheduledGame = {
      away,
      home,
      kickoff: easternToUtc(row.gameday, row.gametime).toISOString(),
    };
    const bucket = byDate.get(row.gameday);
    if (bucket) bucket.push({ row, game });
    else byDate.set(row.gameday, [{ row, game }]);
  }

  const gamedays: Gameday[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entries]) => {
      const games = [...entries]
        .map((e) => e.game)
        .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
      const kickoffs = games.map((g) => Date.parse(g.kickoff));
      // The day takes its round from the fixture that opens it: a Saturday
      // holding the last regular-season game and a wild card game is one day
      // on the calendar and needs one label.
      const first = entries.find((e) => Date.parse(e.game.kickoff) === Math.min(...kickoffs))!.row;
      return {
        key,
        season: Number(first.season),
        week: Number(first.week),
        type: first.game_type as GamedayType,
        weekday: first.weekday,
        opensAt: new Date(Math.min(...kickoffs) - OPENS_BEFORE_MS).toISOString(),
        closesAt: new Date(Math.max(...kickoffs) + CLOSES_AFTER_MS).toISOString(),
        franchises: [...new Set(games.flatMap((g) => [g.away, g.home]))].sort(),
        games,
      };
    });

  // Two overlapping windows would make "which gameday is it" ambiguous, and
  // the resolver assumes it is not. Fail the build rather than ship that.
  for (let i = 1; i < gamedays.length; i++) {
    const previous = gamedays[i - 1]!;
    const current = gamedays[i]!;
    if (Date.parse(current.opensAt) <= Date.parse(previous.closesAt)) {
      throw new Error(
        `Gameday windows overlap: ${previous.key} closes ${previous.closesAt}, ` +
          `${current.key} opens ${current.opensAt}`,
      );
    }
  }

  const schedule = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    source: 'nflverse-data (schedules/games.csv)',
    gamedays,
  };
  writeFileSync(OUT, JSON.stringify(schedule));

  const seasons = [...new Set(gamedays.map((g) => g.season))].sort();
  console.log(`schedule ${schedule.version}`);
  console.log(`  ${gamedays.length} gamedays across ${seasons.join(', ')}`);
  console.log(`  ${gamedays.reduce((n, g) => n + g.games.length, 0)} fixtures`);
  if (skippedTeams > 0) console.log(`  ${skippedTeams} fixtures skipped: unknown franchise`);
  console.log(`  first ${gamedays[0]?.key} · last ${gamedays[gamedays.length - 1]?.key}`);
  console.log(`  wrote ${OUT}`);
}

main();
