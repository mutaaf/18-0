import { memo, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Avatar } from '@/components/Avatar';
import { Pressable } from '@/components/Pressable';
import type { ChallengeRow, MySeason } from '@/services/supabase';
import { color, font, radius, space, tabular, teamWash, themed, tracking } from '@/theme';
import { useTVInitialFocus, type TVInitialFocus } from '../initial-focus';
import {
  TVFigure,
  TVHint,
  TVLabel,
  TVLayer,
  TVLine,
  TVList,
  TVPanel,
  TVRow,
  TVSplit,
  TVSwitcher,
  TVTitle,
  useFocusTrack,
  useMasterDetail,
  useTracked,
  type FocusTrack,
  type SwitchItem,
} from './kit';

/**
 * Challenges on a TV: filters along the top, every challenge you are party to
 * (and the seasons a challenge can be built from) down the left, and the one
 * the remote is on as a face-off in the panel on the right.
 *
 * The phone's page was panels of text: on a TV, with no share sheet, there
 * was nothing on it the remote could land on but a link to Play, and the
 * challenges themselves were unreachable. Here each is a row; Select on one
 * that is yours to answer opens it exactly as its link does on a phone
 * (`/challenge`), and the panel says who won and by how much.
 *
 * The data and every decision about it -- who won, which season is worth
 * putting up -- are the phone screen's, passed in from
 * `app/(tabs)/challenges.tsx`. A TV cannot send a challenge (no share sheet,
 * no pasteboard) and says so rather than offering a button that cannot work.
 */

type Filter = 'all' | 'answer' | 'waiting' | 'settled' | 'seasons';

export interface TVChallengesProps {
  rows: readonly ChallengeRow[];
  seasons: readonly MySeason[];
  me: string | null;
  best: MySeason | null;
  loading: boolean;
  failed: boolean;
  offline: boolean;
}

type Item =
  | { kind: 'pitch' }
  | { kind: 'duel'; row: ChallengeRow }
  | { kind: 'how'; step: (typeof HOW)[number] }
  | { kind: 'season'; season: MySeason; n: number }
  | { kind: 'empty'; title: string; copy: string };

const HOW = [
  { no: '01', title: 'Send a link', copy: 'Pick a season the server scored and share it with a friend, from the app on your phone.' },
  { no: '02', title: 'Same seven spins', copy: 'They are dealt exactly the franchise-eras you were dealt. The same wheels, a different pair of eyes.' },
  { no: '03', title: 'Higher rating wins', copy: 'Both seasons are scored the same way, by the server. Your roster stays secret.' },
] as const;

interface Verdict {
  label: string;
  tint: string;
  answerable: boolean;
  settled: boolean;
  won: boolean;
  tied: boolean;
}

/** The phone's reading of a challenge from your side of it (`Duel`), in one place. */
function verdictOf(row: ChallengeRow, me: string | null): Verdict {
  const settled = row.status === 'complete';
  const won = settled && me !== null && row.winnerUserId === me;
  const tied = settled && row.winnerUserId === null;
  const answerable = row.status === 'open' && !row.mine;
  const label =
    row.status === 'expired'
      ? 'Expired'
      : !settled
        ? row.mine
          ? 'Waiting for an answer'
          : 'Yours to answer'
        : tied
          ? 'Tied'
          : won
            ? 'You won'
            : 'You lost';
  const tint = row.status === 'expired' ? color.textFaint : !settled ? (answerable ? color.actionBright : color.ice) : tied ? color.silver : won ? color.gold : color.textDim;
  return { label, tint, answerable, settled, won, tied };
}

/** Both sides, from yours. */
function sidesOf(row: ChallengeRow) {
  const mine = row.mine;
  return {
    you: {
      handle: mine ? row.creatorHandle : row.opponentHandle ?? 'You',
      rating: mine ? row.creatorRating : row.opponentRating,
      record: mine ? row.creatorRecord : row.opponentRecord,
    },
    them: {
      handle: (mine ? row.opponentHandle : row.creatorHandle) ?? 'Nobody yet',
      rating: mine ? row.opponentRating : row.creatorRating,
      record: mine ? row.opponentRecord : row.creatorRecord,
    },
  };
}

