import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  DEFAULT_SCORING_CONFIG,
  ROSTER_SLOTS,
  eligibleSlotsFor,
  isRosterComplete,
  openSlots,
  scoreRoster,
  spinHasPlayableOption,
  validateSelection,
  type CompletedRoster,
  type EraKey,
  type GameResult,
  type PartialRoster,
  type RosterSlot,
  type SpinResult,
} from '@18-0/domain';
import { DATASET, eligibleCards, toRatedSeason, type DatasetCard } from '@18-0/data';

/**
 * The gameplay state machine (PRFAQ §29), persisted so an in-progress game
 * survives the app being killed.
 *
 * Everything here is local: the dataset is bundled, so a spin, an eligible
 * list and a final rating never touch the network.
 */
export type GameStatus = 'idle' | 'ready_to_spin' | 'spun' | 'complete';

interface StoredSelection {
  readonly slot: RosterSlot;
  readonly cardId: string;
  readonly spinSequence: number;
}

interface GameState {
  status: GameStatus;
  spins: SpinResult[];
  selections: StoredSelection[];
  startedAt: number | null;
  result: GameResult | null;

  startGame: () => void;
  spin: () => SpinResult | null;
  select: (card: DatasetCard, slot: RosterSlot) => { ok: true } | { ok: false; message: string };
  removeSelection: (slot: RosterSlot) => void;
  complete: () => GameResult | null;
  abandon: () => void;
}

const cardIndex = new Map(DATASET.cards.map((c) => [c.id, c]));
export const lookupCard = (id: string): DatasetCard | undefined => cardIndex.get(id);

/** Rebuilds the domain roster from the stored card ids. */
export function rosterFrom(selections: readonly StoredSelection[]): PartialRoster {
  const roster: Record<string, unknown> = {};
  for (const selection of selections) {
    const card = cardIndex.get(selection.cardId);
    if (!card) continue;
    roster[selection.slot] = {
      slot: selection.slot,
      season: toRatedSeason(card),
      spinSequence: selection.spinSequence,
    };
  }
  return roster as PartialRoster;
}

const MAX_SPIN_ATTEMPTS = 60;

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      status: 'idle',
      spins: [],
      selections: [],
      startedAt: null,
      result: null,

      startGame: () =>
        set({ status: 'ready_to_spin', spins: [], selections: [], startedAt: Date.now(), result: null }),

      spin: () => {
        const { spins, selections, status } = get();
        if (status === 'complete') return null;
        const roster = rosterFrom(selections);

        // Re-spin rather than dead-end when a franchise-era offers nothing for
        // any open slot (PRFAQ §6.3).
        for (let attempt = 0; attempt < MAX_SPIN_ATTEMPTS; attempt++) {
          const combo = DATASET.combos[Math.floor(Math.random() * DATASET.combos.length)]!;
          const cards = eligibleCards(combo.franchiseId, combo.era as EraKey);
          const playable = spinHasPlayableOption(cards.map(toRatedSeason), roster);
          if (!playable) continue;

          const result: SpinResult = {
            sequence: spins.length + 1,
            franchiseId: combo.franchiseId,
            era: combo.era as EraKey,
          };
          set({ spins: [...spins, result], status: 'spun' });
          return result;
        }
        return null;
      },

      select: (card, slot) => {
        const { spins, selections } = get();
        const spin = spins[spins.length - 1];
        if (!spin) return { ok: false, message: 'Spin first.' };

        const validation = validateSelection({
          season: toRatedSeason(card),
          slot,
          roster: rosterFrom(selections),
          spin,
        });
        if (!validation.ok) return { ok: false, message: validation.message };

        const next = [...selections, { slot, cardId: card.id, spinSequence: spin.sequence }];
        set({
          selections: next,
          status: next.length === ROSTER_SLOTS.length ? 'complete' : 'ready_to_spin',
        });
        return { ok: true };
      },

      removeSelection: (slot) => {
        const next = get().selections.filter((s) => s.slot !== slot);
        set({ selections: next, status: next.length === 0 ? 'ready_to_spin' : 'ready_to_spin', result: null });
      },

      complete: () => {
        const roster = rosterFrom(get().selections);
        if (!isRosterComplete(roster)) return null;
        const result = scoreRoster(roster as CompletedRoster, DEFAULT_SCORING_CONFIG);
        set({ result, status: 'complete' });
        return result;
      },

      abandon: () => set({ status: 'idle', spins: [], selections: [], startedAt: null, result: null }),
    }),
    {
      name: '18-0.game',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        status: s.status,
        spins: s.spins,
        selections: s.selections,
        startedAt: s.startedAt,
        result: s.result,
      }),
    },
  ),
);

// --- selectors -------------------------------------------------------------

export const currentSpin = (s: GameState): SpinResult | null => s.spins[s.spins.length - 1] ?? null;

export const filledSlots = (s: GameState): Set<RosterSlot> => new Set(s.selections.map((x) => x.slot));

export const openSlotsOf = (s: GameState): RosterSlot[] => openSlots(rosterFrom(s.selections));

/** Which slots this card may legally fill right now. */
export function slotsForCard(card: DatasetCard, selections: readonly StoredSelection[]): RosterSlot[] {
  return eligibleSlotsFor(toRatedSeason(card), rosterFrom(selections));
}

export const hasGameInProgress = (s: GameState): boolean =>
  s.status !== 'idle' && s.selections.length < ROSTER_SLOTS.length;
