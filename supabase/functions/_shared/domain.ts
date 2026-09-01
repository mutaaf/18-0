// src/types.ts
var ROSTER_SLOTS = [
  "QB",
  "RB1",
  "RB2",
  "WR1",
  "WR2",
  "TE1",
  "DEF"
];
var POSITIONS = ["QB", "RB", "WR", "TE", "DEF"];
var SLOT_POSITION = {
  QB: "QB",
  RB1: "RB",
  RB2: "RB",
  WR1: "WR",
  WR2: "WR",
  TE1: "TE",
  DEF: "DEF"
};
var LEGACY_DECADE_KEYS = [
  "1950s",
  "1960s",
  "1970s",
  "1980s",
  "1990s",
  "2000s",
  "2010s",
  "2020s"
];
var ARCHETYPES = [
  "deep_passer",
  "precision_passer",
  "dual_threat_qb",
  "vertical_receiver",
  "possession_receiver",
  "yac_receiver",
  "receiving_back",
  "power_back",
  "explosive_back",
  "seam_te",
  "blocking_te",
  "ball_hawk_defense",
  "pressure_defense",
  "stonewall_defense"
];

// src/constants/calibration.generated.ts
var GENERATED_CALIBRATION_ANCHORS = [
  { raw: 47.6438, final: 30 },
  { raw: 72.6438, final: 58 },
  { raw: 75.6355, final: 64 },
  { raw: 78.1593, final: 68 },
  { raw: 80.5593, final: 71.5 },
  { raw: 84.9471, final: 76 },
  { raw: 89.7299, final: 80 },
  { raw: 92.4101, final: 87 },
  { raw: 93.8919, final: 92 },
  { raw: 94.6406, final: 95 },
  { raw: 95.8853, final: 97.5 },
  { raw: 97.101, final: 99 },
  { raw: 97.9134, final: 99.35 },
  { raw: 99.6357, final: 99.6 },
  { raw: 100, final: 100 }
];

// src/constants/config.ts
var ROSTER_WEIGHTS = {
  QB: 0.24,
  DEF: 0.18,
  WR1: 0.13,
  RB1: 0.12,
  WR2: 0.11,
  TE1: 0.11,
  RB2: 0.11
};
var WEAK_LINK = {
  threshold: 90,
  exponent: 1.35,
  positionFactors: {
    QB: 1.2,
    DEF: 1.1,
    WR1: 1,
    RB1: 1,
    WR2: 0.95,
    TE1: 0.95,
    RB2: 0.95
  },
  // Owned by the calibration harness. See docs/scoring-model.md.
  scale: 0.02
};
var ELITE_DEPTH = {
  bands: [
    [
      { minRating: 95, minCount: 7, bonus: 0.75 },
      { minRating: 95, minCount: 5, bonus: 0.5 },
      { minRating: 95, minCount: 3, bonus: 0.25 }
    ],
    [
      { minRating: 98, minCount: 5, bonus: 0.4 },
      { minRating: 98, minCount: 3, bonus: 0.25 }
    ]
  ],
  cap: 1.25
};
var CHEMISTRY = {
  min: -1,
  max: 1,
  rules: [
    {
      key: "DEEP_SHOT",
      label: "Deep passer + vertical threat",
      value: 0.35,
      all: [
        { slots: ["QB"], archetype: "deep_passer" },
        { slots: ["WR1", "WR2"], archetype: "vertical_receiver" }
      ]
    },
    {
      key: "CHECKDOWN_ENGINE",
      label: "Precision passer + receiving back",
      value: 0.25,
      all: [
        { slots: ["QB"], archetype: "precision_passer" },
        { slots: ["RB1", "RB2"], archetype: "receiving_back" }
      ]
    },
    {
      key: "THUNDER_AND_LIGHTNING",
      label: "Complementary backfield",
      value: 0.2,
      all: [
        { slots: ["RB1", "RB2"], archetype: "power_back" },
        { slots: ["RB1", "RB2"], archetype: "explosive_back" }
      ]
    },
    {
      key: "SEAM_STRETCH",
      label: "Seam tight end in a vertical offense",
      value: 0.2,
      all: [
        { slots: ["TE1"], archetype: "seam_te" },
        { slots: ["QB"], archetype: "deep_passer" }
      ]
    },
    {
      key: "CHAINS_MOVER",
      label: "Possession receiver + precision passer",
      value: 0.15,
      all: [
        { slots: ["WR1", "WR2"], archetype: "possession_receiver" },
        { slots: ["QB"], archetype: "precision_passer" }
      ]
    },
    {
      key: "SHORT_FIELD",
      label: "Ball-hawking defense + explosive offense",
      value: 0.2,
      all: [
        { slots: ["DEF"], archetype: "ball_hawk_defense" },
        { slots: ["WR1", "WR2"], archetype: "yac_receiver" }
      ]
    },
    {
      key: "GROUND_CONTROL",
      label: "Blocking tight end + power back",
      value: 0.15,
      all: [
        { slots: ["TE1"], archetype: "blocking_te" },
        { slots: ["RB1", "RB2"], archetype: "power_back" }
      ]
    },
    {
      key: "ONE_DIMENSIONAL",
      label: "No vertical element anywhere",
      value: -0.3,
      all: [
        { slots: ["QB"], archetype: "precision_passer" },
        { slots: ["WR1", "WR2"], archetype: "possession_receiver" },
        { slots: ["TE1"], archetype: "blocking_te" }
      ]
    },
    {
      key: "NO_SAFETY_VALVE",
      label: "Deep passer with no underneath outlet",
      value: -0.2,
      all: [
        { slots: ["QB"], archetype: "deep_passer" },
        { slots: ["RB1", "RB2"], archetype: "power_back" },
        { slots: ["TE1"], archetype: "blocking_te" }
      ]
    }
  ]
};
var CALIBRATION = {
  anchors: GENERATED_CALIBRATION_ANCHORS
};
var RECORD_BANDS = [
  { minRating: 0, endingKey: "HISTORIC_COLLAPSE" },
  { minRating: 61, endingKey: "ROCK_BOTTOM" },
  { minRating: 63, endingKey: "REBUILD" },
  { minRating: 65, endingKey: "LOST_SEASON" },
  { minRating: 67, endingKey: "BOTTOM_FEEDER" },
  { minRating: 69, endingKey: "STRUGGLING" },
  { minRating: 71, endingKey: "UNDERACHIEVER" },
  { minRating: 73, endingKey: "FRINGE" },
  { minRating: 75, endingKey: "ALMOST_THERE" },
  { minRating: 77, endingKey: "AVERAGE" },
  { minRating: 80, endingKey: "WINNING_SEASON" },
  { minRating: 82.5, endingKey: "WILD_CARD" },
  { minRating: 85, endingKey: "PLAYOFF_TEAM" },
  { minRating: 87.5, endingKey: "CONTENDER" },
  { minRating: 90, endingKey: "ELITE" },
  { minRating: 92.5, endingKey: "CHAMPIONSHIP_CALIBER" },
  { minRating: 94.5, endingKey: "DYNASTY" },
  { minRating: 96.5, endingKey: "HEARTBREAK" },
  { minRating: 98.5, endingKey: "PERFECT" }
];
var PERFECTION = {
  minFinalRating: 98.5,
  slotMinimums: { QB: 96, DEF: 96 },
  universalSlotMinimum: 93,
  eliteCount: { minRating: 96, minCount: 4 },
  deniedEndingKey: "HEARTBREAK"
};
var SCORING_CONFIG_V1 = {
  version: "1.2.0",
  rosterWeights: ROSTER_WEIGHTS,
  weakLink: WEAK_LINK,
  eliteDepth: ELITE_DEPTH,
  chemistry: CHEMISTRY,
  calibration: CALIBRATION,
  recordBands: RECORD_BANDS,
  perfection: PERFECTION
};
var DEFAULT_SCORING_CONFIG = SCORING_CONFIG_V1;
var RATING_MODEL_VERSION = SCORING_CONFIG_V1.version;
var REGISTRY = {
  "1.2.0": SCORING_CONFIG_V1
};
function scoringConfigForVersion(version) {
  const config = REGISTRY[version];
  if (!config) throw new Error(`Unknown rating model version: ${version}`);
  return config;
}

