import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Panel } from './Panel';
import {
  fetchMultiplier,
  fetchProgress,
  isBackendConfigured,
  type MultiplierNow,
  type Progress,
} from '@/services/supabase';
import { color, font, radius, space, tabular, tracking } from '@/theme';

/**
 * Your level, and what the next season is worth.
 *
 * Two numbers that come from different places on purpose. The level is history
 * -- the sum of what every season was stamped with, and stamped is the
 * operative word: a multiplier is decided once, when a season is scored, and
 * never recomputed, so a streak you had in September keeps paying for the
 * seasons you played during it even after the streak breaks.
 *
 * The multiplier shown here is the *other* thing: what the next one would be
 * worth if you played it now. It is a forecast rather than a balance, which is
 * why it sits under the level rather than inside it.
 */
export function LevelPanel() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [bonus, setBonus] = useState<MultiplierNow | null>(null);

  const load = useCallback(async () => {
    if (!isBackendConfigured) return;
    const [p, m] = await Promise.all([
      fetchProgress().catch(() => null),
      fetchMultiplier().catch(() => null),
    ]);
    setProgress(p);
    setBonus(m);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!progress) return null;

  const span = Math.max(1, progress.nextLevelAt - progress.levelFloor);
  const into = Math.max(0, Math.min(span, progress.points - progress.levelFloor));
  const pct = Math.round((into / span) * 100);

  const terms = bonus
    ? [
        { label: 'Days in a row', value: bonus.dayStreak, each: 6, cap: 10 },
        { label: 'Weeks in a row', value: bonus.weekStreak, each: 8, cap: 5 },
        { label: 'Seasons today', value: bonus.today, each: 2, cap: 5 },
        { label: 'This hour', value: bonus.thisHour, each: 1, cap: 5 },
      ]
    : [];

  return (
    <Panel tint={color.gold} contentStyle={styles.body}>
      <View style={styles.head}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{progress.level}</Text>
        </View>
        <View style={styles.headText}>
          <Text style={styles.eyebrow}>Level</Text>
          <Text style={styles.points}>{progress.points.toLocaleString()} pts</Text>
        </View>
        {bonus && bonus.multiplier > 1 ? (
          <View style={styles.mult}>
            <Text style={styles.multValue}>×{bonus.multiplier.toFixed(2)}</Text>
            <Text style={styles.multLabel}>NEXT SEASON</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.toGo}>
        {(progress.nextLevelAt - progress.points).toLocaleString()} points to level{' '}
        {progress.level + 1}
      </Text>

      {terms.some((t) => t.value > 0) ? (
        <View style={styles.terms}>
          {terms
            .filter((t) => t.value > 0)
            .map((t) => (
              <View key={t.label} style={styles.term}>
                <Text style={styles.termLabel}>{t.label}</Text>
                <Text style={styles.termValue}>
                  {t.value}
                  <Text style={styles.termBonus}>
                    {'  +'}
                    {Math.min(t.value, t.cap) * t.each}%
                  </Text>
                </Text>
              </View>
            ))}
        </View>
      ) : (
        <Text style={styles.toGo}>
          Finish a season today to start a streak. Days in a row are worth the most.
        </Text>
      )}

      {progress.hidden > 0 ? (
        <Text style={styles.hidden}>
          {progress.hidden} season{progress.hidden === 1 ? '' : 's'} kept off the board, earning
          nothing.
        </Text>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  badge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.gold,
  },
  badgeText: {
    fontFamily: font.display,
    fontSize: 21,
    color: '#0A0E17',
    includeFontPadding: false,
    ...tabular,
  },
  headText: { flex: 1, minWidth: 0 },
  eyebrow: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  points: {
    fontFamily: font.display,
    fontSize: 24,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  mult: { alignItems: 'flex-end' },
  multValue: {
    fontFamily: font.display,
    fontSize: 22,
    color: color.gold,
    includeFontPadding: false,
    ...tabular,
  },
  multLabel: {
    fontFamily: font.label,
    fontSize: 8,
    letterSpacing: tracking.wide,
    color: color.textFaint,
  },

  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF14',
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3, backgroundColor: color.gold },
  toGo: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },

  terms: {
    gap: 4,
    paddingTop: space.xs,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  term: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  termLabel: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textDim },
  termValue: { fontFamily: font.body, fontSize: 13, color: color.text, ...tabular },
  termBonus: { fontFamily: font.label, fontSize: 11, color: color.gold },
  hidden: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
});
