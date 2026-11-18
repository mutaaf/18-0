import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from '@/features/haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  ReduceMotion,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { DATASET, displayName, eraLabel, franchise, type BootCard } from '@17-0/data';
import { Pressable } from '@/components/Pressable';
import { Screen } from '@/components/Screen';
import { DECK_SIZE, buildDeck, summarize, type Call } from '@/features/gut-check';
import { feedbackKey, flushRatingFeedback, giveRatingFeedback, useRatingFeedback, type RatingVerdict } from '@/features/rating-feedback';
import { useCardStats } from '@/features/stat-lines';
import { track } from '@/features/telemetry';
import { isTV } from '@/features/tv/platform';
import { useTVRemote, type HWEvent } from '@/features/tv/remote';
import { cue } from '@/features/tv/sound';
import { GutCheckTally, useCleanFeed } from '@/features/tv/hud';
import { remoteAction } from '@/features/tv/remote-calls';
import { useHistoryStore } from '@/state/history';
import { DECORATIVE, color, font, positionColor, radius, space, tabular, themed, tracking, useThemeId, useWindowSize, type PressState } from '@/theme';

/**
 * Gut Check: ten cards, one swipe each.
 *
 * Right: the rating looks right. Left: it does not -- and the card comes back
 * asking which way, answered with a flick up (deserves more) or down
 * (deserves less). "Don't know" skips without recording anything, because a
 * guess about a season nobody remembers is noise in the refit, not signal.
 *
 * Every call is a `rating_feedback` row with `source: 'swipe'` (migration
 * 0028), queued locally first like the result screen's arrows, so the game
 * plays offline (invariant 3). Nothing here touches a score (invariant 1).
 */

/** How far a card has to travel to count, as a share of its own width. */
const COMMIT = 0.32;
/** A fast flick counts sooner than a slow drag, as on every swipe deck. */
const FLICK = 850;

type Phase = 'judge' | 'which';

const MODEL = DATASET.ratingModelVersion;

function buzz(kind: 'tick' | 'light' | 'medium' | 'soft' | 'done') {
  if (Platform.OS === 'web') return;
  const p =
    kind === 'tick'
      ? Haptics.selectionAsync()
      : kind === 'done'
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        : Haptics.impactAsync(
            kind === 'light'
              ? Haptics.ImpactFeedbackStyle.Light
              : kind === 'soft'
                ? Haptics.ImpactFeedbackStyle.Soft
                : Haptics.ImpactFeedbackStyle.Medium,
          );
  p.catch(() => {});
}

function dealDeck(): BootCard[] {
  const verdicts = useRatingFeedback.getState().verdicts;
  const recent = useHistoryStore
    .getState()
    .games.slice(0, 6)
    .flatMap((g) => g.roster.map((r) => r.cardId));
  return buildDeck({
    pool: DATASET.cards,
    recent,
    voted: (id) => feedbackKey(MODEL, id) in verdicts,
  });
}

