import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Animated, Easing } from 'react-native';
import { ROSTER_SLOTS, isPerfectionDenied, type RosterSlot } from '@18-0/domain';
import { displayName, eraLabel, franchise } from '@18-0/data';
import { Brand } from '@/components/Brand';
import { Reveal } from '@/components/Reveal';
import { Crown } from '@/components/Crown';
import { Screen } from '@/components/Screen';
import { RatingBadge } from '@/components/RatingBadge';
import { ShareCard, type ShareRosterRow } from '@/components/ShareCard';
import { shareResult } from '@/features/share';
import { lookupCard, useGameStore } from '@/state/game';
import { useHistoryStore } from '@/state/history';
import {
  color,
  elevate,
  font,
  positionColor,
  radius,
  space,
  tabular,
  tierColor,
  tracking,
  useLayout,
  type PressState,
} from '@/theme';

/**
 * The reveal does two jobs: land the result hard, and make the next spin feel
 * inevitable. So the distance from 18-0 is the second thing on the page rather
 * than a footnote — the whole product is the chase.
 */
const PERFECT_THRESHOLD = 98.5;

export default function Result() {
  const router = useRouter();
  const layout = useLayout();
  const game = useGameStore();
  const history = useHistoryStore((s) => s.games);
  const result = game.result;

  const cardRef = useRef<View>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);

  // 18-0 breathes and wears the crown. Nothing else in the app does either.
  const glow = useRef(new Animated.Value(0)).current;
  const crownLift = useRef(new Animated.Value(0)).current;

  const rosterCards = useMemo(
    () =>
      game.selections
        .map((s) => ({ slot: s.slot, card: lookupCard(s.cardId) }))
        .filter(
          (x): x is { slot: RosterSlot; card: NonNullable<ReturnType<typeof lookupCard>> } => !!x.card,
        )
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

  /** The best honest run before this one, so the result can say if it was beaten. */
  const previousBest = useMemo(() => {
    const ratings = history
      .filter((g) => !g.assisted)
      .map((g) => g.result.finalRating)
      .sort((a, b) => b - a);
    return ratings.length > 1 ? ratings[1]! : null;
  }, [history]);

  useEffect(() => {
    if (!result) return;
    const wins = result.record.wins;
    if (wins >= 12) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else if (wins >= 9) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, [result?.finalRating]);

  useEffect(() => {
    if (result?.ending.key !== 'PERFECT') return;
    Animated.spring(crownLift, {
      toValue: 1,
      delay: 260,
      damping: 9,
      stiffness: 140,
      mass: 1,
      useNativeDriver: true,
    }).start();
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 1700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 1700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [result?.ending.key]);

  useEffect(() => {
    if (!result) router.replace('/(tabs)');
  }, [result]);

  if (!result) {
    return (
      <Screen>
        <View style={styles.blank} />
      </Screen>
    );
  }

  const perfect = result.ending.key === 'PERFECT';
  const denied = isPerfectionDenied(result);
  const heartbreak = result.ending.key === 'HEARTBREAK';
  const accent = perfect ? color.gold : tierColor[result.ending.tier] ?? color.text;
  const wins = result.record.wins;

  // The record grows with the achievement (PRFAQ §22.4).
  const recordSize = layout.wide
    ? wins >= 17
      ? 128
      : wins >= 14
        ? 112
        : wins >= 9
          ? 98
          : 82
    : wins >= 17
      ? 94
      : wins >= 14
        ? 84
        : wins >= 9
          ? 74
          : 62;

  const share = () => {
    void shareResult(cardRef, result, shareRows).then((mode) => {
      if (mode === 'text') setShareNote('Shared as text — the image could not be generated.');
    });
  };

  const buildAnother = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    game.startGame();
    router.replace('/play');
  };

  const beatBest = previousBest !== null && result.finalRating > previousBest;
  const toPerfect = Math.max(0, PERFECT_THRESHOLD - result.finalRating);
  const progress = Math.min(1, result.finalRating / PERFECT_THRESHOLD);

  // ---------------------------------------------------------------- verdict

  const verdict = (
    <View style={styles.verdictColumn}>
      <Reveal delay={0}
        style={[styles.hero, { borderColor: `${accent}4D` }, perfect && styles.heroPerfect]}
        accessible
        accessibilityLabel={`Final result. ${wins} and ${result.record.losses}. ${result.ending.label}. Tier ${result.ending.tier}. Rating ${result.finalRating.toFixed(1)}.`}
      >
        {perfect ? (
          <>
            {/* A slow gold breath behind the record. Nothing else in the app
                pulses, so this reads as the moment it is. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.glow,
                { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.5] }) },
              ]}
            />
            <Animated.View
              style={{
                opacity: crownLift,
                transform: [
                  { scale: crownLift.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                  { translateY: crownLift.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
                ],
              }}
            >
              <Crown size={layout.wide ? 64 : 50} />
            </Animated.View>
          </>
        ) : null}

        <Text style={styles.kicker}>Projected Record</Text>

        <View style={styles.recordRow}>
          <Text
            maxFontSizeMultiplier={1.15}
            style={[
              styles.recordNum,
              { fontSize: recordSize, lineHeight: recordSize * 1.04 },
              perfect && styles.recordPerfect,
            ]}
          >
            {wins}
          </Text>
          <View style={[styles.recordBar, { backgroundColor: accent, height: recordSize * 0.09 }]} />
          <Text
            maxFontSizeMultiplier={1.15}
            style={[
              styles.recordNum,
              { fontSize: recordSize, lineHeight: recordSize * 1.04 },
              perfect && styles.recordPerfect,
            ]}
          >
            {result.record.losses}
          </Text>
        </View>

        <Text style={[styles.endingName, { color: accent }]}>
          {perfect ? 'PERFECT' : result.ending.label.toUpperCase()}
        </Text>

        {perfect ? <Text style={styles.immortal}>IMMORTAL</Text> : null}

        <View style={styles.heroMeta}>
          <Text style={styles.metaLabel}>
            TIER <Text style={{ color: accent }}>{result.ending.tier}</Text>
          </Text>
          <View style={styles.metaDot} />
          <Text style={styles.metaRating}>
            {result.finalRating.toFixed(1)}
            <Text style={styles.metaLabel}> RATING</Text>
          </Text>
        </View>
      </Reveal>

      {/* The hook: how close you came, and what it would take to go again. */}
      <Reveal delay={220} style={styles.chase}>
        {perfect ? (
          <Text style={styles.chaseHeadline}>
            No weaknesses. No compromises. A roster for the ages.
          </Text>
        ) : (
          <>
            <View style={styles.chaseHead}>
              <Text style={styles.chaseLabel}>Distance from 18-0</Text>
              <Text style={styles.chaseValue}>{toPerfect.toFixed(2)}</Text>
            </View>
            <View style={styles.meter}>
              <View style={[styles.meterFill, { width: `${progress * 100}%` }]} />
            </View>
            <Text style={styles.chaseCopy}>
              {denied
                ? 'You cleared the score. A gate stopped you.'
                : heartbreak
                  ? 'One loss from immortality.'
                  : beatBest
                    ? `A new personal best — ${previousBest!.toFixed(1)} was the mark. Go again.`
                    : 'Seven better picks and the crown is yours.'}
            </Text>
          </>
        )}
      </Reveal>

      {denied ? (
        <Reveal delay={300} style={styles.denied}>
          <Text style={styles.deniedTitle}>Perfection Denied</Text>
          {result.perfectEligibility.failedGates.slice(0, 3).map((gate) => (
            <Text key={`${gate.kind}-${gate.slot}`} style={styles.deniedGate}>
              {gate.message}
            </Text>
          ))}
        </Reveal>
      ) : null}

      {game.mode === 'player_iq' || game.assisted ? (
        <Reveal delay={340} style={styles.badgeRow}>
          {game.mode === 'player_iq' ? (
            <View style={[styles.badge, styles.badgeBlind]}>
              <Text style={styles.badgeBlindText}>Built blind · Player IQ</Text>
            </View>
          ) : null}
          {game.assisted ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Assisted · not counted</Text>
            </View>
          ) : null}
        </Reveal>
      ) : null}

      <Reveal delay={400} style={styles.actions}>
        <Pressable
          style={({ pressed, hovered }: PressState) => [
            styles.primary,
            hovered && styles.lift,
            pressed && { opacity: 0.88 },
          ]}
          onPress={buildAnother}
          accessibilityRole="button"
          accessibilityLabel="Build another roster"
        >
          <Text style={styles.primaryLabel}>Build Another</Text>
        </Pressable>
        <Pressable
          style={({ pressed, hovered }: PressState) => [
            styles.secondary,
            hovered && { borderColor: color.gold },
            pressed && { opacity: 0.85 },
          ]}
          onPress={share}
          accessibilityRole="button"
          accessibilityLabel="Share this result"
        >
          <Text style={styles.secondaryLabel}>Share</Text>
        </Pressable>
      </Reveal>

      {shareNote ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {shareNote}
        </Text>
      ) : null}
    </View>
  );

  // ----------------------------------------------------------------- detail

  const detail = (
    <View style={styles.detailColumn}>
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Roster</Text>
        {rosterCards.map(({ slot, card }, index) => (
          <Reveal
            key={slot}
            delay={280 + index * 50}
            style={styles.rosterRow}
            accessible
            accessibilityLabel={`${slot}. ${displayName(card)}. ${card.year} ${franchise(card.franchiseId).name}. Rating ${card.rating.toFixed(1)}.`}
          >
            <Text style={[styles.rosterSlot, { color: positionColor[card.position] }]}>{slot}</Text>
            <View style={styles.rosterMain}>
              <Text style={styles.rosterName} numberOfLines={1}>
                {displayName(card)}
              </Text>
              <Text style={styles.rosterMeta} numberOfLines={1}>
                {franchise(card.franchiseId).abbr} · {card.year} · {eraLabel(card.era)}
              </Text>
            </View>
            <RatingBadge rating={card.rating} size="sm" />
          </Reveal>
        ))}
      </View>

      <Reveal delay={560} style={styles.panel}>
        <Text style={styles.panelTitle}>How it scored</Text>
        <Line label="Weighted roster rating" value={result.breakdown.baseRating.toFixed(2)} />
        <Line
          label="Weak-link penalty"
          value={
            result.breakdown.weakLinkPenalty > 0
              ? `−${result.breakdown.weakLinkPenalty.toFixed(2)}`
              : '0.00'
          }
          tone={result.breakdown.weakLinkPenalty > 0 ? color.negative : undefined}
        />
        <Line
          label="Elite depth bonus"
          value={`+${result.breakdown.eliteBonus.toFixed(2)}`}
          tone={result.breakdown.eliteBonus > 0 ? color.positive : undefined}
        />
        <Line
          label="Chemistry"
          value={`${result.breakdown.chemistryBonus >= 0 ? '+' : '−'}${Math.abs(result.breakdown.chemistryBonus).toFixed(2)}`}
          tone={
            result.breakdown.chemistryBonus === 0
              ? undefined
              : result.breakdown.chemistryBonus > 0
                ? color.positive
                : color.negative
          }
        />
        {result.breakdown.weakLinkDetail.length > 0 ? (
          <Text style={styles.footnote}>
            Biggest drag: {result.breakdown.weakLinkDetail[0]!.slot} at{' '}
            {result.breakdown.weakLinkDetail[0]!.rating.toFixed(1)}
          </Text>
        ) : null}
      </Reveal>

      {result.breakdown.chemistryDetail.links.length > 0 ? (
        <Reveal delay={620} style={styles.panel}>
          <Text style={styles.panelTitle}>Chemistry</Text>
          {result.breakdown.chemistryDetail.links.map((link) => (
            <View key={link.key} style={styles.chemRow}>
              <Text style={styles.chemLabel} numberOfLines={1}>
                {link.label}
              </Text>
              <Text
                style={[
                  styles.chemValue,
                  { color: link.value >= 0 ? color.positive : color.negative },
                ]}
              >
                {link.value >= 0 ? '+' : '−'}
                {Math.abs(link.value).toFixed(2)}
              </Text>
            </View>
          ))}
        </Reveal>
      ) : null}

      <Text style={styles.modelNote}>
        Scoring model {result.ratingModelVersion} · deterministic. The same roster always earns the
        same record.
      </Text>
    </View>
  );

  return (
    <Screen maxWidth={layout.wide ? 760 : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Reveal delay={0} distance={0} style={styles.header}>
          <Brand size={22} tint={perfect ? color.goldBright : undefined} />
          <Pressable
            onPress={() => router.replace('/(tabs)')}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </Reveal>

        {verdict}
        {detail}
      </ScrollView>

      {/* Rendered off-screen at a fixed size so the captured image is identical
          on every device, and hidden from assistive tech. */}
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

function Line({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={[styles.lineValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1 },
  scroll: { paddingHorizontal: space.lg, paddingBottom: 60, gap: space.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.sm,
  },
  close: {
    fontFamily: font.body,
    fontSize: 18,
    color: color.textDim,
    minWidth: 44,
    minHeight: 44,
    lineHeight: 44,
    textAlign: 'center',
  },

  split: { flexDirection: 'row', gap: space.xxl, alignItems: 'flex-start', width: '100%' },
  verdictColumn: { gap: space.md, width: '100%' },
  detailColumn: { gap: space.md, width: '100%' },

  hero: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingTop: space.xl,
    paddingBottom: space.lg,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    backgroundColor: '#0C0D11E6',
  },
  glow: {
    position: 'absolute',
    top: -30,
    left: -30,
    right: -30,
    bottom: -30,
    borderRadius: 90,
    backgroundColor: color.gold,
  },
  heroPerfect: {
    backgroundColor: '#171204F2',
    borderColor: '#FFB40080',
    shadowColor: color.gold,
    ...elevate(14),
    shadowOffset: { width: 0, height: 0 },
  },
  kicker: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: 2 },
  recordNum: {
    fontFamily: font.display,
    color: color.text,
    includeFontPadding: false,
    textShadowColor: color.goldGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
    ...tabular,
  },
  recordPerfect: { color: color.goldBright },
  recordBar: { width: 26, borderRadius: 3 },
  endingName: {
    fontFamily: font.display,
    fontSize: 28,
    letterSpacing: tracking.wide,
    includeFontPadding: false,
    marginTop: 2,
  },
  immortal: {
    fontFamily: font.display,
    fontSize: 15,
    letterSpacing: 7,
    color: color.gold,
    marginTop: 4,
  },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  metaLabel: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    color: color.textFaint,
  },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: color.textFaint },
  metaRating: { fontFamily: font.display, fontSize: 17, color: color.text, ...tabular },

  chase: {
    borderWidth: 1,
    borderColor: color.lineGold,
    backgroundColor: '#FFB4000A',
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.sm,
  },
  chaseHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  chaseLabel: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.gold,
    textTransform: 'uppercase',
  },
  chaseValue: { fontFamily: font.display, fontSize: 26, color: color.text, ...tabular },
  chaseHeadline: {
    fontFamily: font.body,
    fontSize: 14,
    color: color.goldBright,
    textAlign: 'center',
    lineHeight: 20,
  },
  chaseCopy: { fontFamily: font.bodyRegular, fontSize: 12.5, color: color.textDim, lineHeight: 18 },
  meter: { height: 6, borderRadius: 3, backgroundColor: '#FFFFFF0F', overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3, backgroundColor: color.gold },

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
    fontSize: 18,
    letterSpacing: tracking.wide,
    color: color.negative,
    textTransform: 'uppercase',
  },
  deniedGate: { fontFamily: font.body, fontSize: 13, color: color.text },

  badgeRow: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  badge: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 4,
  },
  badgeText: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: color.textDim,
    textTransform: 'uppercase',
  },
  badgeBlind: { borderColor: '#C49BFF66', backgroundColor: '#C49BFF14' },
  badgeBlindText: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: '#C49BFF',
    textTransform: 'uppercase',
  },

  actions: { flexDirection: 'row', gap: space.sm },
  lift: { transform: [{ translateY: -1 }] },
  primary: {
    flex: 1.4,
    backgroundColor: color.red,
    borderRadius: radius.md,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.red,
    shadowOpacity: 0.5,
    ...elevate(8),
  },
  primaryLabel: {
    fontFamily: font.display,
    fontSize: 19,
    letterSpacing: tracking.wide,
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryLabel: {
    fontFamily: font.display,
    fontSize: 19,
    letterSpacing: tracking.wide,
    color: color.text,
    textTransform: 'uppercase',
  },
  note: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textDim, textAlign: 'center' },

  panel: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space.lg,
    backgroundColor: '#FFFFFF05',
  },
  panelTitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
    marginBottom: space.sm,
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  rosterSlot: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, width: 38 },
  rosterMain: { flex: 1, minWidth: 0 },
  rosterName: { fontFamily: font.heading, fontSize: 16, color: color.text },
  rosterMeta: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },

  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  lineLabel: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim, flex: 1 },
  lineValue: { fontFamily: font.display, fontSize: 15, color: color.text, ...tabular },
  footnote: {
    fontFamily: font.bodyRegular,
    fontSize: 11,
    color: color.textFaint,
    marginTop: space.sm,
  },

  chemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: 5,
  },
  chemLabel: { fontFamily: font.bodyRegular, fontSize: 12.5, color: color.textDim, flex: 1 },
  chemValue: { fontFamily: font.display, fontSize: 13, ...tabular },

  modelNote: {
    fontFamily: font.bodyRegular,
    fontSize: 10,
    color: color.textFaint,
    textAlign: 'center',
    lineHeight: 15,
  },
  captureHost: { position: 'absolute', left: -10000, top: 0, opacity: 0 },
});
