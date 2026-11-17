import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/Pressable';
import { useShallow } from 'zustand/react/shallow';
import { LENS_SNOOZE, isLens, suggestLens, type Lens, type LensSuggestion } from '@/features/lens';
import { useStartGame } from '@/features/start-game';
import { track } from '@/features/telemetry';
import { MODE_LABEL, useGameStore } from '@/state/game';
import { useHistoryStore } from '@/state/history';
import { color, font, radius, space, themed, tracking, type PressState } from '@/theme';

/**
 * "Try GM Mode?" / "Try Rookie?" -- the lens suggestion, from features/lens.ts.
 *
 * Shown in full under a finished season, where the evidence was just made, and
 * as a single line under the front page's Play bar. Taking it starts a season
 * in the suggested lens straight away (the same one-tap start as Play);
 * "Not now" keeps it quiet for LENS_SNOOZE seasons.
 */
export function useLensSuggestion(): LensSuggestion | null {
  const games = useHistoryStore((s) => s.games);
  const { mode, snoozeUntil } = useGameStore(useShallow((s) => ({ mode: s.mode, snoozeUntil: s.lensSnoozeUntil })));
  return useMemo(() => {
    const current: Lens = isLens(mode) ? mode : 'scout';
    const seasons = games.map((g) => ({ mode: g.mode, wins: g.result.record.wins, assisted: g.assisted }));
    return suggestLens(seasons, current, games.length, snoozeUntil);
  }, [games, mode, snoozeUntil]);
}

const COPY: Record<string, { title: string; line: (avg: number) => string }> = {
  'rookie>scout': {
    title: 'Ready for Scout?',
    line: () => 'You read the ratings well. Scout hides them and shows the stat line, and it counts on the board.',
  },
  'scout>player_iq': {
    title: 'Try GM Mode?',
    line: (avg) => `About ${avg} wins a season in Scout lately. GM Mode takes the stat line away too: a name, a team and a year.`,
  },
  'player_iq>scout': {
    title: 'Bring the numbers back?',
    line: () => 'Scout shows each season’s stat line, and it still counts on the board.',
  },
  'scout>rookie': {
    title: 'Try Rookie for a few?',
    line: () => 'Rookie puts every rating on screen while you learn what wins. It’s practice, so it stays off the board.',
  },
};

export function LensNudge({ compact = false, replace = false }: { compact?: boolean; replace?: boolean }) {
  const suggestion = useLensSuggestion();
  const { start, opening } = useStartGame();
  const played = useHistoryStore((s) => s.games.length);
  const key = suggestion ? `${suggestion.from}>${suggestion.to}` : null;

  useEffect(() => {
    if (suggestion && !compact) track('lens_suggested', { from: suggestion.from, to: suggestion.to, wins: suggestion.averageWins });
    // Once per suggestion per finished season, not per render.
  }, [key, played, compact]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!suggestion || !key) return null;
  const copy = COPY[key];
  if (!copy) return null;

  const take = () => {
    track('lens_suggestion_taken', { from: suggestion.from, to: suggestion.to, where: compact ? 'home' : 'result' });
    void start(suggestion.to, { ranked: useGameStore.getState().preferRanked, replace });
  };
  const dismiss = () => {
    track('lens_suggestion_dismissed', { from: suggestion.from, to: suggestion.to });
    useGameStore.getState().snoozeLens(played + LENS_SNOOZE);
  };

  if (compact) {
    return (
      <Pressable
        onPress={take}
        disabled={opening}
        accessibilityRole="button"
        accessibilityLabel={`${copy.title} Starts a season in ${MODE_LABEL[suggestion.to]}.`}
        hitSlop={8}
        style={styles.compact}
      >
        {({ hovered }: PressState) => (
          <Text style={[styles.compactText, hovered && styles.compactHover]}>
            {suggestion.direction === 'up' ? '↑' : '↓'} {copy.title} <Text style={styles.compactGo}>Play {MODE_LABEL[suggestion.to]} →</Text>
          </Text>
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.card} accessibilityRole="summary">
      <Text style={styles.kicker}>{suggestion.direction === 'up' ? 'Level up' : 'A different lens'}</Text>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.line}>{copy.line(suggestion.averageWins)}</Text>
      <View style={styles.actions}>
        <Pressable
          onPress={take}
          disabled={opening}
          accessibilityRole="button"
          accessibilityLabel={`Play ${MODE_LABEL[suggestion.to]}`}
          style={({ pressed, hovered }: PressState) => [styles.go, hovered && styles.goHover, pressed && { opacity: 0.88 }]}
        >
          <Text style={styles.goLabel}>Play {MODE_LABEL[suggestion.to]}</Text>
        </Pressable>
        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Not now"
          hitSlop={8}
          style={({ pressed }) => [styles.later, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.laterLabel}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: color.lineBright,
      borderRadius: radius.md,
      padding: space.lg,
      gap: space.xs,
      backgroundColor: color.surface,
    },
    kicker: {
      fontFamily: font.label,
      fontSize: 10,
      letterSpacing: tracking.wider,
      textTransform: 'uppercase',
      color: color.action,
    },
    title: { fontFamily: font.display, fontSize: 22, color: color.text },
    line: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.silver },
    actions: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginTop: space.sm },
    go: {
      minHeight: 44,
      paddingHorizontal: space.lg,
      borderRadius: radius.pill,
      backgroundColor: color.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
    goHover: { backgroundColor: color.actionBright },
    goLabel: {
      fontFamily: font.label,
      fontSize: 14,
      letterSpacing: tracking.wide,
      textTransform: 'uppercase',
      color: color.onAction,
    },
    later: { minHeight: 44, justifyContent: 'center' },
    laterLabel: { fontFamily: font.body, fontSize: 13, color: color.textDim, textDecorationLine: 'underline' },
    compact: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
    compactText: { fontFamily: font.body, fontSize: 13, color: color.silver },
    compactHover: { color: color.text },
    compactGo: { fontFamily: font.bodyBold, color: color.action },
  }),
);
