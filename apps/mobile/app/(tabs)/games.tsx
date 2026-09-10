import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { franchise } from '@18-0/data';
import { Screen } from '@/components/Screen';
import { RatingBadge } from '@/components/RatingBadge';
import Svg, { Path } from 'react-native-svg';
import { useStartGame } from '@/features/start-game';
import { useHistoryStore, type HistoryEntry } from '@/state/history';
import { MODE_LABEL } from '@/state/game';
import { color, font, positionColor, radius, space, tabular, themed, tierColor, tracking, type PressState, useLayout, useThemeId } from '@/theme';

export default function Games() {
  // Subscribes this screen to the palette. React Navigation memoizes the
  // element it was handed, so a theme change reaches the component that
  // *creates* this screen's children or it reaches nothing -- which showed up
  // as a repainted picker sitting inside a screen still wearing the old
  // colours. `theme.test.ts` asserts every route does this.
  useThemeId();
  const layout = useLayout();
  const games = useHistoryStore((s) => s.games);
  const { start, opening } = useStartGame();
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Screen maxWidth={layout.wide ? 820 : undefined}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Games</Text>
            <Text style={styles.subtitle}>{games.length} saved</Text>
          </View>
          {/* The shortest path from "I have finished looking at these" back to
              playing. It starts Scout because that is the mode the front page
              leads with, and it goes through the same `useStartGame` the mode
              cards do -- a second implementation here would be a second place
              for the ranked handshake to be wrong. */}
          <Pressable
            onPress={() => start('scout')}
            disabled={opening}
            accessibilityRole="button"
            accessibilityLabel="Quick play a Scout season"
            style={({ hovered, pressed }: PressState) => [
              styles.quick,
              hovered && styles.quickHover,
              pressed && { opacity: 0.9 },
              opening && styles.quickBusy,
            ]}
          >
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
              <Path d="M7 4.5l12 7.5-12 7.5z" fill={color.onAction} />
            </Svg>
            <Text style={styles.quickLabel}>{opening ? 'Starting…' : 'Quick play'}</Text>
          </Pressable>
        </View>
      </View>

      {games.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No seasons yet</Text>
          <Text style={styles.emptyCopy}>Finish a roster and it lands here.</Text>
          <Pressable
            onPress={() => start('scout')}
            disabled={opening}
            accessibilityRole="button"
            accessibilityLabel="Play a Scout season"
            style={styles.emptyCta}
          >
            <Text style={styles.emptyCtaLabel}>{opening ? 'Starting…' : 'Play a season'}</Text>
          </Pressable>
        </View>
      ) : (
        // History is capped at 500 games; rendering them all at once mounts
        // several thousand views for the four that are on screen.
        <FlatList
          data={games}
          keyExtractor={(game) => game.id + game.completedAt}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          renderItem={({ item }) => (
            <GameCard
              game={item}
              expanded={expanded === item.id + item.completedAt}
              onToggle={() =>
                setExpanded(expanded === item.id + item.completedAt ? null : item.id + item.completedAt)
              }
            />
          )}
        />
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
  const router = useRouter();
  const { result } = game;
  const accent = result.ending.key === 'PERFECT' ? color.gold : tierColor[result.ending.tier] ?? color.text;
  const date = new Date(game.completedAt);

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${result.record.wins} and ${result.record.losses}, ${result.ending.label}, tier ${result.ending.tier}, rating ${result.finalRating.toFixed(1)}${game.mode === 'player_iq' ? ', built blind' : ''}${game.assisted ? ', assisted' : ''}`}
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
              {game.mode ? ` · ${MODE_LABEL[game.mode]}` : ''}
              {game.assisted ? ' · Assisted' : ''}
            </Text>
          </View>
          <RatingBadge rating={result.finalRating} size="sm" />
        </View>

        {expanded ? (
          <View style={styles.roster}>
            {game.roster.map((pick) => (
              <Pressable
                key={pick.slot}
                onPress={() => router.push(`/card/${encodeURIComponent(pick.cardId)}`)}
                style={({ hovered, pressed }: PressState) => [
                  styles.rosterRow,
                  hovered && { backgroundColor: '#FFFFFF0A' },
                  pressed && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${pick.slot}. ${pick.name}. ${pick.year} ${franchise(pick.franchiseId).name}. Rating ${pick.rating.toFixed(1)}. Tap for the card.`}
              >
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
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  header: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headerText: { flex: 1, minWidth: 0 },
  quick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    minHeight: 44,
    borderRadius: radius.pill,
    backgroundColor: color.action,
    borderWidth: 1,
    borderColor: color.actionBright,
  },
  quickHover: { backgroundColor: color.actionBright },
  quickBusy: { opacity: 0.6 },
  quickLabel: {
    fontFamily: font.label,
    fontSize: 13,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.onAction,
  },
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
  emptyCta: {
    marginTop: space.lg,
    backgroundColor: color.action,
    borderRadius: radius.md,
    paddingHorizontal: space.xl,
    minHeight: 48,
    justifyContent: 'center',
  },
  emptyCtaLabel: {
    fontFamily: font.display,
    fontSize: 16,
    letterSpacing: tracking.wide,
    color: color.onAction,
    textTransform: 'uppercase',
  },
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
  record: { fontFamily: font.displayBlack, fontSize: 24, width: 62, includeFontPadding: false, ...tabular },
  cardMain: { flex: 1, minWidth: 0 },
  ending: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide },
  cardDate: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
  roster: { marginTop: space.md, gap: 3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, paddingTop: space.sm },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rosterSlot: { fontFamily: font.label, fontSize: 10, width: 32, letterSpacing: tracking.wide },
  rosterName: { flex: 1, fontFamily: font.body, fontSize: 12, color: color.text },
  rosterMeta: { fontFamily: font.bodyRegular, fontSize: 10, color: color.textFaint, width: 52, textAlign: 'right' },
  rosterRating: { fontFamily: font.heading, fontSize: 12, color: color.textDim, width: 34, textAlign: 'right', ...tabular },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingBottom: 120 },
  emptyTitle: { fontFamily: font.heading, fontSize: 19, color: color.textDim },
  emptyCopy: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textFaint },
}));