// src/constants/endings.ts
var ENDINGS = [
  { key: "HISTORIC_COLLAPSE", label: "Historic Collapse", tier: "F", wins: 0, losses: 18 },
  { key: "ROCK_BOTTOM", label: "Rock Bottom", tier: "F", wins: 1, losses: 17 },
  { key: "REBUILD", label: "Rebuild", tier: "F", wins: 2, losses: 16 },
  { key: "LOST_SEASON", label: "Lost Season", tier: "D", wins: 3, losses: 15 },
  { key: "BOTTOM_FEEDER", label: "Bottom Feeder", tier: "D", wins: 4, losses: 14 },
  { key: "STRUGGLING", label: "Struggling", tier: "D", wins: 5, losses: 13 },
  { key: "UNDERACHIEVER", label: "Underachiever", tier: "C-", wins: 6, losses: 12 },
  { key: "FRINGE", label: "Fringe", tier: "C", wins: 7, losses: 11 },
  { key: "ALMOST_THERE", label: "Almost There", tier: "C+", wins: 8, losses: 10 },
  { key: "AVERAGE", label: "Average", tier: "B-", wins: 9, losses: 9 },
  { key: "WINNING_SEASON", label: "Winning Season", tier: "B", wins: 10, losses: 8 },
  { key: "WILD_CARD", label: "Wild Card", tier: "B+", wins: 11, losses: 7 },
  { key: "PLAYOFF_TEAM", label: "Playoff Team", tier: "A-", wins: 12, losses: 6 },
  { key: "CONTENDER", label: "Contender", tier: "A", wins: 13, losses: 5 },
  { key: "ELITE", label: "Elite", tier: "A", wins: 14, losses: 4 },
  { key: "CHAMPIONSHIP_CALIBER", label: "Championship Caliber", tier: "A+", wins: 15, losses: 3 },
  { key: "DYNASTY", label: "Dynasty", tier: "S", wins: 16, losses: 2 },
  { key: "HEARTBREAK", label: "Heartbreak", tier: "S+", wins: 17, losses: 1 },
  { key: "PERFECT", label: "Perfect", tier: "IMMORTAL", wins: 18, losses: 0 }
];
var BY_KEY = new Map(ENDINGS.map((e) => [e.key, e]));
function endingByKey(key) {
  const ending = BY_KEY.get(key);
  if (!ending) throw new Error(`Unknown ending key: ${key}`);
  return ending;
}
function endingByWins(wins) {
  const ending = ENDINGS[wins];
  if (!ending) throw new Error(`No ending for win total: ${wins}`);
  return ending;
}
var HEARTBREAK_KEY = "HEARTBREAK";
var PERFECT_KEY = "PERFECT";

// src/game-rules/roster.ts
function openSlots(roster) {
  return ROSTER_SLOTS.filter((slot2) => roster[slot2] === void 0);
}
function filledSlotCount(roster) {
  return ROSTER_SLOTS.length - openSlots(roster).length;
}
function isRosterComplete(roster) {
  return openSlots(roster).length === 0;
}
function rosterEntityIds(roster) {
  const ids = /* @__PURE__ */ new Set();
  for (const slot2 of ROSTER_SLOTS) {
    const selection = roster[slot2];
    if (selection) ids.add(selection.season.entityId);
  }
  return ids;
}
function eligibleSlotsFor(season, roster) {
  if (rosterEntityIds(roster).has(season.entityId)) return [];
  return openSlots(roster).filter((slot2) => SLOT_POSITION[slot2] === season.position);
}
function validateSelection(input) {
  const { season, slot: slot2, roster, spin } = input;
  if (roster[slot2] !== void 0) {
    return { ok: false, reason: "SLOT_ALREADY_FILLED", message: `${slot2} is already filled.` };
  }
  if (SLOT_POSITION[slot2] !== season.position) {
    return {
      ok: false,
      reason: "POSITION_MISMATCH",
      message: `${season.displayName} is a ${season.position} and cannot fill ${slot2}.`
    };
  }
  if (rosterEntityIds(roster).has(season.entityId)) {
    return {
      ok: false,
      reason: "DUPLICATE_ENTITY",
      message: `${season.displayName} is already on this roster.`
    };
  }
  if (season.franchiseId !== spin.franchiseId || season.era !== spin.era) {
    return {
      ok: false,
      reason: "SPIN_MISMATCH",
      message: `${season.displayName} is not eligible for this spin.`
    };
  }
  return { ok: true };
}
function spinHasPlayableOption(eligible, roster) {
  return eligible.some((season) => eligibleSlotsFor(season, roster).length > 0);
}

