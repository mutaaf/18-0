import { useEffect } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ROSTER_SLOTS, isPerfectionDenied, type RosterSlot } from '@18-0/domain';
import { displayName, franchise } from '@18-0/data';
import { Brand } from '@/components/Brand';
import { Screen } from '@/components/Screen';
import { RatingBadge } from '@/components/RatingBadge';
import { lookupCard, useGameStore } from '@/state/game';
import { color, font, positionColor, radius, space, tierColor, tracking, useLayout, type PressState } from '@/theme';

export default function Result() {
  const router = useRouter();
  const layout = useLayout();
  const game = useGameStore();
  const result = game.result;

  useEffect(() => {
    if (!result) router.replace('/(tabs)');
  }, [result]);

  useEffect(() => {
    if (result?.ending.key === 'PERFECT') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, [result?.ending.key]);

  if (!result) return <Screen><View /></Screen>;

  const perfect = result.ending.key === 'PERFECT';
  const denied = isPerfectionDenied(result);
  const heartbreak = result.ending.key === 'HEARTBREAK';
  const accent = perfect ? color.gold : tierColor[result.ending.tier] ?? color.text;

  const rosterCards = game.selections
    .map((s) => ({ slot: s.slot, card: lookupCard(s.cardId) }))
    .filter((x): x is { slot: RosterSlot; card: NonNullable<ReturnType<typeof lookupCard>> } => !!x.card)
    .sort((a, b) => ROSTER_SLOTS.indexOf(a.slot) - ROSTER_SLOTS.indexOf(b.slot));

  const share = () => {
    const lines = rosterCards.map(
      (r) => `${r.slot.padEnd(4)} ${displayName(r.card)} '${String(r.card.year).slice(2)}  ${r.card.rating.toFixed(1)}`,
    );
    Share.share({
      message:
        `18-0 — ${result.record.wins}-${result.record.losses} ${result.ending.label.toUpperCase()}\n` +
        `Rating ${result.finalRating.toFixed(1)} · Tier ${result.ending.tier}\n\n${lines.join('\n')}\n\n` +
        `Can you beat this roster?`,
    }).catch(() => {});
  };

  const buildAnother = () => {
    game.startGame();
    router.replace('/play');
  };

  const verdict = (
    <View style={styles.verdictColumn}>
      <View
        style={[styles.hero, { borderColor: `${accent}59` }, perfect && styles.heroPerfect]}
          accessible
          accessibilityLabel={`Final result. ${result.record.wins} and ${result.record.losses}. ${result.ending.label}. Tier ${result.ending.tier}. Rating ${result.finalRating.toFixed(1)}.`}
        >
          <Text style={styles.heroKicker}>Projected Record</Text>
          <View style={styles.recordRow}>
            <Text style={[styles.recordNum, perfect && { color: color.goldBright }]}>{result.record.wins}</Text>
            <View style={[styles.recordDash, { backgroundColor: accent }]} />
            <Text style={[styles.recordNum, perfect && { color: color.goldBright }]}>{result.record.losses}</Text>
          </View>
          <Text style={[styles.endingName, { color: accent }]}>
            {perfect ? 'PERFECT' : result.ending.label.toUpperCase()}
          </Text>
          <View style={styles.heroMeta}>
            <Text style={styles.tier}>
              TIER <Text style={{ color: accent }}>{result.ending.tier}</Text>
            </Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.rating}>
              {result.finalRating.toFixed(1)} <Text style={styles.ratingLabel}>18-0 RATING</Text>
            </Text>
          </View>
        </View>

        {perfect ? (
          <View style={styles.immortal}>
            <Text style={styles.immortalWord}>IMMORTAL</Text>
            <Text style={styles.immortalCopy}>
              No weaknesses. No compromises. A roster for the ages.
            </Text>
          </View>
        ) : null}

        {denied ? (
          <View style={styles.denied}>
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
          </View>
        ) : heartbreak ? (
          <View style={styles.heartbreak}>
            <Text style={styles.heartbreakTitle}>Heartbreak</Text>
            <Text style={styles.heartbreakCopy}>
              One loss from immortality. {result.distanceFromPerfection.toFixed(2)} rating points short
              of the 18-0 threshold.
            </Text>
          </View>
      ) : (
        <View style={styles.gap}>
          <Text style={styles.gapLabel}>Distance from 18-0</Text>
          <Text style={styles.gapValue}>{result.distanceFromPerfection.toFixed(2)}</Text>
        </View>
      )}

      <View style={styles.actions}>
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
      </View>
    </View>
  );

  const detail = (
    <View style={styles.detailColumn}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Roster</Text>
          {rosterCards.map(({ slot, card }) => (
            <View key={slot} style={styles.rosterRow}>
              <Text style={[styles.rosterSlot, { color: positionColor[card.position] }]}>{slot}</Text>
              <View style={styles.rosterMain}>
                <Text style={styles.rosterName} numberOfLines={1}>
                  {displayName(card)}
                </Text>
                <Text style={styles.rosterMeta}>
                  {franchise(card.franchiseId).abbr} · {card.year} · {card.era}
                </Text>
              </View>
              <RatingBadge rating={card.rating} size="sm" />
            </View>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.sm },
  close: { fontFamily: font.body, fontSize: 18, color: color.textDim },
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
    shadowOpacity: 0.4,
    shadowRadius: 30,
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
    fontSize: 86,
    lineHeight: 92,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  recordDash: { width: 26, height: 7, borderRadius: 4 },
  endingName: {
    fontFamily: font.display,
    fontSize: 26,
    letterSpacing: tracking.wide,
    marginTop: -4,
    includeFontPadding: false,
  },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  tier: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, color: color.textFaint },
  dot: { color: color.textFaint },
  rating: { fontFamily: font.heading, fontSize: 15, color: color.text },
  ratingLabel: { fontFamily: font.label, fontSize: 9, letterSpacing: tracking.wide, color: color.textFaint },
  immortal: { alignItems: 'center', gap: 4 },
  immortalWord: {
    fontFamily: font.displayBlack,
    fontSize: 40,
    letterSpacing: 6,
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
  modelNote: {
    fontFamily: font.bodyRegular,
    fontSize: 10,
    color: color.textFaint,
    textAlign: 'center',
    lineHeight: 15,
  },
});
