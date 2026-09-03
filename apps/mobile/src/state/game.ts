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
import { DATASET, cardById, eligibleCards, toRatedSeason, type BootCard } from '@18-0/data';

/**
 * The gameplay state machine (PRFAQ §29), persisted so an in-progress game
 * survives the app being killed.
 *
 * Everything here is local: the dataset is bundled, so a spin, an eligible
 * list and a final rating never touch the network.
 */
export type GameStatus = 'idle' | 'ready_to_spin' | 'spun' | 'complete';

/**
 * How much the game tells you.
 *
 * `rookie` shows every rating and stat line — the training wheels that teach
 * what the model values. `player_iq` hides all of it: name, position, franchise
 * and season only. You pick on what you actually know about football, and the
 * numbers are revealed with the result.
 */
export type GameMode = 'rookie' | 'scout' | 'player_iq';

/**
 * What a mode lets you see about a card before you pick it.
 *
 * Three states, so the old `blind` boolean is no longer enough anywhere. These
 * two predicates are the only place the ladder is written down: Rookie shows
 * everything, Scout shows the stat line and withholds the grade, Player IQ
 * withholds both.
 */
export const showsRating = (mode: GameMode): boolean => mode === 'rookie';
export const showsStats = (mode: GameMode): boolean => mode !== 'player_iq';

/**
 * What each mode is called on screen.
 *
 * The stored key stays `player_iq` while the label is GM Mode. The key is
 * written into every ranked row on the server, into the mode check on
 * game_sessions, and into the local history on every device that has already
 * played -- renaming it would invalidate all three to change a word that only
 * ever appears here.
 */
export const MODE_LABEL: Record<GameMode, string> = {
  rookie: 'Rookie',
  scout: 'Scout',
  player_iq: 'GM Mode',
};

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
  mode: GameMode;
  /**
   * True once a rigged spin has been used. Assisted games still save and still
   * show their result — they are just marked, and kept off the leaderboard, so
   * an honest run and a helped one are never confused.
   */
  assisted: boolean;

  /**
   * A ranked game is played against the server: it issues the spins and scores
   * the roster, because a client that could declare either could declare a
   * perfect season. A casual game is entirely local and needs no connection,
   * which is why it stays the default.
   */
  ranked: boolean;
  /** The row in `game_sessions` this game belongs to, once one exists. */
  serverSessionId: string | null;
  /** Replay protection for the completion, minted with the session. */
  serverIdempotencyKey: string | null;
  /** Why a ranked game stopped being ranked, if it did. */
  serverNote: string | null;

  startGame: (mode?: GameMode, options?: { ranked?: boolean }) => void;
  attachServerSession: (id: string, idempotencyKey: string) => void;
  /** Records a spin the server issued, rather than one this device invented. */
  applyServerSpin: (spin: SpinResult, assisted: boolean) => void;
  /**
   * Drop out of ranked and carry on offline.
   *
   * Losing the network mid-game should cost you the leaderboard, not the seven
   * picks you already made.
   */
  downgrade: (note: string) => void;
  spin: (options?: { assist?: boolean }) => SpinResult | null;
  select: (card: BootCard, slot: RosterSlot) => { ok: true } | { ok: false; message: string };
  removeSelection: (slot: RosterSlot) => void;
  complete: () => GameResult | null;
  abandon: () => void;
}

/** Re-exported so screens have one lookup, not two competing indexes. */
export const lookupCard = (id: string): BootCard | undefined => cardById(id);