// src/scoring/base.ts
function computeBaseRating(roster, config) {
  let total = 0;
  for (const slot2 of ROSTER_SLOTS) {
    total += roster[slot2].season.rating * config.rosterWeights[slot2];
  }
  return total;
}
function slotRatings(roster) {
  return Object.fromEntries(
    ROSTER_SLOTS.map((slot2) => [slot2, roster[slot2].season.rating])
  );
}

// src/scoring/weak-link.ts
function computeWeakLinkPenalty(roster, config) {
  const { threshold, exponent, positionFactors, scale } = config.weakLink;
  const detail = [];
  let total = 0;
  for (const slot2 of ROSTER_SLOTS) {
    const rating = roster[slot2].season.rating;
    const shortfall = Math.max(0, threshold - rating);
    if (shortfall === 0) continue;
    const penalty = shortfall ** exponent * positionFactors[slot2] * scale;
    total += penalty;
    detail.push({ slot: slot2, rating, shortfall, penalty });
  }
  detail.sort((a, b) => b.penalty - a.penalty);
  return { total, detail };
}

// src/scoring/elite-depth.ts
function computeEliteDepthBonus(roster, config) {
  const ratings = ROSTER_SLOTS.map((slot2) => roster[slot2].season.rating);
  const countAtLeast = (min) => ratings.filter((r) => r >= min).length;
  let raw = 0;
  for (const band of config.eliteDepth.bands) {
    for (const tier of band) {
      if (countAtLeast(tier.minRating) >= tier.minCount) {
        raw += tier.bonus;
        break;
      }
    }
  }
  const bonus = Math.min(raw, config.eliteDepth.cap);
  return {
    countAt95: countAtLeast(95),
    countAt98: countAtLeast(98),
    bonus,
    cappedAt: raw > config.eliteDepth.cap ? config.eliteDepth.cap : null
  };
}

// src/util/math.ts
function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
var RATING_PRECISION = 4;

// src/scoring/chemistry.ts
function ruleFires(rule, roster) {
  const used = /* @__PURE__ */ new Set();
  const assign = (index) => {
    const clause = rule.all[index];
    if (!clause) return true;
    for (const slot2 of clause.slots) {
      if (used.has(slot2)) continue;
      if (!roster[slot2].season.archetypes.includes(clause.archetype)) continue;
      used.add(slot2);
      if (assign(index + 1)) return true;
      used.delete(slot2);
    }
    return false;
  };
  return assign(0);
}
function computeChemistry(roster, config) {
  const links = [];
  let raw = 0;
  for (const rule of config.chemistry.rules) {
    if (!ruleFires(rule, roster)) continue;
    links.push({ key: rule.key, label: rule.label, value: rule.value });
    raw += rule.value;
  }
  return {
    links,
    raw,
    bonus: clamp(raw, config.chemistry.min, config.chemistry.max)
  };
}

// src/scoring/calibrate.ts
function calibrate(raw, config) {
  const anchors = config.calibration.anchors;
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (!first || !last) throw new Error("Calibration curve has no anchors");
  if (raw <= first.raw) return clamp(first.final, 0, 100);
  if (raw >= last.raw) return clamp(last.final, 0, 100);
  for (let i = 1; i < anchors.length; i++) {
    const lo = anchors[i - 1];
    const hi = anchors[i];
    if (raw > hi.raw) continue;
    const span = hi.raw - lo.raw;
    const t = span === 0 ? 0 : (raw - lo.raw) / span;
    return clamp(lo.final + t * (hi.final - lo.final), 0, 100);
  }
  return clamp(last.final, 0, 100);
}
function assertMonotonicCalibration(config) {
  const anchors = config.calibration.anchors;
  for (let i = 1; i < anchors.length; i++) {
    const lo = anchors[i - 1];
    const hi = anchors[i];
    if (hi.raw <= lo.raw) {
      throw new Error(`Calibration anchors must ascend by raw: ${lo.raw} -> ${hi.raw}`);
    }
    if (hi.final < lo.final) {
      throw new Error(`Calibration must be monotonic: ${lo.final} -> ${hi.final}`);
    }
  }
}

// src/scoring/record.ts
function endingForRating(rating, config) {
  let selected = config.recordBands[0];
  for (const band of config.recordBands) {
    if (rating >= band.minRating) selected = band;
    else break;
  }
  return endingByKey(selected.endingKey);
}

// src/scoring/perfection.ts
function evaluatePerfection(roster, finalRating, config) {
  const { minFinalRating, slotMinimums, universalSlotMinimum, eliteCount } = config.perfection;
  const reachedThreshold = finalRating >= minFinalRating;
  const failedGates = [];
  for (const slot2 of ROSTER_SLOTS) {
    const rating = roster[slot2].season.rating;
    if (rating < universalSlotMinimum) {
      failedGates.push({
        kind: "slot_minimum",
        slot: slot2,
        required: universalSlotMinimum,
        actual: rating,
        message: `${slot2} needed a ${universalSlotMinimum.toFixed(1)} minimum for 18-0 eligibility.`
      });
    }
    const positionFloor = slotMinimums[slot2];
    if (positionFloor !== void 0 && rating < positionFloor) {
      failedGates.push({
        kind: "position_minimum",
        slot: slot2,
        required: positionFloor,
        actual: rating,
        message: `${slot2} needed a ${positionFloor.toFixed(1)} minimum for 18-0 eligibility.`
      });
    }
  }
  const eliteSlots = ROSTER_SLOTS.filter(
    (slot2) => roster[slot2].season.rating >= eliteCount.minRating
  ).length;
  if (eliteSlots < eliteCount.minCount) {
    failedGates.push({
      kind: "elite_count",
      slot: null,
      required: eliteCount.minCount,
      actual: eliteSlots,
      message: `18-0 needs at least ${eliteCount.minCount} positions at ${eliteCount.minRating}+. This roster had ${eliteSlots}.`
    });
  }
  const order = {
    position_minimum: 0,
    slot_minimum: 1,
    elite_count: 2
  };
  failedGates.sort((a, b) => order[a.kind] - order[b.kind] || a.actual - b.actual);
  return {
    eligible: reachedThreshold && failedGates.length === 0,
    reachedThreshold,
    failedGates
  };
}

