import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * The Apple TV's own preferences, remembered across launches.
 *
 * - `sound`: the effects in `sound.ts`. On by default -- a TV is a room
 *   speaker and the game reads flat without them -- and one switch away.
 * - `broadcast`: the broadcast graphics package (`features/tv/hud`): scorebug,
 *   lower thirds, the full-screen record. For somebody putting the game on a
 *   stream or a podcast.
 * - `cleanFeed`: with broadcast on, hides the app's own chrome (the rail, the
 *   account disc, the remote hints) so only the game and the graphics are in
 *   the picture.
 * - `ticker`: the crawl along the foot of the broadcast frame.
 *
 * Display only, all of it. None of these reaches a score, a spin or a board
 * (invariant 1 and 2): they decide what is drawn and heard, nothing else.
 */
interface TVPrefs {
  sound: boolean;
  broadcast: boolean;
  cleanFeed: boolean;
  ticker: boolean;
  set: (patch: Partial<Omit<TVPrefs, 'set'>>) => void;
}

export const useTVPrefs = create<TVPrefs>()(
  persist(
    (set) => ({
      sound: true,
      broadcast: false,
      cleanFeed: false,
      ticker: true,
      set: (patch) => set(patch),
    }),
    {
      name: '17-0.tv-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ set: _set, ...rest }) => rest,
    },
  ),
);
