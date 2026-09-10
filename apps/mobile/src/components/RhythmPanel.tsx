import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GlassSurface } from './GlassSurface';
import { useHistoryStore } from '@/state/history';
import { careerReport } from '@/state/career';
import { color, font, radius, space, tabular, themed, tracking } from '@/theme';

/**
 * When you play, as opposed to how well.
 *
 * The streak on this panel is the *device's* streak, counted in local days from
 * the history stored here. The multiplier on the level panel above is the
 * server's, counted in UTC days from rows the server owns, and the two are
 * different numbers whenever somebody plays late at night. Neither is wrong;
 * saying which is which is what stops a player reading a mismatch as a bug. The
 * copy here never claims this one is worth anything.
 */

const BARS = 44;
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export function RhythmPanel() {
  const games = useHistoryStore((s) => s.games);
  // Cached on the array, so this is the same object the career panel is reading.
  const report = careerReport(games);

  const bars = useMemo(() => {
    let busiest = 1;
    for (let i = 0; i < report.weekdays.length; i++) {
      busiest = Math.max(busiest, report.weekdays[i]!);
    }
    const today = new Date().getDay();
    return report.weekdays.map((count, day) => ({
      day,
      count,
      // Two points of stub for a day never played, so the row still reads as a
      // week rather than as four floating bars.
      height: count === 0 ? 2 : Math.max(4, (count / busiest) * BARS),
      today: day === today,
    }));
  }, [report]);

  if (report.total === 0) return null;

  const perDay = report.daysPlayed > 0 ? report.total / report.daysPlayed : 0;

  return (
    <GlassSurface round={0.04} maxRound={radius.lg} style={styles.panel}>
      <Text style={styles.eyebrow}>Rhythm</Text>

      <View style={styles.head}>
        <View style={styles.streak}>
          <Text style={[styles.streakValue, report.dayStreak > 0 && { color: color.gold }]}>
            {report.dayStreak}
          </Text>
          <Text style={styles.streakLabel}>
            {report.dayStreak === 1 ? 'day in a row' : 'days in a row'}
          </Text>
        </View>
        <View style={styles.tiles}>
          <Tile label="Longest" value={String(report.longestStreak)} />
          <Tile label="Days played" value={String(report.daysPlayed)} />
          <Tile label="Per day" value={perDay.toFixed(1)} />
        </View>
      </View>

      <View style={styles.week} accessibilityLabel={weekSummary(bars)}>
        {bars.map((bar) => (
          <View key={bar.day} style={styles.weekCol}>
            <View style={styles.weekTrack}>
              <View
                style={[
                  styles.bar,
                  { height: bar.height },
                  bar.today && { backgroundColor: color.gold },
                ]}
              />
            </View>
            <Text style={[styles.weekLabel, bar.today && { color: color.gold }]}>
              {WEEKDAY[bar.day]}
            </Text>
          </View>
        ))}
      </View>

      <Text style={styles.note}>
        {report.firstAt
          ? `Playing since ${when(report.firstAt)}. Last season ${when(report.lastAt)}.`
          : ''}
      </Text>
      <Text style={styles.note}>
        Counted on this device, in your own timezone. The streak the multiplier pays for is the
        server's, and it turns over at midnight UTC.
      </Text>
    </GlassSurface>
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

const when = (at: number | null) =>
  at === null ? '—' : new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** The bars are decorative; this is what a screen reader gets instead. */
function weekSummary(bars: readonly { day: number; count: number }[]): string {
  const busiest = bars.reduce((a, b) => (b.count > a.count ? b : a));
  if (busiest.count === 0) return 'No seasons yet this week';
  return `Busiest day: ${FULL_DAY[busiest.day]}, ${busiest.count} seasons`;
}

const FULL_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const styles = themed(() => StyleSheet.create({
  panel: { padding: space.lg, gap: space.md },
  eyebrow: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },

  head: { flexDirection: 'row', alignItems: 'flex-end', gap: space.lg },
  streak: { minWidth: 92 },
  streakValue: {
    fontFamily: font.displayBlack,
    fontSize: 44,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  streakLabel: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },

  tiles: { flex: 1, flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, minWidth: 0 },
  tileValue: {
    fontFamily: font.display,
    fontSize: 20,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  tileLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.textFaint,
  },

  week: { flexDirection: 'row', gap: space.xs, paddingTop: space.xs },
  weekCol: { flex: 1, alignItems: 'center', gap: 4 },
  // Capped rather than stretched: seven columns across a desktop panel gave
  // each day a bar wider than it was tall, which stopped reading as a week.
  weekTrack: { height: BARS, justifyContent: 'flex-end', width: '100%', maxWidth: 40 },
  bar: { borderRadius: 2, backgroundColor: color.ice, opacity: 0.7 },
  weekLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.normal,
    color: color.textFaint,
  },

  note: { fontFamily: font.bodyRegular, fontSize: 11, lineHeight: 16, color: color.textFaint },
}));
