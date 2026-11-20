import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { TV_PREFS_DEFAULTS, TV_PREFS_VERSION, migrateTVPrefs, restoreTVPrefs, type StoredTVPrefs } from '@/state/restore';

/**
 * The Apple TV's own preferences, remembered across launches.
 *
 * - `sound`: the effects in `sound.ts`. On by default -- a TV is a room
 *   speaker and the game reads flat without them -- and one switch away.
 * - `broadcast`: the broadcast graphics package (`features/tv/hud`): scorebug,
 *   lower thirds, the full-screen record. On by default: a game on a
 *   television is already a broadcast, and the owner wanted it to look like one.
 * - `broadcastChosen`: the Broadcast mode switch has been pressed on this TV,
 *   so the setting is a decision rather than a default. A later change of
 *   default follows only the TVs that never chose (`restoreTVPrefs`).
 * - `cleanFeed`: with broadcast on, hides the app's own chrome (the rail, the
 *   account disc, the remote hints) so only the game and the graphics are in
 *   the picture.
 * - `ticker`: the crawl along the foot of the broadcast frame.
 *
 * Display only, all of it. None of these reaches a score, a spin or a board
 * (invariant 1 and 2): they decide what is drawn and heard, nothing else.
 */
interface TVPrefs extends StoredTVPrefs {
  set: (patch: Partial<StoredTVPrefs>) => void;
}

export const useTVPrefs = create<TVPrefs>()(
  persist(
    (set) => ({
      ...TV_PREFS_DEFAULTS,
      set: (patch) => set(patch),
    }),
    {
      name: '17-0.tv-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      // Version 1 made broadcast mode the default. Read through the same
      // launch-time validation as every other store (state/restore.ts): a
      // half-written or foreign value falls back to its default, never reaches
      // a screen as a string where a switch expects a boolean.
      version: TV_PREFS_VERSION,
      migrate: (persisted, version) => migrateTVPrefs(persisted, version) as TVPrefs,
      merge: (persisted, current) => ({ ...current, ...restoreTVPrefs(persisted) }),
      partialize: ({ set: _set, ...rest }) => rest,
    },
  ),
);