/** An ending as the server stores it (`ROCK_BOTTOM`), as words. */
const endingOf = (key: string | null) =>
  key ? key.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'Season';

const dateOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export function TVChallenges({ rows, seasons, me, best, loading, failed, offline }: TVChallengesProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const track = useFocusTrack(-1);
  const md = useMasterDetail(track);

  const groups = useMemo(() => {
    const answer = rows.filter((r) => r.status === 'open' && !r.mine);
    const waiting = rows.filter((r) => r.status === 'open' && r.mine);
    const settled = rows.filter((r) => r.status !== 'open');
    return { all: rows, answer, waiting, settled };
  }, [rows]);

  const filters = useMemo<SwitchItem<Filter>[]>(
    () => [
      { key: 'all', label: 'All', note: String(rows.length) },
      { key: 'answer', label: 'Answer', note: String(groups.answer.length) },
      { key: 'waiting', label: 'Waiting', note: String(groups.waiting.length) },
      { key: 'settled', label: 'Settled', note: String(groups.settled.length) },
      { key: 'seasons', label: 'Seasons', note: String(seasons.length) },
    ],
    [rows.length, groups, seasons.length],
  );

  const items = useMemo<Item[]>(() => {
    if (filter === 'seasons') {
      return seasons.length
        ? seasons.map((season, n) => ({ kind: 'season', season, n }))
        : [{ kind: 'empty', title: 'No scored seasons yet', copy: 'Turn on Ranked and finish a season: the server scores it, and a challenge can be built from it.' }];
    }
    const duels: Item[] = groups[filter].map((row) => ({ kind: 'duel', row }));
    if (filter === 'all') return [{ kind: 'pitch' }, ...duels, ...(duels.length ? [] : HOW.map((step): Item => ({ kind: 'how', step })))];
    return duels.length ? duels : [{ kind: 'empty', title: 'Nothing here', copy: EMPTY_COPY[filter] }];
  }, [filter, groups, seasons]);

  const open = (row: ChallengeRow) => router.push({ pathname: '/challenge', params: { t: row.shareToken } });

  const master = (
    <>
      <TVTitle kicker="Same seven spins, head to head" title="Challenges" sub={`${groups.answer.length} to answer · ${groups.waiting.length} waiting · ${groups.settled.length} settled`} />
      {offline ? (
        <Message title="Challenges need the server" copy="A challenge deals your opponent the same seven franchise-eras you were dealt, which only the server can do. Offline seasons still play and still score." />
      ) : loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={color.action} size="large" />
        </View>
      ) : (
        <>
          <TVSwitcher label="Show" items={filters} value={filter} onChange={setFilter} onFocus={() => track.set(-1)} />
          {failed ? <Text style={styles.failed}>Couldn&apos;t reach your challenges. Your seasons are safe on this device.</Text> : null}
          <TVList
            // A new filter is a new list: start it at its top.
            key={filter}
            items={items}
            onRowFocus={md.onRowFocus}
            renderRow={(item, index) => (
              <Row
                key={keyOf(item, index)}
                item={item}
                index={index}
                claim={md.claimRow === index}
                me={me}
                onOpen={open}
                onEnter={md.enter}
                best={best}
              />
            )}
          />
        </>
      )}
    </>
  );

  return (
    <TVSplit
      master={master}
      detail={<Detail track={track} items={items} me={me} best={best} filter={filter} entering={md.entering} onOpen={open} />}
      onDetailEnter={md.onDetailEnter}
      onDetailLeave={md.onDetailLeave}
    />
  );
}

const EMPTY_COPY: Record<Exclude<Filter, 'all' | 'seasons'>, string> = {
  answer: 'Nobody has sent you one to answer. When they do, it lands here.',
  waiting: 'Every challenge you sent has been answered, or you have not sent one yet.',
  settled: 'No challenge has been decided yet.',
};

const keyOf = (item: Item, index: number) =>
  item.kind === 'duel' ? item.row.id : item.kind === 'season' ? item.season.id : item.kind === 'how' ? item.step.no : `${item.kind}-${index}`;

