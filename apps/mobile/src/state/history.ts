import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { GameResult, RosterSlot } from '@18-0/domain';

/**
 * Completed games and the profile stats derived from them (PRFAQ §22.5, §22.6).
 *
 * Local-first: an anonymous player keeps a full history without ever signing
 * in. Sync is a later concern, not a gate on playing.
 */
export interface HistoryEntry {
  readonly id: string;
  readonly completedAt: number;
  readonly result: GameResult;
  readonly roster: readonly {
    readonly slot: RosterSlot;
    readonly cardId: string;
    readonly name: string;
    readonly franchiseId: string;
    readonly era: string;
    readonly year: number;
    readonly rating: number;
  }[];
}

interface HistoryState {
  games: HistoryEntry[];
  record: (entry: HistoryEntry) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      games: [],
      record: (entry) => set((s) => ({ games: [entry, ...s.games].slice(0, 500) })),
      remove: (id) => set((s) => ({ games: s.games.filter((g) => g.id !== id) })),
      clear: () => set({ games: [] }),
    }),
    { name: '18-0.history', storage: createJSONStorage(() => AsyncStorage) },
  ),
);

export interface ProfileStats {
  played: number;
  bestRating: number | null;
  bestRecord: { wins: number; losses: number } | null;
  perfectSeasons: number;
  heartbreaks: number;
  averageRating: number | null;
  topFranchise: string | null;
  topEra: string | null;
  bestCard: HistoryEntry['roster'][number] | null;
}

export function computeStats(games: readonly HistoryEntry[]): ProfileStats {
  if (games.length === 0) {
    return {
      played: 0, bestRating: null, bestRecord: null, perfectSeasons: 0,
      heartbreaks: 0, averageRating: null, topFranchise: null, topEra: null, bestCard: null,
    };
  }

  const franchises = new Map<string, number>();
  const eras = new Map<string, number>();
  let bestCard: HistoryEntry['roster'][number] | null = null;
  let ratingTotal = 0;
  let best = games[0]!;

  for (const game of games) {
    ratingTotal += game.result.finalRating;
    if (game.result.finalRating > best.result.finalRating) best = game;
    for (const pick of game.roster) {
      franchises.set(pick.franchiseId, (franchises.get(pick.franchiseId) ?? 0) + 1);
      eras.set(pick.era, (eras.get(pick.era) ?? 0) + 1);
      if (!bestCard || pick.rating > bestCard.rating) bestCard = pick;
    }
  }

  const top = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    played: games.length,
    bestRating: best.result.finalRating,
    bestRecord: best.result.record,
    perfectSeasons: games.filter((g) => g.result.ending.key === 'PERFECT').length,
    heartbreaks: games.filter((g) => g.result.ending.key === 'HEARTBREAK').length,
    averageRating: ratingTotal / games.length,
    topFranchise: top(franchises),
    topEra: top(eras),
    bestCard,
  };
}
