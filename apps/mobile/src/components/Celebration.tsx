import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { DECORATIVE } from '@/theme';

/**
 * The noise a good season deserves.
 *
 * A reveal that fades a number in is a receipt, not a celebration — this is the
 * moment the whole loop exists for, so it flashes, it throws confetti, and at
 * 18-0 it does all of it in gold and does not apologise. Intensity scales with
 * the record: a 6-12 gets a flicker, a 17-1 gets buried.
 *
 * Built on React Native's own `Animated` rather than Reanimated, and every
 * piece is `pointerEvents="none"` in an absolutely-positioned overlay, so
 * nothing here can swallow a tap or gate the content underneath. Reduce Motion
 * renders nothing at all.
 */

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

const GOLD = ['#FFB400', '#FFD152', '#C98A00', '#FFF1C2', '#FF8A33'];

export function Celebration({
  /** 0 is silence, 1 is everything at once. */
  intensity,
  /** Confetti and flash colours. */
  palette,
  /** Gold rings and a longer, denser burst. */
  perfect = false,
}: {
  intensity: number;
  palette: readonly string[];
  perfect?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const [enabled, setEnabled] = useState<boolean | null>(null);

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

  if (enabled !== true || strength <= 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" {...DECORATIVE}>
      <Flash color={perfect ? '#FFD152' : colors[0]!} strength={strength} />
      {perfect ? <Rings width={width} /> : null}
      {pieces.map((piece) => (
        <Confetto key={piece.key} piece={piece} fallTo={height + 80} />
      ))}
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

/** Three shockwaves off the record. Reserved for 18-0. */
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
        borderColor: '#FFD152',
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
