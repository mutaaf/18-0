/**
 * Tunes the perfection gates against the real dataset.
 *
 *   pnpm --filter @18-0/data tune -- --games=400000
 *
 * The gate values in PRFAQ §21 (96 everywhere, 98 at QB and DEF) were round
 * numbers chosen before anyone knew the real rating distribution. Measured
 * against actual NFL history they make 18-0 effectively unreachable: only 0.007%
 * of seven-spin draws can fill all seven slots at a 96 floor, because most
 * franchise-decades simply never produced an all-time-elite season at every
 * position.
 *
 * This plays a large sample once, then replays every candidate gate config
 * against it, so the floors can be chosen to hit a target rarity instead of
 * being guessed.
 */
import {
  DEFAULT_SCORING_CONFIG,
  ROSTER_SLOTS,
  scoreRoster,
  type RosterSlot,
} from '@18-0/domain';
import { createRng, drawSkill, expectedBestByPosition, playGame, poolFromSeasons } from '@18-0/domain/sim';
import { DATASET, toRatedSeason } from '../index.js';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k!, v ?? 'true'] as const;
  }),
);
const GAMES = Number(args.get('games') ?? 400_000);
const config = DEFAULT_SCORING_CONFIG;

const pool = poolFromSeasons(DATASET.cards.map(toRatedSeason), DATASET.combos);
const baseline = expectedBestByPosition(pool);
const rng = createRng(0x18000000);

interface Sample {
  final: number;
  ratings: Record<RosterSlot, number>;
}

console.log(`\n18-0 — GATE TUNING  (${GAMES.toLocaleString()} games on the real dataset)\n` + '='.repeat(76));
const samples: Sample[] = [];
for (let i = 0; i < GAMES; i++) {
  const { roster } = playGame(pool, rng, drawSkill(rng), config, baseline);
  const result = scoreRoster(roster, config);
  samples.push({
    final: result.finalRating,
    ratings: Object.fromEntries(
      ROSTER_SLOTS.map((s) => [s, roster[s].season.rating]),
    ) as Record<RosterSlot, number>,
  });
}

const sortedFinals = [...samples.map((s) => s.final)].sort((a, b) => a - b);
const above = (threshold: number) => samples.filter((s) => s.final >= threshold).length;

console.log('\nSCORE THRESHOLD ALONE\n');
for (const threshold of [96.5, 97.5, 98, 98.5, 99, 99.25]) {
  const n = above(threshold);
  console.log(
    `  >= ${threshold.toFixed(2)}  ${String(n).padStart(7)} / ${GAMES.toLocaleString()}  ` +
      `${((n / GAMES) * 100).toFixed(4)}%  ${n ? `1 in ${Math.round(GAMES / n).toLocaleString()}` : '—'}`,
  );
}
console.log(`  max observed final rating: ${sortedFinals[sortedFinals.length - 1]!.toFixed(3)}`);

interface Candidate {
  label: string;
  score: number;
  universal: number;
  qbDef: number;
  eliteRating: number;
  eliteCount: number;
}

const CANDIDATES: Candidate[] = [
  { label: 'PRFAQ §21 as written', score: 99.25, universal: 96, qbDef: 98, eliteRating: 98, eliteCount: 4 },
  { label: 'score 99.0 / 96 / 98', score: 99.0, universal: 96, qbDef: 98, eliteRating: 98, eliteCount: 4 },
  { label: 'score 99.0 / 94 / 97', score: 99.0, universal: 94, qbDef: 97, eliteRating: 97, eliteCount: 4 },
  { label: 'score 98.5 / 93 / 96', score: 98.5, universal: 93, qbDef: 96, eliteRating: 96, eliteCount: 4 },
  { label: 'score 98.5 / 93 / 96 (3 elite)', score: 98.5, universal: 93, qbDef: 96, eliteRating: 96, eliteCount: 3 },
  { label: 'score 98.0 / 93 / 96', score: 98.0, universal: 93, qbDef: 96, eliteRating: 96, eliteCount: 4 },
  { label: 'score 98.0 / 92 / 95', score: 98.0, universal: 92, qbDef: 95, eliteRating: 95, eliteCount: 4 },
  { label: 'score 97.5 / 92 / 95', score: 97.5, universal: 92, qbDef: 95, eliteRating: 95, eliteCount: 4 },
  { label: 'score 99.0 / 93 / 96', score: 99.0, universal: 93, qbDef: 96, eliteRating: 96, eliteCount: 4 },
  { label: 'score 98.9 / 93 / 96', score: 98.9, universal: 93, qbDef: 96, eliteRating: 96, eliteCount: 4 },
  { label: 'score 98.75 / 93 / 96', score: 98.75, universal: 93, qbDef: 96, eliteRating: 96, eliteCount: 4 },
  { label: 'score 98.75 / 94 / 96', score: 98.75, universal: 94, qbDef: 96, eliteRating: 96, eliteCount: 4 },
  { label: 'score 98.5 / 94 / 96', score: 98.5, universal: 94, qbDef: 96, eliteRating: 96, eliteCount: 4 },
  { label: 'score 98.5 / 93 / 97', score: 98.5, universal: 93, qbDef: 97, eliteRating: 97, eliteCount: 4 },
  { label: 'score 98.6 / 93 / 96 (5 elite)', score: 98.6, universal: 93, qbDef: 96, eliteRating: 96, eliteCount: 5 },
];

const passes = (sample: Sample, c: Candidate): boolean => {
  if (sample.final < c.score) return false;
  let elite = 0;
  for (const slot of ROSTER_SLOTS) {
    const rating = sample.ratings[slot];
    const floor = slot === 'QB' || slot === 'DEF' ? Math.max(c.universal, c.qbDef) : c.universal;
    if (rating < floor) return false;
    if (rating >= c.eliteRating) elite++;
  }
  return elite >= c.eliteCount;
};

console.log('\nCANDIDATE GATE CONFIGS\n');
console.log('  config                            18-0 rate     1 in       17-1 rate');
for (const candidate of CANDIDATES) {
  const perfect = samples.filter((s) => passes(s, candidate)).length;
  const reachedScore = above(candidate.score);
  const heartbreak = samples.filter(
    (s) => s.final >= 96.5 && !passes(s, candidate),
  ).length;
  console.log(
    `  ${candidate.label.padEnd(32)}${((perfect / GAMES) * 100).toFixed(4).padStart(9)}%` +
      `${perfect ? Math.round(GAMES / perfect).toLocaleString().padStart(11) : '        —'}` +
      `${((heartbreak / GAMES) * 100).toFixed(3).padStart(13)}%` +
      `   (${reachedScore} cleared score)`,
  );
}
console.log('');
