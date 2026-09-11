import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Brand } from '@/components/Brand';
import { EmbedBoard } from '@/components/EmbedBoard';
import { StadiumBackdrop } from '@/components/Screen';
import { useStartGame } from '@/features/start-game';
import { tellHost } from '@/features/embed';
import { useHistoryStore } from '@/state/history';
import { careerReport } from '@/state/career';
import { MODE_LABEL } from '@/state/game';
import {
  color,
  font,
  radius,
  space,
  tabular,
  themed,
  tracking,
  type PressState,
  useThemeId,
} from '@/theme';

/**
 * Which of the two things a frame can be showing.
 *
 * Read from the URL once, because the host chooses it when it sets the frame's
 * `src` -- a segmented control in the panel changes the address rather than
 * talking to the frame, so there is one way in and no message to keep in step.
 */
function initialView(): 'entry' | 'board' {
  if (typeof window === 'undefined') return 'entry';
  try {
    return new URLSearchParams(window.location.search).get('view') === 'board'
      ? 'board'
      : 'entry';
  } catch {
    return 'entry';
  }
}

/**
 * The game in a card, for a frame in somebody else's page.
 *
 * Two views and no more: an entry card that starts a season, and a board.
 * A frame on a watch page is a couple of hundred points tall, and the thing it
 * has to do is be obviously playable at a glance -- not reproduce a home
 * screen. Everything that makes the full app a *product* rather than a game is
 * gone: no dock, no sign-in, no install prompt, no account.
 *
 * Scout, because that is what the front page leads with and because a frame is
 * the worst possible place to explain three modes.
 *
 * Ranked is off. A ranked season needs the server to deal every spin, and a
 * frame has no way to sign in and nothing to attach a season to -- so it plays
 * locally, the way the game has always been able to, and says so rather than
 * quietly failing to reach a board.
 */
export default function Embed() {
  // Subscribes this screen to the palette, like every route. See theme.test.ts.
  useThemeId();
  const { start, opening } = useStartGame();
  const games = useHistoryStore((s) => s.games);
  const career = careerReport(games);
  const [view] = useState(initialView);

  useEffect(() => {
    tellHost(view);
  }, [view]);

  if (view === 'board') {
    return (
      <View style={styles.root}>
        <StadiumBackdrop />
        <EmbedBoard />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StadiumBackdrop />

      <View style={styles.body}>
        <View style={styles.head}>
          <Brand size={20} />
          <Text style={styles.mode}>{MODE_LABEL.scout}</Text>
        </View>

        <Text style={styles.pitch}>
          Seven spins. One roster. See what it would have gone.
        </Text>

        <Pressable
          onPress={() => start('scout', { ranked: false })}
          disabled={opening}
          accessibilityRole="button"
          accessibilityLabel="Play a season"
          style={({ hovered, pressed }: PressState) => [
            styles.play,
            hovered && styles.playHover,
            pressed && { opacity: 0.9 },
          ]}
        >
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Path d="M7 4.5l12 7.5-12 7.5z" fill={color.onAction} />
          </Svg>
          <Text style={styles.playLabel}>{opening ? 'Starting…' : 'Play a season'}</Text>
        </Pressable>

        {career.counted > 0 ? (
          <Text style={styles.form}>
            <Text style={styles.formValue}>{career.counted}</Text>
            {career.counted === 1 ? ' season' : ' seasons'} here · best{' '}
            <Text style={styles.formValue}>{career.bestRating?.toFixed(1)}</Text>
          </Text>
        ) : (
          <Text style={styles.form}>Plays right here. No account, nothing to install.</Text>
        )}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void, justifyContent: 'center' },
  body: { padding: space.lg, gap: space.sm, alignItems: 'flex-start' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  mode: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.actionBright,
    borderWidth: 1,
    borderColor: color.actionGlow,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pitch: {
    fontFamily: font.heading,
    fontSize: 19,
    lineHeight: 23,
    color: color.text,
    maxWidth: 300,
  },
  play: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 40,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: color.action,
    borderWidth: 1,
    borderColor: color.actionBright,
    marginTop: 2,
  },
  playHover: { backgroundColor: color.actionBright },
  playLabel: {
    fontFamily: font.label,
    fontSize: 12,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.onAction,
  },
  form: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
  formValue: { fontFamily: font.bodyBold, color: color.silver, ...tabular },
}));