// src/scoring/score.ts
function scoreRoster(roster, config = DEFAULT_SCORING_CONFIG) {
  const baseRating = computeBaseRating(roster, config);
  const weakLink = computeWeakLinkPenalty(roster, config);
  const elite = computeEliteDepthBonus(roster, config);
  const chemistry = computeChemistry(roster, config);
  const rawTeamRating = baseRating - weakLink.total + elite.bonus + chemistry.bonus;
  const finalRating = roundTo(
    clamp(calibrate(rawTeamRating, config), 0, 100),
    RATING_PRECISION
  );
  const breakdown = {
    baseRating: roundTo(baseRating, RATING_PRECISION),
    weakLinkPenalty: roundTo(weakLink.total, RATING_PRECISION),
    weakLinkDetail: weakLink.detail,
    eliteBonus: roundTo(elite.bonus, RATING_PRECISION),
    eliteDetail: elite,
    chemistryBonus: roundTo(chemistry.bonus, RATING_PRECISION),
    chemistryDetail: chemistry,
    rawTeamRating: roundTo(rawTeamRating, RATING_PRECISION)
  };
  const perfectEligibility = evaluatePerfection(roster, finalRating, config);
  const banded = endingForRating(finalRating, config);
  const ending = banded.key === "PERFECT" && !perfectEligibility.eligible ? endingByKey(config.perfection.deniedEndingKey) : banded;
  return {
    finalRating,
    record: { wins: ending.wins, losses: ending.losses },
    ending,
    breakdown,
    perfectEligibility,
    distanceFromPerfection: roundTo(
      Math.max(0, config.perfection.minFinalRating - finalRating),
      RATING_PRECISION
    ),
    ratingModelVersion: config.version
  };
}
function isPerfectionDenied(result) {
  return result.perfectEligibility.reachedThreshold && !result.perfectEligibility.eligible;
}

// src/fixtures/rosters.ts
var slot = (rating, name, franchise, season, archetypes) => ({ rating, name, franchise, season, ...archetypes ? { archetypes } : {} });
var ROSTER_FIXTURES = [
  {
    key: "weak",
    label: "Weak roster",
    description: "Seven very good starters and nothing more.",
    expectedRecord: [6, 12],
    expectedEndingKey: "UNDERACHIEVER",
    slots: {
      QB: slot(85.2, "Fixture QB", "atl", 1994),
      RB1: slot(83.2, "Fixture RB1", "atl", 1993),
      RB2: slot(81.4, "Fixture RB2", "chi", 1988),
      WR1: slot(84.7, "Fixture WR1", "nyj", 1999),
      WR2: slot(82.5, "Fixture WR2", "cle", 1986),
      TE1: slot(81.9, "Fixture TE1", "det", 1997),
      DEF: slot(84.4, "Fixture Defense", "phi", 1991)
    }
  },
  {
    key: "average",
    label: "Average roster",
    description: "Seven Pro Bowl-caliber seasons \u2014 the median build.",
    expectedRecord: [9, 9],
    expectedEndingKey: "AVERAGE",
    slots: {
      QB: slot(91, "Fixture QB", "buf", 1991),
      RB1: slot(89, "Fixture RB1", "dal", 1993),
      RB2: slot(87.2, "Fixture RB2", "no", 1988),
      WR1: slot(90.5, "Fixture WR1", "min", 1998),
      WR2: slot(88.3, "Fixture WR2", "ind", 2004),
      TE1: slot(87.7, "Fixture TE1", "kc", 2e3),
      DEF: slot(90.2, "Fixture Defense", "nyg", 1990)
    }
  },
  {
    key: "playoff",
    label: "Playoff roster",
    description: "First-Team All-Pro across the board, with a soft RB2.",
    expectedRecord: [12, 6],
    expectedEndingKey: "PLAYOFF_TEAM",
    slots: {
      QB: slot(93.8, "Fixture QB", "sf", 1989),
      RB1: slot(91.8, "Fixture RB1", "det", 1997),
      RB2: slot(90, "Fixture RB2", "chi", 1977),
      WR1: slot(93.3, "Fixture WR1", "sf", 1987),
      WR2: slot(91.1, "Fixture WR2", "min", 1998),
      TE1: slot(90.5, "Fixture TE1", "kc", 2004),
      DEF: slot(93, "Fixture Defense", "pit", 1976)
    }
  },
  {
    key: "championship",
    label: "Championship-caliber roster",
    description: "One rung below a dynasty; the middle of the roster gives it away.",
    expectedRecord: [15, 3],
    expectedEndingKey: "CHAMPIONSHIP_CALIBER",
    slots: {
      QB: slot(95.7, "Fixture QB", "ne", 2007),
      RB1: slot(93.7, "Fixture RB1", "det", 1997),
      RB2: slot(91.9, "Fixture RB2", "was", 1983),
      WR1: slot(95.2, "Fixture WR1", "sf", 1987),
      WR2: slot(93, "Fixture WR2", "min", 1998),
      TE1: slot(92.4, "Fixture TE1", "kc", 2004),
      DEF: slot(94.9, "Fixture Defense", "chi", 1985)
    }
  },
  {
    key: "dynasty",
    label: "Dynasty roster",
    description: "Elite everywhere, still short of the perfection floors.",
    expectedRecord: [16, 2],
    expectedEndingKey: "DYNASTY",
    slots: {
      QB: slot(96.2, "Fixture QB", "ne", 2007),
      RB1: slot(94.2, "Fixture RB1", "det", 1997),
      RB2: slot(92.4, "Fixture RB2", "was", 1983),
      WR1: slot(95.7, "Fixture WR1", "sf", 1987),
      WR2: slot(93.5, "Fixture WR2", "min", 1998),
      TE1: slot(92.9, "Fixture TE1", "kc", 2004),
      DEF: slot(95.4, "Fixture Defense", "chi", 1985)
    }
  },
  {
    key: "heartbreak",
    label: "Heartbreak roster",
    description: "17-1 on score alone \u2014 it never reached the 18-0 threshold.",
    expectedRecord: [17, 1],
    expectedEndingKey: "HEARTBREAK",
    slots: {
      QB: slot(96.7, "Fixture QB", "ne", 2007),
      RB1: slot(94.7, "Fixture RB1", "det", 1997),
      RB2: slot(92.9, "Fixture RB2", "was", 1983),
      WR1: slot(96.2, "Fixture WR1", "sf", 1987),
      WR2: slot(94, "Fixture WR2", "min", 1998),
      TE1: slot(93.4, "Fixture TE1", "kc", 2004),
      DEF: slot(95.9, "Fixture Defense", "chi", 1985)
    }
  },
  {
    key: "perfection_denied",
    label: "Perfection denied",
    description: "Cleared the 18-0 score, then failed the RB2 floor. The PERFECTION DENIED state.",
    expectedRecord: [17, 1],
    expectedEndingKey: "HEARTBREAK",
    slots: {
      QB: slot(99.9, "Fixture QB", "ne", 2007),
      RB1: slot(99.9, "Fixture RB1", "det", 1997),
      RB2: slot(92.4, "Fixture RB2", "was", 1983),
      WR1: slot(99.9, "Fixture WR1", "sf", 1987),
      WR2: slot(99.9, "Fixture WR2", "min", 1998),
      TE1: slot(99.9, "Fixture TE1", "kc", 2004),
      DEF: slot(99.9, "Fixture Defense", "chi", 1985)
    }
  },
  {
    key: "perfect",
    label: "Perfect roster",
    description: "Every gate cleared. 18-0. IMMORTAL.",
    expectedRecord: [18, 0],
    expectedEndingKey: "PERFECT",
    slots: {
      QB: slot(99.9, "Fixture QB", "ne", 2007),
      RB1: slot(99.4, "Fixture RB1", "det", 1997),
      RB2: slot(98.6, "Fixture RB2", "was", 1983),
      WR1: slot(99.9, "Fixture WR1", "sf", 1987),
      WR2: slot(99.1, "Fixture WR2", "min", 1998),
      TE1: slot(98.4, "Fixture TE1", "kc", 2004),
      DEF: slot(99.7, "Fixture Defense", "chi", 1985)
    }
  }
];
function fixtureRoster(fixture) {
  return Object.fromEntries(
    ROSTER_SLOTS.map((slotKey) => {
      const spec = fixture.slots[slotKey];
      return [
        slotKey,
        {
          slot: slotKey,
          spinSequence: ROSTER_SLOTS.indexOf(slotKey) + 1,
          season: {
            id: `fixture-${fixture.key}-${slotKey}`,
            entityId: `fixture-${fixture.key}-${slotKey}-entity`,
            entityType: slotKey === "DEF" ? "defense" : "player",
            displayName: spec.name,
            position: SLOT_POSITION[slotKey],
            franchiseId: spec.franchise,
            seasonYear: spec.season,
            era: `${Math.floor(spec.season / 10) * 10}s`,
            rating: spec.rating,
            archetypes: spec.archetypes ?? [],
            ratingModelVersion: "1.2.0"
          }
        }
      ];
    })
  );
}
function fixtureByKey(key) {
  const fixture = ROSTER_FIXTURES.find((f) => f.key === key);
  if (!fixture) throw new Error(`Unknown roster fixture: ${key}`);
  return fixture;
}

