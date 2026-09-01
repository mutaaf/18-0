import { ROSTER_SLOTS, SLOT_POSITION, type Archetype, type CompletedRoster, type RosterSlot } from '../types.js';

/**
 * Deterministic fixture games (PRFAQ §38).
 *
 * These exist so the reveal screen, the share card and the E2E suite can be
 * driven to a known ending without playing a real game. Every expectation here
 * is asserted against the live scoring model, so a recalibration that moves a
 * fixture off its ending fails the build rather than shipping quietly.
 */

export interface FixtureSlot {
  readonly rating: number;
  readonly name: string;
  readonly franchise: string;
  readonly season: number;
  readonly archetypes?: readonly Archetype[];
}

export interface RosterFixture {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly expectedRecord: readonly [wins: number, losses: number];
  readonly expectedEndingKey: string;
  readonly slots: Readonly<Record<RosterSlot, FixtureSlot>>;
}

const slot = (
  rating: number,
  name: string,
  franchise: string,
  season: number,
  archetypes?: readonly Archetype[],
): FixtureSlot => ({ rating, name, franchise, season, ...(archetypes ? { archetypes } : {}) });

export const ROSTER_FIXTURES: readonly RosterFixture[] = [
  {
    key: 'weak',
    label: 'Weak roster',
    description: 'Seven Pro Bowl-caliber seasons and nothing more.',
    expectedRecord: [6, 12],
    expectedEndingKey: 'UNDERACHIEVER',
    slots: {
      QB: slot(89.1, 'Fixture QB', 'atl', 1994),
      RB1: slot(87.1, 'Fixture RB1', 'atl', 1993),
      RB2: slot(85.3, 'Fixture RB2', 'chi', 1988),
      WR1: slot(88.6, 'Fixture WR1', 'nyj', 1999),
      WR2: slot(86.4, 'Fixture WR2', 'cle', 1986),
      TE1: slot(85.8, 'Fixture TE1', 'det', 1997),
      DEF: slot(88.3, 'Fixture Defense', 'phi', 1991),
    },
  },
  {
    key: 'average',
    label: 'Average roster',
    description: 'Seven First-Team All-Pro seasons — the median build.',
    expectedRecord: [9, 9],
    expectedEndingKey: 'AVERAGE',
    slots: {
      QB: slot(94.8, 'Fixture QB', 'buf', 1991),
      RB1: slot(92.8, 'Fixture RB1', 'dal', 1993),
      RB2: slot(91.0, 'Fixture RB2', 'no', 1988),
      WR1: slot(94.3, 'Fixture WR1', 'min', 1998),
      WR2: slot(92.1, 'Fixture WR2', 'ind', 2004),
      TE1: slot(91.5, 'Fixture TE1', 'kc', 2000),
      DEF: slot(94.0, 'Fixture Defense', 'nyg', 1990),
    },
  },
  {
    key: 'playoff',
    label: 'Playoff roster',
    description: 'All-time elite across the board, with a soft RB2.',
    expectedRecord: [12, 6],
    expectedEndingKey: 'PLAYOFF_TEAM',
    slots: {
      QB: slot(97.6, 'Fixture QB', 'sf', 1989),
      RB1: slot(95.6, 'Fixture RB1', 'det', 1997),
      RB2: slot(93.8, 'Fixture RB2', 'chi', 1977),
      WR1: slot(97.1, 'Fixture WR1', 'sf', 1987),
      WR2: slot(94.9, 'Fixture WR2', 'min', 1998),
      TE1: slot(94.3, 'Fixture TE1', 'kc', 2004),
      DEF: slot(96.8, 'Fixture Defense', 'pit', 1976),
    },
  },
  {
    key: 'championship',
    label: 'Championship-caliber roster',
    description: 'One rung below a dynasty; the middle of the roster gives it away.',
    expectedRecord: [15, 3],
    expectedEndingKey: 'CHAMPIONSHIP_CALIBER',
    slots: {
      QB: slot(98.8, 'Fixture QB', 'ne', 2007),
      RB1: slot(96.8, 'Fixture RB1', 'det', 1997),
      RB2: slot(95.0, 'Fixture RB2', 'was', 1983),
      WR1: slot(98.3, 'Fixture WR1', 'sf', 1987),
      WR2: slot(96.1, 'Fixture WR2', 'min', 1998),
      TE1: slot(95.5, 'Fixture TE1', 'kc', 2004),
      DEF: slot(98.0, 'Fixture Defense', 'chi', 1985),
    },
  },
  {
    key: 'dynasty',
    label: 'Dynasty roster',
    description: 'Elite everywhere, still short of the perfection floors.',
    expectedRecord: [16, 2],
    expectedEndingKey: 'DYNASTY',
    slots: {
      QB: slot(99.5, 'Fixture QB', 'ne', 2007),
      RB1: slot(97.5, 'Fixture RB1', 'det', 1997),
      RB2: slot(95.7, 'Fixture RB2', 'was', 1983),
      WR1: slot(99.0, 'Fixture WR1', 'sf', 1987),
      WR2: slot(96.8, 'Fixture WR2', 'min', 1998),
      TE1: slot(96.2, 'Fixture TE1', 'kc', 2004),
      DEF: slot(98.7, 'Fixture Defense', 'chi', 1985),
    },
  },
  {
    key: 'heartbreak',
    label: 'Heartbreak roster',
    description: '17-1 on score alone — it never reached the 18-0 threshold.',
    expectedRecord: [17, 1],
    expectedEndingKey: 'HEARTBREAK',
    slots: {
      QB: slot(99.9, 'Fixture QB', 'ne', 2007),
      RB1: slot(98.5, 'Fixture RB1', 'det', 1997),
      RB2: slot(96.7, 'Fixture RB2', 'was', 1983),
      WR1: slot(99.9, 'Fixture WR1', 'sf', 1987),
      WR2: slot(97.8, 'Fixture WR2', 'min', 1998),
      TE1: slot(97.2, 'Fixture TE1', 'kc', 2004),
      DEF: slot(99.7, 'Fixture Defense', 'chi', 1985),
    },
  },
  {
    key: 'perfection_denied',
    label: 'Perfection denied',
    description: 'Cleared the 18-0 score, then failed a gate at RB2. The PERFECTION DENIED state.',
    expectedRecord: [17, 1],
    expectedEndingKey: 'HEARTBREAK',
    slots: {
      QB: slot(100, 'Fixture QB', 'ne', 2007),
      RB1: slot(100, 'Fixture RB1', 'det', 1997),
      RB2: slot(95.5, 'Fixture RB2', 'was', 1983),
      WR1: slot(100, 'Fixture WR1', 'sf', 1987),
      WR2: slot(100, 'Fixture WR2', 'min', 1998),
      TE1: slot(100, 'Fixture TE1', 'kc', 2004),
      DEF: slot(100, 'Fixture Defense', 'chi', 1985),
    },
  },
  {
    key: 'perfect',
    label: 'Perfect roster',
    description: 'Every gate cleared. 18-0. IMMORTAL.',
    expectedRecord: [18, 0],
    expectedEndingKey: 'PERFECT',
    slots: {
      QB: slot(99.9, 'Fixture QB', 'ne', 2007),
      RB1: slot(99.9, 'Fixture RB1', 'det', 1997),
      RB2: slot(98.1, 'Fixture RB2', 'was', 1983),
      WR1: slot(99.9, 'Fixture WR1', 'sf', 1987),
      WR2: slot(99.2, 'Fixture WR2', 'min', 1998),
      TE1: slot(98.6, 'Fixture TE1', 'kc', 2004),
      DEF: slot(99.9, 'Fixture Defense', 'chi', 1985),
    },
  },
];

export function fixtureRoster(fixture: RosterFixture): CompletedRoster {
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
            entityType: slotKey === 'DEF' ? 'defense' : 'player',
            displayName: spec.name,
            position: SLOT_POSITION[slotKey],
            franchiseId: spec.franchise,
            seasonYear: spec.season,
            era: `${Math.floor(spec.season / 10) * 10}s` as CompletedRoster['QB']['season']['era'],
            rating: spec.rating,
            archetypes: spec.archetypes ?? [],
            ratingModelVersion: '1.0.0',
          },
        },
      ];
    }),
  ) as CompletedRoster;
}

export function fixtureByKey(key: string): RosterFixture {
  const fixture = ROSTER_FIXTURES.find((f) => f.key === key);
  if (!fixture) throw new Error(`Unknown roster fixture: ${key}`);
  return fixture;
}
