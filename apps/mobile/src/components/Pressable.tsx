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
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { cue } from '@/features/tv/sound';
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
 *   wide row, where 1.1 would crash into the neighbours -- over a deep, soft
 *   shadow;
 * - **a rim that follows the shape**: a thin `focusRing` border drawn at the
 *   element's own corner radius, over a faint white wash, so a text button
 *   with no background of its own still reads as a lit pane;
 * - **a specular sweep**: one band of light crossing the face as focus lands.
 *
 * All of it runs on the UI thread: Reanimated springs, and the sweep is one
 * timing per focus, never a loop. A screen that wants another look reads
 * `focused` from the style callback (`PressState`) or passes `tvFocus`:
 * `rim` keeps the rim without the lift (rows inside a clipped list), `none`
 * draws nothing (a control that paints its own focus).
 *
 * **Cheap until focused** (docs/apple-tv.md, Performance). A spin's list is a
 * hundred Pressables and the remote visits a handful, so the rim and the
 * sheen are not mounted until a control is first focused, and then stay. The
 * sheen is a native CSS gradient on one view rather than an Svg, which was
 * seven native components per control -- every row of every list carried
 * them, and each one made every commit of that screen longer.
 *
 * `native-imports.test.ts` keeps this the only place that imports React
 * Native's.
 */
type Ref = ElementRef<typeof NativePressable>;

export type TVFocusLook = 'lift' | 'rim' | 'none';

const AnimatedPressable = Animated.createAnimatedComponent(NativePressable);

const SPRING = { damping: 17, stiffness: 260, mass: 0.7, reduceMotion: ReduceMotion.System };
const SHEEN = 140;

/** Apple's rule of thumb: small things grow more than big ones. */
function liftFor(width: number): number {
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
  const [focused, setFocused] = useState(false);
  // Becomes true on the first focus and stays: see "Cheap until focused".
  const [visited, setVisited] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const f = useSharedValue(0);
  const p = useSharedValue(0);
  const sweep = useSharedValue(-1);

  const state = { pressed, focused, hovered: false } as PressableStateCallbackType;
  const own = (StyleSheet.flatten(typeof style === 'function' ? style(state) : style) ?? {}) as ViewStyle;
  const { transform: ownTransform, ...rest } = own;
  const corner = cornerOf(own);
  const border = typeof own.borderWidth === 'number' ? own.borderWidth : 0;
  const lift = tvFocus === 'lift' ? liftFor(box.width) - 1 : 0;
  const base = (Array.isArray(ownTransform) ? ownTransform : []) as object[];
  const travel = box.width + SHEEN * 2;

  const raised = useAnimatedStyle(() => ({
    transform: [...(base as never[]), { scale: 1 + lift * f.value - 0.035 * p.value }],
    shadowColor: '#000',
    shadowOpacity: 0.6 * f.value,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 * f.value },
  }));
  const rim = useAnimatedStyle(() => ({ opacity: f.value }));
  const shine = useAnimatedStyle(() => ({ transform: [{ translateX: sweep.value * travel }] }));

  const focusIn = useCallback(
    (e: NativeSyntheticEvent<TargetedEvent>) => {
      setFocused(true);
      setVisited(true);
      f.value = withSpring(1, SPRING);
      sweep.value = 0;
      sweep.value = withTiming(1, { duration: 950, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System });
      cue('focus');
      onFocus?.(e);
    },
    [f, sweep, onFocus],
  );
  const focusOut = useCallback(
    (e: NativeSyntheticEvent<TargetedEvent>) => {
      setFocused(false);
      f.value = withSpring(0, SPRING);
      onBlur?.(e);
    },
    [f, onBlur],
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
        setPressed(true);
        p.value = withTiming(1, { duration: 80 });
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        setPressed(false);
        p.value = withSpring(0, SPRING);
        onPressOut?.(e);
      }}
      onLayout={(e: LayoutChangeEvent) => {
        const { width, height } = e.nativeEvent.layout;
        if (width !== box.width || height !== box.height) setBox({ width, height });
        onLayout?.(e);
      }}
      // Above its neighbours while lifted, so the scale and the shadow are not
      // drawn under the next row.
      style={[rest, focused && { zIndex: 10 }, lit ? raised : base.length ? { transform: base as ViewStyle['transform'] } : null]}
    >
      {kids as ReactNode}
      {lit && visited ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.rim,
            { top: -border, left: -border, right: -border, bottom: -border, borderRadius: corner, borderColor: color.focusRing },
            rim,
          ]}
        >
          {box.width > 0 ? <Animated.View style={[styles.sheen, shine]} /> : null}
        </Animated.View>
      ) : null}
    </AnimatedPressable>
  );
});

const styles = themed(() => StyleSheet.create({
  rim: {
    position: 'absolute',
    borderWidth: 2.5,
    overflow: 'hidden',
    // A lit pane, not a fill: lighting rather than colour, so it reads on
    // every ground and the action colour alike.
    backgroundColor: '#FFFFFF14',
  },
  sheen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: -SHEEN,
    width: SHEEN,
    // Drawn by the view itself (a CAGradientLayer), not an Svg. TV only, so
    // the web's support for the property never matters.
    experimental_backgroundImage: 'linear-gradient(105deg, #FFFFFF00 0%, #FFFFFF33 50%, #FFFFFF00 100%)',
  },
}));

/** React Native's Pressable on a phone and the web; the focus-lit one on a TV. */
export const Pressable = (isTV ? TVPressable : NativePressable) as unknown as ForwardRefExoticComponent<
  Props & RefAttributes<View>
>;
export type { PressableProps };