export default function GutCheck() {
  useThemeId();
  const router = useRouter();
  const cleanFeed = useCleanFeed();
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const cardWidth = Math.min(windowWidth - space.xl * 2, isTV ? 380 : 360);
  const cardHeight = Math.min(cardWidth * 1.32, windowHeight * (isTV ? 0.56 : 0.52));

  const [deck, setDeck] = useState<BootCard[]>(() => dealDeck());
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('judge');
  const [calls, setCalls] = useState<Call[]>([]);
  const round = useRef(1);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  /** 0 judging, 1 asking which way: the gesture reads it on the UI thread. */
  const mode = useSharedValue(0);
  /** -1, 0 or 1: which side of the line the finger is on, for the tick. */
  const armed = useSharedValue(0);
  const busy = useSharedValue(false);
  /**
   * TV: the call, stamped on the card before it leaves. On a phone the finger
   * drags the card and the stamp fades in with it; a click on a remote has no
   * drag, so without this the card just vanished sideways.
   */
  const [stamp, setStamp] = useState<StampKind | null>(null);
  const slam = useSharedValue(0);

  const card = deck[index];
  const next = deck[index + 1];
  const done = index >= deck.length;

  useEffect(() => {
    track('gut_check_started', { round: round.current, cards: deck.length });
  }, [deck]);

  useEffect(() => {
    if (!done || calls.length === 0) return;
    buzz('done');
    cue('round');
    const s = summarize(calls);
    track('gut_check_finished', {
      round: round.current,
      fair: s.fair,
      too_high: s.tooHigh,
      too_low: s.tooLow,
      skipped: s.skipped,
    });
    void flushRatingFeedback();
  }, [done, calls]);

  // A new card starts in the middle. Reset after the render that swaps it
  // in, not before: resetting first shows the card just judged back in the
  // centre for a frame.
  useLayoutEffect(() => {
    tx.value = 0;
    ty.value = 0;
    armed.value = 0;
    busy.value = false;
    slam.value = 0;
    setStamp(null);
  }, [index, tx, ty, armed, busy, slam]);

  useEffect(() => {
    mode.value = phase === 'which' ? 1 : 0;
  }, [phase, mode]);

  const advance = useCallback(
    (call: Call) => {
      const current = deck[index];
      if (!current) return;
      if (call !== 'skip') {
        giveRatingFeedback({
          cardId: current.id,
          modelVersion: MODEL,
          ratingShown: current.rating,
          verdict: call,
          source: 'swipe',
        });
      }
      buzz(call === 'fair' ? 'light' : call === 'skip' ? 'soft' : 'medium');
      setCalls((c) => [...c, call]);
      setPhase('judge');
      setIndex((i) => i + 1);
    },
    [deck, index],
  );

  const askWhich = useCallback(() => {
    buzz('medium');
    setPhase('which');
  }, []);

  /** Sends the card off screen, then records the call. Buttons and keys use it too. */
  const fly = useCallback(
    (call: Call) => {
      if (busy.value) return;
      busy.value = true;
      cue(call === 'fair' ? 'fair' : call === 'skip' ? 'skip' : 'off');
      if (isTV) {
        // Stamp, hold a beat, then throw: the call lands before the card goes.
        setStamp(call);
        slam.value = withSpring(1, { damping: 12, stiffness: 320, reduceMotion: ReduceMotion.System });
      }
      const out = isTV
        ? { duration: 340, easing: Easing.in(Easing.cubic), reduceMotion: ReduceMotion.System }
        : { duration: 220, reduceMotion: ReduceMotion.System };
      const hold = isTV ? 420 : 0;
      const finish = (finished?: boolean) => {
        'worklet';
        if (finished) runOnJS(advance)(call);
      };
      if (call === 'fair') tx.value = withDelay(hold, withTiming(windowWidth * 1.3, out, finish));
      else if (call === 'too_low') ty.value = withDelay(hold, withTiming(-windowHeight, out, finish));
      else if (call === 'too_high') ty.value = withDelay(hold, withTiming(windowHeight, out, finish));
      else tx.value = withDelay(hold, withTiming(-windowWidth * 1.3, out, finish));
    },
    [advance, busy, tx, ty, slam, windowWidth, windowHeight],
  );

  const disagree = useCallback(() => {
    if (busy.value) return;
    cue('off');
    if (isTV) {
      // A nudge left and back: the card refuses the call and turns round to
      // ask which way, rather than the prompt simply changing under it.
      tx.value = withSequence(
        withTiming(-46, { duration: 120, easing: Easing.out(Easing.quad) }),
        withSpring(0, { damping: 11, stiffness: 220 }),
      );
    } else {
      tx.value = withSpring(0, { damping: 14, stiffness: 180 });
    }
    askWhich();
  }, [askWhich, busy, tx]);

  const pan = useMemo(() => {
    const line = cardWidth * COMMIT;
    return Gesture.Pan()
      .enabled(!done)
      .onUpdate((e) => {
        if (busy.value) return;
        if (mode.value === 0) {
          tx.value = e.translationX;
          ty.value = e.translationY * 0.25;
          const side = e.translationX > line ? 1 : e.translationX < -line ? -1 : 0;
          if (side !== armed.value) {
            armed.value = side;
            if (side !== 0) runOnJS(buzz)('tick');
          }
        } else {
          tx.value = e.translationX * 0.2;
          ty.value = e.translationY;
          const side = e.translationY < -line ? -1 : e.translationY > line ? 1 : 0;
          if (side !== armed.value) {
            armed.value = side;
            if (side !== 0) runOnJS(buzz)('tick');
          }
        }
      })
      .onEnd((e) => {
        if (busy.value) return;
        const spring = { damping: 15, stiffness: 190 };
        if (mode.value === 0) {
          if (e.translationX > line || e.velocityX > FLICK) {
            runOnJS(fly)('fair');
          } else if (e.translationX < -line || e.velocityX < -FLICK) {
            tx.value = withSpring(0, spring);
            ty.value = withSpring(0, spring);
            runOnJS(askWhich)();
          } else {
            tx.value = withSpring(0, spring);
            ty.value = withSpring(0, spring);
          }
        } else if (e.translationY < -line || e.velocityY < -FLICK) {
          runOnJS(fly)('too_low');
        } else if (e.translationY > line || e.velocityY > FLICK) {
          runOnJS(fly)('too_high');
        } else {
          tx.value = withSpring(0, spring);
          ty.value = withSpring(0, spring);
        }
        armed.value = 0;
      });
  }, [cardWidth, done, askWhich, fly, armed, busy, mode, tx, ty]);

  // The keyboard, on the web: the same calls as the swipes.
  useEffect(() => {
    if (Platform.OS !== 'web' || done) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') fly('fair');
      else if (e.key === 'ArrowLeft') disagree();
      else if (e.key === 'ArrowUp') fly('too_low');
      else if (e.key === 'ArrowDown') fly('too_high');
      else if (e.key === ' ' || e.key.toLowerCase() === 's') fly('skip');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, fly, disagree]);

  // The Siri Remote: a swipe on its touch surface or a click on the edge of
  // its clickpad makes the same calls (features/tv/remote-calls.ts). A click
  // in the middle presses the focused button, which on the deck is the only
  // focusable one: "Don't know", or "Fair after all" once asked which way.
  const onRemote = useCallback(
    (e: HWEvent) => {
      if (done) return;
      const action = remoteAction(e.eventType, e.eventKeyAction, phase);
      if (action === 'off') disagree();
      else if (action) fly(action);
    },
    [done, phase, fly, disagree],
  );
  useTVRemote(onRemote);

  const again = () => {
    round.current += 1;
    setDeck(dealDeck());
    setCalls([]);
    setIndex(0);
    setPhase('judge');
  };

  return (
    // A TV takes the whole width -- the calls flank the card and the tally
    // sits in the corner -- with the header kept to the phone's column.
    <Screen edges={['top', 'left', 'right', 'bottom']} maxWidth={isTV ? 4000 : undefined}>
      <View style={isTV ? styles.tvColumn : null}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          // Not a focus stop on a TV, where swiping up means "deserves more"
          // and must not walk the focus up here instead. Menu closes it.
          focusable={!isTV}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close Gut Check"
          style={styles.close}
        >
          {({ hovered }: PressState) => <Text style={[styles.closeText, hovered && { color: color.text }]}>✕</Text>}
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.kicker}>Gut Check</Text>
          <Text style={styles.count} accessibilityLiveRegion="polite">
            {done ? 'Round done' : `${index + 1} of ${deck.length}`}
          </Text>
        </View>
        <View style={styles.close} />
      </View>
      <Progress calls={calls} total={deck.length || DECK_SIZE} />
      </View>
      {isTV ? <GutCheckTally calls={calls} total={deck.length || DECK_SIZE} /> : null}

      {done ? (
        <View style={isTV ? styles.tvColumn : null}>
          <RoundEnd calls={calls} onAgain={again} onDone={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>
      ) : (
        <>
          <Text style={styles.prompt} accessibilityLiveRegion="polite">
            {phase === 'judge' ? 'Is this rating right?' : 'Which way is it off?'}
          </Text>
          {(() => {
            const deck = (
              <View style={[styles.stage, { height: cardHeight + space.lg }, isTV && { width: cardWidth + space.lg }]}>
                {next ? (
                  <BackCard key={next.id} card={next} width={cardWidth} height={cardHeight} tx={tx} ty={ty} />
                ) : null}
                {card ? (
                  <GestureDetector gesture={pan}>
                    <TopCard
                      key={card.id}
                      card={card}
                      width={cardWidth}
                      height={cardHeight}
                      tx={tx}
                      ty={ty}
                      phase={phase}
                      stamp={stamp}
                      slam={slam}
                    />
                  </GestureDetector>
                ) : null}
              </View>
            );
            const off =
              phase === 'judge' ? (
                <RoundButton glyph="✕" label="Off" tone={color.negative} onPress={disagree} a11y="Rating is off" />
              ) : (
                <RoundButton glyph="▼" label="Lower" tone={color.negative} onPress={() => fly('too_high')} a11y="Should be lower" />
              );
            const on =
              phase === 'judge' ? (
                <RoundButton glyph="✓" label="Fair" tone={color.positive} onPress={() => fly('fair')} a11y="Rating is fair" />
              ) : (
                <RoundButton glyph="▲" label="Higher" tone={color.positive} onPress={() => fly('too_low')} a11y="Should be higher" />
              );
            const skip =
              phase === 'judge' ? <SkipButton onPress={() => fly('skip')} /> : <SkipButton label="Fair after all" onPress={() => fly('fair')} />;
            // A TV is wide and short: the two calls flank the card, where the
            // card flies, and the remote's legend sits under it. Stacked as on a
            // phone the legend fell off the bottom of the glass.
            return isTV ? (
              <>
                <View style={styles.tvDeck}>
                  {off}
                  {deck}
                  {on}
                </View>
                <View style={styles.tvUnder}>
                  {skip}
                  {cleanFeed ? null : <RemoteHint phase={phase} />}
                </View>
              </>
            ) : (
              <>
                {deck}
                <View style={styles.actions}>
                  {off}
                  {skip}
                  {on}
                </View>
              </>
            );
          })()}
          {/* On a TV the remote hint above says it, with a fingertip. */}
          {cleanFeed || isTV ? null : <Text style={styles.hint}>
            {phase === 'judge'
              ? isTV
                ? 'Swipe right if it’s right, left if it’s off. Click if you don’t know.'
                : 'Swipe right if it’s right. Left if it’s off.'
              : isTV
                ? 'Swipe up if it deserves more, down if less.'
                : 'Flick up if it deserves more, down if less.'}
          </Text>}
        </>
      )}
    </Screen>
  );
}

