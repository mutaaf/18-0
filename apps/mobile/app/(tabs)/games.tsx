import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { franchise } from '@18-0/data';
import { Screen } from '@/components/Screen';
import { RatingBadge } from '@/components/RatingBadge';
import { useHistoryStore, type HistoryEntry } from '@/state/history';
import { color, font, positionColor, radius, space, tierColor, tracking, useLayout } from '@/theme';

export default function Games() {
  const layout = useLayout();
  const games = useHistoryStore((s) => s.games);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Screen maxWidth={layout.wide ? 820 : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>Games</Text>
        <Text style={styles.subtitle}>{games.length} saved</Text>
      </View>

      {games.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No seasons yet</Text>
          <Text style={styles.emptyCopy}>Finish a roster and it lands here.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {games.map((game) => (
            <GameCard
              key={game.id + game.completedAt}
              game={game}
              expanded={expanded === game.id + game.completedAt}
              onToggle={() =>
                setExpanded(expanded === game.id + game.completedAt ? null : game.id + game.completedAt)
              }
            />
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

function GameCard({
  game,
  expanded,
  onToggle,
}: {
  game: HistoryEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { result } = game;
  const accent = result.ending.key === 'PERFECT' ? color.gold : tierColor[result.ending.tier] ?? color.text;
  const date = new Date(game.completedAt);

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${result.record.wins} and ${result.record.losses}, ${result.ending.label}, rating ${result.finalRating.toFixed(1)}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={[styles.stripe, { backgroundColor: accent }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <Text style={[styles.record, { color: accent }]}>
            {result.record.wins}-{result.record.losses}
          </Text>
          <View style={styles.cardMain}>
            <Text style={[styles.ending, { color: accent }]}>{result.ending.label.toUpperCase()}</Text>
            <Text style={styles.cardDate}>
              {date.toLocaleDateString()} · Tier {result.ending.tier}
              {game.assisted ? ' · Assisted' : ''}
            </Text>
          </View>
          <RatingBadge rating={result.finalRating} size="sm" />
        </View>

        {expanded ? (
          <View style={styles.roster}>
            {game.roster.map((pick) => (
              <View key={pick.slot} style={styles.rosterRow}>
                <Text
                  style={[
                    styles.rosterSlot,
                    { color: positionColor[(pick.slot === 'DEF' ? 'DEF' : pick.slot.replace(/\d/g, '')) as keyof typeof positionColor] },
                  ]}
                >
                  {pick.slot}
                </Text>
                <Text style={styles.rosterName} numberOfLines={1}>
                  {pick.name}
                </Text>
                <Text style={styles.rosterMeta}>
                  {franchise(pick.franchiseId).abbr} '{String(pick.year).slice(2)}
                </Text>
                <Text style={styles.rosterRating}>{pick.rating.toFixed(1)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
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
  scroll: { paddingHorizontal: space.lg, paddingBottom: 120, gap: space.sm },
  card: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF05',
  },
  stripe: { width: 3 },
  cardBody: { flex: 1, padding: space.md },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  record: { fontFamily: font.displayBlack, fontSize: 24, width: 62, includeFontPadding: false },
  cardMain: { flex: 1, minWidth: 0 },
  ending: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide },
  cardDate: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
  roster: { marginTop: space.md, gap: 3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, paddingTop: space.sm },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rosterSlot: { fontFamily: font.label, fontSize: 10, width: 32, letterSpacing: tracking.wide },
  rosterName: { flex: 1, fontFamily: font.body, fontSize: 12, color: color.text },
  rosterMeta: { fontFamily: font.bodyRegular, fontSize: 10, color: color.textFaint, width: 52, textAlign: 'right' },
  rosterRating: { fontFamily: font.heading, fontSize: 12, color: color.textDim, width: 34, textAlign: 'right' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingBottom: 120 },
  emptyTitle: { fontFamily: font.heading, fontSize: 19, color: color.textDim },
  emptyCopy: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textFaint },
});
