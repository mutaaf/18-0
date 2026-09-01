/**
 * Is 18-0 actually reachable?
 *
 * The perfection gates require seven slots at 96+, QB and DEF at 98+, and four
 * slots at 98+ — but the user does not choose their spins. This measures how
 * often a seven-spin sequence can satisfy the gates *under omniscient play*,
 * which is a hard upper bound on any real strategy.
 *
 *   pnpm sim -- --draws=200000 --seed=7 --leagues=3
 */
import { DEFAULT_SCORING_CONFIG, ENDINGS, POSITIONS, ROSTER_SLOTS, scoreRoster, type Position } from '../../index.js';
import { createRng } from '../rng.js';
import { DEFAULT_POOL_SPEC, buildPool, countAtOrAbove } from '../pool.js';
import { drawSkill, drawSpins, evaluateReachability, expectedBestByPosition, maxGatedSlotCount, playGame } from '../play.js';
import { bar, pct, percentile } from '../stats.js';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k!, v ?? 'true'] as const;
  }),
);
const num = (key: string, fallback: number) => Number(args.get(key) ?? fallback);

const DRAWS = num('draws', 200_000);
const GAMES = num('games', 50_000);
const LEAGUES = num('leagues', 3);
const SEED = num('seed', 1);
const CLUSTERING = num('clustering', DEFAULT_POOL_SPEC.talentClustering);
const POOL_SPEC = { ...DEFAULT_POOL_SPEC, talentClustering: CLUSTERING };
const config = DEFAULT_SCORING_CONFIG;


console.log('\n18-0 — PERFECTION REACHABILITY\n' + '='.repeat(72));
console.log(`model ${config.version} · ${LEAGUES} leagues · ${DRAWS.toLocaleString()} draws · ${GAMES.toLocaleString()} games each`);
console.log(`talent clustering: ${CLUSTERING}\n`);

let totalGatesReachable = 0;
let totalPerfectReachable = 0;
let totalDraws = 0;
const gatedHistogram = new Array<number>(ROSTER_SLOTS.length + 1).fill(0);
const allFinalRatings: number[] = [];
const endingCounts = new Map<string, number>();

for (let league = 0; league < LEAGUES; league++) {
  const seed = SEED + league * 104_729;
  const pool = buildPool(seed, POOL_SPEC);
  const baseline = expectedBestByPosition(pool);
  const buckets = pool.buckets.size;

  if (league === 0) {
    console.log(`POOL SHAPE  (${buckets} valid franchise-era buckets)\n`);
    console.log('  pos     seasons    >=96    >=98   >=99.5   buckets w/ 96+   buckets w/ 98+');
    for (const position of POSITIONS as readonly Position[]) {
      let with96 = 0;
      let with98 = 0;
      let seasons = 0;
      for (const bucket of pool.buckets.values()) {
        seasons += bucket[position].length;
        if (bucket[position].some((s) => s.rating >= 96)) with96++;
        if (bucket[position].some((s) => s.rating >= 98)) with98++;
      }
      console.log(
        `  ${position.padEnd(6)}${String(seasons).padStart(8)}` +
          `${String(countAtOrAbove(pool, position, 96)).padStart(8)}` +
          `${String(countAtOrAbove(pool, position, 98)).padStart(8)}` +
          `${String(countAtOrAbove(pool, position, 99.5)).padStart(9)}` +
          `${((with96 / buckets) * 100).toFixed(1).padStart(16)}%` +
          `${((with98 / buckets) * 100).toFixed(1).padStart(16)}%`,
      );
    }
    console.log('');
  }

  // --- Upper bound on 18-0 -------------------------------------------------
  const rng = createRng(seed ^ 0x5f3759df);
  for (let i = 0; i < DRAWS; i++) {
    const spins = drawSpins(pool, rng);
    gatedHistogram[maxGatedSlotCount(spins, pool, config)]!++;
    const verdict = evaluateReachability(spins, pool, config);
    if (verdict.gatesReachable) totalGatesReachable++;
    if (verdict.perfectReachable) totalPerfectReachable++;
    totalDraws++;
  }

  // --- What real play actually produces ------------------------------------
  const playRng = createRng(seed ^ 0x1b873593);
  for (let i = 0; i < GAMES; i++) {
    const { roster } = playGame(pool, playRng, drawSkill(playRng), config, baseline);
    const result = scoreRoster(roster, config);
    allFinalRatings.push(result.finalRating);
    endingCounts.set(result.ending.key, (endingCounts.get(result.ending.key) ?? 0) + 1);
  }
}

console.log('GATE FEASIBILITY UNDER OMNISCIENT PLAY\n');
console.log('  slots fillable at their 18-0 floor, per seven-spin draw:');
gatedHistogram.forEach((count, slots) => {
  console.log(
    `    ${slots}/7  ${bar(count / totalDraws)}  ${((count / totalDraws) * 100).toFixed(3).padStart(7)}%  ${count.toLocaleString()}`,
  );
});

console.log('');
console.log(`  all seven gates satisfiable : ${totalGatesReachable.toLocaleString()} / ${totalDraws.toLocaleString()}  (${pct(totalGatesReachable, totalDraws)})`);
console.log(`  ...and score >= ${config.perfection.minFinalRating}       : ${totalPerfectReachable.toLocaleString()} / ${totalDraws.toLocaleString()}  (${pct(totalPerfectReachable, totalDraws)})`);
if (totalPerfectReachable === 0) {
  console.log(`\n  >>> No reachable 18-0 in ${totalDraws.toLocaleString()} draws under perfect play.`);
  console.log(`  >>> Upper bound on the true rate: < 1 in ${totalDraws.toLocaleString()}.`);
} else {
  console.log(`\n  >>> Roughly 1 in ${Math.round(totalDraws / totalPerfectReachable).toLocaleString()} games could reach 18-0 with perfect knowledge.`);
  console.log('  >>> Real players see far fewer, since they choose without seeing future spins.');
}

const sorted = [...allFinalRatings].sort((a, b) => a - b);
console.log('\nFINAL RATING DISTRIBUTION (realistic strategy mix)\n');
console.log('  percentile   actual   PRFAQ §18 target');
const targets: [number, number | null][] = [
  [50, 80], [75, 87], [90, 92], [95, 95], [99, 97.5], [99.9, 99], [99.99, null],
];
for (const [p, target] of targets) {
  console.log(
    `  ${String(p).padStart(6)}th ${percentile(sorted, p).toFixed(2).padStart(9)}` +
      `${target === null ? '        —' : target.toFixed(2).padStart(19)}`,
  );
}

console.log('\nENDING DISTRIBUTION\n');
const totalGames = allFinalRatings.length;
for (const ending of [...ENDINGS].reverse()) {
  const count = endingCounts.get(ending.key) ?? 0;
  console.log(
    `  ${`${ending.wins}-${ending.losses}`.padStart(5)}  ${ending.label.padEnd(22)}` +
      `${bar(count / totalGames)}  ${((count / totalGames) * 100).toFixed(3).padStart(7)}%`,
  );
}
console.log('');