// src/ratings/scale.ts
var COMPONENT_SCALE = [
  { z: -4, score: 20 },
  { z: -3, score: 38 },
  { z: -2, score: 54 },
  { z: -1, score: 66 },
  { z: -0.5, score: 71 },
  { z: 0, score: 75 },
  { z: 0.5, score: 80.5 },
  { z: 1, score: 86 },
  { z: 1.5, score: 90 },
  { z: 2, score: 93 },
  { z: 2.5, score: 95.5 },
  { z: 3, score: 97.3 },
  { z: 3.5, score: 98.5 },
  { z: 4, score: 99.3 },
  { z: 5, score: 99.9 },
  { z: 6, score: 100 }
];
function scoreFromZ(z, anchors = COMPONENT_SCALE) {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (z <= first.z) return first.score;
  if (z >= last.z) return last.score;
  for (let i = 1; i < anchors.length; i++) {
    const lo = anchors[i - 1];
    const hi = anchors[i];
    if (z > hi.z) continue;
    const t = (z - lo.z) / (hi.z - lo.z);
    return lo.score + t * (hi.score - lo.score);
  }
  return last.score;
}
function scoreFromPercentile(percentile) {
  const p = Math.min(Math.max(percentile, 1e-6), 1 - 1e-6);
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pLow = 0.02425;
  let z;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    z = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    z = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    z = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return scoreFromZ(z);
}

