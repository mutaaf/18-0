import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { Panel } from '@/components/Panel';
import { Avatar } from '@/components/Avatar';
import { RatingBadge } from '@/components/RatingBadge';
import { APP_URL } from '@/features/share';
import { track } from '@/features/telemetry';
import {
  createChallenge,
  currentUser,
  fetchMyChallenges,
  fetchMySeasons,
  isBackendConfigured,
  type ChallengeRow,
  type MySeason,
} from '@/services/supabase';
import { color, font, radius, space, tabular, tracking, useLayout, type PressState } from '@/theme';

/** Where a challenge lives. A query parameter, because the site is a static
 *  export and a path that was never exported is a 404 before the app runs. */
export const challengeUrl = (token: string) => `${APP_URL}?c=${token}`;

/**
 * Challenges, both directions.
 *
 * This screen used to offer one button that shared a link to the front page.
 * Nothing carried the roster, nothing on the other end could answer it, and
 * nothing ever came back — so a challenge was a text message with a score in
 * it and the game had no idea any of it had happened.
 *
 * Now it makes a real one from a season the server scored, and shows both
 * sides of every challenge you are party to with the result attached. Who won
 * is decided in the database, not here, so the two players are never looking
 * at two different answers.
 */
export default function Challenges() {
  const layout = useLayout();
  const [rows, setRows] = useState<ChallengeRow[]>([]);
  const [seasons, setSeasons] = useState<MySeason[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(isBackendConfigured);
  const [failed, setFailed] = useState(false);
  const [making, setMaking] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isBackendConfigured) return setLoading(false);
    setLoading(true);
    setFailed(false);
    try {
      const [who, mine, seasonRows] = await Promise.all([
        currentUser(),
        fetchMyChallenges(),
        fetchMySeasons(),
      ]);
      setMe(who?.id ?? null);
      setRows(mine);
      setSeasons(seasonRows);
    } catch {
      setFailed(true);
      setRows([]);
      setSeasons([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only a clean, server-scored season is worth putting up. An assisted one is
  // a number the game itself does not stand behind.
  const best = seasons.find((s) => !s.assisted) ?? null;

  const send = async (season: MySeason) => {
    if (making) return;
    setMaking(true);
    const token = await createChallenge(season.id);
    setMaking(false);
    if (!token) {
      setFailed(true);
      return;
    }
    track('challenge_created', { rating: Math.round(season.rating) });
    const link = challengeUrl(token);
    const message = `I built a ${season.record} roster in 18-0 (${season.rating.toFixed(1)}). Same seven spins. Beat it.\n${link}`;
    await Share.share(Platform.OS === 'ios' ? { message, url: link } : { message }).catch(() => {});
    await load();
  };

  const copy = async (token: string) => {
    await Clipboard.setStringAsync(challengeUrl(token)).catch(() => {});
    setCopied(token);
    setTimeout(() => setCopied((was) => (was === token ? null : was)), 2000);
  };

  return (
    <Screen maxWidth={layout.wide ? 760 : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>Challenges</Text>
        <Text style={styles.subtitle}>Same seven spins, head to head</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {!isBackendConfigured ? (
          <Panel contentStyle={styles.note}>
            <Text style={styles.noteTitle}>Challenges need the server</Text>
            <Text style={styles.noteCopy}>
              A challenge deals your opponent the same seven franchise-eras you were dealt, which
              only the server can do. Offline seasons still play and still score.
            </Text>
          </Panel>
        ) : loading ? (
          <ActivityIndicator color={color.red} style={{ marginTop: space.xl }} />
        ) : (
          <>
            {best ? (
              <Panel tint={color.red} contentStyle={styles.pitch}>
                <Text style={styles.pitchLabel}>Put one up</Text>
                <View style={styles.pitchRow}>
                  <View style={styles.pitchMain}>
                    <Text style={styles.pitchRecord}>{best.record}</Text>
                    <Text style={styles.pitchMeta}>
                      {best.ending ?? 'Season'}
                      {best.blind ? ' · built blind' : ''}
                    </Text>
                  </View>
                  <RatingBadge rating={best.rating} size="sm" />
                </View>
                <Pressable
                  onPress={() => void send(best)}
                  disabled={making}
                  accessibilityRole="button"
                  accessibilityLabel="Challenge a friend with this season"
                  style={({ hovered, pressed }: PressState) => [
                    styles.cta,
                    hovered && { backgroundColor: color.redBright },
                    pressed && { opacity: 0.85 },
                    making && { opacity: 0.6 },
                  ]}
                >
                  <Text style={styles.ctaLabel}>{making ? 'Making a link…' : 'Challenge a friend'}</Text>
                </Pressable>
                <Text style={styles.pitchNote}>
                  They get your score and your record. Never your roster.
                </Text>
              </Panel>
            ) : (
              <Panel contentStyle={styles.note}>
                <Text style={styles.noteTitle}>No season to challenge with yet</Text>
                <Text style={styles.noteCopy}>
                  A challenge is built from a season the server scored, so turn on{' '}
                  <Text style={styles.strong}>Playing for the leaderboard</Text> and finish one.
                </Text>
                <Pressable
                  onPress={() => router.push('/(tabs)')}
                  accessibilityRole="button"
                  accessibilityLabel="Go and play a ranked season"
                  style={({ hovered }: PressState) => [styles.quiet, hovered && { opacity: 0.8 }]}
                >
                  <Text style={styles.quietLabel}>Play one →</Text>
                </Pressable>
              </Panel>
            )}

            {failed ? (
              <Text style={styles.failed} accessibilityLiveRegion="polite">
                Couldn&apos;t reach your challenges. Your seasons are safe on this device.
              </Text>
            ) : null}

            {rows.length > 0 ? (
              <View style={styles.list}>
                <Text style={styles.sectionTitle}>Your challenges</Text>
                {rows.map((row) => (
                  <Duel
                    key={row.id}
                    row={row}
                    meId={me}
                    copied={copied === row.shareToken}
                    onCopy={() => void copy(row.shareToken)}
                  />
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

/**
 * One challenge, from your side of it.
 *
 * The same row serves both directions: the labels swap, the scores do not, and
 * the winner comes from the view rather than from a comparison written twice.
 */
function Duel({
  row,
  meId,
  copied,
  onCopy,
}: {
  row: ChallengeRow;
  meId: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  const mine = row.mine;
  const you = {
    handle: mine ? row.creatorHandle : (row.opponentHandle ?? 'you'),
    rating: mine ? row.creatorRating : row.opponentRating,
    record: mine ? row.creatorRecord : row.opponentRecord,
  };
  const them = {
    handle: mine ? row.opponentHandle : row.creatorHandle,
    rating: mine ? row.opponentRating : row.creatorRating,
    record: mine ? row.opponentRecord : row.creatorRecord,
  };

  const settled = row.status === 'complete';
  const won = settled && meId !== null && row.winnerUserId === meId;
  const tied = settled && row.winnerUserId === null;
  const tint = !settled ? undefined : tied ? color.silver : won ? color.gold : color.textFaint;

  return (
    <Panel tint={tint} contentStyle={styles.duel}>
      <View style={styles.duelHead}>
        <Text style={styles.duelStatus}>
          {row.status === 'expired'
            ? 'EXPIRED'
            : !settled
              ? mine
                ? 'WAITING FOR AN ANSWER'
                : 'YOURS TO ANSWER'
              : tied
                ? 'TIED'
                : won
                  ? 'YOU WON'
                  : 'YOU LOST'}
        </Text>
        {!settled && row.status === 'open' && mine ? (
          <Pressable
            onPress={onCopy}
            accessibilityRole="button"
            accessibilityLabel="Copy the challenge link"
            style={({ hovered }: PressState) => [styles.copy, hovered && { opacity: 0.8 }]}
          >
            <Text style={styles.copyLabel}>{copied ? 'COPIED' : 'COPY LINK'}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.sides}>
        <Side handle={you.handle} record={you.record} rating={you.rating} label="You" />
        <Text style={styles.versus}>vs</Text>
        <Side
          handle={them.handle ?? 'Nobody yet'}
          record={them.record}
          rating={them.rating}
          label={mine ? 'Them' : 'Challenger'}
          align="right"
        />
      </View>
    </Panel>
  );
}

function Side({
  handle,
  record,
  rating,
  label,
  align = 'left',
}: {
  handle: string;
  record: string | null;
  rating: number | null;
  label: string;
  align?: 'left' | 'right';
}) {
  const right = align === 'right';
  return (
    <View style={[styles.side, right && { alignItems: 'flex-end' }]}>
      <Avatar handle={handle} size={28} />
      <Text style={[styles.sideLabel, right && { textAlign: 'right' }]}>{label}</Text>
      <Text style={[styles.sideHandle, right && { textAlign: 'right' }]} numberOfLines={1}>
        {handle}
      </Text>
      <Text style={[styles.sideScore, right && { textAlign: 'right' }]}>
        {rating === null ? '—' : rating.toFixed(1)}
      </Text>
      <Text style={[styles.sideRecord, right && { textAlign: 'right' }]}>{record ?? 'not played'}</Text>
    </View>
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
  scroll: { paddingHorizontal: space.lg, paddingBottom: 140, gap: space.lg },

  pitch: { padding: space.lg, gap: space.md },
  pitchLabel: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  pitchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pitchMain: { flex: 1, minWidth: 0 },
  pitchRecord: {
    fontFamily: font.display,
    fontSize: 34,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  pitchMeta: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint },
  pitchNote: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },

  cta: {
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.red,
  },
  ctaLabel: { fontFamily: font.display, fontSize: 16, color: '#FFFFFF', letterSpacing: tracking.wide },

  note: { padding: space.lg, gap: 6 },
  noteTitle: { fontFamily: font.heading, fontSize: 17, color: color.text },
  noteCopy: { fontFamily: font.bodyRegular, fontSize: 13, lineHeight: 19, color: color.textFaint },
  strong: { color: color.gold },
  quiet: { alignSelf: 'flex-start', paddingVertical: space.xs },
  quietLabel: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide, color: color.redBright },

  failed: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textFaint },

  list: { gap: space.md },
  sectionTitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },

  duel: { padding: space.lg, gap: space.md },
  duelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  duelStatus: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textDim,
  },
  copy: { paddingVertical: 2, paddingHorizontal: space.sm, borderWidth: 1, borderColor: color.line, borderRadius: radius.pill },
  copyLabel: { fontFamily: font.label, fontSize: 9, letterSpacing: tracking.wide, color: color.textFaint },

  sides: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  side: { flex: 1, minWidth: 0, gap: 1 },
  sideLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
    marginTop: 4,
  },
  sideHandle: { fontFamily: font.body, fontSize: 14, color: color.text },
  sideScore: {
    fontFamily: font.display,
    fontSize: 26,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  sideRecord: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
  versus: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
});
