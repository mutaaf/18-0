import { useEffect, useState } from 'react';
import { StyleSheet, TVFocusGuideView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { create } from 'zustand';
import { isPerfectionDenied, type GameResult } from '@17-0/domain';
import { Pressable } from '@/components/Pressable';
import { MODE_LABEL, type GameMode } from '@/state/game';
import { DECORATIVE, color, font, positionColor, radius, space, tabular, teamWash, themed, tierColor, tracking } from '@/theme';
import { StadiumLights } from '../lights';
import { cue } from '../sound';
import { GlassFill, useBroadcast, useCleanFeed } from './kit';

/**
 * The final record as a broadcast graphic.
 *
 * Over the result screen, in broadcast mode: the seven picks deal down one
 * side under a riser, the record slams onto a full-screen card, and the
 * perfection gate says where the season stood against 17-0 -- cleared, denied
 * by a named gate, or short by a number. It holds until Select, so a host
 * controls when the show moves on, then fades to the ordinary result page.
 *
 * Everything shown is the `GameResult` the screen already has. Nothing is
 * computed here that could disagree with it.
 */
export interface RevealRow {
  slot: string;
  name: string;
  abbr: string;
  year: number;
  rating: number;
  position: keyof typeof positionColor;
}

const DEAL = 140;
const SLAM = 2000;

/**
 * Whether the graphic is up, for the page underneath: its own preferred-focus
 * button must not claim the remote while it is (the later claim wins, and a
 * click meant to dismiss the graphic started a new season through it).
 */
const useRevealStore = create<{ up: boolean }>(() => ({ up: false }));
export const useRevealUp = (): boolean => useRevealStore((s) => s.up);

export function BroadcastReveal(props: { result: GameResult; mode: GameMode; roster: readonly RevealRow[] }) {
  const on = useBroadcast();
  const [open, setOpen] = useState(true);
  const up = on && open;
  useEffect(() => {
    useRevealStore.setState({ up });
    return () => useRevealStore.setState({ up: false });
  }, [up]);
  if (!up) return null;
  return <Reveal {...props} onDone={() => setOpen(false)} />;
}

function Reveal({ result, mode, roster, onDone }: { result: GameResult; mode: GameMode; roster: readonly RevealRow[]; onDone: () => void }) {
  const clean = useCleanFeed();
  const insets = useSafeAreaInsets();
  const perfect = result.ending.key === 'PERFECT';
  const denied = isPerfectionDenied(result);
  const accent = perfect ? color.gold : tierColor[result.ending.tier] ?? color.text;
  const rated = mode === 'rookie';

  const scrim = useSharedValue(0);
  const slam = useSharedValue(0);
  const gate = useSharedValue(0);
  const exit = useSharedValue(1);

  useEffect(() => {
    cue('build');
    scrim.value = withTiming(1, { duration: 360, reduceMotion: ReduceMotion.System });
    slam.value = withDelay(SLAM, withSpring(1, { damping: 11, stiffness: 200, reduceMotion: ReduceMotion.System }));
    gate.value = withDelay(SLAM + 700, withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }));
    const at = setTimeout(() => cue(perfect ? 'perfect' : denied ? 'denied' : 'stamp'), SLAM);
    return () => clearTimeout(at);
  }, [scrim, slam, gate, perfect, denied]);

  const close = () => {
    exit.value = withTiming(0, { duration: 320, reduceMotion: ReduceMotion.System }, (done) => {
      if (done) runOnJS(onDone)();
    });
  };

  const room = useAnimatedStyle(() => ({ opacity: scrim.value * exit.value }));
  const card = useAnimatedStyle(() => ({
    opacity: Math.min(1, slam.value * 2),
    transform: [{ scale: 1.45 - 0.45 * slam.value }, { rotate: `${(1 - slam.value) * -4}deg` }],
  }));
  const gateIn = useAnimatedStyle(() => ({ opacity: gate.value, transform: [{ translateY: (1 - gate.value) * 30 }] }));

  const threshold = result.distanceFromPerfection > 0 ? result.finalRating + result.distanceFromPerfection : null;
  const gateTitle = perfect ? 'Perfect season' : denied ? 'Perfection denied' : '17-0 gate';
  const gateLine = perfect
    ? 'Every gate cleared. The rarest result in the game.'
    : denied
      ? result.perfectEligibility.failedGates[0]?.message ?? 'Rated high enough, stopped by a gate.'
      : threshold !== null
        ? `Needs ${threshold.toFixed(1)}. This roster: ${result.finalRating.toFixed(1)}, ${result.distanceFromPerfection.toFixed(2)} short.`
        : `This roster: ${result.finalRating.toFixed(1)}.`;

  return (
    // Out to the edge of the glass: the screen it sits in is inset by the
    // TV-safe margins, and a graphic that stops 60 points short of the top
    // shows the page through the gap.
    <Animated.View
      style={[styles.glass, { top: -insets.top, left: -insets.left, right: -insets.right, bottom: -insets.bottom }, room]}
    >
      <TVFocusGuideView style={styles.room} autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
      <Pressable
        onPress={close}
        hasTVPreferredFocus
        tvFocus="none"
        accessibilityRole="button"
        accessibilityLabel={`Final record ${result.record.wins} and ${result.record.losses}. ${result.ending.label}. Select to continue.`}
        style={styles.room}
      >
        <View style={StyleSheet.absoluteFill} pointerEvents="none" {...DECORATIVE}>
          <GlassFill />
          {/* The glow behind the record: a native radial gradient, not an Svg
              -- a full-screen CPU raster, on the main thread, in the moment
              the record slams down. */}
          <View
            style={[
              StyleSheet.absoluteFill,
              { experimental_backgroundImage: `radial-gradient(ellipse 55% 55% at 62% 45%, ${teamWash(accent, 0.28)} 0%, ${teamWash(accent, 0)} 100%)` },
            ]}
          />
          {/* The stadium lights land on the record as it slams down, and hold
              still behind it until Select (features/tv/lights.tsx). */}
          <StadiumLights show={perfect ? 'perfect' : 'reveal'} cue="record" at={SLAM} tint={accent} hold />
        </View>

        <View style={styles.layout} pointerEvents="none">
          <View style={styles.rosterCol}>
            <Text style={styles.kicker}>Final roster · {MODE_LABEL[mode]}</Text>
            {roster.map((row, i) => (
              <DealtRow key={row.slot} row={row} index={i} rated={rated} />
            ))}
          </View>

          <View style={styles.centre}>
            <Animated.View style={[styles.recordCard, { borderColor: accent }, card]}>
              <Text style={styles.recordKicker}>Projected record</Text>
              <Text style={[styles.record, { color: perfect ? color.goldBright : color.text }]}>
                {result.record.wins}
                <Text style={{ color: accent }}>–</Text>
                {result.record.losses}
              </Text>
              <Text style={[styles.ending, { color: accent }]}>{result.ending.label}</Text>
              <View style={styles.metaRow}>
                <View style={[styles.tier, { borderColor: accent }]}>
                  <Text style={[styles.tierText, { color: accent }]}>Tier {result.ending.tier}</Text>
                </View>
                <Text style={styles.rating}>
                  {result.finalRating.toFixed(1)} <Text style={styles.ratingLabel}>rating</Text>
                </Text>
              </View>
            </Animated.View>

            <Animated.View style={[styles.gate, { borderColor: perfect ? color.gold : denied ? color.negative : color.lineBright }, gateIn]}>
              <View style={[styles.gateBar, { backgroundColor: perfect ? color.gold : denied ? color.negative : color.action }]} />
              <View style={styles.gateText}>
                <Text style={[styles.gateTitle, { color: perfect ? color.goldBright : denied ? color.negative : color.text }]}>{gateTitle}</Text>
                <Text style={styles.gateLine} numberOfLines={2}>
                  {gateLine}
                </Text>
              </View>
            </Animated.View>
          </View>
        </View>

        {clean ? null : <Text style={styles.hint}>Select to continue</Text>}
      </Pressable>
      </TVFocusGuideView>
    </Animated.View>
  );
}

