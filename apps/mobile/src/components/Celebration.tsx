import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { useFold } from '@/features/fold';
import { gpu } from '@/features/gpu';
import { DECORATIVE, color, useWindowSize } from '@/theme';

/**
 * The noise a good season deserves.
 *
 * A reveal that fades a number in is a receipt, not a celebration — this is the
 * moment the whole loop exists for, so it flashes, it throws confetti, and at
 * 17-0 it does all of it in gold and does not apologise. Intensity scales with
 * the record: a 6-11 gets a flicker, a 16-1 gets buried.
 *
 * On the GPU it is a firework show (`features/gpu/effects/fireworks.tsx`):
 * shells and hundreds of pieces of confetti in one Skia picture, and on an
 * iPhone Duo the shells launch out of the fold and burst over both pages. The
 * view-based confetti below is the fallback -- built on React Native's own
 * `Animated`, as it always was.
 *
 * Every piece of either is `pointerEvents="none"` in an absolutely-positioned
 * overlay, so nothing here can swallow a tap or gate the content underneath.
 * Reduce Motion renders nothing at all.
 *
 * **Mounted with the screen, live on its cue.** The result screen used to
 * mount this at the frame the tier stamps on, so that one frame paid for a
 * whole-screen re-render, an accessibility query, loading the effect, a
 * measure pass and planning three hundred pieces -- and the first frames of
 * the show, which are the burst, were the ones dropped, while the rating
 * counted up underneath. Now everything that costs anything happens during
 * the record's roll (`ARM_LEAD` before the cue), with the show's clock held at
 * zero, and the cue itself only starts clocks.
 */

const GpuFireworks = gpu(() => import('@/features/gpu/effects/fireworks'));

interface Piece {
  readonly key: number;
  readonly x: number;
  readonly size: number;
  readonly color: string;
  readonly delay: number;
  readonly duration: number;
  readonly drift: number;
  readonly spin: number;
  readonly ratio: number;
}

/**
 * How far ahead of its cue the show is set up. Long enough for the effect to
 * load and measure; late enough to stay off the screen's first frames, which
 * are building the panel.
 */
const ARM_LEAD = 600;

const GOLD = [color.gold, color.goldBright, color.goldDeep, '#FFF1C2', color.ignitionBright];

export function Celebration({
  /** 0 is silence, 1 is everything at once. */
  intensity,
  /** Confetti and flash colours. */
  palette,
  /** Gold rings and a longer, denser burst. */
  perfect = false,
  /** Milliseconds from mount until it goes off. 0 is now. */
  at = 0,
}: {
  intensity: number;
  palette: readonly string[];
  perfect?: boolean;
  at?: number;
}) {
  const { width, height } = useWindowSize();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [armed, setArmed] = useState(at <= 0);
  const [live, setLive] = useState(at <= 0);
  const { divisions } = useFold();

  // Measured from mount, as every cue on the result screen is. A cue moving
  // to 0 -- the skip tap -- fires at once; once live it stays live.
  useEffect(() => {
    const arm = setTimeout(() => setArmed(true), Math.max(0, at - ARM_LEAD));
    const go = setTimeout(() => setLive(true), Math.max(0, at));
    return () => {
      clearTimeout(arm);
      clearTimeout(go);
    };
  }, [at]);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => !cancelled && setEnabled(!reduced))
      .catch(() => setEnabled(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const strength = Math.max(0, Math.min(1, intensity));
  const colors = perfect ? GOLD : palette;

  const pieces = useMemo<Piece[]>(() => {
    const count = Math.round(24 + 96 * strength);
    return Array.from({ length: count }, (_, i) => ({
      key: i,
      x: Math.random() * width,
      size: 6 + Math.random() * (perfect ? 12 : 9),
      color: colors[i % colors.length]!,
      // Front-loaded: a burst, then stragglers, rather than an even drizzle.
      delay: Math.random() ** 2 * (900 + 1400 * strength),
      duration: 1700 + Math.random() * 1900,
      drift: (Math.random() - 0.5) * width * 0.55,
      spin: (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random() * 4),
      ratio: Math.random() > 0.7 ? 1 : 0.42,
    }));
  }, [width, strength, perfect]);

  if (enabled !== true || strength <= 0 || !armed) return null;

  // The hinge, in window coordinates: shells rise out of it. A book's fold
  // launches from its foot, a tabletop's from the crease up into the top page.
  const fold = divisions[0];
  const origin = fold
    ? fold.height > fold.width
      ? { x: fold.x + fold.width / 2, y: fold.y + fold.height }
      : { x: fold.x + fold.width / 2, y: fold.y + fold.height / 2 }
    : null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" {...DECORATIVE}>
      {live ? <Flash color={perfect ? color.goldBright : colors[0]!} strength={strength} /> : null}
      {live && perfect ? <Rings width={width} /> : null}
      <GpuFireworks
        intensity={strength}
        palette={perfect ? [...GOLD, color.text] : [...colors, color.goldBright]}
        perfect={perfect}
        origin={origin}
        live={live}
        fallback={
          live
            ? pieces.map((piece) => <Confetto key={piece.key} piece={piece} fallTo={height + 80} />)
            : null
        }
      />
    </View>
  );
}

/** One hard blink of colour over the whole screen, on arrival. */
function Flash({ color, strength }: { color: string; strength: number }) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 520, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: color,
          opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0, 0.09 + 0.17 * strength] }),
        },
      ]}
    />
  );
}

/** Three shockwaves off the record. Reserved for 17-0. */
function Rings({ width }: { width: number }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Ring key={i} delay={i * 260} width={width} />
      ))}
    </>
  );
}

function Ring({ delay, width }: { delay: number; width: number }) {
  const value = useRef(new Animated.Value(0)).current;
  const size = width * 0.5;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(value, { toValue: 1, duration: 1600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(700),
      ]),
    ).start();
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: '26%',
        left: width / 2 - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: color.goldBright,
        opacity: value.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
        transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.6] }) }],
      }}
    />
  );
}

function Confetto({ piece, fallTo }: { piece: Piece; fallTo: number }) {
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(value, {
      toValue: 1,
      duration: piece.duration,
      delay: piece.delay,
      easing: Easing.bezier(0.25, 0.5, 0.6, 1),
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: -40,
        left: piece.x,
        width: piece.size,
        height: piece.size * piece.ratio,
        backgroundColor: piece.color,
        borderRadius: 1,
        opacity: value.interpolate({ inputRange: [0, 0.06, 0.75, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, fallTo] }) },
          { translateX: value.interpolate({ inputRange: [0, 1], outputRange: [0, piece.drift] }) },
          {
            rotate: value.interpolate({
              inputRange: [0, 1],
              outputRange: ['0deg', `${piece.spin * 360}deg`],
            }),
          },
        ],
      }}
    />
  );
}