function Progress({ calls, total }: { calls: readonly Call[]; total: number }) {
  return (
    <View style={styles.progress} {...DECORATIVE}>
      {Array.from({ length: total }, (_, i) => {
        const call = calls[i];
        const tone =
          call === 'fair'
            ? color.positive
            : call === 'too_high' || call === 'too_low'
              ? color.negative
              : call === 'skip'
                ? color.textFaint
                : i === calls.length
                  ? color.text
                  : color.line;
        return <View key={i} style={[styles.pip, { backgroundColor: tone }]} />;
      })}
    </View>
  );
}

interface CardProps {
  card: BootCard;
  width: number;
  height: number;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
}

type StampKind = Call;

const STAMP: Record<StampKind, { label: string; tone: () => string }> = {
  fair: { label: 'FAIR', tone: () => color.positive },
  too_low: { label: '▲ HIGHER', tone: () => color.positive },
  too_high: { label: '▼ LOWER', tone: () => color.negative },
  skip: { label: 'PASS', tone: () => color.silver },
};

function TopCard({
  card,
  width,
  height,
  tx,
  ty,
  phase,
  stamp = null,
  slam,
}: CardProps & { phase: Phase; stamp?: StampKind | null; slam?: SharedValue<number> }) {
  const slammed = useAnimatedStyle(() => {
    const k = slam ? slam.value : 0;
    return { opacity: Math.min(1, k * 1.6), transform: [{ rotate: '-11deg' }, { scale: 1.7 - 0.7 * k }] };
  });
  const line = width * COMMIT;
  const lift = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, 0, width], [-14, 0, 14], Extrapolation.CLAMP)}deg` },
    ],
  }));
  const fair = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [line * 0.2, line], [0, 1], Extrapolation.CLAMP),
  }));
  const off = useAnimatedStyle(() => ({
    opacity: phase === 'judge' ? interpolate(tx.value, [-line, -line * 0.2], [1, 0], Extrapolation.CLAMP) : 0,
  }));
  const higher = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [-line, -line * 0.2], [1, 0], Extrapolation.CLAMP),
  }));
  const lower = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [line * 0.2, line], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View
      style={[styles.cardWrap, { width, height }, lift]}
      accessible
      accessibilityLabel={`${displayName(card)}. ${card.year} ${franchise(card.franchiseId).name}. Rated ${card.rating.toFixed(1)}.`}
    >
      <Face card={card} asking={phase === 'which'} />
      {stamp ? (
        <View style={styles.slamSeat} pointerEvents="none">
          <Animated.View style={[styles.slam, { borderColor: STAMP[stamp].tone() }, slammed]}>
            <Text style={[styles.slamText, { color: STAMP[stamp].tone() }]}>{STAMP[stamp].label}</Text>
          </Animated.View>
        </View>
      ) : null}
      {/* The drag stamps follow a finger; a remote has none, and they doubled
          up with the stamp above as the card flew. */}
      {isTV ? null : (
        <>
        <Animated.View style={[styles.stamp, styles.stampLeft, { borderColor: color.positive }, fair]} pointerEvents="none">
          <Text style={[styles.stampText, { color: color.positive }]}>FAIR</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampRight, { borderColor: color.negative }, off]} pointerEvents="none">
          <Text style={[styles.stampText, { color: color.negative }]}>OFF</Text>
        </Animated.View>
        {phase === 'which' ? (
          <>
            <Animated.View style={[styles.stamp, styles.stampTop, { borderColor: color.positive }, higher]} pointerEvents="none">
              <Text style={[styles.stampText, { color: color.positive }]}>▲ HIGHER</Text>
            </Animated.View>
            <Animated.View style={[styles.stamp, styles.stampBottom, { borderColor: color.negative }, lower]} pointerEvents="none">
              <Text style={[styles.stampText, { color: color.negative }]}>▼ LOWER</Text>
            </Animated.View>
          </>
        ) : null}
        </>
      )}
    </Animated.View>
  );
}

/** The next card, waiting underneath and rising to meet the finger. */
function BackCard({ card, width, height, tx, ty }: CardProps) {
  // TV: each new card deals in from below rather than appearing in place.
  const dealt = useSharedValue(isTV ? 0 : 1);
  useEffect(() => {
    if (isTV) dealt.value = withSpring(1, { damping: 16, stiffness: 140, reduceMotion: ReduceMotion.System });
  }, [dealt]);
  const rise = useAnimatedStyle(() => {
    const travel = Math.min(1, Math.max(Math.abs(tx.value), Math.abs(ty.value)) / (width * 0.8));
    return {
      opacity: (0.55 + travel * 0.45) * dealt.value,
      transform: [{ scale: 0.93 + travel * 0.07 }, { translateY: 14 - travel * 14 + (1 - dealt.value) * 90 }],
    };
  });
  return (
    <Animated.View style={[styles.cardWrap, styles.back, { width, height }, rise]} pointerEvents="none" {...DECORATIVE}>
      <Face card={card} asking={false} />
    </Animated.View>
  );
}

function Face({ card, asking }: { card: BootCard; asking: boolean }) {
  const stats = useCardStats(card);
  const team = franchise(card.franchiseId);
  const accent = positionColor[card.position];
  const wash = team.color || color.navy;
  const wash2 = team.color2 || wash;
  return (
    <View style={[styles.face, { borderColor: `${wash}99` }]}>
      {/* In a wrapper the size of the face. An Svg sized "100%" directly in
          the padded face takes the padding off its size and stops short --
          a band of bare card down the right and along the bottom. */}
      <View style={styles.wash} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={`gc-${card.id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={wash} stopOpacity="0.6" />
            <Stop offset="0.55" stopColor={wash2} stopOpacity="0.16" />
            <Stop offset="1" stopColor={color.void} stopOpacity="0.5" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#gc-${card.id})`} />
      </Svg>
      </View>
      <View style={styles.faceTop}>
        <View style={[styles.position, { borderColor: `${accent}80`, backgroundColor: `${accent}22` }]}>
          <Text style={[styles.positionText, { color: accent }]}>{card.position}</Text>
        </View>
        <Text style={styles.year}>{card.year}</Text>
      </View>

      <View>
        <Text style={styles.name} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
          {displayName(card)}
        </Text>
        <Text style={styles.team} numberOfLines={1}>
          {team.name} · {eraLabel(card.era)}
        </Text>
      </View>

      <View style={styles.ratingRow}>
        <Text style={styles.ratingLabel}>{asking ? 'Rated' : '17-0 rating'}</Text>
        <Text style={styles.rating}>{card.rating.toFixed(1)}</Text>
      </View>

      <View style={styles.chips}>
        {stats.slice(0, 3).map((stat) => (
          <View key={stat.label} style={styles.chip}>
            <Text style={styles.chipValue} numberOfLines={1}>{stat.value}</Text>
            <Text style={styles.chipLabel} numberOfLines={1}>{stat.label}</Text>
          </View>
        ))}
        <View style={styles.chip}>
          <Text style={styles.chipValue}>{card.games}</Text>
          <Text style={styles.chipLabel}>GAMES</Text>
        </View>
      </View>
    </View>
  );
}

