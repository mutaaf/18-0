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
  // Added when the 1980s and 1990s came in and every pool got deeper: the
  // configs above straddle the published 1-in-6,000 without landing near it.
  { label: 'score 98.75 / 94 / 96', score: 98.75, universal: 94, qbDef: 96, eliteRating: 96, eliteCount: 4 },
  { label: 'score 98.9 / 94 / 96', score: 98.9, universal: 94, qbDef: 96, eliteRating: 96, eliteCount: 4 },
  { label: 'score 99.0 / 94 / 96', score: 99.0, universal: 94, qbDef: 96, eliteRating: 96, eliteCount: 4 },
  { label: 'score 98.75 / 94 / 96 (5 elite)', score: 98.75, universal: 94, qbDef: 96, eliteRating: 96, eliteCount: 5 },
  { label: 'score 98.5 / 94 / 96 (5 elite)', score: 98.5, universal: 94, qbDef: 96, eliteRating: 96, eliteCount: 5 },
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

// ---------------------------------------------------------------------------
// The shipped gates, and whether the front page is still true
// ---------------------------------------------------------------------------

/**
 * The config the app actually ships, read from the config rather than matched
 * by label against the candidate list above. A candidate whose numbers happen
 * to equal the shipped ones is a coincidence that stops being true the moment
 * somebody retunes.
 */
const shipped: Candidate = {
  label: 'SHIPPED',
  score: config.perfection.minFinalRating,
  universal: config.perfection.universalSlotMinimum,
  qbDef: Math.max(
    config.perfection.slotMinimums.QB ?? 0,
    config.perfection.slotMinimums.DEF ?? 0,
  ),
  eliteRating: config.perfection.eliteCount.minRating,
  eliteCount: config.perfection.eliteCount.minCount,
};

/** Where 17-1 begins, taken from the record bands rather than restated. */
const heartbreakFloor = config.recordBands
  .filter((b) => b.endingKey === 'HEARTBREAK')
  .map((b) => b.minRating)[0] ?? 96.5;

const perfectCount = samples.filter((s) => passes(s, shipped)).length;
const heartbreakCount = samples.filter(
  (s) => s.final >= heartbreakFloor && !passes(s, shipped),
).length;
const perfectOneIn = perfectCount ? Math.round(GAMES / perfectCount) : Infinity;
const heartbreakOneIn = heartbreakCount ? Math.round(GAMES / heartbreakCount) : Infinity;

console.log(`SHIPPED GATES  (model ${config.version})\n`);
console.log(
  `  score ${shipped.score} / ${shipped.universal} / ${shipped.qbDef}` +
    `, ${shipped.eliteCount} at ${shipped.eliteRating}+`,
);
console.log(`  18-0   ${perfectCount} of ${GAMES.toLocaleString()}   1 in ${perfectOneIn.toLocaleString()}`);
console.log(`  17-1   ${heartbreakCount} of ${GAMES.toLocaleString()}   1 in ${heartbreakOneIn.toLocaleString()}`);
console.log('');

/**
 * The published claim, asserted rather than printed.
 *
 * The README, the home screen and the stats screen all say 18-0 lands about
 * once every 6,000 games and 17-1 about once every 49. Those are a function of
 * the card pool, and the pool has grown twice in a month -- each time silently
 * falsifying them until somebody happened to measure. The last drift was a
 * factor of four.
 *
 * The sample is seeded, so this is a fixed number for a given dataset rather
 * than something that can flake. The bands are wide enough to survive the
 * ~1.4x spread between this harness and `analyze` (see docs/scoring-model.md)
 * and the coarseness of a smaller `--games`, and tight enough that a real
 * drift cannot hide: at 400,000 games the shipped gates read 1 in 5,797.
 *
 * Retuning is two steps in order -- `analyze --write` refits the curve, which
 * governs 17-1, then `tune` picks the gates, which govern 18-0 -- and then the
 * copy has to move with them, or this fails again for the right reason.
 */
const BANDS = {
  perfect: { min: 4_000, max: 9_000, claim: 'about once every 6,000 games' },
  heartbreak: { min: 33, max: 83, claim: 'about once every 49' },
};

if (args.has('assert')) {
  const failures: string[] = [];
  if (perfectOneIn < BANDS.perfect.min || perfectOneIn > BANDS.perfect.max) {
    failures.push(
      `18-0 is 1 in ${perfectOneIn.toLocaleString()}, outside ` +
        `${BANDS.perfect.min.toLocaleString()}-${BANDS.perfect.max.toLocaleString()}. ` +
        `The app says ${BANDS.perfect.claim}.`,
    );
  }
  if (heartbreakOneIn < BANDS.heartbreak.min || heartbreakOneIn > BANDS.heartbreak.max) {
    failures.push(
      `17-1 is 1 in ${heartbreakOneIn.toLocaleString()}, outside ` +
        `${BANDS.heartbreak.min}-${BANDS.heartbreak.max}. The app says ${BANDS.heartbreak.claim}.`,
    );
  }
  if (failures.length > 0) {
    console.error('RARITY OUT OF BAND\n');
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\n  Either retune the gates and the calibration curve, or change the copy.\n' +
        '  Both live together: README.md, the home screen and the stats screen.\n',
    );
    process.exit(1);
  }
  console.log('  Published rarity holds.\n');
}
