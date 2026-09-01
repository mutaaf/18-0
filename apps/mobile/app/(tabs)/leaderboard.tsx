import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { RatingBadge } from '@/components/RatingBadge';
import {
  fetchLeaderboard,
  isBackendConfigured,
  type LeaderboardPeriod,
  type LeaderboardRow,
} from '@/services/supabase';
import { color, font, radius, space, tierColor, tracking, useLayout, type PressState } from '@/theme';

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: 'all_time', label: 'All Time' },
  { key: 'month', label: 'This Month' },
  { key: 'week', label: 'This Week' },
];

export default function Leaderboard() {
  const layout = useLayout();
  const [period, setPeriod] = useState<LeaderboardPeriod>('all_time');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(isBackendConfigured);

  const load = useCallback(async (p: LeaderboardPeriod) => {
    if (!isBackendConfigured) return;
    setLoading(true);
    setRows(await fetchLeaderboard(p));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  return (
    <Screen maxWidth={layout.wide ? 820 : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboards</Text>
        <Text style={styles.subtitle}>Highest 18-0 rating</Text>
      </View>

      {!isBackendConfigured ? (
        <View style={styles.offline}>
          <Text style={styles.offlineTitle}>Leaderboards are offline</Text>
          <Text style={styles.offlineCopy}>
            The game is fully playable without a server. Set EXPO_PUBLIC_SUPABASE_URL and
            EXPO_PUBLIC_SUPABASE_ANON_KEY to bring rankings online.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.tabs}>
            {PERIODS.map((p) => (
              <Pressable
                key={p.key}
                onPress={() => setPeriod(p.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: period === p.key }}
                style={({ hovered }: PressState) => [
                  styles.tab,
                  hovered && { borderColor: color.red },
                  period === p.key && styles.tabActive,
                ]}
              >
                <Text style={[styles.tabLabel, period === p.key && { color: color.redBright }]}>
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={color.red} />
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.offline}>
              <Text style={styles.offlineTitle}>No seasons ranked yet</Text>
              <Text style={styles.offlineCopy}>Be the first to post a record.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
              {rows.map((row, index) => {
                const accent = row.endingKey === 'PERFECT' ? color.gold : tierColor[row.tier] ?? color.text;
                return (
                  <View key={row.gameSessionId} style={styles.row}>
                    <Text style={[styles.rank, index < 3 && { color: accent }]}>
                      {String(index + 1).padStart(2, '0')}
                    </Text>
                    <View style={styles.rowMain}>
                      <Text style={styles.handle} numberOfLines={1}>
                        {row.handle}
                      </Text>
                      <Text style={[styles.record, { color: accent }]}>
                        {row.wins}-{row.losses}
                      </Text>
                    </View>
                    <RatingBadge rating={row.finalRating} size="sm" />
                  </View>
                );
              })}
            </ScrollView>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md },
  title: {
    fontFamily: font.displayBlack,
    fontSize: 34,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  subtitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  tabs: { flexDirection: 'row', gap: space.xs, paddingHorizontal: space.lg, paddingBottom: space.md },
  tab: {
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
  },
  tabActive: { backgroundColor: '#E01A2B26', borderColor: color.red },
  tabLabel: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide, color: color.textDim },
  loading: { paddingVertical: space.xxxl },
  list: { paddingHorizontal: space.lg, paddingBottom: 120, gap: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF05',
  },
  rank: { fontFamily: font.display, fontSize: 16, color: color.textFaint, width: 26 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: space.sm, minWidth: 0 },
  handle: { fontFamily: font.heading, fontSize: 15, color: color.text, flexShrink: 1 },
  record: { fontFamily: font.display, fontSize: 15 },
  offline: {
    marginHorizontal: space.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space.xl,
    gap: 6,
  },
  offlineTitle: { fontFamily: font.heading, fontSize: 17, color: color.textDim },
  offlineCopy: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint, lineHeight: 18 },
});
