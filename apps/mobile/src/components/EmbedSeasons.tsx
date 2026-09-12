import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { franchise } from '@18-0/data';
import { SLOT_POSITION } from '@18-0/domain';
import { CarryOver } from './CarryOver';
import { MODE_LABEL } from '@/state/game';
import { useHistoryStore, type HistoryEntry } from '@/state/history';
import {
  color,
  font,
  positionColor,
  radius,
  space,
  tabular,
  themed,
  tierColor,
  tracking,
  type PressState,
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
  /**
   * One open at a time.
   *
   * The frame is sized from what this measures, so every roster left open is a
   * frame that grew -- four of them and the panel is taller than the page it is
   * sitting on. One is also the question being asked: what was *that* season.
   */
  const [open, setOpen] = useState<string | null>(null);

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
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.title}>Your seasons</Text>
        <Text style={styles.sub}>
          {seasons.length === 1 ? '1 season' : `${seasons.length} seasons`} · kept on this browser
        </Text>
      </View>

      {/* Above the list, because it is about all of them. It draws nothing
          unless the server has seasons to hand over. */}
      <CarryOver />

      <ScrollView style={styles.scroller} contentContainerStyle={styles.list}>
        {seasons.map((game) => (
          <Season
            key={game.id}
            game={game}
            best={game.result.finalRating === best}
            open={open === game.id}
            onToggle={() => setOpen(open === game.id ? null : game.id)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Season({
  game,
  best,
  open,
  onToggle,
}: {
  game: HistoryEntry;
  best: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  // The tier is already on the result -- the ending carries it, which is the
  // same value the board colours by. Recomputing it here would be a second
  // opinion about a number the domain has already had the final word on.
  const { finalRating, record, ending } = game.result;
  const tint = tierColor[ending.tier] ?? color.text;

  return (
    <View style={[styles.season, best && styles.seasonBest]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          `${stamp(game.completedAt)}. ${record.wins} and ${record.losses}. `
          + `${ending.label}. Rating ${finalRating.toFixed(1)}. `
          + `${open ? 'Hide' : 'Show'} the roster.`
        }
        style={({ hovered }: PressState) => [styles.row, hovered && styles.rowHover]}
      >
        <View style={styles.when}>
          <Text style={styles.date}>{stamp(game.completedAt)}</Text>
          <Text style={styles.mode}>
            {MODE_LABEL[game.mode ?? 'scout']} · {ending.label}
          </Text>
        </View>
        <Text style={styles.record}>
          {record.wins}-{record.losses}
        </Text>
        <Text style={[styles.rating, { color: tint }]}>{finalRating.toFixed(1)}</Text>
        <Text style={[styles.chevron, open && styles.chevronOpen]}>›</Text>
      </Pressable>

      {/*
        The seven, in the order they were filled. A season is the roster -- the
        rating is what it earned, and a list of ratings with no players in it is
        a scoreboard for a game nobody can see.
      */}
      {open ? (
        <View style={styles.roster}>
          {game.roster.map((pick) => (
            <View key={pick.slot} style={styles.pick}>
              <Text style={[styles.slot, { color: positionColor[SLOT_POSITION[pick.slot]] }]}>
                {pick.slot}
              </Text>
              <Text style={styles.name} numberOfLines={1}>
                {pick.name}
              </Text>
              <Text style={styles.team}>
                {franchise(pick.franchiseId).abbr} '{String(pick.year).slice(2)}
              </Text>
              <Text style={styles.pickRating}>{pick.rating.toFixed(1)}</Text>
            </View>
          ))}
        </View>
      ) : null}
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
  /**
   * Content-sized, and a scroller with a ceiling inside it.
   *
   * Not `flex: 1` -- the same note `EmbedBoard` carries, and I wrote this one
   * anyway. The frame is sized from what this measures, so a root that stretches
   * has nothing to stretch *into*: it measured zero, reported zero, and the view
   * collapsed the moment it was opened.
   *
   * The scroller needs a ceiling for the same reason it needs to scroll at all.
   * Forty seasons content-sized is a frame taller than the page holding it, and
   * the host clamps at 760 -- so without a bound the list would simply be cut
   * off with no way to reach the rest of it.
   */
  root: { padding: space.lg, gap: space.md },
  scroller: { maxHeight: 300 },
  list: { gap: space.xs },
  head: { gap: 1 },
  title: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.actionBright,
  },
  sub: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },

  season: { borderRadius: radius.sm, backgroundColor: '#FFFFFF05', overflow: 'hidden' },
  seasonBest: { borderWidth: 1, borderColor: color.lineGold, backgroundColor: color.goldGlow },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 7,
    paddingHorizontal: space.sm,
  },
  rowHover: { backgroundColor: '#FFFFFF0A' },
  chevron: {
    fontFamily: font.bodyBold,
    fontSize: 15,
    color: color.textFaint,
    width: 10,
    textAlign: 'center',
  },
  chevronOpen: { color: color.actionBright },

  roster: { paddingHorizontal: space.sm, paddingBottom: space.sm, gap: 2 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  slot: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    width: 26,
  },
  name: { flex: 1, minWidth: 0, fontFamily: font.body, fontSize: 11.5, color: color.text },
  team: { fontFamily: font.bodyRegular, fontSize: 10, color: color.textFaint, ...tabular },
  pickRating: {
    fontFamily: font.bodyBold,
    fontSize: 11,
    color: color.silver,
    width: 30,
    textAlign: 'right',
    ...tabular,
  },
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
