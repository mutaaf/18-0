import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { ROSTER_SLOTS, isPerfectionDenied, type RosterSlot } from '@18-0/domain';
import { displayName, eraLabel, franchise } from '@18-0/data';
import { Brand } from '@/components/Brand';
import { ShareCard, type ShareRosterRow } from '@/components/ShareCard';
import { shareResult } from '@/features/share';
import { Screen } from '@/components/Screen';
import { RatingBadge } from '@/components/RatingBadge';
import { lookupCard, useGameStore } from '@/state/game';
import { color, elevate, font, positionColor, radius, space, tabular, tierColor, tracking, useLayout, type PressState } from '@/theme';

/**
 * The reveal is the payoff, so it is orchestrated rather than scattered: the
 * record lands first, the verdict follows, then the roster fills in row by row.
 * Every animation defers to the system Reduce Motion setting (PRFAQ §34).
 */
const enter = (delay: number, distance = 14) =>
  FadeInDown.delay(delay)
    .duration(380)
    .easing(Easing.out(Easing.cubic))
    .withInitialValues({ transform: [{ translateY: distance }] })
    .reduceMotion(ReduceMotion.System);

export default function Result() {
  const router = useRouter();
  const layout = useLayout();
  const game = useGameStore();
  const result = game.result;

  // 18-0 gets a slow breathing glow. Nothing else in the app is gold, so this
  // reads as the moment it is.
  const glow = useSharedValue(0);
  const glowStyle = useAnimatedStyle(() => ({ shadowOpacity: 0.28 + glow.value * 0.34 }));

  useEffect(() => {
    if (!result) router.replace('/(tabs)');
  }, [result]);

  useEffect(() => {
    if (!result) return;
    const wins = result.record.wins;
    if (wins >= 12) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else if (wins >= 9) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, [result?.finalRating]);

  useEffect(() => {
    if (result?.ending.key !== 'PERFECT') return;
    glow.value = withDelay(
      420,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        false,
        undefined,
        ReduceMotion.System,
      ),
    );
  }, [result?.ending.key]);

  const cardRef = useRef<View>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const rosterCards = useMemo(
    () =>
      game.selections
        .map((s) => ({ slot: s.slot, card: lookupCard(s.cardId) }))
        .filter((x): x is { slot: RosterSlot; card: NonNullable<ReturnType<typeof lookupCard>> } => !!x.card)
        .sort((a, b) => ROSTER_SLOTS.indexOf(a.slot) - ROSTER_SLOTS.indexOf(b.slot)),
    [game.selections],
  );

  const shareRows: ShareRosterRow[] = useMemo(
    () =>
      rosterCards.map(({ slot, card }) => ({
        slot,
        name: displayName(card),
        abbr: franchise(card.franchiseId).abbr,
        year: card.year,
        rating: card.rating,
        position: card.position,
      })),
    [rosterCards],
  );

  // Every hook above this line: `abandon()` and `removeSelection()` both null
  // the result while this screen can be mounted, and a conditional return below
  // a hook throws "rendered fewer hooks than expected".
  if (!result) return <Screen><View /></Screen>;

  const perfect = result.ending.key === 'PERFECT';
  const denied = isPerfectionDenied(result);
  const heartbreak = result.ending.key === 'HEARTBREAK';
  const accent = perfect ? color.gold : tierColor[result.ending.tier] ?? color.text;

  // PRFAQ §22.4: "visual state should change based on result tier". The numerals
  // grow with the achievement, so a 16-2 does not land like a 5-13.
  const wins = result.record.wins;
  const recordSize = wins >= 17 ? 108 : wins >= 14 ? 96 : wins >= 9 ? 82 : 66;

  const share = () => {
    void shareResult(cardRef, result, shareRows).then((mode) => {
      if (mode === 'text') setShareNote('Shared as text — the image could not be generated.');
    });
  };

  const buildAnother = () => {
    game.startGame();
    router.replace('/play');
  };

  const verdict = (
    <View style={styles.verdictColumn}>
      <Animated.View
        entering={enter(0, 18)}
        style={[styles.hero, { borderColor: `${accent}59` }, perfect && styles.heroPerfect, perfect && glowStyle]}
          accessible
          accessibilityLabel={`Final result. ${result.record.wins} and ${result.record.losses}. ${result.ending.label}. Tier ${result.ending.tier}. Rating ${result.finalRating.toFixed(1)}.`}
        >
          <Text style={styles.heroKicker}>Projected Record</Text>
          <Animated.View entering={enter(90, 10)} style={styles.recordRow}>
            <Text
              maxFontSizeMultiplier={1.2}
              style={[styles.recordNum, { fontSize: recordSize, lineHeight: recordSize * 1.06 },
                perfect && { color: color.goldBright }]}
            >
              {result.record.wins}
            </Text>
            <View style={[styles.recordDash, { backgroundColor: accent }]} />
            <Text
              maxFontSizeMultiplier={1.2}
              style={[styles.recordNum, { fontSize: recordSize, lineHeight: recordSize * 1.06 },
                perfect && { color: color.goldBright }]}
            >
              {result.record.losses}
            </Text>
          </Animated.View>
          <Animated.Text entering={enter(220, 8)} style={[styles.endingName, { color: accent }]}>
            {perfect ? 'PERFECT' : result.ending.label.toUpperCase()}
          </Animated.Text>
          <Animated.View entering={enter(300, 6)} style={styles.heroMeta}>
            <Text style={styles.tier}>
              TIER <Text style={{ color: accent }}>{result.ending.tier}</Text>
            </Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.rating}>
              {result.finalRating.toFixed(1)} <Text style={styles.ratingLabel}>18-0 RATING</Text>
            </Text>
          </Animated.View>
        </Animated.View>

      {game.mode === 'player_iq' ? (
        <View style={styles.blindBadge}>
          <Text style={styles.blindBadgeText}>Built blind · Player IQ</Text>
        </View>
      ) : null}

      {game.assisted ? (
        <View style={styles.assisted}>
          <Text style={styles.assistedTitle}>Assisted</Text>
          <Text style={styles.assistedCopy}>
            A rigged spin was used, so this season is saved but kept out of your records.
          </Text>
        </View>
      ) : null}

      {perfect ? (
        <Animated.View entering={enter(420, 10)} style={styles.immortal}>
            <Text style={styles.immortalWord}>IMMORTAL</Text>
          <Text style={styles.immortalCopy}>
            No weaknesses. No compromises. A roster for the ages.
          </Text>
        </Animated.View>
      ) : null}

      {denied ? (
        <Animated.View entering={enter(420, 10)} style={styles.denied}>
            <Text style={styles.deniedTitle}>Perfection Denied</Text>
            <Text style={styles.deniedCopy}>
              This roster cleared the {result.perfectEligibility.reachedThreshold ? '' : ''}
              18-0 score. It failed the gates.
            </Text>
          {result.perfectEligibility.failedGates.slice(0, 3).map((gate) => (
            <Text key={`${gate.kind}-${gate.slot}`} style={styles.deniedGate}>
              — {gate.message}
            </Text>
          ))}
        </Animated.View>
      ) : heartbreak ? (
        <Animated.View entering={enter(420, 10)} style={styles.heartbreak}>
            <Text style={styles.heartbreakTitle}>Heartbreak</Text>
            <Text style={styles.heartbreakCopy}>
              One loss from immortality. {result.distanceFromPerfection.toFixed(2)} rating points short
              of the 18-0 threshold.
            </Text>
        </Animated.View>
      ) : (
        <View style={styles.gap}>
          <Text style={styles.gapLabel}>Distance from 18-0</Text>
          <Text style={styles.gapValue}>{result.distanceFromPerfection.toFixed(2)}</Text>
        </View>
      )}

      <Animated.View entering={enter(560, 10)} style={styles.actions}>
        <Pressable
          style={({ pressed, hovered }: PressState) => [styles.primary, hovered && styles.lift, pressed && { opacity: 0.85 }]}
          onPress={buildAnother}
          accessibilityRole="button"
          accessibilityLabel="Build another roster"
        >
          <Text style={styles.primaryLabel}>Build Another</Text>
        </Pressable>
        <Pressable
          style={({ pressed, hovered }: PressState) => [styles.secondary, hovered && { borderColor: color.textDim }, pressed && { opacity: 0.85 }]}
          onPress={share}
          accessibilityRole="button"
          accessibilityLabel="Share this result"
        >
          <Text style={styles.secondaryLabel}>Share</Text>
        </Pressable>
      </Animated.View>
      {shareNote ? (
        <Text style={styles.shareNote} accessibilityLiveRegion="polite">
          {shareNote}
        </Text>
      ) : null}
    </View>
  );

  const detail = (
    <View style={styles.detailColumn}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Roster</Text>
        {rosterCards.map(({ slot, card }, index) => (
          <Animated.View
            key={slot}
            entering={enter(320 + index * 55)}
            style={styles.rosterRow}
            accessible
            accessibilityLabel={`${slot}. ${displayName(card)}. ${card.year} ${franchise(card.franchiseId).name}. Rating ${card.rating.toFixed(1)}.`}
          >
              <Text style={[styles.rosterSlot, { color: positionColor[card.position] }]}>{slot}</Text>
              <View style={styles.rosterMain}>
                <Text style={styles.rosterName} numberOfLines={1}>
                  {displayName(card)}
                </Text>
                <Text style={styles.rosterMeta}>
                  {franchise(card.franchiseId).abbr} · {card.year} · {eraLabel(card.era)}
                </Text>
              </View>
            <RatingBadge rating={card.rating} size="sm" />
          </Animated.View>
        ))}
      </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>How it scored</Text>
          <Breakdown label="Weighted roster rating" value={result.breakdown.baseRating.toFixed(2)} />
          <Breakdown
            label="Weak-link penalty"
            value={result.breakdown.weakLinkPenalty > 0 ? `−${result.breakdown.weakLinkPenalty.toFixed(2)}` : '0.00'}
            tone={result.breakdown.weakLinkPenalty > 0 ? color.negative : undefined}
          />
          <Breakdown
            label="Elite depth bonus"
            value={`+${result.breakdown.eliteBonus.toFixed(2)}`}
            tone={result.breakdown.eliteBonus > 0 ? color.positive : undefined}
          />
          <Breakdown
            label="Chemistry"
            value={`${result.breakdown.chemistryBonus >= 0 ? '+' : '−'}${Math.abs(result.breakdown.chemistryBonus).toFixed(2)}`}
            tone={result.breakdown.chemistryBonus === 0 ? undefined : result.breakdown.chemistryBonus > 0 ? color.positive : color.negative}
          />
          {result.breakdown.chemistryDetail.links.length > 0 ? (
            <View style={styles.chemistry}>
              {result.breakdown.chemistryDetail.links.map((link) => (
                <Text key={link.key} style={styles.chemistryItem}>
                  {link.value >= 0 ? '+' : '−'}
                  {Math.abs(link.value).toFixed(2)}  {link.label}
                </Text>
              ))}
            </View>
          ) : null}
          {result.breakdown.weakLinkDetail.length > 0 ? (
            <Text style={styles.weakest}>
              Biggest drag: {result.breakdown.weakLinkDetail[0]!.slot} at{' '}
              {result.breakdown.weakLinkDetail[0]!.rating.toFixed(1)}
            </Text>
          ) : null}
        </View>

      <Text style={styles.modelNote}>
        Scoring model {result.ratingModelVersion} · deterministic. The same roster always earns the
        same record.
      </Text>
    </View>
  );

  return (
    <Screen maxWidth={layout.wide ? 1080 : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Brand size={20} />
          <Pressable onPress={() => router.replace('/(tabs)')} hitSlop={12} accessibilityRole="button" accessibilityLabel="Done">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        {layout.wide ? (
          <View style={styles.split}>
            {verdict}
            {detail}
          </View>
        ) : (
          <>
            {verdict}
            {detail}
          </>
        )}
      </ScrollView>

      {/* Rendered off-screen at a fixed size so the captured image is
          identical on every device. */}
      <View
        style={styles.captureHost}
        pointerEvents="none"
        collapsable={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <ShareCard ref={cardRef} result={result} roster={shareRows} assisted={game.assisted} />
      </View>
    </Screen>
  );
}

function Breakdown({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <Text style={[styles.breakdownValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: space.xl, paddingBottom: 60, gap: space.lg },
  split: { flexDirection: 'row', gap: space.xxxl, alignItems: 'flex-start' },
  verdictColumn: { flex: 1, gap: space.lg, minWidth: 0 },
  detailColumn: { flex: 1, gap: space.xl, minWidth: 0 },
  lift: { transform: [{ translateY: -1 }] },
  captureHost: { position: 'absolute', left: -10000, top: 0, opacity: 0 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.sm },
  close: {
    fontFamily: font.body,
    fontSize: 18,
    color: color.textDim,
    minWidth: 44,
    minHeight: 44,
    lineHeight: 44,
    textAlign: 'center',
  },
  hero: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    backgroundColor: '#0A0E13B3',
  },
  heroPerfect: {
    backgroundColor: '#1A140099',
    shadowColor: color.gold,
    ...elevate(14),
    shadowOffset: { width: 0, height: 0 },
  },
  heroKicker: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 2 },
  recordNum: {
    fontFamily: font.displayBlack,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
    ...tabular,
  },
  recordDash: { width: 26, height: 7, borderRadius: 4 },
  endingName: {
    fontFamily: font.display,
    fontSize: 30,
    letterSpacing: tracking.wide,
    marginTop: -4,
    includeFontPadding: false,
  },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  tier: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, color: color.textFaint },
  dot: { color: color.textFaint },
  rating: { fontFamily: font.heading, fontSize: 15, color: color.text, ...tabular },
  ratingLabel: { fontFamily: font.label, fontSize: 9, letterSpacing: tracking.wide, color: color.textFaint },
  blindBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#B47CFF66',
    backgroundColor: '#B47CFF14',
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 4,
  },
  blindBadgeText: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: '#C9A6FF',
    textTransform: 'uppercase',
  },
  assisted: {
    borderWidth: 1,
    borderColor: '#F2C43D40',
    backgroundColor: '#F2C43D0D',
    borderRadius: radius.md,
    padding: space.md,
    gap: 2,
  },
  assistedTitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.gold,
    textTransform: 'uppercase',
  },
  assistedCopy: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textDim, lineHeight: 17 },
  immortal: { alignItems: 'center', gap: 4 },
  immortalWord: {
    fontFamily: font.displayBlack,
    fontSize: 22,
    letterSpacing: 8,
    color: color.goldBright,
    includeFontPadding: false,
  },
  immortalCopy: { fontFamily: font.body, fontSize: 13, color: color.textDim, textAlign: 'center' },
  denied: {
    borderWidth: 1,
    borderColor: '#FF6B6B4D',
    backgroundColor: '#FF6B6B0F',
    borderRadius: radius.md,
    padding: space.lg,
    gap: 4,
  },
  deniedTitle: {
    fontFamily: font.display,
    fontSize: 19,
    letterSpacing: tracking.wide,
    color: color.negative,
    textTransform: 'uppercase',
  },
  deniedCopy: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim, lineHeight: 19 },
  deniedGate: { fontFamily: font.body, fontSize: 13, color: color.text, marginTop: 3 },
  heartbreak: {
    borderWidth: 1,
    borderColor: '#7FB2FF40',
    backgroundColor: '#7FB2FF0D',
    borderRadius: radius.md,
    padding: space.lg,
    gap: 4,
  },
  heartbreakTitle: {
    fontFamily: font.display,
    fontSize: 19,
    letterSpacing: tracking.wide,
    color: color.ice,
    textTransform: 'uppercase',
  },
  heartbreakCopy: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim, lineHeight: 19 },
  gap: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  gapLabel: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  gapValue: { fontFamily: font.display, fontSize: 22, color: color.textDim },
  section: { gap: 6 },
  sectionTitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  rosterSlot: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, width: 34 },
  rosterMain: { flex: 1, minWidth: 0 },
  rosterName: { fontFamily: font.heading, fontSize: 15, color: color.text },
  rosterMeta: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  breakdownLabel: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim },
  breakdownValue: { fontFamily: font.heading, fontSize: 14, color: color.text },
  chemistry: { gap: 2, marginTop: 2, paddingLeft: space.sm },
  chemistryItem: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
  weakest: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint, marginTop: 4 },
  actions: { flexDirection: 'row', gap: space.sm },
  primary: {
    flex: 1,
    backgroundColor: color.red,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryLabel: {
    fontFamily: font.display,
    fontSize: 17,
    letterSpacing: tracking.wide,
    color: '#fff',
    textTransform: 'uppercase',
  },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
  },
  secondaryLabel: {
    fontFamily: font.display,
    fontSize: 17,
    letterSpacing: tracking.wide,
    color: color.text,
    textTransform: 'uppercase',
  },
  shareNote: {
    fontFamily: font.bodyRegular,
    fontSize: 11,
    color: color.textDim,
    textAlign: 'center',
  },
  modelNote: {
    fontFamily: font.bodyRegular,
    fontSize: 10,
    color: color.textFaint,
    textAlign: 'center',
    lineHeight: 15,
  },
});