function RoundButton({
  glyph,
  label,
  tone,
  onPress,
  a11y,
}: {
  glyph: string;
  label: string;
  tone: string;
  onPress: () => void;
  a11y: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      // On a TV these are the legend for the remote's directions, not focus
      // stops: a swipe has to mean a call, never "move to the next button".
      focusable={!isTV}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={styles.roundWrap}
    >
      {({ pressed, hovered }: PressState) => (
        <>
          <View
            style={[
              styles.round,
              { borderColor: `${tone}88`, backgroundColor: hovered || pressed ? `${tone}2A` : `${tone}14` },
              pressed && { transform: [{ scale: 0.92 }] },
            ]}
          >
            <Text style={[styles.roundGlyph, { color: tone }]}>{glyph}</Text>
          </View>
          <Text style={styles.roundLabel}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

function SkipButton({ onPress, label = 'Don’t know' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      // Where the remote rests on a TV, so a click is "Don't know".
      hasTVPreferredFocus
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={10}
      style={styles.skip}
    >
      {({ hovered }: PressState) => <Text style={[styles.skipText, hovered && { color: color.text }]}>{label}</Text>}
    </Pressable>
  );
}

/**
 * TV: the remote's touch surface in miniature, with a fingertip showing the
 * swipe the deck is waiting for. One Reanimated repeat on the UI thread.
 */
function RemoteHint({ phase }: { phase: Phase }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = 0;
    t.value = withRepeat(
      withSequence(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.cubic) }), withDelay(500, withTiming(0, { duration: 0 }))),
      -1,
      false,
      undefined,
      ReduceMotion.System,
    );
  }, [phase, t]);
  const finger = useAnimatedStyle(() => {
    const travel = (t.value - 0.5) * 34;
    const fade = Math.sin(Math.PI * t.value);
    return {
      opacity: fade,
      transform: phase === 'judge' ? [{ translateX: travel }] : [{ translateY: -travel }],
    };
  });
  return (
    <View style={styles.remoteRow} {...DECORATIVE}>
      <View style={styles.remotePad}>
        <Animated.View style={[styles.remoteDot, finger]} />
      </View>
      <Text style={styles.remoteText}>
        {phase === 'judge' ? '→ Fair     ← Off     Click: pass' : '↑ Higher     ↓ Lower     Click: fair'}
      </Text>
    </View>
  );
}

