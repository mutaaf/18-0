import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { AccountPanel } from '@/components/AccountPanel';
import { RatingBadge } from '@/components/RatingBadge';
import {
  fetchLeaderboard,
  isBackendConfigured,
  type LeaderboardPeriod,
  type LeaderboardRow,
} from '@/services/supabase';
import { color, font, radius, space, tabular, tierColor, tracking, useLayout, type PressState } from '@/theme';

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
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (p: LeaderboardPeriod) => {
    if (!isBackendConfigured) return;
    setLoading(true);
    setFailed(false);
    try {
      setRows(await fetchLeaderboard(p));
    } catch {
      // Without this the app tells a user they are first to post a score when
      // it simply could not reach the server.
      setFailed(true);
      setRows([]);
    }
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

      <View style={styles.account}>
        <AccountPanel />
      </View>

      {!isBackendConfigured ? (
        <View style={styles.offline}>
          <Text style={styles.offlineTitle}>Leaderboards are offline</Text>
          <Text style={styles.offlineCopy}>
            Every season you play is still saved on this device. Rankings need a connection.
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
          ) : failed ? (
            <View style={styles.offline}>
              <Text style={styles.offlineTitle}>Couldn't reach the rankings</Text>
              <Text style={styles.offlineCopy}>Your seasons are safe on this device.</Text>
              <Pressable
                onPress={() => void load(period)}
                accessibilityRole="button"
                accessibilityLabel="Retry loading the leaderboard"
                style={styles.retry}
              >
                <Text style={styles.retryLabel}>Retry</Text>
              </Pressable>
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
                  <View
                    key={row.gameSessionId}
                    style={[styles.row, index === 0 && styles.rowLeader]}
                    accessible
                    accessibilityLabel={`Rank ${index + 1}. ${row.handle}. ${row.wins} and ${row.losses}. Tier ${row.tier}. Rating ${row.finalRating.toFixed(1)}.`}
                  >
                    {index === 0 ? <View style={[styles.stripe, { backgroundColor: accent }]} /> : null}
                    <Text style={[styles.rank, index < 3 && { color: accent }, index === 0 && styles.rankLeader]}>
                      {String(index + 1).padStart(2, '0')}
                    </Text>
                    <View style={styles.rowMain}>
                      <Text style={styles.handle} numberOfLines={1}>
                        {row.handle}
                      </Text>
                      <Text style={[styles.record, { color: accent }]}>
                        {row.wins}-{row.losses}
                      </Text>
                      {/* Tier as text, not colour alone (PRFAQ §34). */}
                      <Text style={styles.tier}>TIER {row.tier}</Text>
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
  account: { paddingHorizontal: space.lg, paddingBottom: space.md },
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
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
  },
  tabActive: { backgroundColor: '#D50A0A26', borderColor: color.red },
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
  rank: { fontFamily: font.display, fontSize: 16, color: color.textFaint, width: 26, ...tabular },
  rankLeader: { fontSize: 24 },
  rowLeader: { backgroundColor: '#FFFFFF0D' },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderRadius: 2 },
  tier: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: color.textFaint,
  },
  retry: {
    marginTop: space.md,
    alignSelf: 'flex-start',
    backgroundColor: color.red,
    borderRadius: radius.sm,
    paddingHorizontal: space.lg,
    minHeight: 44,
    justifyContent: 'center',
  },
  retryLabel: {
    fontFamily: font.label,
    fontSize: 13,
    letterSpacing: tracking.wide,
    color: '#fff',
    textTransform: 'uppercase',
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: space.sm, minWidth: 0 },
  handle: { fontFamily: font.heading, fontSize: 15, color: color.text, flexShrink: 1 },
  record: { fontFamily: font.display, fontSize: 15, ...tabular },
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
