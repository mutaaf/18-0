import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { isTV } from '@/features/tv/platform';

/**
 * Frames per tick of the clock. On an Apple TV every other frame: the turf's
 * sheen is a slow ambient sweep, and drawing it sixty times a second was a
 * fifth of the main thread while the remote moved down the play list -- on
 * tvOS the UI thread that runs the focus lift *is* the main thread, so every
 * turf frame was taken from it (docs/apple-tv.md, Performance).
 */
const STRIDE = isTV ? 2 : 1;

/**
 * A shader's clock that only runs while somebody can see it move.
 *
 * Skia's `useClock` is a frame callback that never stops: the turf under the
 * lineup kept a GPU canvas redrawing every frame -- 120 times a second on a
 * ProMotion screen -- for as long as it was mounted. That is the whole play
 * screen, but also the Games tab, which a tab navigator keeps mounted behind
 * whatever is in front of it, and the app sitting in the background. Under
 * Reduce Motion the effects stopped *reading* it, but the callback still ran.
 *
 * This one runs only while the screen is focused, the app is in the
 * foreground and Reduce Motion is off. It counts running time, not wall time,
 * so a field that comes back into view carries on from where it was rather
 * than jumping -- and the floodlights do not flicker on again.
 *
 * Imported only from `effects/`, after Skia has loaded; it does not import
 * Skia itself (see `gpu.test.ts`), so it would be safe anywhere.
 */
export function useEffectClock() {
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(() => AppState.currentState !== 'background');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) =>
      setForeground(state === 'active'),
    );
    return () => subscription.remove();
  }, []);

  const clock = useSharedValue(0);
  const pending = useSharedValue(0);
  const frame = useSharedValue(0);
  const frames = useFrameCallback((info) => {
    'worklet';
    // Capped, because the first frame after a resume can report the whole
    // pause as one step, and a sweep that leaps half a field reads as a glitch.
    pending.value += Math.min(info.timeSincePreviousFrame ?? 0, 100);
    // Only a change of `clock` redraws a canvas, so it moves every STRIDE frames.
    frame.value += 1;
    if (frame.value % STRIDE === 0) {
      clock.value += pending.value;
      pending.value = 0;
    }
  }, false);

  const running = !reduced && focused && foreground;
  useEffect(() => {
    frames.setActive(running);
  }, [running, frames]);

  return { clock, reduced };
}
