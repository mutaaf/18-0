import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MODE_LABEL } from '@/state/game';
import { useHistoryStore, type HistoryEntry } from '@/state/history';
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
 * The seasons you have played here, in the frame you played them in.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS THE LIST THAT CAN BE SHOWN
 * ---------------------------------------------------------------------------
 *
 * A framed season is recorded on an anonymous account and the public boards
 * deliberately exclude those, so the leaderboard cannot show it back to the
 * person who played it. That is a real gap and this is what closes it: history
 * is kept on the device, by the same store the front page reads for "2 seasons
 * here", so it is already sitting there whether or not anything reached a
 * server.
 *
 * It survives partitioning, which is the reason it works at all. A third-party
 * frame gets its own storage bucket keyed to the page holding it, so the
 * seasons played on a watch page come back on that watch page every time --
 * the partition that stops a framed account being the same account as the one
 * on 18-0.co is the same partition that makes this list stable.
 *
 * Local, so it is the honest answer to "my seasons" and not to "everyone's":
 * no rank, no comparison, no claim about a board. The board is one tab away
 * and says what it says.
 */
export function EmbedSeasons() {
  const games = useHistoryStore((s) => s.games);

  // Newest first is how the store keeps it; sorting again would be work that
  // says the store cannot be trusted about its own order.
  const seasons = useMemo(() => games.slice(0, 40), [games]);

  if (seasons.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No seasons here yet.</Text>
        <Text style={styles.emptySub}>
          Play one and it lands here — on this page, on this browser.
        </Text>
      </View>
    );
  }

  const best = Math.max(...seasons.map((g) => g.result.finalRating));

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.list}>
      <View style={styles.head}>
        <Text style={styles.title}>Your seasons</Text>
        <Text style={styles.sub}>
          {seasons.length === 1 ? '1 season' : `${seasons.length} seasons`} · kept on this browser
        </Text>
      </View>

      {seasons.map((game) => (
        <Season key={game.id} game={game} best={game.result.finalRating === best} />
      ))}
    </ScrollView>
  );
}

function Season({ game, best }: { game: HistoryEntry; best: boolean }) {
  // The tier is already on the result -- the ending carries it, which is the
  // same value the board colours by. Recomputing it here would be a second
  // opinion about a number the domain has already had the final word on.
  const { finalRating, record, ending } = game.result;
  const tint = tierColor[ending.tier] ?? color.text;

  return (
    <View style={[styles.row, best && styles.rowBest]}>
      <View style={styles.when}>
        <Text style={styles.date}>{stamp(game.completedAt)}</Text>
        <Text style={styles.mode}>{MODE_LABEL[game.mode ?? 'scout']}</Text>
      </View>
      <Text style={styles.record}>
        {record.wins}-{record.losses}
      </Text>
      <Text style={[styles.rating, { color: tint }]}>{finalRating.toFixed(1)}</Text>
    </View>
  );
}

/**
 * A date short enough for a frame, and unambiguous without a year.
 *
 * `toLocaleDateString` with an explicit shape rather than the default, because
 * the default is a full date in most locales and this column is forty points
 * wide.
 */
function stamp(at: number): string {
  try {
    return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1 },
  list: { padding: space.lg, gap: space.xs },
  head: { gap: 1, marginBottom: space.xs },
  title: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.actionBright,
  },
  sub: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 7,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    backgroundColor: '#FFFFFF05',
  },
  rowBest: { borderWidth: 1, borderColor: color.lineGold, backgroundColor: color.goldGlow },
  when: { flex: 1, minWidth: 0 },
  date: { fontFamily: font.bodyBold, fontSize: 12, color: color.text },
  mode: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  record: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textDim, ...tabular },
  rating: { fontFamily: font.bodyBold, fontSize: 14, width: 42, textAlign: 'right', ...tabular },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg, gap: 4, minHeight: 150 },
  emptyText: { fontFamily: font.heading, fontSize: 15, color: color.text, textAlign: 'center' },
  emptySub: {
    fontFamily: font.bodyRegular,
    fontSize: 11,
    color: color.textFaint,
    textAlign: 'center',
    maxWidth: 260,
  },
}));
