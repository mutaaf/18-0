import { create } from 'zustand';
import { DEFAULT_SCORING_CONFIG, ROSTER_SLOTS, type RosterSlot, type ScoringConfig } from '@18-0/domain';

/**
 * Operator weight overrides.
 *
 * Session-scoped and deliberately NOT persisted: a tuning experiment should not
 * quietly become this device's permanent scoring model, and a saved game must
 * always be readable under the model that produced it. Ranked results are
 * scored server-side and ignore these entirely.
 */
interface OverrideState {
  rosterWeights: Partial<Record<RosterSlot, number>>;
  setWeight: (slot: RosterSlot, value: number) => void;
  resetWeights: () => void;
  total: () => number;
  config: () => ScoringConfig;
  isModified: () => boolean;
}

export const useOverrideStore = create<OverrideState>((set, get) => ({
  rosterWeights: {},

  setWeight: (slot, value) =>
    set((s) => ({ rosterWeights: { ...s.rosterWeights, [slot]: value } })),

  resetWeights: () => set({ rosterWeights: {} }),

  total: () =>
    ROSTER_SLOTS.reduce(
      (sum, slot) => sum + (get().rosterWeights[slot] ?? DEFAULT_SCORING_CONFIG.rosterWeights[slot]),
      0,
    ),

  isModified: () => Object.keys(get().rosterWeights).length > 0,

  config: () => {
    const overrides = get().rosterWeights;
    if (Object.keys(overrides).length === 0) return DEFAULT_SCORING_CONFIG;
    return {
      ...DEFAULT_SCORING_CONFIG,
      rosterWeights: Object.fromEntries(
        ROSTER_SLOTS.map((slot) => [slot, overrides[slot] ?? DEFAULT_SCORING_CONFIG.rosterWeights[slot]]),
      ) as ScoringConfig['rosterWeights'],
    };
  },
}));