function Message({ title, copy }: { title: string; copy: string }) {
  return (
    <View style={styles.message}>
      <Text style={styles.messageTitle}>{title}</Text>
      <Text style={styles.messageCopy}>{copy}</Text>
    </View>
  );
}

const Row = memo(function Row({
  item,
  index,
  claim,
  me,
  onOpen,
  onEnter,
  best,
}: {
  item: Item;
  index: number;
  claim: boolean;
  me: string | null;
  onOpen: (row: ChallengeRow) => void;
  onEnter: () => void;
  best: MySeason | null;
}) {
  if (item.kind === 'duel') {
    const v = verdictOf(item.row, me);
    const { you, them } = sidesOf(item.row);
    return (
      <TVRow
        index={index}
        claim={claim}
        accent={v.tint}
        onPress={v.answerable ? () => onOpen(item.row) : undefined}
        label={`${v.label}. You ${you.rating === null ? 'not played' : you.rating.toFixed(1)}, ${them.handle} ${them.rating === null ? 'not played' : them.rating.toFixed(1)}${v.answerable ? '. Select to answer it' : ''}`}
      >
        {() => (
          <>
            <Avatar handle={them.handle} size={34} />
            <View style={styles.rowMain}>
              <Text style={[styles.status, { color: v.tint }]} numberOfLines={1}>
                {v.label.toUpperCase()}
              </Text>
              <Text style={styles.rowTitle} numberOfLines={1}>
                vs {them.handle}
              </Text>
            </View>
            <Text style={styles.score}>
              {you.rating === null ? '—' : you.rating.toFixed(1)}
              <Text style={styles.scoreDim}> · {them.rating === null ? '—' : them.rating.toFixed(1)}</Text>
            </Text>
          </>
        )}
      </TVRow>
    );
  }
  if (item.kind === 'pitch') {
    return (
      <TVRow
        index={index}
        claim={claim}
        accent={color.action}
        onPress={best ? undefined : onEnter}
        style={styles.pitchRow}
        label={best ? `Put one up. Your best clean season, ${best.record}, ${best.rating.toFixed(1)}` : 'Put one up. No season to challenge with yet'}
      >
        {() => (
          <>
            <View style={styles.rowMain}>
              <Text style={[styles.status, { color: color.actionBright }]}>PUT ONE UP</Text>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {best ? `Your best: ${best.record}` : 'No season to challenge with yet'}
              </Text>
            </View>
            {best ? <Text style={styles.score}>{best.rating.toFixed(1)}</Text> : null}
          </>
        )}
      </TVRow>
    );
  }
  if (item.kind === 'how') {
    return (
      <TVRow index={index} claim={claim} label={`Step ${item.step.no}. ${item.step.title}. ${item.step.copy}`}>
        {() => (
          <>
            <Text style={styles.howNo}>{item.step.no}</Text>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>{item.step.title}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {item.step.copy}
              </Text>
            </View>
          </>
        )}
      </TVRow>
    );
  }
  if (item.kind === 'season') {
    const s = item.season;
    const isBest = best?.id === s.id;
    return (
      <TVRow
        index={index}
        claim={claim}
        accent={isBest ? color.gold : s.assisted ? color.textFaint : color.action}
        label={`${s.record}, ${s.rating.toFixed(1)}${s.ending ? `, ${endingOf(s.ending)}` : ''}${s.blind ? ', built blind' : ''}${s.assisted ? ', assisted' : ''}${isBest ? ', your best clean season' : ''}`}
      >
        {() => (
          <>
            <Text style={[styles.record, isBest && { color: color.goldBright }]}>{s.record}</Text>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {endingOf(s.ending)}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {dateOf(s.completedAt)}
                {s.blind ? ' · Blind' : ''}
                {s.assisted ? ' · Assisted' : ''}
              </Text>
            </View>
            <Text style={styles.score}>{s.rating.toFixed(1)}</Text>
          </>
        )}
      </TVRow>
    );
  }
  return (
    <TVRow index={index} claim={claim} label={`${item.title}. ${item.copy}`}>
      {() => (
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={styles.rowSub} numberOfLines={2}>
            {item.copy}
          </Text>
        </View>
      )}
    </TVRow>
  );
});

