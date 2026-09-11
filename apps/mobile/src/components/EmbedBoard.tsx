import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { fetchLeaderboard, isBackendConfigured, type LeaderboardRow } from '@/services/supabase';
import {
  color,
  font,
  radius,
  space,
  tabular,
  themed,
  tierColor,
  tracking,
} from '@/theme';

/**
 * The board, at the size a frame gets.
 *
 * The full leaderboard is a screen with period tabs, three boards, a search and
 * a row you can open into somebody's roster. None of that fits in four hundred
 * points of width, and cramming it in would produce a worse version of a screen
 * that already exists one tap away.
 *
 * So this is the part that travels: who is top, what they scored, and how far
 * off the crown they are. A podium for the three that matter and a plain list
 * behind them, because "second by a tenth" is the story a leaderboard tells and
 * a uniform list of ten tells it badly.
 *
 * Scout, to match what the entry card offers. A board for a mode the frame does
 * not let you play is a board that invites a comparison nobody can act on.
 */
export function EmbedBoard() {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isBackendConfigured) {
      setFailed(true);
      return;
    }
    let live = true;
    // `fetchLeaderboard` serves a cached board first and calls back with the
    // fresh one, so a frame that has been opened before paints immediately.
    void fetchLeaderboard('all_time', 8, (fresh) => live && setRows(fresh), 'scout')
      .then((first) => live && setRows(first))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>The board is not reachable right now.</Text>
      </View>
    );
  }

  if (!rows) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator color={color.actionBright} />
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Nobody has posted a Scout season yet.</Text>
        <Text style={styles.emptySub}>Play one and the top of this board is yours.</Text>
      </View>
    );
  }

  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);
  const leader = rows[0]?.finalRating ?? 0;

  // Second, first, third -- a real podium's arrangement, but only for the
  // places that exist. A board with two managers on it was drawing an empty
  // bordered box where third would be, and three boxes of content in a frame
  // sized for a podium of however many there are.
  const order = podium.length >= 3 ? [1, 0, 2] : podium.length === 2 ? [0, 1] : [0];

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.title}>Scout · all time</Text>
        <Text style={styles.sub}>Best season, one per manager</Text>
      </View>

      <View style={styles.podium}>
        {order.map((index) => (
          <Step
            key={podium[index]!.gameSessionId}
            row={podium[index]!}
            place={(index + 1) as 1 | 2 | 3}
          />
        ))}
      </View>

      {rest.length > 0 ? (
        <View style={styles.list}>
          {rest.map((row, index) => (
            <View key={row.gameSessionId} style={styles.row}>
              <Text style={styles.rank}>{index + 4}</Text>
              <Text style={styles.handle} numberOfLines={1}>
                {row.handle}
              </Text>
              <Text style={styles.record}>
                {row.wins}-{row.losses}
              </Text>
              <Text style={[styles.rating, { color: tierColor[row.tier] ?? color.text }]}>
                {row.finalRating.toFixed(1)}
              </Text>
              {/* How far off the leader, which is the only comparison that
                  means anything on a best-of board. */}
              <Text style={styles.gap}>−{(leader - row.finalRating).toFixed(1)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** One place on the podium. The winner's step is taller and wears the crown. */
function Step({ row, place }: { row: LeaderboardRow; place: 1 | 2 | 3 }) {
  const won = place === 1;
  const tint = tierColor[row.tier] ?? color.silver;

  return (
    <View style={[styles.step, won && styles.stepFirst]}>
      {won ? (
        <Svg width={16} height={12} viewBox="0 0 24 18" style={styles.crown}>
          <Path
            d="M2 16l2-12 5.5 5L12 2l2.5 7L20 4l2 12z"
            fill={color.gold}
          />
          <Rect x="2" y="15.5" width="20" height="2.5" rx="1" fill={color.goldDeep} />
        </Svg>
      ) : null}
      <Text style={[styles.place, won && styles.placeFirst]}>{place}</Text>
      <Text style={[styles.stepHandle, won && styles.stepHandleFirst]} numberOfLines={1}>
        {row.handle}
      </Text>
      <Text style={[styles.stepRating, { color: tint }]}>{row.finalRating.toFixed(1)}</Text>
      <Text style={styles.stepRecord}>
        {row.wins}-{row.losses}
      </Text>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, padding: space.lg, gap: space.md },
  head: { gap: 1 },
  title: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.actionBright,
  },
  sub: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },

  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  step: {
    flexGrow: 1,
    flexShrink: 1,
    // Zero basis, so three steps divide the frame rather than each asking for
    // the width of its own longest handle and overflowing it.
    flexBasis: 0,
    minWidth: 0,
    alignItems: 'center',
    gap: 1,
    paddingVertical: space.md,
    paddingHorizontal: space.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FFFFFF08',
  },
  stepFirst: {
    paddingVertical: space.lg,
    borderColor: color.lineGold,
    backgroundColor: color.goldGlow,
  },
  crown: { marginBottom: 2 },
  place: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    color: color.textFaint,
  },
  placeFirst: { color: color.gold },
  stepHandle: {
    fontFamily: font.bodyBold,
    fontSize: 12,
    color: color.silver,
    maxWidth: '100%',
  },
  stepHandleFirst: { fontSize: 14, color: color.text },
  stepRating: { fontFamily: font.display, fontSize: 20, ...tabular },
  stepRecord: { fontFamily: font.bodyRegular, fontSize: 10, color: color.textFaint, ...tabular },

  list: { gap: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 6,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    backgroundColor: '#FFFFFF05',
  },
  rank: {
    fontFamily: font.label,
    fontSize: 10,
    color: color.textFaint,
    width: 16,
    ...tabular,
  },
  handle: { flex: 1, minWidth: 0, fontFamily: font.body, fontSize: 12, color: color.text },
  record: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textDim, ...tabular },
  rating: { fontFamily: font.bodyBold, fontSize: 12, width: 34, textAlign: 'right', ...tabular },
  gap: {
    fontFamily: font.bodyRegular,
    fontSize: 10,
    color: color.textFaint,
    width: 32,
    textAlign: 'right',
    ...tabular,
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, gap: 4 },
  emptyText: { fontFamily: font.heading, fontSize: 15, color: color.text, textAlign: 'center' },
  emptySub: {
    fontFamily: font.bodyRegular,
    fontSize: 11,
    color: color.textFaint,
    textAlign: 'center',
  },
}));