/** Rebuilds the domain roster from the stored card ids. */
export function rosterFrom(selections: readonly StoredSelection[]): PartialRoster {
  const roster: Record<string, unknown> = {};
  for (const selection of selections) {
    const card = cardById(selection.cardId);
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

/**
 * The three-finger spin.
 *
 * Hold three fingers on the screen while spinning (or Shift-click on a pointer
 * device) and the wheel is rigged: it lands on whichever franchise-era holds
 * the single best card still available for a slot you have not filled.
 *
 * It is a cheat, and the game says so — any run that uses it is flagged
 * `assisted` for the rest of the game, so a rigged 18-0 can never be mistaken
 * for an earned one.
 */
function bestAvailableCombo(roster: PartialRoster): { franchiseId: string; era: EraKey } | null {
  let best: { franchiseId: string; era: EraKey; rating: number } | null = null;

  for (const combo of DATASET.combos) {
    const era = combo.era as EraKey;
    for (const card of eligibleCards(combo.franchiseId, era)) {
      if (card.rating <= (best?.rating ?? -Infinity)) break; // list is rating-sorted
      if (eligibleSlotsFor(toRatedSeason(card), roster).length === 0) continue;
      best = { franchiseId: combo.franchiseId, era, rating: card.rating };
      break;
    }
  }

  return best ? { franchiseId: best.franchiseId, era: best.era } : null;
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      status: 'idle',
      spins: [],
      selections: [],
      startedAt: null,
      result: null,
      mode: 'rookie',
      assisted: false,
      ranked: false,
      serverSessionId: null,
      serverIdempotencyKey: null,
      serverNote: null,

      startGame: (mode, options) =>
        set((state) => ({
          status: 'ready_to_spin',
          spins: [],
          selections: [],
          startedAt: Date.now(),
          result: null,
          assisted: false,
          mode: mode ?? state.mode,
          ranked: options?.ranked ?? false,
          serverSessionId: null,
          serverIdempotencyKey: null,
          serverNote: null,
        })),

      attachServerSession: (id, idempotencyKey) =>
        set({ serverSessionId: id, serverIdempotencyKey: idempotencyKey }),

      applyServerSpin: (spin, assisted) =>
        set((state) => ({
          spins: [...state.spins, spin],
          status: 'spun',
          assisted: state.assisted || assisted,
        })),

      downgrade: (note) =>
        set({ ranked: false, serverSessionId: null, serverIdempotencyKey: null, serverNote: note }),

      spin: (options) => {
        const { spins, selections, status, assisted } = get();
        if (status === 'complete') return null;
        const roster = rosterFrom(selections);

        const land = (franchiseId: string, era: EraKey, rigged: boolean) => {
          const result: SpinResult = { sequence: spins.length + 1, franchiseId, era };
          set({ spins: [...spins, result], status: 'spun', assisted: assisted || rigged });
          return result;
        };

        if (options?.assist) {
          const best = bestAvailableCombo(roster);
          if (best) return land(best.franchiseId, best.era, true);
        }

        // Re-spin rather than dead-end when a franchise-era offers nothing for
        // any open slot (PRFAQ §6.3).
        for (let attempt = 0; attempt < MAX_SPIN_ATTEMPTS; attempt++) {
          const combo = DATASET.combos[Math.floor(Math.random() * DATASET.combos.length)]!;
          const cards = eligibleCards(combo.franchiseId, combo.era as EraKey);
          if (!spinHasPlayableOption(cards.map(toRatedSeason), roster)) continue;
          return land(combo.franchiseId, combo.era as EraKey, false);
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

      abandon: () =>
        set({ status: 'idle', spins: [], selections: [], startedAt: null, result: null, assisted: false }),
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
        assisted: s.assisted,
        mode: s.mode,
      }),
    },
  ),
);

// --- selectors -------------------------------------------------------------

export const currentSpin = (s: GameState): SpinResult | null => s.spins[s.spins.length - 1] ?? null;

export const filledSlots = (s: GameState): Set<RosterSlot> => new Set(s.selections.map((x) => x.slot));

export const openSlotsOf = (s: GameState): RosterSlot[] => openSlots(rosterFrom(s.selections));

/** Which slots this card may legally fill right now. */
export function slotsForCard(card: BootCard, selections: readonly StoredSelection[]): RosterSlot[] {
  return eligibleSlotsFor(toRatedSeason(card), rosterFrom(selections));
}

export const hasGameInProgress = (s: GameState): boolean =>
  s.status !== 'idle' && s.selections.length < ROSTER_SLOTS.length;
