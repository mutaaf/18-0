import { forwardRef, useCallback, useState, type ElementRef, type ForwardRefExoticComponent, type ReactNode, type RefAttributes } from 'react';
import {
  Pressable as NativePressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type TargetedEvent,
  type ViewStyle,
} from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { isTV } from '@/features/tv/platform';
import { color, radius, themed } from '@/theme';

/**
 * React Native's Pressable, with the tvOS focus language on a television.
 *
 * On a phone and on the web this *is* React Native's Pressable -- the same
 * component object, not a wrapper -- so nothing there changes.
 *
 * On an Apple TV every Pressable is already a stop for the focus engine; what
 * it lacks is any sign of being the one the remote is on. The first version
 * drew an `outline`, which UIKit paints as a square box whatever the corner
 * radius -- a hard white rectangle laid over every rounded card and pill in
 * the app. This one does what tvOS's own controls do:
 *
 * - **lift**: a spring to a larger scale -- more for a small button than for a
 *   wide row, where 1.1 would crash into the neighbours;
 * - **a rim that follows the shape**: a thin `focusRing` border drawn at the
 *   element's own corner radius, over a faint white wash, so a text button
 *   with no background of its own still reads as a lit pane.
 *
 * Only transform and opacity animate, on the UI thread. There was a shadow
 * and a specular sweep; on a real Apple TV each was an offscreen render pass
 * per frame (see the style below), and they were the remote's lag. A screen that wants another look reads
 * `focused` from the style callback (`PressState`) or passes `tvFocus`:
 * `rim` keeps the rim without the lift (rows inside a clipped list), `none`
 * draws nothing (a control that paints its own focus).
 *
 * **Nothing on the JS thread per focus move** (docs/apple-tv.md, "The fourth
 * pass"). A control that does not read `focused` or `pressed` keeps them out
 * of React state, and the rim is mounted with it (one view, drawn by Core
 * Animation), so a move is two spring targets on the UI thread and no render.
 *
 * `native-imports.test.ts` keeps this the only place that imports React
 * Native's.
 */
type Ref = ElementRef<typeof NativePressable>;

export type TVFocusLook = 'lift' | 'rim' | 'none';

const AnimatedPressable = Animated.createAnimatedComponent(NativePressable);

const SPRING = { damping: 17, stiffness: 260, mass: 0.7, reduceMotion: ReduceMotion.System };

/** Apple's rule of thumb: small things grow more than big ones. */
function liftFor(width: number): number {
  'worklet';
  if (width <= 0) return 1.06;
  if (width < 90) return 1.12;
  if (width < 220) return 1.08;
  if (width < 480) return 1.05;
  return 1.03;
}

function cornerOf(style: ViewStyle): number {
  const r = style.borderRadius ?? style.borderTopLeftRadius ?? style.borderTopStartRadius;
  return typeof r === 'number' ? r : radius.sm;
}

type Props = PressableProps & { tvFocus?: TVFocusLook };

