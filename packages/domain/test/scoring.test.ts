import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_CONFIG,
  ROSTER_SLOTS,
  computeBaseRating,
  computeChemistry,
  computeEliteDepthBonus,
  computeWeakLinkPenalty,
  calibrate,
  scoreRoster,
} from '../src/index.js';
import { flatRoster, makeRoster } from './helpers.js';

const config = DEFAULT_SCORING_CONFIG;

describe('roster weighting (PRFAQ §13)', () => {
  it('weights sum to exactly 1', () => {
    const total = ROSTER_SLOTS.reduce((sum, slot) => sum + config.rosterWeights[slot], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('a flat roster scores its own rating', () => {
    expect(computeBaseRating(flatRoster(85), config)).toBeCloseTo(85, 10);
  });

  it('QB carries the most weight', () => {
    const weights = ROSTER_SLOTS.map((s) => config.rosterWeights[s]);
    expect(config.rosterWeights.QB).toBe(Math.max(...weights));
  });

  it('applies the published weights', () => {
    const roster = makeRoster({ QB: 100, RB1: 0, RB2: 0, WR1: 0, WR2: 0, TE1: 0, DEF: 0 });
    expect(computeBaseRating(roster, config)).toBeCloseTo(24, 10);
  });
});

describe('weak-link penalty (PRFAQ §14)', () => {
  it('is zero when every slot clears the threshold', () => {
    expect(computeWeakLinkPenalty(flatRoster(90), config).total).toBe(0);
    expect(computeWeakLinkPenalty(flatRoster(99), config).total).toBe(0);
  });

  it('grows super-linearly with the shortfall', () => {
    const near = computeWeakLinkPenalty(
      makeRoster({ QB: 99, RB1: 99, RB2: 85, WR1: 99, WR2: 99, TE1: 99, DEF: 99 }),
      config,
    ).total;
    const far = computeWeakLinkPenalty(
      makeRoster({ QB: 99, RB1: 99, RB2: 80, WR1: 99, WR2: 99, TE1: 99, DEF: 99 }),
      config,
    ).total;
    // 10 points below is more than twice as bad as 5 points below.
    expect(far).toBeGreaterThan(near * 2);
  });

  it('punishes a weak QB harder than a weak RB2', () => {
    const weakQb = computeWeakLinkPenalty(
      makeRoster({ QB: 80, RB1: 99, RB2: 99, WR1: 99, WR2: 99, TE1: 99, DEF: 99 }),
      config,
    ).total;
    const weakRb2 = computeWeakLinkPenalty(
      makeRoster({ QB: 99, RB1: 99, RB2: 80, WR1: 99, WR2: 99, TE1: 99, DEF: 99 }),
      config,
    ).total;
    expect(weakQb).toBeGreaterThan(weakRb2);
  });

  it('reports the biggest offender first', () => {
    const { detail } = computeWeakLinkPenalty(
      makeRoster({ QB: 88, RB1: 99, RB2: 70, WR1: 99, WR2: 99, TE1: 84, DEF: 99 }),
      config,
    );
    expect(detail.map((d) => d.slot)).toEqual(['RB2', 'TE1', 'QB']);
    expect(detail[0]!.shortfall).toBe(20);
  });

  it('stops six elite picks from hiding one bad slot', () => {
    const clean = scoreRoster(flatRoster(96), config).finalRating;
    const holed = scoreRoster(
      makeRoster({ QB: 99, RB1: 99, RB2: 60, WR1: 99, WR2: 99, TE1: 99, DEF: 99 }),
      config,
    ).finalRating;
    expect(holed).toBeLessThan(clean);
  });
});

describe('elite depth bonus (PRFAQ §15)', () => {
  it('awards nothing to an ordinary roster', () => {
    expect(computeEliteDepthBonus(flatRoster(88), config).bonus).toBe(0);
  });

  it('takes only the highest satisfied tier within a band', () => {
    // 3 at 95+ satisfies the 3+ tier only: +0.25
    const three = makeRoster({ QB: 95, RB1: 95, RB2: 95, WR1: 80, WR2: 80, TE1: 80, DEF: 80 });
    expect(computeEliteDepthBonus(three, config).bonus).toBeCloseTo(0.25, 10);

    // 5 at 95+ satisfies 3+ and 5+ but only 5+ counts: +0.50
    const five = makeRoster({ QB: 95, RB1: 95, RB2: 95, WR1: 95, WR2: 95, TE1: 80, DEF: 80 });
    expect(computeEliteDepthBonus(five, config).bonus).toBeCloseTo(0.5, 10);
  });

  it('sums across the 95 and 98 bands', () => {
    // 7 at 95+ (0.75) and 5 at 98+ (0.40)
    const stacked = makeRoster({ QB: 98, RB1: 98, RB2: 98, WR1: 98, WR2: 98, TE1: 95, DEF: 95 });
    const detail = computeEliteDepthBonus(stacked, config);
    expect(detail.countAt95).toBe(7);
    expect(detail.countAt98).toBe(5);
    expect(detail.bonus).toBeCloseTo(1.15, 10);
  });

  it('never exceeds the cap', () => {
    const perfect = computeEliteDepthBonus(flatRoster(100), config);
    expect(perfect.bonus).toBeLessThanOrEqual(config.eliteDepth.cap);
  });
});

describe('chemistry (PRFAQ §16)', () => {
  it('is zero without archetypes', () => {
    expect(computeChemistry(flatRoster(90), config).bonus).toBe(0);
  });

  it('fires deep passer + vertical receiver', () => {
    const roster = makeRoster({
      QB: { rating: 95, archetypes: ['deep_passer'] },
      RB1: 90,
      RB2: 90,
      WR1: { rating: 95, archetypes: ['vertical_receiver'] },
      WR2: 90,
      TE1: 90,
      DEF: 90,
    });
    const detail = computeChemistry(roster, config);
    expect(detail.links.map((l) => l.key)).toContain('DEEP_SHOT');
    expect(detail.bonus).toBeCloseTo(0.35, 10);
  });

  it('requires distinct slots for each clause', () => {
    // One back tagged both power and explosive must not fire the pairing.
    const single = makeRoster({
      QB: 90,
      RB1: { rating: 95, archetypes: ['power_back', 'explosive_back'] },
      RB2: 90,
      WR1: 90,
      WR2: 90,
      TE1: 90,
      DEF: 90,
    });
    expect(computeChemistry(single, config).links.map((l) => l.key)).not.toContain(
      'THUNDER_AND_LIGHTNING',
    );

    const pair = makeRoster({
      QB: 90,
      RB1: { rating: 95, archetypes: ['power_back'] },
      RB2: { rating: 95, archetypes: ['explosive_back'] },
      WR1: 90,
      WR2: 90,
      TE1: 90,
      DEF: 90,
    });
    expect(computeChemistry(pair, config).links.map((l) => l.key)).toContain(
      'THUNDER_AND_LIGHTNING',
    );
  });

  it('stays inside [-1, +1] however many rules fire', () => {
    const everything = makeRoster({
      QB: { rating: 99, archetypes: ['deep_passer', 'precision_passer'] },
      RB1: { rating: 99, archetypes: ['power_back', 'receiving_back'] },
      RB2: { rating: 99, archetypes: ['explosive_back'] },
      WR1: { rating: 99, archetypes: ['vertical_receiver', 'yac_receiver'] },
      WR2: { rating: 99, archetypes: ['possession_receiver'] },
      TE1: { rating: 99, archetypes: ['seam_te'] },
      DEF: { rating: 99, archetypes: ['ball_hawk_defense'] },
    });
    const detail = computeChemistry(everything, config);
    expect(detail.raw).toBeGreaterThan(config.chemistry.max);
    expect(detail.bonus).toBe(config.chemistry.max);
  });

  it('never rescues a materially weak roster', () => {
    const weakWithChemistry = scoreRoster(
      makeRoster({
        QB: { rating: 72, archetypes: ['deep_passer'] },
        RB1: { rating: 72, archetypes: ['power_back'] },
        RB2: { rating: 72, archetypes: ['explosive_back'] },
        WR1: { rating: 72, archetypes: ['vertical_receiver'] },
        WR2: { rating: 72, archetypes: ['yac_receiver'] },
        TE1: { rating: 72, archetypes: ['seam_te'] },
        DEF: { rating: 72, archetypes: ['ball_hawk_defense'] },
      }),
      config,
    );
    const strongNoChemistry = scoreRoster(flatRoster(88), config);
    expect(weakWithChemistry.finalRating).toBeLessThan(strongNoChemistry.finalRating);
  });
});

describe('calibration curve', () => {
  it('is monotonic non-decreasing', () => {
    let previous = -1;
    for (let raw = 30; raw <= 105; raw += 0.1) {
      const value = calibrate(raw, config);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });

  it('clamps to [0, 100]', () => {
    expect(calibrate(-50, config)).toBeGreaterThanOrEqual(0);
    expect(calibrate(500, config)).toBeLessThanOrEqual(100);
  });
});

describe('determinism (PRFAQ §17)', () => {
  it('returns an identical result for the same roster', () => {
    const roster = makeRoster({ QB: 97.3, RB1: 91.2, RB2: 88.4, WR1: 96.1, WR2: 93.7, TE1: 89.9, DEF: 95.2 });
    const a = scoreRoster(roster, config);
    const b = scoreRoster(roster, config);
    expect(a).toEqual(b);
  });

  it('stamps the model version on every result', () => {
    expect(scoreRoster(flatRoster(90), config).ratingModelVersion).toBe(config.version);
  });

  it('is monotonic in every slot', () => {
    for (const slot of ROSTER_SLOTS) {
      const low = flatRoster(85);
      const high = { ...low, [slot]: { ...low[slot], season: { ...low[slot].season, rating: 95 } } };
      expect(scoreRoster(high, config).finalRating).toBeGreaterThan(
        scoreRoster(low, config).finalRating,
      );
    }
  });
});
