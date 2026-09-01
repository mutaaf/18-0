/**
 * Fits the calibration curve (PRFAQ §17, §18).
 *
 * Plays a large population of plausible games, then maps the empirical raw-score
 * percentiles onto the published rating distribution. Because the curve is
 * piecewise-linear through percentile anchors, the resulting final ratings match
 * the target table by construction — and the curve stays inspectable.
 *
 *   pnpm calibrate -- --games=1000000 --leagues=4 --write
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_SCORING_CONFIG,
  ENDINGS,
  calibrate,
  computeBaseRating,
  computeChemistry,
  computeEliteDepthBonus,
  computeWeakLinkPenalty,
  endingForRating,
  type CalibrationAnchor,
} from '../../index.js';
import { createRng } from '../rng.js';
import { buildPool } from '../pool.js';
import { drawSkill, expectedBestByPosition, playGame } from '../play.js';
import { bar, percentile } from '../stats.js';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k!, v ?? 'true'] as const;
  }),
);
const num = (key: string, fallback: number) => Number(args.get(key) ?? fallback);

const GAMES = num('games', 400_000);
const LEAGUES = num('leagues', 4);
const SEED = num('seed', 1);
const WRITE = args.get('write') === 'true';
const config = DEFAULT_SCORING_CONFIG;

/**
 * Target distribution. The 50th percentile upward comes straight from PRFAQ
 * §18; the lower anchors are chosen so the full ending taxonomy is actually
 * inhabited rather than decorative.
 */
const TARGETS: readonly (readonly [percentile: number, finalRating: number])[] = [
  [0.5, 58],
  [2, 64],
  [5, 68],
  [10, 71.5],
  [25, 76],
  [50, 80],
  [75, 87],
  [90, 92],
  [95, 95],
  [99, 97.5],
  [99.9, 99],
  [99.99, 99.35],
];



console.log('\n18-0 — CALIBRATION FIT\n' + '='.repeat(72));
console.log(`model ${config.version} · ${LEAGUES} leagues × ${GAMES.toLocaleString()} games\n`);

const raws: number[] = [];
const started = Date.now();

for (let league = 0; league < LEAGUES; league++) {
  const seed = SEED + league * 104_729;
  const pool = buildPool(seed);
  const baseline = expectedBestByPosition(pool);
  const rng = createRng(seed ^ 0x2545f491);

  for (let i = 0; i < GAMES; i++) {
    const { roster } = playGame(pool, rng, drawSkill(rng), config, baseline);
    const raw =
      computeBaseRating(roster, config) -
      computeWeakLinkPenalty(roster, config).total +
      computeEliteDepthBonus(roster, config).bonus +
      computeChemistry(roster, config).bonus;
    raws.push(raw);
  }
  process.stdout.write(`  league ${league + 1}/${LEAGUES} played\r`);
}

raws.sort((a, b) => a - b);
console.log(`  ${raws.length.toLocaleString()} rosters simulated in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

console.log('RAW SCORE PERCENTILES\n');
console.log('  percentile        raw   ->   target final');
const anchors: CalibrationAnchor[] = [];
for (const [p, target] of TARGETS) {
  const raw = percentile(raws, p);
  console.log(`  ${String(p).padStart(7)}th ${raw.toFixed(3).padStart(11)}   ->   ${target.toFixed(2).padStart(11)}`);
  const previous = anchors[anchors.length - 1];
  // Strictly ascending raw values keep the curve invertible.
  if (previous && raw <= previous.raw) continue;
  anchors.push({ raw: Number(raw.toFixed(4)), final: target });
}

// Endpoints: below the observed floor the score bottoms out; above the observed
// ceiling it approaches, but only a flawless roster reaches, 100.
const lowest = anchors[0]!;
const highest = anchors[anchors.length - 1]!;
const curve: CalibrationAnchor[] = [
  { raw: Number((lowest.raw - 25).toFixed(4)), final: 30 },
  ...anchors,
  { raw: Number((raws[raws.length - 1]! + 0.5).toFixed(4)), final: 99.6 },
  { raw: 100, final: 100 },
].filter((anchor, index, all) => index === 0 || anchor.raw > all[index - 1]!.raw);

console.log('\nFITTED CURVE\n');
for (const anchor of curve) {
  console.log(`  raw ${anchor.raw.toFixed(4).padStart(9)}  ->  final ${anchor.final.toFixed(2).padStart(7)}`);
}

// --- Verify against the fitted curve ---------------------------------------
const fitted = { ...config, calibration: { anchors: curve } };
const finals = raws.map((raw) => calibrate(raw, fitted)).sort((a, b) => a - b);

console.log('\nVERIFICATION\n');
console.log('  percentile    fitted    target     delta');
for (const [p, target] of TARGETS) {
  const actual = percentile(finals, p);
  console.log(
    `  ${String(p).padStart(7)}th ${actual.toFixed(2).padStart(10)}${target.toFixed(2).padStart(10)}` +
      `${(actual - target).toFixed(2).padStart(10)}`,
  );
}

console.log('\nRESULTING ENDING DISTRIBUTION\n');
const counts = new Map<string, number>();
for (const value of finals) {
  const key = endingForRating(value, fitted).key;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
for (const ending of [...ENDINGS].reverse()) {
  const count = counts.get(ending.key) ?? 0;
  const share = count / finals.length;
  console.log(
    `  ${`${ending.wins}-${ending.losses}`.padStart(5)}  ${ending.label.padEnd(22)}` +
      `${bar(share)}  ${(share * 100).toFixed(3).padStart(7)}%  ${count.toLocaleString().padStart(9)}`,
  );
}
console.log('\n  note: 18-0 here counts rosters that cleared the SCORE only.');
console.log('        The perfection gates decide how many of those actually finish 18-0.\n');

if (WRITE) {
  const target = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../constants/calibration.generated.ts',
  );
  const body = curve
    .map((a) => `  { raw: ${a.raw}, final: ${a.final} },`)
    .join('\n');
  writeFileSync(
    target,
    `import type { CalibrationAnchor } from './config.js';\n\n` +
      `/**\n * GENERATED by \`pnpm calibrate\`. Do not hand-edit.\n *\n` +
      ` * Fitted ${new Date().toISOString().slice(0, 10)} against ${raws.length.toLocaleString()} simulated rosters\n` +
      `(${LEAGUES} leagues, seed ${SEED}).\n` +
      ` * Regenerating changes every future score, so bump the model version with it.\n */\n` +
      `export const GENERATED_CALIBRATION_ANCHORS: readonly CalibrationAnchor[] = [\n${body}\n];\n`,
  );
  console.log(`  written -> ${target}\n`);
}
