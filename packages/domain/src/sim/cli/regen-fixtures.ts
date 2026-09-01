/**
 * Regenerates the seed-fixture ratings against the current scoring config.
 *
 *   pnpm --filter @18-0/domain regen:fixtures
 *
 * The fixtures (PRFAQ §38) pin real rosters to real endings, which makes them a
 * genuine regression check — but it also means every recalibration moves them.
 * Rather than hand-editing eight rosters each time, this searches for the
 * ratings that land on each target ending and rewrites the file.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SCORING_CONFIG,
  ROSTER_SLOTS,
  isPerfectionDenied,
  scoreRoster,
  type CompletedRoster,
  type Position,
  type RosterSelection,
  type RosterSlot,
} from '../../index.js';

const config = DEFAULT_SCORING_CONFIG;
const POSITION: Record<RosterSlot, Position> = {
  QB: 'QB', RB1: 'RB', RB2: 'RB', WR1: 'WR', WR2: 'WR', TE1: 'TE', DEF: 'DEF',
};

const build = (ratings: Record<RosterSlot, number>): CompletedRoster => {
  const entries = ROSTER_SLOTS.map((slot): [RosterSlot, RosterSelection] => [
    slot,
    {
      slot,
      spinSequence: 1,
      season: {
        id: String(slot),
        entityId: `${slot}-e`,
        entityType: slot === 'DEF' ? 'defense' : 'player',
        displayName: String(slot),
        position: POSITION[slot],
        franchiseId: 'f',
        seasonYear: 2010,
        era: '2010_2014',
        rating: Math.round(ratings[slot] * 10) / 10,
        archetypes: [],
        ratingModelVersion: config.version,
      },
    },
  ]);
  return Object.fromEntries(entries) as CompletedRoster;
};

/** A believable spread — a roster is never seven identical ratings. */
const OFFSETS: Record<RosterSlot, number> = {
  QB: 1.4, RB1: -0.6, RB2: -2.4, WR1: 0.9, WR2: -1.3, TE1: -1.9, DEF: 0.6,
};
const shape = (quality: number) =>
  build(
    Object.fromEntries(
      ROSTER_SLOTS.map((s) => [s, Math.min(99.9, quality + OFFSETS[s])]),
    ) as Record<RosterSlot, number>,
  );

/** Finds a shape whose result satisfies `matches`, by bisection on quality. */
function search(matches: (r: ReturnType<typeof scoreRoster>) => number): Record<RosterSlot, number> | null {
  let lo = 40;
  let hi = 101;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const direction = matches(scoreRoster(shape(mid), config));
    if (direction < 0) lo = mid;
    else if (direction > 0) hi = mid;
    else {
      return Object.fromEntries(
        ROSTER_SLOTS.map((s) => [s, shape(mid)[s].season.rating]),
      ) as Record<RosterSlot, number>;
    }
  }
  return null;
}

const targets: [key: string, wins: number][] = [
  ['weak', 6], ['average', 9], ['playoff', 12], ['championship', 15], ['dynasty', 16],
];

const resolved = new Map<string, Record<RosterSlot, number>>();

for (const [key, wins] of targets) {
  const found = search((r) => (r.ending.wins < wins ? -1 : r.ending.wins > wins ? 1 : 0));
  if (!found) throw new Error(`No roster found for ${key} (${wins} wins)`);
  resolved.set(key, found);
}

// 17-1 on score alone: at or above the heartbreak band, below the 18-0 floor.
const heartbreak = search((r) =>
  r.finalRating < 96.5 ? -1 : r.finalRating >= config.perfection.minFinalRating ? 1 : 0,
);
if (!heartbreak) throw new Error('No score-based heartbreak roster found');
resolved.set('heartbreak', heartbreak);

// Perfect: every gate cleared. Take the top of the scale.
const perfect: Record<RosterSlot, number> = {
  QB: 99.9, RB1: 99.4, RB2: 98.6, WR1: 99.9, WR2: 99.1, TE1: 98.4, DEF: 99.7,
};
const perfectResult = scoreRoster(build(perfect), config);
if (perfectResult.ending.key !== 'PERFECT') {
  throw new Error(`Perfect fixture is ${perfectResult.ending.key} at ${perfectResult.finalRating}`);
}
resolved.set('perfect', perfect);

// Perfection denied: clears the score, one slot under the universal floor.
const denied: Record<RosterSlot, number> = {
  ...perfect,
  QB: 99.9, RB1: 99.9, WR1: 99.9, WR2: 99.9, TE1: 99.9, DEF: 99.9,
  RB2: config.perfection.universalSlotMinimum - 0.6,
};
const deniedResult = scoreRoster(build(denied), config);
if (!isPerfectionDenied(deniedResult)) {
  throw new Error(`Denied fixture is not a denial: ${deniedResult.ending.key} @ ${deniedResult.finalRating}`);
}
resolved.set('perfection_denied', denied);

// --- rewrite the fixture file ---------------------------------------------

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/rosters.ts');
let source = readFileSync(file, 'utf8');

for (const [key, ratings] of resolved) {
  const start = source.indexOf(`key: '${key}',`);
  const slotsAt = source.indexOf('slots: {', start);
  const end = source.indexOf('\n    },\n  },', slotsAt);
  let block = source.slice(slotsAt, end);
  for (const slot of ROSTER_SLOTS) {
    block = block.replace(
      new RegExp(`(${slot}: slot\\()[\\d.]+`),
      (_m, prefix: string) => `${prefix}${ratings[slot]}`,
    );
  }
  source = source.slice(0, slotsAt) + block + source.slice(end);
}
source = source.replace(/ratingModelVersion: '[^']+'/g, `ratingModelVersion: '${config.version}'`);
writeFileSync(file, source);

console.log(`Regenerated ${resolved.size} fixtures against model ${config.version}:`);
for (const [key, ratings] of resolved) {
  const result = scoreRoster(build(ratings), config);
  console.log(
    `  ${key.padEnd(20)} ${`${result.record.wins}-${result.record.losses}`.padStart(5)} ` +
      `${result.ending.label.padEnd(22)} rating ${result.finalRating.toFixed(2)}`,
  );
}
