import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { RatingBadge } from '@/components/RatingBadge';
import { Avatar } from '@/components/Avatar';
import { beginRanked } from '@/features/ranked';
import { track } from '@/features/telemetry';
import { fetchChallengeInvite, isBackendConfigured, type ChallengeInvite } from '@/services/supabase';
import { useGameStore } from '@/state/game';
import { color, elevate, font, radius, space, tabular, tracking, type PressState } from '@/theme';

/**
 * The screen a challenge link lands on.
 *
 * A share link used to point at the front page, which meant a challenge was a
 * sentence in a text message and nothing else: no way to see what you were
 * being asked to beat, and no way to answer it.
 *
 * What it shows is deliberately one-sided. You get the score, the record and
 * the name — everything you need to decide whether to take it on — and none of
 * the roster behind it, because a challenge whose answer sheet is attached is
 * a copying exercise.
 *
 * Answering opens a ranked, blind season pinned to this challenge. The server
 * then deals you the same seven franchise-eras the creator was dealt, which is
 * the only reading of head-to-head this game can honestly support: the same
 * wheels, the same dataset, a different pair of eyes.
 */
export default function Challenge() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  const token = typeof t === 'string' ? t : null;

  const game = useGameStore();
  const [invite, setInvite] = useState<ChallengeInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    if (!token || !isBackendConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setInvite(await fetchChallengeInvite(token));
      setError(null);
    } catch {
      setError('Could not reach the challenge.');
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async () => {
    if (!invite || opening) return;
    setOpening(true);
    setError(null);
    // The session opens before the local game is touched. Starting one first
    // would clear a season already in progress, and a challenge that turns out
    // to be closed would have cost you seven picks for nothing.
    const opened = await beginRanked('player_iq', invite.id);
    if (!opened.ok) {
      setOpening(false);
      setError(opened.message);
      void load();
      return;
    }
    // GM Mode, always. A challenge played with anything on screen is a
    // different question from the one the other side answered.
    game.startGame('player_iq', { ranked: true });
    game.attachServerSession(opened.value.sessionId, opened.value.idempotencyKey);
    track('challenge_accepted', { challenge: invite.id });
    setOpening(false);
    router.replace('/play');
  };

  const home = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  if (!token) return <Missing onHome={home} />;

  return (
    <Screen maxWidth={560}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>Head to head</Text>

        {loading ? (
          <View style={styles.centre}>
            <ActivityIndicator color={color.red} />
          </View>
        ) : !invite ? (
          <Missing onHome={home} inline />
        ) : (
          <>
            <View style={[styles.card, elevate(6)]}>
              <View style={styles.who}>
                <Avatar handle={invite.creatorHandle} size={44} />
                <View style={styles.whoText}>
                  <Text style={styles.handle} numberOfLines={1}>
                    {invite.creatorHandle}
                  </Text>
                  <Text style={styles.whoMeta}>challenged you</Text>
                </View>
              </View>

              <View style={styles.scoreRow}>
                <View>
                  <Text style={styles.label}>Their record</Text>
                  <Text style={styles.record}>{invite.creatorRecord ?? '—'}</Text>
                  {invite.creatorEnding ? (
                    <Text style={styles.ending}>{invite.creatorEnding}</Text>
                  ) : null}
                </View>
                {invite.creatorRating !== null ? (
                  <RatingBadge rating={invite.creatorRating} />
                ) : null}
              </View>

              {invite.creatorAssisted ? (
                <Text style={styles.flag}>Built with the assisted spin.</Text>
              ) : null}

              <Text style={styles.terms}>
                Answering deals you the same seven franchise-eras they were dealt, blind. Higher
                rating wins.
              </Text>
            </View>

            <Outcome invite={invite} />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {invite.status === 'open' && !invite.isMine && invite.myStatus !== 'completed' ? (
              <Pressable
                onPress={() => void accept()}
                disabled={opening}
                accessibilityRole="button"
                accessibilityLabel={`Answer the challenge from ${invite.creatorHandle}`}
                style={({ hovered, pressed }: PressState) => [
                  styles.cta,
                  hovered && { backgroundColor: color.redBright },
                  pressed && { opacity: 0.85 },
                  opening && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.ctaLabel}>
                  {opening
                    ? 'Opening…'
                    : invite.myStatus === 'in_progress'
                      ? 'Start again'
                      : 'Answer it'}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              onPress={home}
              accessibilityRole="button"
              accessibilityLabel="Back to the game"
              style={styles.quiet}
            >
              <Text style={styles.quietLabel}>Back to 18-0</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/** What state the challenge is in, when it is in one worth naming. */
function Outcome({ invite }: { invite: ChallengeInvite }) {
  if (invite.status === 'expired') {
    return (
      <View style={styles.note}>
        <Text style={styles.noteTitle}>This one expired</Text>
        <Text style={styles.noteCopy}>Challenges stay open for 30 days.</Text>
      </View>
    );
  }
  if (invite.status === 'complete') {
    const decided =
      invite.opponentRating !== null && invite.creatorRating !== null
        ? invite.opponentRating === invite.creatorRating
          ? 'A tie, to the decimal.'
          : `${invite.opponentRating > invite.creatorRating ? invite.opponentHandle : invite.creatorHandle} took it.`
        : 'Answered.';
    return (
      <View style={styles.note}>
        <Text style={styles.noteTitle}>Already answered</Text>
        <Text style={styles.noteCopy}>
          {invite.opponentHandle ?? 'Someone'} scored{' '}
          {invite.opponentRating?.toFixed(1) ?? '—'}. {decided}
        </Text>
      </View>
    );
  }
  if (invite.isMine) {
    return (
      <View style={styles.note}>
        <Text style={styles.noteTitle}>This is yours</Text>
        <Text style={styles.noteCopy}>Send the link on — you cannot answer your own.</Text>
      </View>
    );
  }
  if (invite.myStatus === 'completed') {
    return (
      <View style={styles.note}>
        <Text style={styles.noteTitle}>You already played this one</Text>
        <Text style={styles.noteCopy}>One answer each. That is what makes it a duel.</Text>
      </View>
    );
  }
  return null;
}

function Missing({ onHome, inline }: { onHome: () => void; inline?: boolean }) {
  const body = (
    <View style={styles.note}>
      <Text style={styles.noteTitle}>No such challenge</Text>
      <Text style={styles.noteCopy}>
        The link may be mistyped, or the season behind it was deleted.
      </Text>
      <Pressable onPress={onHome} accessibilityRole="button" style={styles.quiet}>
        <Text style={styles.quietLabel}>Back to 18-0</Text>
      </Pressable>
    </View>
  );
  return inline ? body : <Screen maxWidth={560}>{body}</Screen>;
}

const styles = StyleSheet.create({
  scroll: { padding: space.lg, paddingBottom: 140, gap: space.md },
  centre: { paddingVertical: space.xxl, alignItems: 'center' },
  eyebrow: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },

  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: `${color.red}40`,
    backgroundColor: '#0C0A12F2',
    padding: space.lg,
    gap: space.md,
  },
  who: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  whoText: { flex: 1, minWidth: 0 },
  handle: {
    fontFamily: font.displayBlack,
    fontSize: 26,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  whoMeta: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint },

  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.md,
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  label: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  record: {
    fontFamily: font.display,
    fontSize: 38,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  ending: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textDim },
  flag: { fontFamily: font.bodyRegular, fontSize: 11, color: color.gold },
  terms: { fontFamily: font.bodyRegular, fontSize: 13, lineHeight: 19, color: color.textDim },

  note: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#0A0E1799',
    padding: space.lg,
    gap: 4,
  },
  noteTitle: { fontFamily: font.heading, fontSize: 16, color: color.text },
  noteCopy: { fontFamily: font.bodyRegular, fontSize: 13, lineHeight: 19, color: color.textFaint },

  error: { fontFamily: font.bodyRegular, fontSize: 13, color: color.negative },

  cta: {
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.red,
  },
  ctaLabel: {
    fontFamily: font.display,
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: tracking.wide,
  },
  quiet: { alignSelf: 'center', paddingVertical: space.sm, paddingHorizontal: space.md },
  quietLabel: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide, color: color.textFaint },
});
