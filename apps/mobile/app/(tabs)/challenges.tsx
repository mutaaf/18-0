import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { RatingBadge } from '@/components/RatingBadge';
import { fetchMyChallenges, isBackendConfigured, type ChallengeRow } from '@/services/supabase';
import { useHistoryStore } from '@/state/history';
import { color, font, radius, space, tabular, tracking, useLayout, type PressState } from '@/theme';

export default function Challenges() {
  const layout = useLayout();
  const games = useHistoryStore((s) => s.games);
  const [rows, setRows] = useState<ChallengeRow[]>([]);
  const [loading, setLoading] = useState(isBackendConfigured);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!isBackendConfigured) return;
    setLoading(true);
    setFailed(false);
    try {
      setRows(await fetchMyChallenges());
    } catch {
      setFailed(true);
      setRows([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const best = games.filter((g) => !g.assisted).sort((a, b) => b.result.finalRating - a.result.finalRating)[0];

  return (
    <Screen maxWidth={layout.wide ? 820 : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>Challenges</Text>
        <Text style={styles.subtitle}>Head to head</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {best ? (
          <View style={styles.pitch}>
            <Text style={styles.pitchLabel}>Your best roster</Text>
            <View style={styles.pitchRow}>
              <Text style={styles.pitchRecord}>
                {best.result.record.wins}-{best.result.record.losses}
              </Text>
              <View style={styles.pitchMain}>
                <Text style={styles.pitchEnding}>{best.result.ending.label}</Text>
                <Text style={styles.pitchMeta}>
                  {best.roster.length} picks · tier {best.result.ending.tier}
                </Text>
              </View>
              <RatingBadge rating={best.result.finalRating} size="sm" />
            </View>
            <Pressable
              onPress={() =>
                Share.share({
                  message:
                    `I built a ${best.result.record.wins}-${best.result.record.losses} roster in 18-0 ` +
                    `(${best.result.finalRating.toFixed(1)}). Beat it.`,
                }).catch(() => {})
              }
              accessibilityRole="button"
              accessibilityLabel="Challenge a friend with your best roster"
              style={({ pressed, hovered }: PressState) => [
                styles.cta,
                hovered && { opacity: 0.92 },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text style={styles.ctaLabel}>Challenge a friend</Text>
            </Pressable>
            {!isBackendConfigured ? (
              <Text style={styles.pitchNote}>
                Shares as text for now. Persistent challenge links need the server configured.
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No roster to challenge with</Text>
            <Text style={styles.emptyCopy}>Finish a season first.</Text>
          </View>
        )}

        {isBackendConfigured ? (
          loading ? (
            <ActivityIndicator color={color.red} style={{ marginTop: space.xl }} />
          ) : failed ? (
            <Text style={styles.failed} accessibilityLiveRegion="polite">
              Couldn't reach your challenges. Your seasons are safe on this device.
            </Text>
          ) : rows.length > 0 ? (
            <View style={styles.list}>
              <Text style={styles.sectionTitle}>Open challenges</Text>
              {rows.map((row) => (
                <View
                  key={row.id}
                  style={styles.row}
                  accessible
                  accessibilityLabel={`Challenge from ${row.creatorHandle}. ${row.creatorRecord ?? 'no record'}. ${row.status}.`}
                >
                  <View style={styles.rowMain}>
                    <Text style={styles.rowHandle}>{row.creatorHandle}</Text>
                    <Text style={styles.rowMeta}>
                      {row.creatorRecord ?? '—'} · {row.status}
                    </Text>
                  </View>
                  {row.creatorRating !== null ? <RatingBadge rating={row.creatorRating} size="sm" /> : null}
                </View>
              ))}
            </View>
          ) : null
        ) : null}
      </ScrollView>
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
  scroll: { paddingHorizontal: space.lg, paddingBottom: 120, gap: space.lg },
  pitch: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
    backgroundColor: '#FFFFFF05',
  },
  pitchLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
  pitchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pitchRecord: { fontFamily: font.displayBlack, fontSize: 28, color: color.text, includeFontPadding: false, ...tabular },
  pitchMain: { flex: 1, minWidth: 0 },
  pitchEnding: { fontFamily: font.heading, fontSize: 15, color: color.text },
  pitchMeta: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
  pitchNote: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint, lineHeight: 16 },
  cta: {
    backgroundColor: color.red,
    borderRadius: radius.md,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  failed: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textDim, marginTop: space.lg },
  ctaLabel: {
    fontFamily: font.display,
    fontSize: 16,
    letterSpacing: tracking.wide,
    color: '#fff',
    textTransform: 'uppercase',
  },
  list: { gap: 4 },
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
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 10,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: '#FFFFFF05',
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowHandle: { fontFamily: font.heading, fontSize: 15, color: color.text },
  rowMeta: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
  empty: { alignItems: 'center', gap: 4, paddingVertical: space.xxxl },
  emptyTitle: { fontFamily: font.heading, fontSize: 17, color: color.textDim },
  emptyCopy: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textFaint },
});