const TVPressable = forwardRef<Ref, Props>(function TVPressable(
  { style, children, tvFocus = 'lift', onFocus, onBlur, onPressIn, onPressOut, onLayout, ...props },
  ref,
) {
  // Focus and press live in React state only for a control that reads them
  // (a style or children callback). Everywhere else a focus move is shared
  // values on the UI thread and nothing on the JS thread: every setState here
  // was a render and a commit per remote press, and a commit lays out and
  // walks the whole shadow tree on the JS thread -- on a
  // real Apple TV, part of the ~300 ms the JS thread was late after every
  // press on the play list (docs/apple-tv.md, "The fourth pass").
  const reads = typeof style === 'function' || typeof children === 'function';
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  // The width picks the lift, read on the UI thread: a state here re-rendered
  // every Pressable once more on mount, and a spin mounts a hundred of them.
  const width = useSharedValue(0);
  const f = useSharedValue(0);
  const p = useSharedValue(0);

  const state = { pressed, focused, hovered: false } as PressableStateCallbackType;
  const own = (StyleSheet.flatten(typeof style === 'function' ? style(state) : style) ?? {}) as ViewStyle;
  const { transform: ownTransform, ...rest } = own;
  const corner = cornerOf(own);
  const border = typeof own.borderWidth === 'number' ? own.borderWidth : 0;
  const lifts = tvFocus === 'lift';
  const base = (Array.isArray(ownTransform) ? ownTransform : []) as object[];

  // Transform and opacity only. A real Apple TV paid for what the simulator
  // hid: an animated shadow with no shadowPath is an offscreen render pass on
  // every frame of every lift, and a clipped sheen inside a rounded rim is a
  // mask pass on top of it. On the Mac's GPU both were free; on an A-series
  // TV at 4K they were the lag (docs/apple-tv.md, "Real hardware").
  const raised = useAnimatedStyle(() => ({
    transform: [...(base as never[]), { scale: 1 + (lifts ? liftFor(width.value) - 1 : 0) * f.value - 0.035 * p.value }],
  }));
  const rim = useAnimatedStyle(() => ({ opacity: f.value }));

  const focusIn = useCallback(
    (e: NativeSyntheticEvent<TargetedEvent>) => {
      if (reads) setFocused(true);
      f.value = withSpring(1, SPRING);
      // No sound on a focus move: it was an audio seek and play on the JS
      // thread for every press of the remote, and tvOS's own apps are silent
      // there too. Sound marks things that happen, not where the focus is.
      onFocus?.(e);
    },
    [f, onFocus, reads],
  );
  const focusOut = useCallback(
    (e: NativeSyntheticEvent<TargetedEvent>) => {
      if (reads) setFocused(false);
      f.value = withSpring(0, SPRING);
      onBlur?.(e);
    },
    [f, onBlur, reads],
  );

  const kids = typeof children === 'function' ? children(state) : children;
  const lit = tvFocus !== 'none' && props.focusable !== false;

  return (
    <AnimatedPressable
      ref={ref}
      {...props}
      onFocus={focusIn}
      onBlur={focusOut}
      onPressIn={(e: GestureResponderEvent) => {
        if (reads) setPressed(true);
        p.value = withTiming(1, { duration: 80 });
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        if (reads) setPressed(false);
        p.value = withSpring(0, SPRING);
        onPressOut?.(e);
      }}
      onLayout={(e: LayoutChangeEvent) => {
        width.value = e.nativeEvent.layout.width;
        onLayout?.(e);
      }}
      // Above its neighbours while lifted, for a control that re-renders on
      // focus anyway. The rest lift into the gap around them: a zIndex is a
      // prop, and changing one is a commit.
      style={[rest, focused && { zIndex: 10 }, lit ? raised : base.length ? { transform: base as ViewStyle['transform'] } : null]}
    >
      {kids as ReactNode}
      {lit ? (
        // Mounted with the control, so a first focus is not a render. It
        // clips (and holds no children, so the clip is free): a clipped view's
        // border is Core Animation's own. Unclipped, React Native draws a
        // border as an image on the CPU, and redraws it whenever the view's
        // opacity changes -- every frame of every focus spring, on the main
        // thread, for the rim that faded in and out on each press.
        <Animated.View
          pointerEvents="none"
          style={[
            styles.rim,
            { top: -border, left: -border, right: -border, bottom: -border, borderRadius: corner, borderColor: color.focusRing },
            rim,
          ]}
        />
      ) : null}
    </AnimatedPressable>
  );
});

const styles = themed(() => StyleSheet.create({
  rim: {
    position: 'absolute',
    overflow: 'hidden',
    borderWidth: 2.5,
    // A lit pane, not a fill: lighting rather than colour, so it reads on
    // every ground and the action colour alike.
    backgroundColor: '#FFFFFF14',
  },
}));

/** React Native's Pressable on a phone and the web; the focus-lit one on a TV. */
export const Pressable = (isTV ? TVPressable : NativePressable) as unknown as ForwardRefExoticComponent<
  Props & RefAttributes<View>
>;
export type { PressableProps };