function Detail({
  track,
  items,
  me,
  best,
  filter,
  entering,
  onOpen,
}: {
  track: FocusTrack;
  items: readonly Item[];
  me: string | null;
  best: MySeason | null;
  filter: Filter;
  entering: boolean;
  onOpen: (row: ChallengeRow) => void;
}) {
  const index = useTracked(track);
  const entry = useTVInitialFocus(entering);
  const item = index >= 0 ? items[index] : undefined;
  return (
    <View style={styles.fill}>
      <TVLayer shown={!item || item.kind === 'pitch'}>
        <PitchPanel best={best} entry={!item || item.kind === 'pitch' ? entry : null} filter={filter} />
      </TVLayer>
      <TVLayer shown={item?.kind === 'duel'}>{item?.kind === 'duel' ? <DuelPanel row={item.row} me={me} onOpen={onOpen} /> : null}</TVLayer>
      <TVLayer shown={item?.kind === 'season'}>{item?.kind === 'season' ? <SeasonPanel season={item.season} best={best} /> : null}</TVLayer>
      <TVLayer shown={item?.kind === 'how' || item?.kind === 'empty'}>
        {item?.kind === 'how' ? <StepPanel no={item.step.no} title={item.step.title} copy={item.step.copy} /> : null}
        {item?.kind === 'empty' ? <StepPanel no="—" title={item.title} copy={item.copy} /> : null}
      </TVLayer>
    </View>
  );
}

const PitchPanel = memo(function PitchPanel({ best, entry, filter }: { best: MySeason | null; entry: TVInitialFocus | null; filter: Filter }) {
  const router = useRouter();
  return (
    <TVPanel tint={color.action}>
      <TVLabel>Put one up</TVLabel>
      {best ? (
        <>
          <Text style={styles.panelTitle}>Your best clean season</Text>
          <View style={styles.figures}>
            <TVFigure value={best.record} label="Record" size="lg" />
            <TVFigure value={best.rating.toFixed(1)} label="Rating" tint={color.goldBright} size="lg" />
            
          </View>
          <TVLine label="Ending" value={endingOf(best.ending)} />
          <TVLine label="Played" value={dateOf(best.completedAt)} />
          <TVLine label="Built" value={best.blind ? 'Blind (GM Mode)' : 'With stat lines (Scout)'} />
          <Text style={styles.body}>
            A challenge goes out as a link, and a TV has nowhere to send one: send it from the app on your phone. Your ranked
            seasons here still count on the board.
          </Text>
          <Text style={styles.note}>They get your score and your record. Never your roster.</Text>
        </>
      ) : (
        <>
          <Text style={styles.panelTitle}>No season to challenge with yet</Text>
          <Text style={styles.body}>
            A challenge is built from a season the server scored, so turn on <Text style={styles.gold}>Ranked</Text> and finish one.
          </Text>
          <Pressable
            {...(entry ?? {})}
            onPress={() => router.push('/(tabs)')}
            accessibilityRole="button"
            accessibilityLabel="Go and play a ranked season"
            style={styles.cta}
          >
            <Text style={styles.ctaLabel}>Play one</Text>
          </Pressable>
        </>
      )}
      <View style={styles.grow} />
      <View style={styles.steps}>
        {HOW.map((step) => (
          <View key={step.no} style={styles.step}>
            <Text style={styles.stepNo}>{step.no}</Text>
            <Text style={styles.stepTitle}>{step.title}</Text>
          </View>
        ))}
      </View>
      <TVHint>{filter === 'all' ? 'Down through your challenges · Left and right to filter' : 'Down through the list'}</TVHint>
    </TVPanel>
  );
});