function RoundEnd({ calls, onAgain, onDone }: { calls: readonly Call[]; onAgain: () => void; onDone: () => void }) {
  const s = summarize(calls);
  const scale = useSharedValue(0.9);
  useEffect(() => {
    scale.value = withSpring(1, { damping: 12, stiffness: 160, reduceMotion: ReduceMotion.System });
  }, [scale]);
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[styles.end, pop]}>
      <Text style={styles.endKicker}>Your round</Text>
      <Text style={styles.endTitle}>{s.title}</Text>
      <Text style={styles.endLine}>{s.line}</Text>
      <View style={styles.tiles}>
        <Tile value={s.fair} label="Fair" tone={color.positive} />
        <Tile value={s.tooLow} label="Should be higher" tone={color.positive} />
        <Tile value={s.tooHigh} label="Should be lower" tone={color.negative} />
      </View>
      {s.skipped > 0 ? <Text style={styles.endNote}>{s.skipped} skipped</Text> : null}
      <Text style={styles.endNote}>
        Every call goes into the next ratings refit. None of them changes a score.
      </Text>
      <Pressable onPress={onAgain} hasTVPreferredFocus accessibilityRole="button" accessibilityLabel="Another ten" style={styles.primary}>
        {({ pressed }: PressState) => (
          <Text style={[styles.primaryText, pressed && { opacity: 0.8 }]}>Another 10</Text>
        )}
      </Pressable>
      <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel="Done" hitSlop={10} style={styles.skip}>
        {({ hovered }: PressState) => <Text style={[styles.skipText, hovered && { color: color.text }]}>Done</Text>}
      </Pressable>
    </Animated.View>
  );
}