function DealtRow({ row, index, rated }: { row: RevealRow; index: number; rated: boolean }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(300 + index * DEAL, withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }));
    const at = setTimeout(() => cue('tick'), 300 + index * DEAL);
    return () => clearTimeout(at);
  }, [p, index]);
  const s = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateX: (1 - p.value) * -40 }] }));
  const tint = positionColor[row.position] ?? color.text;
  return (
    <Animated.View style={[styles.row, s]}>
      <Text style={[styles.rowSlot, { color: tint }]}>{row.slot}</Text>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {row.name}
        </Text>
        <Text style={styles.rowMeta}>
          {row.abbr} {row.year}
        </Text>
      </View>
      {rated ? <Text style={styles.rowRating}>{row.rating.toFixed(1)}</Text> : null}
    </Animated.View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    glass: { position: 'absolute', backgroundColor: color.void },
    room: { flex: 1 },
    layout: { flex: 1, flexDirection: 'row', paddingHorizontal: 96, paddingTop: 72, paddingBottom: 80, gap: space.xxxl },
    rosterCol: { width: 320, gap: space.sm, justifyContent: 'center' },
    kicker: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wider, textTransform: 'uppercase', color: color.textDim, marginBottom: space.xs },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingVertical: 6,
      paddingHorizontal: space.md,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.scrim,
    },
    rowSlot: { width: 36, fontFamily: font.label, fontSize: 13, letterSpacing: tracking.wide },
    rowBody: { flex: 1, minWidth: 0 },
    rowName: { fontFamily: font.heading, fontSize: 17, color: color.text },
    rowMeta: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.normal, color: color.silver },
    rowRating: { fontFamily: font.display, fontSize: 18, color: color.text, ...tabular },

    centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl },
    recordCard: {
      alignItems: 'center',
      paddingHorizontal: 64,
      paddingVertical: space.xl,
      borderRadius: radius.xl,
      borderWidth: 3,
      backgroundColor: color.glass,
      // No shadow: the card slams in, and an animated layer with a shadow and
      // no shadowPath is re-rendered offscreen every frame on a real TV.
    },
    recordKicker: { fontFamily: font.label, fontSize: 14, letterSpacing: tracking.wider, textTransform: 'uppercase', color: color.silver },
    record: { fontFamily: font.display, fontSize: 150, lineHeight: 150, ...tabular },
    ending: { fontFamily: font.display, fontSize: 34, letterSpacing: tracking.wider, textTransform: 'uppercase' },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.sm },
    tier: { borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 2 },
    tierText: { fontFamily: font.label, fontSize: 15, letterSpacing: tracking.wide },
    rating: { fontFamily: font.display, fontSize: 26, color: color.text, ...tabular },
    ratingLabel: { fontFamily: font.label, fontSize: 13, color: color.textDim, letterSpacing: tracking.wide },

    gate: {
      flexDirection: 'row',
      alignItems: 'stretch',
      borderWidth: 1,
      borderRadius: radius.md,
      backgroundColor: color.glass,
      overflow: 'hidden',
      maxWidth: 560,
    },
    gateBar: { width: 6 },
    gateText: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: 2 },
    gateTitle: { fontFamily: font.display, fontSize: 22, letterSpacing: tracking.wide, textTransform: 'uppercase' },
    gateLine: { fontFamily: font.body, fontSize: 14, color: color.silver },

    hint: {
      position: 'absolute',
      bottom: 48,
      alignSelf: 'center',
      fontFamily: font.label,
      fontSize: 13,
      letterSpacing: tracking.wider,
      textTransform: 'uppercase',
      color: color.textDim,
    },
  }),
);
