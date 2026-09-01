/**
 * Runs the calibration and reachability harnesses against the real dataset.
 *
 *   pnpm --filter @18-0/data analyze -- --games=250000 --write
 *
 * Everything the synthetic harness reported was a function of `PoolSpec`.
 * These numbers are a function of actual NFL history.
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SCORING_CONFIG,
  ENDINGS,
  ROSTER_SLOTS,
  computeBaseRating,
  computeChemistry,
  computeEliteDepthBonus,
  computeWeakLinkPenalty,
  scoreRoster,
  type CalibrationAnchor,
  type RatedSeason,
} from '@18-0/domain';
import {
  createRng,
  drawSkill,
  drawSpins,
  evaluateReachability,
  expectedBestByPosition,
  maxGatedSlotCount,
  playGame,
  poolFromSeasons,
} from '@18-0/domain/sim';
import { DATASET, toRatedSeason } from '../index.js';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k!, v ?? 'true'] as const;
  }),
);
const num = (key: string, fallback: number) => Number(args.get(key) ?? fallback);

const GAMES = num('games', 250_000);
const DRAWS = num('draws', 200_000);
const WRITE = args.get('write') === 'true';
const config = DEFAULT_SCORING_CONFIG;

const pool = poolFromSeasons(DATASET.cards.map(toRatedSeason), DATASET.combos);
const baseline = expectedBestByPosition(pool);

const bar = (fraction: number, width = 28) =>
  '█'.repeat(Math.round(fraction * width)) + '·'.repeat(Math.max(0, width - Math.round(fraction * width)));
const percentile = (sorted: readonly number[], p: number) => {
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (rank - lo) * (sorted[hi]! - sorted[lo]!);
};

console.log('\n18-0 — REAL DATA ANALYSIS\n' + '='.repeat(72));
console.log(`dataset ${DATASET.version} · ${DATASET.coverage.firstSeason}-${DATASET.coverage.lastSeason}`);
console.log(`${DATASET.cards.length.toLocaleString()} cards · ${DATASET.combos.length} franchise-era combos\n`);

console.log('BUCKET COVERAGE\n');
console.log('  pos    cards   buckets w/ 96+   buckets w/ 98+   avg per bucket');
for (const position of ['QB', 'RB', 'WR', 'TE', 'DEF'] as const) {
  let with96 = 0;
  let with98 = 0;
  let total = 0;
  for (const bucket of pool.buckets.values()) {
    total += bucket[position].length;
    if (bucket[position].some((s: RatedSeason) => s.rating >= 96)) with96++;
    if (bucket[position].some((s: RatedSeason) => s.rating >= 98)) with98++;
  }
  const n = pool.buckets.size;
  console.log(
    `  ${position.padEnd(6)}${String(total).padStart(6)}` +
      `${((with96 / n) * 100).toFixed(1).padStart(16)}%` +
      `${((with98 / n) * 100).toFixed(1).padStart(16)}%` +
      `${(total / n).toFixed(1).padStart(16)}`,
  );
}

// --- calibration fit -------------------------------------------------------
const rng = createRng(20260901);
const raws: number[] = [];
for (let i = 0; i < GAMES; i++) {
  const { roster } = playGame(pool, rng, drawSkill(rng), config, baseline);
  raws.push(
    computeBaseRating(roster, config) -
      computeWeakLinkPenalty(roster, config).total +
      computeEliteDepthBonus(roster, config).bonus +
      computeChemistry(roster, config).bonus,
  );
}
raws.sort((a, b) => a - b);

const TARGETS: readonly (readonly [number, number])[] = [
  [0.5, 58], [2, 64], [5, 68], [10, 71.5], [25, 76], [50, 80],
  [75, 87], [90, 92], [95, 95], [99, 97.5], [99.9, 99], [99.99, 99.35],
];

const fittedAnchors: CalibrationAnchor[] = [];
for (const [p, target] of TARGETS) {
  const raw = Number(percentile(raws, p).toFixed(4));
  const previous = fittedAnchors[fittedAnchors.length - 1];
  if (previous && raw <= previous.raw) continue;
  fittedAnchors.push({ raw, final: target });
}
const curve: CalibrationAnchor[] = [
  { raw: Number((fittedAnchors[0]!.raw - 25).toFixed(4)), final: 30 },
  ...fittedAnchors,
  { raw: Number((raws[raws.length - 1]! + 0.5).toFixed(4)), final: 99.6 },
  { raw: 100, final: 100 },
].filter((a, i, all) => i === 0 || a.raw > all[i - 1]!.raw);

console.log(`\nCALIBRATION FIT  (${GAMES.toLocaleString()} simulated games on real cards)\n`);
console.log('  percentile        raw   ->   target');
for (const [p, target] of TARGETS) {
  console.log(`  ${String(p).padStart(7)}th ${percentile(raws, p).toFixed(3).padStart(11)}   ->   ${target.toFixed(2).padStart(8)}`);
}

const fitted = { ...config, calibration: { anchors: curve } };

// --- ending distribution + reachability ------------------------------------
const playRng = createRng(0x18001800);
const finals: number[] = [];
const endings = new Map<string, number>();
for (let i = 0; i < GAMES; i++) {
  const { roster } = playGame(pool, playRng, drawSkill(playRng), fitted, baseline);
  const result = scoreRoster(roster, fitted);
  finals.push(result.finalRating);
  endings.set(result.ending.key, (endings.get(result.ending.key) ?? 0) + 1);
}

console.log('\nENDING DISTRIBUTION (real cards, fitted curve)\n');
for (const ending of [...ENDINGS].reverse()) {
  const count = endings.get(ending.key) ?? 0;
  console.log(
    `  ${`${ending.wins}-${ending.losses}`.padStart(5)}  ${ending.label.padEnd(22)}` +
      `${bar(count / GAMES)}  ${((count / GAMES) * 100).toFixed(3).padStart(7)}%`,
  );
}

const drawRng = createRng(0xbadf00d);
const histogram = new Array<number>(ROSTER_SLOTS.length + 1).fill(0);
let gates = 0;
let perfect = 0;
for (let i = 0; i < DRAWS; i++) {
  const spins = drawSpins(pool, drawRng);
  histogram[maxGatedSlotCount(spins, pool, fitted)]!++;
  const verdict = evaluateReachability(spins, pool, fitted);
  if (verdict.gatesReachable) gates++;
  if (verdict.perfectReachable) perfect++;
}

console.log('\nPERFECTION REACHABILITY (omniscient upper bound)\n');
histogram.forEach((count, slots) => {
  console.log(`    ${slots}/7  ${bar(count / DRAWS)}  ${((count / DRAWS) * 100).toFixed(3).padStart(7)}%`);
});
console.log(`\n  gates satisfiable : ${((gates / DRAWS) * 100).toFixed(4)}%`);
console.log(`  ...and score gate : ${((perfect / DRAWS) * 100).toFixed(4)}%  ${perfect ? `(1 in ${Math.round(DRAWS / perfect).toLocaleString()})` : '(none observed)'}`);

if (WRITE) {
  const target = resolve(dirname(fileURLToPath(import.meta.url)), '../../../domain/src/constants/calibration.generated.ts');
  writeFileSync(
    target,
    `import type { CalibrationAnchor } from './config.js';\n\n` +
      `/**\n * GENERATED by \`pnpm --filter @18-0/data analyze -- --write\`. Do not hand-edit.\n *\n` +
      ` * Fitted ${new Date().toISOString().slice(0, 10)} against ${GAMES.toLocaleString()} games simulated on the\n` +
      ` * real ${DATASET.coverage.firstSeason}-${DATASET.coverage.lastSeason} dataset (${DATASET.cards.length.toLocaleString()} cards).\n` +
      ` * Regenerating changes every future score, so bump the model version with it.\n */\n` +
      `export const GENERATED_CALIBRATION_ANCHORS: readonly CalibrationAnchor[] = [\n` +
      curve.map((a) => `  { raw: ${a.raw}, final: ${a.final} },`).join('\n') +
      `\n];\n`,
  );
  console.log(`\n  written -> ${target}`);
}
console.log('');
