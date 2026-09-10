import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { DECORATIVE } from '@/theme';

/**
 * One clock, many layers.
 *
 * A broadcast graphic is not a pile of animations that happen to start at the
 * same time — it is a single timeline with layers reading their own keyframes
 * off it. That distinction is the whole reason this module exists rather than
 * another dozen `Animated.Value`s scattered through the result screen: with one
 * clock there is exactly one thing to stop, one thing to jump to the end, and
 * one failsafe. A layer cannot be left half-built, because there is nothing for
 * it to be half-built *of*.
 *
 * It is also, deliberately, the model Lottie uses. Lottie was tried here and
 * rejected — `lottie-react-native@7` cannot render on the web without
 * `@lottiefiles/dotlottie-react` (a 7MB WASM renderer) and cannot follow the
 * palette without baking hexes into JSON that `theme.test.ts` does not read.
 * The idea it is good at survives; its runtime did not earn a native module.
 */

export interface Timeline {
  /**
   * Milliseconds since the sequence began, native-driven. Layers interpolate
   * against real times, so a cue table reads as a rundown rather than as a
   * chain of nested delays nobody can re-time.
   */
  readonly t: Animated.Value;
  /** True once every layer is at its end state, however it got there. */
  readonly settled: boolean;
  /** Cut to the end. Safe to call at any point, including twice. */
  readonly settle: () => void;
}

/**
 * Runs the clock once per `restart`.
 *
 * Reduce Motion never starts it: the sequence is skipped outright rather than
 * played slowly, because somebody who asked for less motion asked for the
 * result, not for a gentler version of the production around it.
 */
export function useTimeline(duration: number, restart?: unknown): Timeline {
  const t = useRef(new Animated.Value(0)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const [settled, setSettled] = useState(false);

  const settle = useCallback(() => {
    running.current?.stop();
    running.current = null;
    t.setValue(duration);
    setSettled(true);
  }, [duration, t]);

  useEffect(() => {
    let cancelled = false;
    t.setValue(0);
    setSettled(false);

    // The rule the whole result screen depends on: decoration must never gate
    // the score. Whatever happens below -- a rejected accessibility query, a
    // driver that never schedules the timing, a web build where the completion
    // callback does not fire -- the graphic is fully built by now. A reveal
    // that stalls at 40% hides the one number the game exists to show.
    const failsafe = setTimeout(() => {
      if (!cancelled) settle();
    }, duration + 900);

    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => {
        if (cancelled) return;
        if (reduced) {
          settle();
          return;
        }
        const run = Animated.timing(t, {
          toValue: duration,
          duration,
          // Linear on purpose. `t` is a clock, not a curve: every layer bends
          // its own segment, and an easing here would quietly slide every cue
          // time in the table away from the millisecond it claims to be.
          easing: Easing.linear,
          useNativeDriver: true,
        });
        running.current = run;
        run.start(({ finished }) => {
          if (finished && !cancelled) setSettled(true);
        });
      })
      .catch(() => {
        if (!cancelled) settle();
      });

    return () => {
      cancelled = true;
      clearTimeout(failsafe);
      running.current?.stop();
      running.current = null;
    };
  }, [duration, restart, settle, t]);

  return { t, settled, settle };
}

/**
 * A layer's keyframes: `values` spread evenly across one window of the clock.
 *
 * Animated interpolates linearly between points, so shape comes from placing
 * more of them rather than from an easing function — which is what lets a
 * single value carry an overshoot, a settle and a hold without three chained
 * animations. Outside the window it clamps, so a layer is at its first value
 * before its cue and its last value forever after.
 */
export function keyframes(
  t: Animated.Value,
  start: number,
  duration: number,
  values: readonly number[],
): Animated.AnimatedInterpolation<number> {
  const last = values.length - 1;
  return t.interpolate({
    inputRange: values.map((_, i) => start + (duration * i) / last),
    outputRange: [...values],
    extrapolate: 'clamp',
  });
}

/** Ease-out, 0 to 1. The default arrival for anything that just needs to be there. */
export const EASE_OUT = [0, 0.58, 0.84, 0.95, 1] as const;
/** Ease-in-out, 0 to 1. For travel — a sweep, a fill — rather than an arrival. */
export const TRAVEL = [0, 0.08, 0.5, 0.92, 1] as const;
/** Arrives past its mark and settles back. Digits landing on a scoreboard. */
export const DROP_IN = [0, 0.66, 1.07, 0.97, 1.01, 1] as const;
/** Comes down large and hits. A tier being stamped on. */
export const STAMP = [0, 0.88, 1.02, 0.995, 1] as const;
/** One frame of light, then gone. An impact, never a state. */
export const FLARE = [0, 1, 0.34, 0.09, 0] as const;

/**
 * The plain entrance — fade up, slide up — taken off the shared clock.
 *
 * `Reveal` already does this with a timer of its own, which is right for a
 * screen that has one build and nothing to synchronise with. Here it would mean
 * a skip tap settling the scoreboard while the roster carried on fading in
 * behind it, and a page whose order was spread across a dozen `delay` props
 * that nobody could re-time as a whole.
 */