// src/ratings/models.ts
var n = (v) => v === void 0 || Number.isNaN(v) ? null : v;
var ratio = (num, den, minDen = 1) => {
  if (num === void 0 || den === void 0 || den < minDen) return null;
  return num / den;
};
var metric = (key, label, extract, higherIsBetter = true) => ({ key, label, extract, higherIsBetter });
var anya = (s) => {
  const { passing_yards, passing_tds, passing_interceptions, attempts, sacks_suffered, sack_yards_lost } = s;
  if (passing_yards === void 0 || attempts === void 0 || attempts < 100) return null;
  const denominator = attempts + (sacks_suffered ?? 0);
  if (denominator <= 0) return null;
  return (passing_yards + 20 * (passing_tds ?? 0) - 45 * (passing_interceptions ?? 0) - (sack_yards_lost ?? 0)) / denominator;
};
var QB_COMPONENTS = [
  {
    key: "passing_efficiency",
    label: "Era-adjusted passing efficiency",
    weight: 0.3,
    metrics: [
      metric("epa_per_dropback", "EPA per dropback", (s) => ratio(s.passing_epa, (s.attempts ?? 0) + (s.sacks_suffered ?? 0), 100)),
      metric("anya", "Adjusted net yards per attempt", anya),
      metric("ypa", "Yards per attempt", (s) => ratio(s.passing_yards, s.attempts, 100))
    ]
  },
  {
    key: "scoring_production",
    label: "Touchdown production",
    weight: 0.15,
    metrics: [
      metric("td_rate", "Touchdown rate", (s) => ratio(s.passing_tds, s.attempts, 100)),
      metric("passing_tds", "Passing touchdowns", (s) => n(s.passing_tds))
    ]
  },
  {
    key: "turnover_avoidance",
    label: "Turnover avoidance",
    weight: 0.15,
    metrics: [
      metric("turnover_rate", "Interception + fumble rate", (s) => {
        const giveaways = (s.passing_interceptions ?? 0) + (s.sack_fumbles_lost ?? 0);
        const r = ratio(giveaways, s.attempts, 100);
        return r === null ? null : -r;
      })
    ]
  },
  {
    key: "passing_volume",
    label: "Total passing value",
    weight: 0.1,
    metrics: [
      metric("total_passing_epa", "Total passing EPA", (s) => n(s.passing_epa)),
      metric("passing_yards", "Passing yards", (s) => n(s.passing_yards))
    ]
  },
  {
    key: "rushing_value",
    label: "Rushing value",
    weight: 0.05,
    metrics: [
      metric("qb_rush_epa", "Rushing EPA", (s) => n(s.rushing_epa)),
      metric("qb_rush_yards", "Rushing yards", (s) => n(s.rushing_yards))
    ]
  },
  {
    key: "sack_avoidance",
    label: "Sack avoidance",
    weight: 0.05,
    metrics: [
      metric("sack_rate", "Sack rate", (s) => {
        const r = ratio(s.sacks_suffered, (s.attempts ?? 0) + (s.sacks_suffered ?? 0), 100);
        return r === null ? null : -r;
      })
    ]
  },
  {
    key: "peak_dominance",
    label: "Peak dominance vs league",
    weight: 0.1,
    metrics: [],
    percentileOf: "epa_per_dropback"
  },
  {
    key: "awards",
    label: "Awards and honors",
    weight: 0.05,
    metrics: [metric("award_share", "Award share", (s) => n(s.award_share))]
  },
  {
    key: "team_success",
    label: "Team offensive success",
    weight: 0.05,
    metrics: [
      metric("team_off_epa", "Team offensive EPA per play", (s) => n(s.team_off_epa_per_play)),
      metric("team_points", "Team points per game", (s) => n(s.team_points_per_game))
    ]
  }
];
var touches = (s) => (s.carries ?? 0) + (s.receptions ?? 0);
var RB_COMPONENTS = [
  {
    key: "rushing_efficiency",
    label: "Era-adjusted rushing efficiency",
    weight: 0.25,
    metrics: [
      metric("rush_epa_per_carry", "Rushing EPA per carry", (s) => ratio(s.rushing_epa, s.carries, 80)),
      metric("ypc", "Yards per carry", (s) => ratio(s.rushing_yards, s.carries, 80))
    ]
  },
  {
    key: "rushing_production",
    label: "Rushing production",
    weight: 0.2,
    metrics: [metric("rushing_yards", "Rushing yards", (s) => n(s.rushing_yards))]
  },
  {
    key: "receiving_value",
    label: "Receiving value",
    weight: 0.15,
    metrics: [
      metric("rb_rec_epa", "Receiving EPA", (s) => n(s.receiving_epa)),
      metric("rb_rec_yards", "Receiving yards", (s) => n(s.receiving_yards))
    ]
  },
  {
    key: "scoring",
    label: "Scoring value",
    weight: 0.1,
    metrics: [
      metric("total_tds", "Total touchdowns", (s) => n((s.rushing_tds ?? 0) + (s.receiving_tds ?? 0)))
    ]
  },
  {
    key: "success_rate",
    label: "First-down conversion",
    weight: 0.1,
    metrics: [
      metric("first_down_rate", "First downs per touch", (s) => ratio((s.rushing_first_downs ?? 0) + (s.receiving_first_downs ?? 0), touches(s), 80))
    ]
  },
  {
    key: "explosive",
    label: "Explosive plays",
    weight: 0.05,
    metrics: [
      metric("explosive_runs", "Runs of 20+ yards", (s) => n(s.rushing_20))
    ]
  },
  {
    key: "ball_security",
    label: "Ball security",
    weight: 0.05,
    metrics: [
      metric("fumble_rate", "Fumbles lost per touch", (s) => {
        const lost = (s.rushing_fumbles_lost ?? 0) + (s.receiving_fumbles_lost ?? 0);
        const r = ratio(lost, touches(s), 80);
        return r === null ? null : -r;
      })
    ]
  },
  {
    key: "peak_dominance",
    label: "Peak dominance",
    weight: 0.05,
    metrics: [],
    percentileOf: "rushing_yards"
  },
  {
    key: "awards",
    label: "Awards and honors",
    weight: 0.05,
    metrics: [metric("award_share", "Award share", (s) => n(s.award_share))]
  }
];
var RECEIVER_COMPONENTS = (peakMetric) => [
  {
    key: "receiving_production",
    label: "Era-adjusted receiving production",
    weight: 0.25,
    metrics: [metric("receiving_yards", "Receiving yards", (s) => n(s.receiving_yards))]
  },
  {
    key: "receiving_efficiency",
    label: "Receiving efficiency",
    weight: 0.2,
    metrics: [
      metric("rec_epa_per_target", "Receiving EPA per target", (s) => ratio(s.receiving_epa, s.targets, 25)),
      metric("yards_per_target", "Yards per target", (s) => ratio(s.receiving_yards, s.targets, 25)),
      metric("yards_per_reception", "Yards per reception", (s) => ratio(s.receiving_yards, s.receptions, 15))
    ]
  },
  {
    key: "td_production",
    label: "Touchdown production",
    weight: 0.15,
    metrics: [metric("receiving_tds", "Receiving touchdowns", (s) => n(s.receiving_tds))]
  },
  {
    key: "first_downs",
    label: "First-down creation",
    weight: 0.1,
    metrics: [
      metric("receiving_first_downs", "Receiving first downs", (s) => n(s.receiving_first_downs))
    ]
  },
  {
    key: "offense_share",
    label: "Share of team offense",
    weight: 0.1,
    metrics: [
      metric("wopr", "Weighted opportunity rating", (s) => n(s.wopr)),
      metric("target_share", "Target share", (s) => n(s.target_share)),
      metric("team_yard_share", "Share of team receiving yards", (s) => ratio(s.receiving_yards, s.team_receiving_yards, 500))
    ]
  },
  {
    key: "explosive",
    label: "Explosive plays",
    weight: 0.05,
    metrics: [metric("explosive_catches", "Catches of 20+ yards", (s) => n(s.receiving_20))]
  },
  {
    key: "catch_efficiency",
    label: "Catch efficiency",
    weight: 0.05,
    metrics: [
      metric("catch_rate", "Catch rate", (s) => ratio(s.receptions, s.targets, 25))
    ]
  },
  {
    key: "peak_dominance",
    label: "Peak dominance",
    weight: 0.05,
    metrics: [],
    percentileOf: peakMetric
  },
  {
    key: "awards",
    label: "Awards and honors",
    weight: 0.05,
    metrics: [metric("award_share", "Award share", (s) => n(s.award_share))]
  }
];
var TE_COMPONENTS = [
  {
    key: "receiving_efficiency",
    label: "Receiving efficiency",
    weight: 0.2,
    metrics: [
      metric("rec_epa_per_target", "Receiving EPA per target", (s) => ratio(s.receiving_epa, s.targets, 20)),
      metric("yards_per_target", "Yards per target", (s) => ratio(s.receiving_yards, s.targets, 20))
    ]
  },
  {
    key: "receiving_production",
    label: "Receiving production",
    weight: 0.2,
    metrics: [metric("receiving_yards", "Receiving yards", (s) => n(s.receiving_yards))]
  },
  {
    key: "td_production",
    label: "Touchdown production",
    weight: 0.1,
    metrics: [metric("receiving_tds", "Receiving touchdowns", (s) => n(s.receiving_tds))]
  },
  {
    key: "positional_dominance",
    label: "Dominance among tight ends",
    weight: 0.2,
    metrics: [],
    percentileOf: "receiving_yards"
  },
  {
    key: "first_downs",
    label: "First-down creation",
    weight: 0.1,
    metrics: [metric("receiving_first_downs", "Receiving first downs", (s) => n(s.receiving_first_downs))]
  },
  {
    key: "blocking",
    label: "Blocking contribution",
    weight: 0.1,
    metrics: [metric("block_grade", "Blocking grade", (s) => n(s.block_grade))]
  },
  {
    key: "peak_dominance",
    label: "Peak dominance",
    weight: 0.05,
    metrics: [],
    percentileOf: "rec_epa_per_target"
  },
  {
    key: "awards",
    label: "Awards and honors",
    weight: 0.05,
    metrics: [metric("award_share", "Award share", (s) => n(s.award_share))]
  }
];
var DEF_COMPONENTS = [
  {
    key: "points_allowed",
    label: "Points allowed",
    weight: 0.2,
    metrics: [
      metric("points_allowed_per_drive", "Points allowed per drive", (s) => {
        const v = n(s.points_allowed_per_drive);
        return v === null ? null : -v;
      }),
      metric("points_allowed_per_game", "Points allowed per game", (s) => {
        const r = ratio(s.points_allowed, s.games, 4);
        return r === null ? null : -r;
      })
    ]
  },
  {
    key: "def_epa",
    label: "Defensive EPA per play",
    weight: 0.2,
    metrics: [
      metric("def_epa_per_play", "EPA allowed per play", (s) => {
        const r = ratio(s.epa_allowed, s.plays_faced, 300);
        return r === null ? null : -r;
      }),
      metric("yards_per_play_allowed", "Yards allowed per play", (s) => {
        const r = ratio(s.yards_allowed, s.plays_faced, 300);
        return r === null ? null : -r;
      })
    ]
  },
  {
    key: "pass_defense",
    label: "Passing defense",
    weight: 0.12,
    metrics: [
      metric("pass_epa_allowed", "Passing EPA allowed per dropback", (s) => {
        const r = ratio(s.pass_epa_allowed, s.dropbacks_faced, 200);
        return r === null ? null : -r;
      }),
      metric("ypa_allowed", "Yards per attempt allowed", (s) => {
        const r = ratio(s.pass_yards_allowed, s.pass_attempts_faced, 200);
        return r === null ? null : -r;
      })
    ]
  },
  {
    key: "rush_defense",
    label: "Rushing defense",
    weight: 0.1,
    metrics: [
      metric("rush_epa_allowed", "Rushing EPA allowed per carry", (s) => {
        const r = ratio(s.rush_epa_allowed, s.carries_faced, 150);
        return r === null ? null : -r;
      }),
      metric("ypc_allowed", "Yards per carry allowed", (s) => {
        const r = ratio(s.rush_yards_allowed, s.carries_faced, 150);
        return r === null ? null : -r;
      })
    ]
  },
  {
    key: "takeaways",
    label: "Turnovers forced",
    weight: 0.1,
    metrics: [
      metric("takeaways", "Takeaways", (s) => n((s.def_interceptions ?? 0) + (s.fumble_recoveries ?? 0)))
    ]
  },
  {
    key: "pressure",
    label: "Sack and pressure production",
    weight: 0.08,
    metrics: [metric("def_sacks", "Sacks", (s) => n(s.def_sacks))]
  },
  {
    key: "red_zone",
    label: "Red-zone defense",
    weight: 0.05,
    metrics: [
      metric("red_zone_td_rate", "Red-zone touchdown rate allowed", (s) => {
        const v = n(s.red_zone_td_rate_allowed);
        return v === null ? null : -v;
      })
    ]
  },
  {
    key: "third_down",
    label: "Third-down defense",
    weight: 0.05,
    metrics: [
      metric("third_down_rate", "Third-down conversion rate allowed", (s) => {
        const v = n(s.third_down_rate_allowed);
        return v === null ? null : -v;
      })
    ]
  },
  {
    key: "era_dominance",
    label: "Era dominance",
    weight: 0.05,
    metrics: [],
    percentileOf: "points_allowed_per_game"
  },
  {
    key: "honors",
    label: "Historical adjustment",
    weight: 0.05,
    metrics: [metric("award_share", "Award share", (s) => n(s.award_share))]
  }
];
var proportional = (base, seasonGames) => base * Math.min(seasonGames, 17) / 17;
var POSITION_MODELS = {
  QB: {
    position: "QB",
    components: QB_COMPONENTS,
    qualifies: (s, g) => (s.games ?? 0) >= proportional(8, g) && (s.attempts ?? 0) >= proportional(180, g)
  },
  RB: {
    position: "RB",
    components: RB_COMPONENTS,
    qualifies: (s, g) => touches(s) >= proportional(100, g)
  },
  WR: {
    position: "WR",
    components: RECEIVER_COMPONENTS("receiving_yards"),
    qualifies: (s, g) => (s.targets ?? 0) >= proportional(40, g)
  },
  TE: {
    position: "TE",
    components: TE_COMPONENTS,
    qualifies: (s, g) => (s.targets ?? 0) >= proportional(30, g)
  },
  DEF: {
    position: "DEF",
    components: DEF_COMPONENTS,
    qualifies: (s) => (s.games ?? 0) >= 8
  }
};
function metricKeysFor(model) {
  const keys = /* @__PURE__ */ new Set();
  for (const component of model.components) {
    for (const m of component.metrics) keys.add(m.key);
    if (component.percentileOf) keys.add(component.percentileOf);
  }
  return [...keys];
}

