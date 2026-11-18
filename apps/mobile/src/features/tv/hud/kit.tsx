import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { isTV } from '../platform';
import { useTVPrefs } from '../prefs';
import { DECORATIVE, color, radius, themed } from '@/theme';

/**
 * The broadcast graphics kit: the pieces every HUD element is built from.
 *
 * A sports broadcast's graphics package is a small vocabulary used with
 * discipline -- one panel, one accent bar, one wipe -- and that is what makes
 * it read as a package rather than a pile of overlays. This file is that
 * vocabulary. Everything is token-coloured, so a theme change repaints the
 * package with the app, and nothing here knows a club: franchises are cities.
 */

/**
 * Broadcast mode is on: a TV, and the player switched it on in Account.
 *
 * A preference, not a flag. It is off until the person at the TV asks for
 * it, it draws nothing a player cannot already see, and it reads nothing
 * remote -- there is no rollout to gate. (A registry flag here would also be
 * off for everyone until somebody created it in PostHog: an answered-but-
 * absent key reads as "switched off".)
 */
export function useBroadcast(): boolean {
  const on = useTVPrefs((s) => s.broadcast);
  return isTV && on;
}

/** The same, read once, for code outside a render. */
export function broadcastOn(): boolean {
  return isTV && useTVPrefs.getState().broadcast;
}

/** Broadcast mode with the app's own chrome hidden: only the game and the graphics. */
export function useCleanFeed(): boolean {
  const broadcast = useBroadcast();
  const clean = useTVPrefs((s) => s.cleanFeed);
  return broadcast && clean;
}

export const WIPE_IN = { duration: 420, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System };
export const WIPE_OUT = { duration: 260, easing: Easing.in(Easing.cubic), reduceMotion: ReduceMotion.System };

/**
 * A 0..1 driver for one graphic: in when `shown`, out when not, after `delay`.
 * The accent bar leads (0 to 0.5) and the panel follows (0.3 to 1): the
 * two-beat wipe every broadcast package uses.
 */
export function useWipe(shown: boolean, delay = 0): SharedValue<number> {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = shown ? withDelay(delay, withTiming(1, WIPE_IN)) : withTiming(0, WIPE_OUT);
  }, [shown, delay, p]);
  return p;
}

/** A panel that wipes on from the left: accent bar first, then the glass behind it. */
export function HudPanel({
  progress,
  accent,
  children,
  style,
  from = 'left',
}: {
  progress: SharedValue<number>;
  accent?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  from?: 'left' | 'right' | 'bottom';
}) {
  const bar = useAnimatedStyle(() => ({
    transform: [{ scaleY: Math.min(1, progress.value * 2) }],
    opacity: progress.value > 0.01 ? 1 : 0,
  }));
  const body = useAnimatedStyle(() => {
    const k = Math.max(0, Math.min(1, (progress.value - 0.3) / 0.7));
    const travel = (1 - k) * 36;
    return {
      opacity: k,
      transform: [from === 'bottom' ? { translateY: travel } : { translateX: from === 'left' ? -travel : travel }],
    };
  });
  return (
    <View style={[styles.seat, style]} pointerEvents="none" {...DECORATIVE}>
      <Animated.View style={[styles.panel, body]}>
        <GlassFill />
        {children}
      </Animated.View>
      <Animated.View style={[styles.bar, { backgroundColor: accent ?? color.action }, from === 'right' ? styles.barRight : null, bar]} />
    </View>
  );
}

/** The panel's glass: dark, a little light from the top, a hairline highlight. */
export function GlassFill() {
  return (
    <View style={styles.fill} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="hudGlass" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color.panelTop} stopOpacity="0.96" />
            <Stop offset="1" stopColor={color.inkDeep} stopOpacity="0.94" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#hudGlass)" />
      </Svg>
      <View style={styles.highlight} />
    </View>
  );
}

/** A spring-in pop, for a number or a stamp landing. */
export function usePop(trigger: unknown, delay = 0): SharedValue<number> {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = 0;
    p.value = withDelay(delay, withSpring(1, { damping: 12, stiffness: 220, reduceMotion: ReduceMotion.System }));
  }, [trigger, delay, p]);
  return p;
}

const styles = themed(() =>
  StyleSheet.create({
    seat: { flexDirection: 'row' },
    panel: {
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: color.lineBright,
      // No shadow: `overflow: hidden` clipped it away anyway, and a shadow on
      // a panel that wipes on is an offscreen pass per frame on a real TV.
      overflow: 'hidden',
    },
    bar: { position: 'absolute', left: -2, top: 0, bottom: 0, width: 5, borderRadius: 2 },
    barRight: { left: undefined, right: -2 },
    fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    highlight: { position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: '#FFFFFF26' },
  }),
);
