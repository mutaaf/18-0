import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchLeaderboard, isBackendConfigured, type LeaderboardRow } from '@/services/supabase';
import { computeStats, useHistoryStore } from '@/state/history';
import { Panel } from './Panel';
import { color, font, radius, space, tabular, tierColor, tracking, type PressState } from '@/theme';

/**
 * Rankings, always on screen.
 *
 * When the server is configured this is the live top three. When it is not —
 * which is the default, because the game is offline-first — it falls back to
 * the player's own best seasons rather than disappearing. A leaderboard that
 * vanishes teaches people not to look for it.
 */
export function LeaderboardStrip({ onPress }: { onPress: () => void }) {
  const games = useHistoryStore((s) => s.games);
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isBackendConfigured) return;
    let live = true;
    fetchLeaderboard('all_time', 3)
      .then((r) => live && setRows(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const local = useHistoryStore.getState().games;
  void computeStats;
  const mine = [...games.filter((g) => !g.assisted)]
    .sort((a, b) => b.result.finalRating - a.result.finalRating)
    .slice(0, 3);
  void local;

  const online = isBackendConfigured && !failed && rows !== null && rows.length > 0;

  return (
    <Panel tint={online ? color.navy : undefined} contentStyle={styles.card}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Open leaderboards"
        style={({ hovered }: PressState) => [hovered && { opacity: 0.9 }]}
      >
      <View style={styles.head}>
        <Text style={styles.title}>{online ? 'Leaderboard' : 'Your best seasons'}</Text>
        <View style={[styles.pill, online ? styles.pillLive : styles.pillLocal]}>
          <Text style={[styles.pillText, online && styles.pillTextLive]}>
            {online ? 'Live' : 'On this device'}
          </Text>
        </View>
      </View>

      {online ? (
        rows!.map((row, i) => (
          <Row
            key={row.gameSessionId}
            rank={i + 1}
            name={row.handle}
            record={`${row.wins}-${row.losses}`}
            rating={row.finalRating}
            tier={row.tier}
          />
        ))
      ) : mine.length > 0 ? (
        mine.map((g, i) => (
          <Row
            key={g.id + g.completedAt}
            rank={i + 1}
            name={g.result.ending.label}
            record={`${g.result.record.wins}-${g.result.record.losses}`}
            rating={g.result.finalRating}
            tier={g.result.ending.tier}
          />
        ))
      ) : (
        <Text style={styles.empty}>Finish a season and it lands here.</Text>
      )}

      <Text style={styles.footer}>
        {online
          ? 'Tap to see the full board'
          : failed
            ? "Couldn't reach the global board — showing yours"
            : 'Global rankings need a connection'}
      </Text>
      </Pressable>
    </Panel>
  );
}

function Row({
  rank,
  name,
  record,
  rating,
  tier,
}: {
  rank: number;
  name: string;
  record: string;
  rating: number;
  tier: string;
}) {
  const accent = tierColor[tier] ?? color.text;
  const medal = MEDAL[rank];
  return (
    <View style={styles.row}>
      <Text style={[styles.rank, medal ? { color: medal } : null]}>{rank}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.record, { color: accent }]}>{record}</Text>
      <Text style={[styles.rating, { color: accent }]}>{rating.toFixed(1)}</Text>
    </View>
  );
}

/** Gold, silver, bronze. Anything below third is just a number. */
const MEDAL: Record<number, string | undefined> = {
  1: color.gold,
  2: color.silver,
  3: '#C87A3D',
};

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  title: {
    flex: 1,
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 1 },
  pillLive: { borderColor: '#FF2B2B80', backgroundColor: '#D50A0A1A' },
  pillLocal: { borderColor: color.line },
  pillText: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wide,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  pillTextLive: { color: color.redBright },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 7 },
  rank: { fontFamily: font.display, fontSize: 16, color: color.textFaint, width: 16, ...tabular },
  name: { flex: 1, fontFamily: font.body, fontSize: 14, color: color.text, minWidth: 0 },
  record: { fontFamily: font.display, fontSize: 16, ...tabular },
  rating: { fontFamily: font.display, fontSize: 16, color: color.silver, width: 46, textAlign: 'right', ...tabular },
  empty: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textFaint, paddingVertical: space.sm },
  footer: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint, marginTop: space.sm },
});