// src/ratings/context.ts
function extractMetrics(stats, model) {
  const values = /* @__PURE__ */ new Map();
  for (const component of model.components) {
    for (const m of component.metrics) {
      if (!values.has(m.key)) values.set(m.key, m.extract(stats));
    }
  }
  for (const key of metricKeysFor(model)) {
    if (!values.has(key)) values.set(key, null);
  }
  return values;
}
function buildSeasonContext(qualifiedSeasons, minSample = 8) {
  const byMetric = /* @__PURE__ */ new Map();
  for (const season of qualifiedSeasons) {
    for (const [key, value] of season) {
      if (value === null || !Number.isFinite(value)) continue;
      const bucket = byMetric.get(key);
      if (bucket) bucket.push(value);
      else byMetric.set(key, [value]);
    }
  }
  const context = /* @__PURE__ */ new Map();
  for (const [key, values] of byMetric) {
    if (values.length < minSample) continue;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    if (stddev < 1e-9) continue;
    context.set(key, {
      mean,
      stddev,
      count: values.length,
      sorted: [...values].sort((a, b) => a - b)
    });
  }
  return context;
}
function percentileRank(value, distribution) {
  const { sorted } = distribution;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sorted.length;
}

// src/ratings/rate.ts
var RATING_ENGINE_VERSION = "1.0.0";
function rateSeason(stats, model, context) {
  const values = extractMetrics(stats, model);
  const scored = [];
  const unavailable = [];
  for (const component of model.components) {
    if (component.percentileOf) {
      const distribution = context.get(component.percentileOf);
      const value = values.get(component.percentileOf) ?? null;
      if (!distribution || value === null) {
        unavailable.push(component.key);
        continue;
      }
      scored.push({
        key: component.key,
        label: component.label,
        weight: component.weight,
        score: scoreFromPercentile(percentileRank(value, distribution)),
        z: null,
        metricUsed: component.percentileOf,
        value,
        fellBack: false
      });
      continue;
    }
    let matched = false;
    for (let i = 0; i < component.metrics.length; i++) {
      const definition = component.metrics[i];
      const value = values.get(definition.key) ?? null;
      const distribution = context.get(definition.key);
      if (value === null || !distribution) continue;
      const z = (value - distribution.mean) / distribution.stddev;
      scored.push({
        key: component.key,
        label: component.label,
        weight: component.weight,
        score: scoreFromZ(z),
        z,
        metricUsed: definition.key,
        value,
        fellBack: i > 0
      });
      matched = true;
      break;
    }
    if (!matched) unavailable.push(component.key);
  }
  const availableWeight = scored.reduce((sum, c) => sum + c.weight, 0);
  if (availableWeight <= 0) {
    throw new Error("No rating components had data for this season");
  }
  const components = scored.map((c) => ({
    ...c,
    effectiveWeight: c.weight / availableWeight,
    score: roundTo(c.score, 2),
    z: c.z === null ? null : roundTo(c.z, 3)
  }));
  const overall = components.reduce((sum, c) => sum + c.score * c.effectiveWeight, 0);
  return {
    overall: roundTo(clamp(overall, 0, 100), 2),
    components,
    unavailable,
    ratingModelVersion: RATING_ENGINE_VERSION
  };
}