function DuelPanel({ row, me, onOpen }: { row: ChallengeRow; me: string | null; onOpen: (row: ChallengeRow) => void }) {
  const v = verdictOf(row, me);
  const { you, them } = sidesOf(row);
  const margin = you.rating !== null && them.rating !== null ? Math.abs(you.rating - them.rating) : null;
  const youWin = v.settled && v.won;
  const themWin = v.settled && !v.won && !v.tied;
  return (
    <TVPanel tint={v.tint}>
      <View style={[styles.banner, { borderColor: v.tint, backgroundColor: teamWash(v.tint, 0.14) }]}>
        <Text style={[styles.bannerText, { color: v.tint }]}>{v.label.toUpperCase()}</Text>
        {margin !== null && v.settled && !v.tied ? (
          <Text style={[styles.bannerMargin, { color: v.tint }]}>by {margin.toFixed(1)}</Text>
        ) : null}
      </View>
      <View style={styles.faceoff}>
        <Side label="You" handle={you.handle} rating={you.rating} record={you.record} lead={youWin} />
        <View style={styles.vs}>
          <Text style={styles.vsText}>VS</Text>
        </View>
        <Side label={row.mine ? 'Them' : 'Challenger'} handle={them.handle} rating={them.rating} record={them.record} lead={themWin} align="right" />
      </View>
      <TVLine label="Sent" value={dateOf(row.createdAt)} />
      <TVLine label="Who sent it" value={row.mine ? 'You' : row.creatorHandle} />
      <TVLine label="The deal" value="Same seven franchise-eras, scored by the server" />
      <View style={styles.grow} />
      {v.answerable ? (
        <Pressable onPress={() => onOpen(row)} accessibilityRole="button" accessibilityLabel={`Answer ${them.handle}'s challenge`} style={styles.cta}>
          <Text style={styles.ctaLabel}>Answer it</Text>
        </Pressable>
      ) : null}
      <TVHint>{v.answerable ? 'Select to answer: a ranked, blind season on the same seven spins' : 'Who won is decided by the server, not this screen'}</TVHint>
    </TVPanel>
  );
}

function Side({
  label,
  handle,
  rating,
  record,
  lead,
  align = 'left',
}: {
  label: string;
  handle: string;
  rating: number | null;
  record: string | null;
  lead: boolean;
  align?: 'left' | 'right';
}) {
  const right = align === 'right';
  return (
    <View style={[styles.side, right && styles.sideRight]}>
      <Avatar handle={handle} size={64} />
      <TVLabel style={{ marginTop: space.sm }}>{label}</TVLabel>
      <Text style={[styles.sideHandle, right && styles.textRight]} numberOfLines={1}>
        {handle}
      </Text>
      <Text style={[styles.sideRating, lead && { color: color.goldBright }]}>{rating === null ? '—' : rating.toFixed(1)}</Text>
      <Text style={styles.sideRecord}>{record ?? 'not played yet'}</Text>
    </View>
  );
}

function SeasonPanel({ season, best }: { season: MySeason; best: MySeason | null }) {
  const isBest = best?.id === season.id;
  return (
    <TVPanel tint={isBest ? color.gold : color.action}>
      <TVLabel style={isBest ? { color: color.gold } : undefined}>{isBest ? 'Your best clean season' : 'A season the server scored'}</TVLabel>
      <Text style={styles.panelTitle}>{endingOf(season.ending)}</Text>
      <View style={styles.figures}>
        <TVFigure value={season.record} label="Record" size="lg" />
        <TVFigure value={season.rating.toFixed(1)} label="Rating" tint={isBest ? color.goldBright : undefined} size="lg" />
      </View>
      <TVLine label="Played" value={dateOf(season.completedAt)} />
      <TVLine label="Built" value={season.blind ? 'Blind (GM Mode)' : 'With stat lines (Scout)'} />
      <TVLine label="Assisted" value={season.assisted ? 'Yes: not offered as a challenge' : 'No'} tint={season.assisted ? color.textFaint : undefined} />
      <View style={styles.grow} />
      <Text style={styles.body}>
        {season.assisted
          ? 'An assisted season is a number the game itself does not stand behind, so it is never put up as a challenge.'
          : isBest
            ? 'This is the season a challenge from you is built from: your opponent is dealt its seven spins.'
            : 'Only your best clean season is put up as a challenge.'}
      </Text>
    </TVPanel>
  );
}

