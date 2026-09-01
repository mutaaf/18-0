import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ROSTER_SLOTS } from '@18-0/domain';
import { DATASET } from '@18-0/data';
import { Brand } from '@/components/Brand';
import { Screen } from '@/components/Screen';
import { hasGameInProgress, useGameStore } from '@/state/game';
import { computeStats, useHistoryStore } from '@/state/history';
import { color, font, radius, space, tracking, useLayout, type PressState } from '@/theme';

export default function Home() {
  const router = useRouter();
  const layout = useLayout();
  const game = useGameStore();
  const inProgress = hasGameInProgress(game);
  const stats = computeStats(useHistoryStore((s) => s.games));

  const startFresh = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    game.startGame();
    router.push('/play');
  };

  const hero = (
    <View style={styles.heroColumn}>
      <View style={styles.hero}>
        <Text style={styles.kicker}>The NFL history roster game</Text>
        <Text style={[styles.headline, layout.roomy && styles.headlineRoomy]}>
          Spin history.{'\n'}Build seven.{'\n'}
          <Text style={styles.headlineAccent}>Chase perfection.</Text>
        </Text>
        <Text style={styles.blurb}>
          Every spin hands you one franchise and one era. Take a player, fill a slot, and live with
          it. Seven picks decide your season — no simulation, no luck after the whistle.
        </Text>
      </View>

      {inProgress ? (
        <Pressable
          style={({ pressed, hovered }: PressState) => [
            styles.resume,
            hovered && { borderColor: color.red },
            pressed && styles.pressed,
          ]}
          onPress={() => router.push('/play')}
          accessibilityRole="button"
          accessibilityLabel={`Resume game, ${game.selections.length} of ${ROSTER_SLOTS.length} slots filled`}
        >
          <View style={styles.resumeBar}>
            <View style={[styles.resumeFill, { width: `${(game.selections.length / ROSTER_SLOTS.length) * 100}%` }]} />
          </View>
          <View style={styles.resumeRow}>
            <View>
              <Text style={styles.resumeTitle}>Resume game</Text>
              <Text style={styles.resumeMeta}>
                {game.selections.length} of {ROSTER_SLOTS.length} positions filled
              </Text>
            </View>
            <Text style={styles.resumeArrow}>→</Text>
          </View>
        </Pressable>
      ) : null}

      <Pressable
        style={({ pressed, hovered }: PressState) => [
          styles.play,
          hovered && styles.playHover,
          pressed && styles.pressed,
        ]}
        onPress={startFresh}
        accessibilityRole="button"
        accessibilityLabel={inProgress ? 'Start a new game' : 'Play'}
      >
        <Text style={styles.playLabel}>{inProgress ? 'Start New Game' : 'Play'}</Text>
      </Pressable>
    </View>
  );

  const aside = (
    <View style={styles.aside}>
      <View style={styles.statRow}>
        <Stat label="Games" value={String(stats.played)} />
        <Stat label="Best Rating" value={stats.bestRating ? stats.bestRating.toFixed(1) : '—'} />
        <Stat
          label="Best Record"
          value={stats.bestRecord ? `${stats.bestRecord.wins}-${stats.bestRecord.losses}` : '—'}
        />
      </View>

      <View style={styles.rules}>
        <Text style={styles.rulesTitle}>How a season is decided</Text>
        {[
          ['Spin', 'One franchise, one era.'],
          ['Pick', 'Exactly one player per spin. No takebacks.'],
          ['Seven', 'QB, two backs, two receivers, a tight end, a defense.'],
          ['Rate', 'Every season scored against its own era.'],
          ['Record', '0-18 through 18-0. Same roster, same result.'],
        ].map(([step, copy], i) => (
          <View key={step} style={styles.ruleRow}>
            <Text style={styles.ruleIndex}>{String(i + 1).padStart(2, '0')}</Text>
            <View style={styles.ruleMain}>
              <Text style={styles.ruleStep}>{step}</Text>
              <Text style={styles.ruleCopy}>{copy}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerLabel}>Bundled history</Text>
        <Text style={styles.footerValue}>
          {DATASET.coverage.firstSeason}–{DATASET.coverage.lastSeason} ·{' '}
          {DATASET.cards.length.toLocaleString()} rated seasons · {DATASET.combos.length} franchise-era
          combinations
        </Text>
        <Text style={styles.footerNote}>
          Every rating is computed against its own era and stored on this device. No account, no
          connection required.
        </Text>
      </View>
    </View>
  );

  return (
    <Screen maxWidth={layout.wide ? 1080 : undefined}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {layout.wide ? null : (
          <View style={styles.header}>
            <Brand size={34} subtitle="Est. 2026" />
          </View>
        )}
        {layout.wide ? (
          <View style={styles.split}>
            {hero}
            {aside}
          </View>
        ) : (
          <>
            {hero}
            {aside}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.xl, paddingBottom: 120, gap: space.xl, paddingTop: space.lg },
  split: { flexDirection: 'row', gap: space.xxxl, alignItems: 'flex-start' },
  heroColumn: { flex: 1.15, gap: space.xl, minWidth: 0 },
  aside: { flex: 1, gap: space.xl, minWidth: 0 },
  rules: { gap: space.md, borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.lg },
  rulesTitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  ruleRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  ruleIndex: { fontFamily: font.display, fontSize: 13, color: color.red, marginTop: 1, width: 20 },
  ruleMain: { flex: 1, minWidth: 0 },
  ruleStep: { fontFamily: font.heading, fontSize: 15, color: color.text },
  ruleCopy: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint, lineHeight: 17 },
  header: { paddingTop: space.md },
  hero: { gap: space.md },
  kicker: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.red,
    textTransform: 'uppercase',
  },
  headline: {
    fontFamily: font.displayBlack,
    fontSize: 46,
    lineHeight: 46,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  headlineRoomy: { fontSize: 62, lineHeight: 60 },
  headlineAccent: { color: color.textFaint },
  blurb: {
    fontFamily: font.bodyRegular,
    fontSize: 14,
    lineHeight: 21,
    color: color.textDim,
    maxWidth: 400,
  },
  play: {
    backgroundColor: color.red,
    borderRadius: radius.md,
    paddingVertical: 17,
    alignItems: 'center',
    shadowColor: color.red,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  playLabel: {
    fontFamily: font.display,
    fontSize: 21,
    letterSpacing: tracking.wide,
    color: '#FFFFFF',
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  playHover: { shadowOpacity: 0.75, shadowRadius: 26, transform: [{ translateY: -1 }] },
  pressed: { opacity: 0.82 },
  resume: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  resumeBar: { height: 3, backgroundColor: '#FFFFFF0D' },
  resumeFill: { height: 3, backgroundColor: color.red },
  resumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.lg,
  },
  resumeTitle: { fontFamily: font.heading, fontSize: 17, color: color.text },
  resumeMeta: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textDim, marginTop: 1 },
  resumeArrow: { fontFamily: font.display, fontSize: 20, color: color.red },
  statRow: { flexDirection: 'row', gap: space.sm },
  stat: {
    flex: 1,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    backgroundColor: '#FFFFFF04',
  },
  statValue: { fontFamily: font.display, fontSize: 22, color: color.text, includeFontPadding: false },
  statLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    color: color.textFaint,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  footer: { gap: 4, borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.lg },
  footerLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  footerValue: { fontFamily: font.body, fontSize: 12, color: color.textDim },
  footerNote: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint, lineHeight: 16 },
});