// src/util/curve.ts
function interpolate(x, points) {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) throw new Error("Curve has no points");
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;
  for (let i = 1; i < points.length; i++) {
    const lo = points[i - 1];
    const hi = points[i];
    if (x > hi.x) continue;
    const span = hi.x - lo.x;
    const t = span === 0 ? 0 : (x - lo.x) / span;
    return lo.y + t * (hi.y - lo.y);
  }
  return last.y;
}
function ascending(points) {
  const out = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous && point.x <= previous.x) continue;
    out.push(point);
  }
  return out;
}

// src/ratings/calibration.ts
var PLAYER_RATING_TARGETS = [
  [0, 58],
  [5, 66],
  [15, 70.5],
  [30, 74.5],
  [45, 77.5],
  [60, 80.5],
  [75, 84],
  [85, 87.5],
  [90, 90],
  [94, 92],
  [97, 94.2],
  [99, 96.4],
  [99.5, 97.5],
  [99.9, 98.8],
  [100, 99.7]
];
function percentileOf(sorted, p) {
  if (sorted.length === 0) return NaN;
  const rank = p / 100 * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loValue = sorted[lo];
  return lo === hi ? loValue : loValue + (rank - lo) * (sorted[hi] - loValue);
}
function fitPlayerCalibration(rawRatings, targets = PLAYER_RATING_TARGETS) {
  const sorted = [...rawRatings].sort((a, b) => a - b);
  return ascending(
    targets.map(([percentile, rating]) => ({
      x: roundTo(percentileOf(sorted, percentile), 4),
      y: rating
    }))
  );
}
function applyPlayerCalibration(raw, curve) {
  return roundTo(interpolate(raw, curve), 2);
}
export {
  ARCHETYPES,
  COMPONENT_SCALE,
  DEFAULT_SCORING_CONFIG,
  ENDINGS,
  HEARTBREAK_KEY,
  LEGACY_DECADE_KEYS,
  PERFECT_KEY,
  PLAYER_RATING_TARGETS,
  POSITIONS,
  POSITION_MODELS,
  RATING_ENGINE_VERSION,
  RATING_MODEL_VERSION,
  RATING_PRECISION,
  ROSTER_FIXTURES,
  ROSTER_SLOTS,
  SCORING_CONFIG_V1,
  SLOT_POSITION,
  applyPlayerCalibration,
  ascending,
  assertMonotonicCalibration,
  buildSeasonContext,
  calibrate,
  clamp,
  computeBaseRating,
  computeChemistry,
  computeEliteDepthBonus,
  computeWeakLinkPenalty,
  eligibleSlotsFor,
  endingByKey,
  endingByWins,
  endingForRating,
  evaluatePerfection,
  extractMetrics,
  filledSlotCount,
  fitPlayerCalibration,
  fixtureByKey,
  fixtureRoster,
  interpolate,
  isPerfectionDenied,
  isRosterComplete,
  metricKeysFor,
  openSlots,
  percentileRank,
  rateSeason,
  rosterEntityIds,
  roundTo,
  scoreFromPercentile,
  scoreFromZ,
  scoreRoster,
  scoringConfigForVersion,
  slotRatings,
  spinHasPlayableOption,
  validateSelection
};