export function Layer({
  t,
  at,
  duration = 300,
  distance = 14,
  style,
  children,
  ...rest
}: Omit<ComponentProps<typeof Animated.View>, 'children'> & {
  t: Animated.Value;
  at: number;
  duration?: number;
  distance?: number;
  children: ReactNode;
}) {
  // Memoized because the tickers re-render this screen twenty-odd times a
  // second while the numbers roll, and an interpolation built in render is a
  // fresh Animated node attached and detached on every one of them.
  const p = useMemo(() => keyframes(t, at, duration, EASE_OUT), [t, at, duration]);
  const lift = useMemo(
    () => p.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    [p, distance],
  );

  return (
    <Animated.View
      {...rest}
      style={[style, { opacity: p, transform: [{ translateY: lift }] }]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * A light sweeping across a panel, once.
 *
 * Travels a fixed multiple of the window width rather than a measured one: the
 * panel is never wider than the screen, the sweep is clipped by its parent, and
 * an `onLayout` round trip here would put the sheen a frame behind the impact
 * it is supposed to belong to.
 */
export function Sheen({
  t,
  at,
  duration = 620,
  angle = '18deg',
}: {
  t: Animated.Value;
  at: number;
  duration?: number;
  angle?: string;
}) {
  const { width } = useWindowDimensions();
  const band = Math.max(90, width * 0.28);
  const { slide, fade } = useMemo(
    () => ({
      slide: keyframes(t, at, duration, TRAVEL).interpolate({
        inputRange: [0, 1],
        outputRange: [-band, width + band],
      }),
      fade: keyframes(t, at, duration, FLARE.map((v) => Math.min(1, v * 1.6))),
    }),
    [t, at, duration, band, width],
  );

  return (
    <Animated.View
      pointerEvents="none"
      {...DECORATIVE}
      style={{
        position: 'absolute',
        top: -width,
        bottom: -width,
        width: band,
        opacity: fade,
        transform: [{ translateX: slide }, { rotate: angle }],
      }}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
            {/* White, not a token: this is a light source crossing the panel,
                and it reads the same on every ground the app can wear. */}
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
            <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.22" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#sheen)" />
      </Svg>
    </Animated.View>
  );
}

/** A single shockwave off the centre of a panel. One shot, never a loop. */
export function ImpactRing({
  t,
  at,
  size,
  tint,
  duration = 700,
}: {
  t: Animated.Value;
  at: number;
  size: number;
  tint: string;
  duration?: number;
}) {
  const { wave, fade } = useMemo(
    () => ({
      wave: keyframes(t, at, duration, EASE_OUT).interpolate({
        inputRange: [0, 1],
        outputRange: [0.35, 1.9],
      }),
      fade: keyframes(t, at, duration, [0, 0.55, 0.28, 0.1, 0]),
    }),
    [t, at, duration],
  );

  return (
    <Animated.View
      pointerEvents="none"
      {...DECORATIVE}
      style={[
        StyleSheet.absoluteFill,
        { alignItems: 'center', justifyContent: 'center' },
        { opacity: fade },
      ]}
    >
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: tint,
          transform: [{ scale: wave }],
        }}
      />
    </Animated.View>
  );
}

/**
 * A number that rolls onto its value instead of appearing at it.
 *
 * Stepped at ~24fps rather than per frame, because each tick re-renders the
 * result screen and twenty of them read as a scoreboard rolling over while
 * sixty would only cost more. The value is raw; callers round or fix it, so one
 * ticker serves both a win total and a rating to one decimal.
 *
 * Two things force the true number: `settled`, which covers Reduce Motion, the
 * skip tap and the timeline's own failsafe, and a local timer, because
 * decoration must never be the reason a score is wrong on screen.
 */
export function useRoll(
  target: number,
  from: number,
  start: number,
  duration: number,
  settled: boolean,
): number {
  const [value, setValue] = useState(target);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stop = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };

    if (settled) {
      stop();
      setValue(target);
      return;
    }

    let cancelled = false;
    let began = 0;
    setValue(from);
    const failsafe = setTimeout(() => !cancelled && setValue(target), start + duration + 700);

    const tick = () => {
      if (cancelled) return;
      const p = Math.min(1, (Date.now() - began) / duration);
      setValue(from + (target - from) * (1 - (1 - p) ** 3));
      if (p < 1) timer.current = setTimeout(tick, 42);
    };

    timer.current = setTimeout(() => {
      began = Date.now();
      tick();
    }, start);

    return () => {
      cancelled = true;
      stop();
      clearTimeout(failsafe);
    };
  }, [target, from, start, duration, settled]);

  return value;
}

/**
 * The tap that ends the production early.
 *
 * Covers only the graphic it belongs to, never the page. A skip layer over the
 * whole screen would swallow the first press on Build Another, and skipping an
 * animation is not worth costing somebody a tap on the control they actually
 * meant — so it sits over the scoreboard panel, which carries nothing else to
 * press, and unmounts the instant the sequence settles.
 *
 * Hidden from assistive tech and given no role: Reduce Motion never runs the
 * sequence in the first place, so a screen reader has nothing to skip and would
 * only find an unlabelled button sitting on top of the result.
 */
export function SkipLayer({ onPress }: { onPress: () => void }) {
  return <Pressable style={StyleSheet.absoluteFill} onPress={onPress} {...DECORATIVE} />;
}