function StepPanel({ no, title, copy }: { no: string; title: string; copy: string }) {
  return (
    <TVPanel>
      <TVLabel>How a challenge works</TVLabel>
      <Text style={styles.bigNo}>{no}</Text>
      <Text style={styles.panelTitle}>{title}</Text>
      <Text style={styles.body}>{copy}</Text>
    </TVPanel>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    fill: { flex: 1 },
    grow: { flex: 1 },
    loading: { paddingVertical: space.xxxl, alignItems: 'center' },
    failed: { fontFamily: font.body, fontSize: 12, color: color.textFaint, marginBottom: space.sm, marginLeft: space.xs },
    message: { gap: 6, paddingTop: space.md, paddingHorizontal: space.xs },
    messageTitle: { fontFamily: font.heading, fontSize: 20, color: color.text },
    messageCopy: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.textDim },

    rowMain: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: font.heading, fontSize: 18, color: color.text },
    rowSub: { fontFamily: font.body, fontSize: 11, color: color.textDim },
    status: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide },
    score: { fontFamily: font.display, fontSize: 22, color: color.text, ...tabular },
    scoreDim: { color: color.textFaint, fontSize: 18 },
    record: { fontFamily: font.displayBlack, fontSize: 24, color: color.text, width: 62, ...tabular },
    howNo: { fontFamily: font.display, fontSize: 26, color: color.actionBright, width: 36 },
    pitchRow: { borderColor: teamWash(color.action, 0.6), backgroundColor: teamWash(color.action, 0.1) },

    panelTitle: { fontFamily: font.display, fontSize: 30, lineHeight: 32, color: color.text, marginTop: 2, marginBottom: space.sm },
    figures: { flexDirection: 'row', gap: space.xxl, marginVertical: space.md, flexWrap: 'wrap' },
    body: { fontFamily: font.body, fontSize: 14, lineHeight: 21, color: color.silver, marginTop: space.md, maxWidth: 560 },
    note: { fontFamily: font.body, fontSize: 12, color: color.textFaint, marginTop: space.sm },
    gold: { color: color.goldBright },
    cta: {
      alignSelf: 'flex-start',
      marginTop: space.lg,
      paddingHorizontal: space.xl,
      height: 50,
      borderRadius: radius.lg,
      justifyContent: 'center',
      backgroundColor: color.action,
    },
    ctaLabel: { fontFamily: font.display, fontSize: 20, letterSpacing: tracking.normal, color: color.onAction },

    steps: { flexDirection: 'row', gap: space.lg, borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.md },
    step: { flex: 1, gap: 0 },
    stepNo: { fontFamily: font.display, fontSize: 22, color: color.actionBright },
    stepTitle: { fontFamily: font.heading, fontSize: 15, color: color.text },

    banner: { flexDirection: 'row', alignItems: 'baseline', alignSelf: 'flex-start', gap: space.sm, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 },
    bannerText: { fontFamily: font.label, fontSize: 15, letterSpacing: tracking.wider },
    bannerMargin: { fontFamily: font.display, fontSize: 15, ...tabular },
    faceoff: { flexDirection: 'row', alignItems: 'center', marginVertical: space.lg },
    side: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
    sideRight: { alignItems: 'flex-end' },
    textRight: { textAlign: 'right' },
    sideHandle: { fontFamily: font.heading, fontSize: 20, color: color.text, maxWidth: '100%' },
    sideRating: { fontFamily: font.display, fontSize: 56, lineHeight: 58, color: color.text, ...tabular },
    sideRecord: { fontFamily: font.label, fontSize: 14, letterSpacing: tracking.normal, color: color.textDim },
    vs: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: color.lineBright, alignItems: 'center', justifyContent: 'center', backgroundColor: color.scrim },
    vsText: { fontFamily: font.displayBlack, fontSize: 24, color: color.silver },

    bigNo: { fontFamily: font.displayBlack, fontSize: 96, lineHeight: 96, color: color.actionBright, marginTop: space.lg },
  }),
);
