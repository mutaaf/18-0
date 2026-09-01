import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { eraLabel, franchise } from '@18-0/data';
import { useMemo } from 'react';
import { Screen } from '@/components/Screen';
import { computeStats, useHistoryStore } from '@/state/history';
import { color, font, radius, space, tabular, tracking, useLayout } from '@/theme';

export default function Stats() {
  const router = useRouter();
  const layout = useLayout();
  const games = useHistoryStore((s) => s.games);
  const stats = useMemo(() => computeStats(games), [games]);

  if (stats.played === 0) {
    return (
      <Screen maxWidth={layout.wide ? 820 : undefined}>
        <View style={styles.blank}>
          <Text style={styles.blankTitle}>Your record starts empty</Text>
          <Text style={styles.blankCopy}>
            Play a season and this fills with your best rating, your best record, and how close you
            have come to perfection.
          </Text>
          <Pressable
            onPress={() => router.push('/(tabs)')}
            accessibilityRole="button"
            accessibilityLabel="Play a season"
            style={styles.blankCta}
          >
            <Text style={styles.blankCtaLabel}>Play a season</Text>
          </Pressable>
          <Text style={styles.blankNote}>
            18-0 lands about once every 6,000 games. 17-1 about once every 49.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen maxWidth={layout.wide ? 820 : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>My Stats</Text>

        <View style={styles.grid}>
          <Tile label="Games Played" value={String(stats.played)} />
          <Tile label="Best Rating" value={stats.bestRating?.toFixed(1) ?? '—'} />
          <Tile
            label="Best Record"
            value={stats.bestRecord ? `${stats.bestRecord.wins}-${stats.bestRecord.losses}` : '—'}
          />
          <Tile label="Average Rating" value={stats.averageRating?.toFixed(1) ?? '—'} />
        </View>

        <View style={[styles.chase, stats.perfectSeasons > 0 && styles.chaseEarned]}>
          <Text style={[styles.chaseTitle, stats.perfectSeasons > 0 && styles.chaseTitleEarned]}>
            The chase
          </Text>
          <View style={styles.chaseRow}>
            <ChaseStat label="18-0 seasons" value={stats.perfectSeasons} gold />
            <ChaseStat label="17-1 seasons" value={stats.heartbreaks} />
          </View>
          <Text style={styles.chaseNote}>
            18-0 lands about once every 6,000 games. 17-1 about once every 49.
          </Text>
        </View>

        <View style={styles.chase}>
          <Text style={styles.chaseTitle}>Player IQ</Text>
          <View style={styles.chaseRow}>
            <ChaseStat label="Blind seasons" value={stats.playerIqGames} />
            <ChaseStat
              label="Best blind rating"
              value={stats.bestPlayerIqRating ? Number(stats.bestPlayerIqRating.toFixed(1)) : 0}
            />
          </View>
          <Text style={styles.chaseNote}>
            Built with no ratings and no stat lines on screen.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tendencies</Text>
          <Row label="Most-used franchise" value={stats.topFranchise ? franchise(stats.topFranchise).name : '—'} />
          <Row label="Most-used era" value={stats.topEra ? eraLabel(stats.topEra) : '—'} />
          <Row
            label="Highest-rated pick"
            value={stats.bestCard ? `${stats.bestCard.name} (${stats.bestCard.rating.toFixed(1)})` : '—'}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function ChaseStat({ label, value, gold }: { label: string; value: number; gold?: boolean }) {
  return (
    <View style={styles.chaseStat}>
      <Text style={[styles.chaseValue, gold && { color: color.goldBright }]}>{value}</Text>
      <Text style={styles.chaseLabel}>{label}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: 120, gap: space.xl },
  title: {
    fontFamily: font.displayBlack,
    fontSize: 34,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space.lg,
    backgroundColor: '#FFFFFF04',
  },
  tileValue: { fontFamily: font.display, fontSize: 30, color: color.text, includeFontPadding: false, ...tabular },
  tileLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  chase: {
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FFFFFF04',
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
  },
  // Gold appears only once an 18-0 has actually been earned.
  chaseEarned: { borderColor: '#F2C43D40', backgroundColor: '#F2C43D0A' },
  chaseTitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  chaseTitleEarned: { color: color.gold },
  blank: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.xl, paddingBottom: 120 },
  blankTitle: { fontFamily: font.display, fontSize: 26, color: color.text, textAlign: 'center' },
  blankCopy: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim, textAlign: 'center', lineHeight: 19, maxWidth: 340 },
  blankCta: { backgroundColor: color.red, borderRadius: radius.md, paddingHorizontal: space.xxl, minHeight: 50, justifyContent: 'center' },
  blankCtaLabel: { fontFamily: font.display, fontSize: 17, letterSpacing: tracking.wide, color: '#fff', textTransform: 'uppercase' },
  blankNote: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint, textAlign: 'center' },
  chaseRow: { flexDirection: 'row', gap: space.xxl },
  chaseStat: {},
  chaseValue: { fontFamily: font.displayBlack, fontSize: 38, color: color.text, includeFontPadding: false, ...tabular },
  chaseLabel: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
  chaseNote: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint, lineHeight: 16 },
  section: { gap: 2 },
  sectionTitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
    marginBottom: space.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.lg,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  rowLabel: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim },
  rowValue: { fontFamily: font.body, fontSize: 13, color: color.text, flexShrink: 1, textAlign: 'right' },
});