function Tile({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, { color: tone }]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.lg,
      paddingTop: space.sm,
    },
    close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    closeText: { fontFamily: font.bodyBold, fontSize: 18, color: color.textDim },
    titleBlock: { alignItems: 'center' },
    kicker: {
      fontFamily: font.label,
      fontSize: 13,
      letterSpacing: tracking.wide,
      textTransform: 'uppercase',
      color: color.action,
    },
    count: { fontFamily: font.display, fontSize: 20, color: color.text, ...tabular },
    progress: { flexDirection: 'row', gap: 4, paddingHorizontal: space.xl, paddingTop: space.sm },
    pip: { flex: 1, height: 4, borderRadius: 2 },
    prompt: {
      fontFamily: font.display,
      fontSize: 24,
      color: color.text,
      textAlign: 'center',
      marginTop: space.lg,
    },
    stage: { alignItems: 'center', justifyContent: 'center', marginTop: space.md },
    cardWrap: { position: 'absolute' },
    back: {},
    face: {
      flex: 1,
      borderRadius: radius.xl,
      borderWidth: 1.5,
      overflow: 'hidden',
      backgroundColor: color.surfaceRaised,
      padding: space.lg,
      justifyContent: 'space-between',
    },
    faceTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    position: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
    positionText: { fontFamily: font.label, fontSize: 14, letterSpacing: tracking.wide },
    year: { fontFamily: font.display, fontSize: 22, color: color.silver, ...tabular },
    name: { fontFamily: font.display, fontSize: 34, lineHeight: 36, color: color.text },
    team: { fontFamily: font.body, fontSize: 14, color: color.silver, marginTop: space.xs },
    ratingRow: { alignItems: 'flex-start' },
    ratingLabel: {
      fontFamily: font.label,
      fontSize: 12,
      letterSpacing: tracking.wide,
      textTransform: 'uppercase',
      color: color.textDim,
    },
    rating: { fontFamily: font.display, fontSize: 72, lineHeight: 76, color: color.text, ...tabular },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    chip: {
      backgroundColor: color.scrim,
      borderRadius: radius.md,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      minWidth: 60,
    },
    chipValue: { fontFamily: font.bodyBold, fontSize: 14, color: color.text, ...tabular },
    chipLabel: { fontFamily: font.label, fontSize: 10, letterSpacing: tracking.wide, color: color.textDim },
    wash: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    tvColumn: { width: '100%', maxWidth: 620, alignSelf: 'center' },
    tvDeck: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xxxl, marginTop: space.sm },
    tvUnder: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xxl, marginTop: space.md },
    slamSeat: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    slam: {
      borderWidth: 5,
      borderRadius: radius.lg,
      paddingHorizontal: space.xl,
      paddingVertical: space.sm,
      backgroundColor: color.scrim,
    },
    slamText: { fontFamily: font.display, fontSize: 54, letterSpacing: tracking.wider },
    remoteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md },
    remotePad: {
      width: 56,
      height: 56,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: color.lineBright,
      backgroundColor: color.scrim,
      alignItems: 'center',
      justifyContent: 'center',
    },
    remoteDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: color.text },
    remoteText: { fontFamily: font.label, fontSize: 15, letterSpacing: tracking.normal, color: color.silver },
    stamp: {
      position: 'absolute',
      borderWidth: 3,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      backgroundColor: color.scrim,
    },
    stampLeft: { top: space.xl + 24, left: space.lg, transform: [{ rotate: '-14deg' }] },
    stampRight: { top: space.xl + 24, right: space.lg, transform: [{ rotate: '14deg' }] },
    stampTop: { top: space.lg, alignSelf: 'center' },
    stampBottom: { bottom: space.lg, alignSelf: 'center' },
    stampText: { fontFamily: font.display, fontSize: 30, letterSpacing: tracking.wide },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.xl,
      marginTop: space.xl,
    },
    roundWrap: { alignItems: 'center', gap: space.xs },
    round: {
      width: 64,
      height: 64,
      borderRadius: 32,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    roundGlyph: { fontFamily: font.bodyBold, fontSize: 26 },
    roundLabel: { fontFamily: font.label, fontSize: 13, letterSpacing: tracking.wide, color: color.silver },
    skip: { paddingHorizontal: space.sm, paddingVertical: space.sm, minWidth: 72, alignItems: 'center' },
    skipText: { fontFamily: font.body, fontSize: 13, color: color.textDim, textDecorationLine: 'underline' },
    hint: {
      fontFamily: font.body,
      fontSize: 12,
      color: color.textFaint,
      textAlign: 'center',
      marginTop: space.md,
      paddingHorizontal: space.xl,
    },
    end: { alignItems: 'center', paddingHorizontal: space.xl, marginTop: space.xxl, gap: space.sm },
    endKicker: {
      fontFamily: font.label,
      fontSize: 13,
      letterSpacing: tracking.wide,
      textTransform: 'uppercase',
      color: color.textDim,
    },
    endTitle: { fontFamily: font.display, fontSize: 44, color: color.text, textAlign: 'center' },
    endLine: { fontFamily: font.body, fontSize: 15, color: color.silver, textAlign: 'center' },
    tiles: { flexDirection: 'row', gap: space.sm, marginTop: space.lg, alignSelf: 'stretch' },
    tile: {
      flex: 1,
      backgroundColor: color.surfaceRaised,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.line,
      paddingVertical: space.md,
      alignItems: 'center',
    },
    tileValue: { fontFamily: font.display, fontSize: 34, ...tabular },
    tileLabel: { fontFamily: font.label, fontSize: 11, color: color.textDim, textAlign: 'center', letterSpacing: tracking.wide },
    endNote: { fontFamily: font.body, fontSize: 12, color: color.textFaint, textAlign: 'center' },
    primary: {
      marginTop: space.lg,
      backgroundColor: color.action,
      borderRadius: radius.pill,
      paddingHorizontal: space.xxl,
      paddingVertical: space.md,
      alignSelf: 'stretch',
      alignItems: 'center',
    },
    primaryText: { fontFamily: font.display, fontSize: 20, color: color.onAction, letterSpacing: tracking.wide },
  }),
);
