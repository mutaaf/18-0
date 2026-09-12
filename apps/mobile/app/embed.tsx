import { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useLocalSearchParams } from 'expo-router';
import { Brand } from '@/components/Brand';
import { EmbedBoard } from '@/components/EmbedBoard';
import { EmbedSeasons } from '@/components/EmbedSeasons';
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
 * The address is the control, because the host chooses it when it sets the
 * frame's `src` -- a segmented control in the panel changes the address rather
 * than talking to the frame, so there is one way in and no message to keep in
 * step.
 *
 * Read through the router rather than off `window.location`, which is what it
 * used to do behind a `useState` initialiser. That worked for the only caller
 * there was -- a host assigning `src` on a fresh document -- and silently did
 * not work for the second one: the result screen sending a player to
 * `/embed?view=board` from inside the frame is a client-side navigation, and
 * the component had already read the old address by the time this one existed.
 * The frame arrived on the board's URL showing the entry card.
 */
function useView(): 'entry' | 'board' | 'seasons' {
  const view = useLocalSearchParams<{ view?: string }>().view;
  return view === 'board' || view === 'seasons' ? view : 'entry';
}

/**
 * The game in a card, for a frame in somebody else's page.
 *
 * Three views: an entry card that starts a season, a board, and the seasons
 * this browser has played. The last of those is not a luxury -- a framed season
 * is recorded on an anonymous account, and the public boards exclude those on
 * purpose, so without it there is nowhere a player can see the thing they just
 * did. History is on the device either way.
 *
 * A frame on a watch page is a couple of hundred points tall, and the thing it
 * has to do is be obviously playable at a glance -- not reproduce a home
 * screen. Everything that makes the full app a *product* rather than a game is
 * gone: no dock, no sign-in, no install prompt, no account screen.
 *
 * Scout, because that is what the front page leads with and because a frame is
 * the worst possible place to explain three modes.
 *
 * Ranked is on, and this is the line that was wrong for as long as the frame
 * has existed. It used to read: "a frame has no way to sign in and nothing to
 * attach a season to". Neither half was true. `ensureSession()` signs in
 * anonymously with no UI whatsoever -- it is how the site opens a ranked
 * session for somebody who has never seen a sign-in screen -- and the session
 * it makes is exactly the thing a season attaches to. So every season played
 * here was dealt locally and scored locally, which is to say it could not have
 * reached a board even in principle, while the extension was offering to link
 * an account so seasons could rank.
 *
 * No sign-in appears here and none is needed: `useStartGame` opens the ranked
 * session before the first spin and downgrades in the open if it cannot, so a
 * frame with no network, or one in a browser that refuses it storage, still
 * plays the whole game and says plainly that this one will not be ranked.
 * That is invariant 3, and it is unchanged.
 *
 * What a framed player does *not* get for free is the public board: it filters
 * on `is_permanent` (0011), and this surface must never offer sign-in
 * (clickjacking -- see `embed.ts`). `frame-standing.ts` holds what may honestly
 * be said about that, and the result screen says it.
 */
export default function Embed() {
  // Subscribes this screen to the palette, like every route. See theme.test.ts.
  useThemeId();
  const { start, opening } = useStartGame();
  const games = useHistoryStore((s) => s.games);
  const career = careerReport(games);
  const view = useView();

  useEffect(() => {
    tellHost(view);
  }, [view]);

  /**
   * The height the host should give this frame.
   *
   * Sent on layout rather than once on mount: the board arrives empty, paints a
   * cached list, then re-paints a fresh one that may be a different length, and
   * every one of those is a different height. `onLayout` fires for each, so the
   * frame is the size of what is in it rather than the size of what was
   * expected to be in it.
   */
  const measured = useCallback(
    (event: LayoutChangeEvent) => tellHost(view, event.nativeEvent.layout.height),
    [view],
  );

  if (view === 'board' || view === 'seasons') {
    return (
      <View style={styles.root}>
        <StadiumBackdrop />
        <View onLayout={measured}>
          {view === 'board' ? <EmbedBoard /> : <EmbedSeasons />}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StadiumBackdrop />

      <View style={styles.body} onLayout={measured}>
        <View style={styles.head}>
          <Brand size={20} />
          <Text style={styles.mode}>{MODE_LABEL.scout}</Text>
        </View>

        <Text style={styles.pitch}>
          Seven spins. One roster. See what it would have gone.
        </Text>

        <Pressable
          onPress={() => start('scout')}
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
          <Text style={styles.form}>Plays right here. Nothing to install, no sign-up.</Text>
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
