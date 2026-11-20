import { memo, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { displayName, franchise } from '@17-0/data';
import { Avatar } from '@/components/Avatar';
import { RatingRidge } from '@/components/charts';
import { Pressable } from '@/components/Pressable';
import { RankGate } from '@/components/RankGate';
import { ReportButton } from '@/components/ReportButton';
import { RESPIN_MARK } from '@17-0/respins/client';
import { lookupCard, type GameMode } from '@/state/game';
import {
  fetchRoster,
  type Identity,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type PointsRow,
  type RosterPick,
} from '@/services/supabase';
import { color, font, positionColor, radius, space, tabular, teamWash, themed, tierColor, tracking, type PressState } from '@/theme';
import { useTVInitialFocus, type TVInitialFocus } from '../initial-focus';
import {
  TVFigure,
  TVHint,
  TVLabel,
  TVLayer,
  TVLine,
  TVList,
  TVMeter,
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
 * Leaderboards on a TV: which board and over what window along the top, the
 * field down the left, and the entry the remote is on -- rank, record, where
 * it sits in the field, the gap either side, and the seven players behind it
 * -- in the panel on the right. Your own place is pinned first; Select on it
 * jumps to your row.
 *
 * Every decision (which boards exist, what each fetches, who you are) is the
 * phone screen's, passed in from `app/(tabs)/leaderboard.tsx`, so the two can
 * never rank differently. Nothing here asks the server for anything the phone
 * does not: the roster is the phone's own `fetchRoster`, asked once the remote
 * has settled on a row rather than once per press.
 */

type Board = 'rating' | 'scout' | 'points' | 'gameday';

export interface TVLeaderboardProps {
  boards: readonly { key: Board; label: string; blurb: string }[];
  board: Board;
  onBoard: (board: Board) => void;
  periods: readonly { key: LeaderboardPeriod; label: string }[];
  period: LeaderboardPeriod;
  onPeriod: (period: LeaderboardPeriod) => void;
  /** Null when respins are not offered: no clean-only switch. */
  clean: boolean | null;
  onClean: (clean: boolean) => void;
  subtitle: string;
  rows: readonly LeaderboardRow[];
  scores: readonly PointsRow[];
  me: Identity | null;
  loading: boolean;
  failed: boolean;
  offline: boolean;
  onRetry: () => void;
  gateMode: GameMode;
  gateHeading: string;
}

type Item =
  | { kind: 'you'; rank: number }
  | { kind: 'entry'; row: LeaderboardRow; rank: number }
  | { kind: 'points'; row: PointsRow; rank: number };

/** How long the remote rests on a row before its roster is asked for. */
const ROSTER_SETTLE_MS = 280;

const accentFor = (row: LeaderboardRow) => (row.endingKey === 'PERFECT' ? color.gold : tierColor[row.tier] ?? color.textDim);
const MEDALS = (): string[] => [color.goldBright, color.silver, color.ignitionBright];
const pts = new Intl.NumberFormat();

export function TVLeaderboard(props: TVLeaderboardProps) {
  const { board, rows, scores, me } = props;
  const pointsBoard = board === 'points';
  const track = useFocusTrack(-1);
  const md = useMasterDetail(track);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = pointsBoard
      ? scores.map((row, i) => ({ kind: 'points', row, rank: i + 1 }))
      : rows.map((row, i) => ({ kind: 'entry', row, rank: i + 1 }));
    const mine = me ? (pointsBoard ? scores.findIndex((r) => r.userId === me.userId) : rows.findIndex((r) => r.userId === me.userId)) : -1;
    return mine >= 0 ? [{ kind: 'you', rank: mine + 1 }, ...list] : list;
  }, [pointsBoard, rows, scores, me]);

  const pinned = items[0]?.kind === 'you' ? items[0].rank : null;
  const ownIndex = pinned === null ? -1 : pinned; // the pinned row shifts the list by one
  const top = rows[0]?.finalRating ?? 100;
  const floor = rows.length ? Math.min(...rows.map((r) => r.finalRating), top - 1) : top - 1;

  const boardItems = useMemo<SwitchItem<Board>[]>(() => props.boards.map((b) => ({ key: b.key, label: b.label })), [props.boards]);
  const periodItems = useMemo<SwitchItem<LeaderboardPeriod>[]>(() => props.periods.map((p) => ({ key: p.key, label: p.label })), [props.periods]);
  const toOverview = () => track.set(-1);
  const blurb = props.boards.find((b) => b.key === board)?.blurb ?? '';

  const body = props.offline ? (
    <Notice title="Leaderboards are offline" copy="Every season you play is still saved on this device. Rankings need a connection." />
  ) : props.loading && items.length === 0 ? (
    <View style={styles.loading}>
      <ActivityIndicator color={color.action} size="large" />
    </View>
  ) : props.failed ? (
    <View style={styles.notice}>
      <Notice title="Couldn't reach the rankings" copy="Your seasons are safe on this device." />
      <Pressable onPress={props.onRetry} accessibilityRole="button" accessibilityLabel="Retry loading the leaderboard" style={styles.retry}>
        <Text style={styles.retryLabel}>Retry</Text>
      </Pressable>
    </View>
  ) : items.length === 0 ? (
    <ScrollView contentContainerStyle={styles.gate}>
      <RankGate named={me?.named === true} mode={props.gateMode} requireBlind={!pointsBoard} heading={props.gateHeading} />
    </ScrollView>
  ) : (
    <TVList
      items={items}
      reach={md.claimRow}
      onRowFocus={md.onRowFocus}
      renderRow={(item, index) =>
        item.kind === 'you' ? (
          <YouRow key="you" rank={item.rank} index={index} claim={md.claimRow === index} onJump={md.jumpTo} target={ownIndex} />
        ) : item.kind === 'entry' ? (
          <EntryRow
            key={item.row.gameSessionId}
            row={item.row}
            rank={item.rank}
            index={index}
            claim={md.claimRow === index}
            isMe={item.row.userId === me?.userId}
            top={top}
            floor={floor}
            onPress={md.enter}
          />
        ) : (
          <PointsEntryRow
            key={item.row.userId}
            row={item.row}
            rank={item.rank}
            index={index}
            claim={md.claimRow === index}
            isMe={item.row.userId === me?.userId}
          />
        )
      }
    />
  );

  const master = (
    <>
      <TVTitle kicker={blurb} title="Leaderboards" sub={props.subtitle} />
      <TVSwitcher label="Board" items={boardItems} value={board} onChange={props.onBoard} onFocus={toOverview} />
      {board !== 'gameday' || props.clean !== null ? (
        <View style={styles.switchRow}>
          {board !== 'gameday' ? (
            <TVSwitcher label="Period" items={periodItems} value={props.period} onChange={props.onPeriod} onFocus={toOverview} />
          ) : null}
          {props.clean !== null ? (
            <TVSwitcher
              label="Seasons"
              items={CLEAN_ITEMS}
              value={props.clean ? 'clean' : 'all'}
              onChange={(k) => props.onClean(k === 'clean')}
              onFocus={toOverview}
            />
          ) : null}
        </View>
      ) : null}
      {body}
    </>
  );

  return (
    <TVSplit
      master={master}
      detail={
        <Detail
          track={track}
          items={items}
          rows={rows}
          scores={scores}
          board={board}
          blurb={blurb}
          label={props.boards.find((b) => b.key === board)?.label ?? ''}
          period={props.periods.find((p) => p.key === props.period)?.label ?? ''}
          me={me}
          top={top}
          floor={floor}
          entering={md.entering}
        />
      }
      onDetailEnter={md.onDetailEnter}
      onDetailLeave={md.onDetailLeave}
    />
  );
}

const CLEAN_ITEMS: SwitchItem<'all' | 'clean'>[] = [
  { key: 'all', label: `All · ${RESPIN_MARK} marked` },
  { key: 'clean', label: 'Clean only' },
];

function Notice({ title, copy }: { title: string; copy: string }) {
  return (
    <View style={styles.noticeBox}>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeCopy}>{copy}</Text>
    </View>
  );
}

const YouRow = memo(function YouRow({
  rank,
  index,
  claim,
  onJump,
  target,
}: {
  rank: number;
  index: number;
  claim: boolean;
  onJump: (index: number) => void;
  target: number;
}) {
  return (
    <TVRow
      index={index}
      claim={claim}
      onPress={() => onJump(target)}
      accent={color.goldBright}
      label={`Your place, number ${rank}. Select to jump to your row.`}
      style={styles.youRow}
    >
      {() => (
        <>
          <Text style={styles.youRank}>#{rank}</Text>
          <View style={styles.rowMain}>
            <Text style={styles.youTitle}>Your place</Text>
            <Text style={styles.rowSub}>Select to jump to your row</Text>
          </View>
          <Text style={styles.youArrow}>↓</Text>
        </>
      )}
    </TVRow>
  );
});

const EntryRow = memo(function EntryRow({
  row,
  rank,
  index,
  claim,
  isMe,
  top,
  floor,
  onPress,
}: {
  row: LeaderboardRow;
  rank: number;
  index: number;
  claim: boolean;
  isMe: boolean;
  top: number;
  floor: number;
  onPress: () => void;
}) {
  const accent = accentFor(row);
  const medal = rank <= 3 ? MEDALS()[rank - 1] : undefined;
  const fill = Math.max(0.06, Math.min(1, (row.finalRating - floor) / Math.max(top - floor, 1)));
  return (
    <TVRow
      index={index}
      claim={claim}
      onPress={onPress}
      accent={medal ?? accent}
      style={isMe ? styles.mineRow : undefined}
      label={`Rank ${rank}. ${row.handle}${isMe ? ', you' : ''}. ${row.wins} and ${row.losses}. Tier ${row.tier}. Rating ${row.finalRating.toFixed(1)}${row.respun ? '. Used a respin' : ''}`}
    >
      {() => (
        <>
          <Text style={[styles.rank, medal ? { color: medal } : null]}>{String(rank).padStart(2, '0')}</Text>
          <Avatar handle={row.handle} size={30} />
          <View style={styles.rowMain}>
            <View style={styles.handleRow}>
              <Text style={styles.handle} numberOfLines={1}>
                {row.handle}
              </Text>
              {row.respun ? <Text style={styles.respun}>{RESPIN_MARK}</Text> : null}
              {isMe ? <Text style={styles.you}>YOU</Text> : null}
            </View>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${fill * 100}%`, backgroundColor: accent }]} />
            </View>
          </View>
          <View style={styles.right}>
            <Text style={[styles.rating, { color: accent }]}>{row.finalRating.toFixed(1)}</Text>
            <Text style={styles.recordSmall}>
              {row.wins}-{row.losses} · {row.tier}
            </Text>
          </View>
        </>
      )}
    </TVRow>
  );
});

const PointsEntryRow = memo(function PointsEntryRow({
  row,
  rank,
  index,
  claim,
  isMe,
}: {
  row: PointsRow;
  rank: number;
  index: number;
  claim: boolean;
  isMe: boolean;
}) {
  const medal = rank <= 3 ? MEDALS()[rank - 1] : undefined;
  return (
    <TVRow
      index={index}
      claim={claim}
      accent={medal ?? color.action}
      style={isMe ? styles.mineRow : undefined}
      label={`Rank ${rank}. ${row.handle}${isMe ? ', you' : ''}. ${pts.format(row.points)} points from ${row.seasons} seasons`}
    >
      {() => (
        <>
          <Text style={[styles.rank, medal ? { color: medal } : null]}>{String(rank).padStart(2, '0')}</Text>
          <Avatar handle={row.handle} size={30} />
          <View style={styles.rowMain}>
            <View style={styles.handleRow}>
              <Text style={styles.handle} numberOfLines={1}>
                {row.handle}
              </Text>
              {isMe ? <Text style={styles.you}>YOU</Text> : null}
            </View>
            <Text style={styles.rowSub} numberOfLines={1}>
              {row.seasons} {row.seasons === 1 ? 'season' : 'seasons'}
              {row.respunSeasons > 0 ? ` · ${row.respunSeasons} ${RESPIN_MARK}` : ''}
            </Text>
          </View>
          <Text style={styles.points}>{pts.format(row.points)}</Text>
        </>
      )}
    </TVRow>
  );
});

/** The panel: the board's shape when the remote is on the switches, the entry when it is on a row. */
function Detail({
  track,
  items,
  rows,
  scores,
  board,
  blurb,
  label,
  period,
  me,
  top,
  floor,
  entering,
}: {
  track: FocusTrack;
  items: readonly Item[];
  rows: readonly LeaderboardRow[];
  scores: readonly PointsRow[];
  board: Board;
  blurb: string;
  label: string;
  period: string;
  me: Identity | null;
  top: number;
  floor: number;
  entering: boolean;
}) {
  const index = useTracked(track);
  const entry = useTVInitialFocus(entering);
  let item = index >= 0 ? items[index] : undefined;
  // The pinned row is your entry, shown as your entry.
  if (item?.kind === 'you') item = items[item.rank] ?? undefined;
  return (
    <View style={styles.fill}>
      <TVLayer shown={!item}>
        <Overview rows={rows} scores={scores} board={board} blurb={blurb} label={label} period={period} me={me} />
      </TVLayer>
      <TVLayer shown={item?.kind === 'entry'}>
        {item?.kind === 'entry' ? <EntryPanel row={item.row} rank={item.rank} rows={rows} top={top} floor={floor} isMe={item.row.userId === me?.userId} entry={entry} /> : null}
      </TVLayer>
      <TVLayer shown={item?.kind === 'points'}>
        {item?.kind === 'points' ? <PointsPanel row={item.row} rank={item.rank} scores={scores} isMe={item.row.userId === me?.userId} /> : null}
      </TVLayer>
    </View>
  );
}

/** The board as a whole, with its ridge: an Svg, drawn when the board loads, never on a focus move. */
const Overview = memo(function Overview({
  rows,
  scores,
  board,
  blurb,
  label,
  period,
  me,
}: {
  rows: readonly LeaderboardRow[];
  scores: readonly PointsRow[];
  board: Board;
  blurb: string;
  label: string;
  period: string;
  me: Identity | null;
}) {
  const ratings = useMemo(() => rows.map((r) => r.finalRating), [rows]);
  const points = board === 'points';
  const mineRating = me ? rows.find((r) => r.userId === me.userId)?.finalRating ?? null : null;
  const perfect = rows.filter((r) => r.endingKey === 'PERFECT').length;
  const median = ratings.length ? [...ratings].sort((a, b) => a - b)[Math.floor(ratings.length / 2)]! : null;
  return (
    <TVPanel tint={color.gold}>
      <TVLabel>{board === 'gameday' ? label : `${label} · ${period}`}</TVLabel>
      <Text style={styles.panelTitle}>{blurb}</Text>
      {points ? (
        <View style={styles.figures}>
          <TVFigure value={String(scores.length)} label="On the board" />
          <TVFigure value={scores[0] ? pts.format(scores[0].points) : '—'} label="Leader's points" tint={color.goldBright} />
          <TVFigure value={String(scores.reduce((t, r) => t + r.seasons, 0))} label="Seasons between them" />
        </View>
      ) : (
        <View style={styles.figures}>
          <TVFigure value={String(rows.length)} label="Seasons shown" />
          <TVFigure value={rows[0] ? rows[0].finalRating.toFixed(1) : '—'} label="Top rating" tint={color.goldBright} />
          <TVFigure value={median !== null ? median.toFixed(1) : '—'} label="Median" />
          <TVFigure value={String(perfect)} label="17-0s" tint={perfect ? color.goldBright : undefined} />
        </View>
      )}
      {!points && ratings.length >= 4 ? (
        <View style={styles.ridge}>
          <TVLabel>Where the board's seasons fall</TVLabel>
          <RatingRidge ratings={ratings} you={mineRating} height={240} />
        </View>
      ) : null}
      {points ? (
        <View style={styles.podium}>
          {scores.slice(0, 3).map((row, i) => (
            <View key={row.userId} style={styles.podiumStep}>
              <Text style={[styles.podiumPlace, { color: MEDALS()[i] }]}>{i + 1}</Text>
              <Avatar handle={row.handle} size={i === 0 ? 64 : 48} />
              <Text style={styles.podiumName} numberOfLines={1}>
                {row.handle}
              </Text>
              <Text style={styles.podiumPoints}>{pts.format(row.points)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.grow} />
      <TVHint>Left and right to change the board · Down through the field</TVHint>
    </TVPanel>
  );
});

function useRoster(sessionId: string): RosterPick[] | null | 'failed' {
  const [rosters, setRosters] = useState<Record<string, RosterPick[] | 'failed'>>({});
  const known = rosters[sessionId];
  useEffect(() => {
    if (known) return;
    let live = true;
    // Asked once the remote rests here, so walking down the board is not a
    // request per press; `fetchRoster` caches what it has fetched.
    const timer = setTimeout(() => {
      fetchRoster(sessionId)
        .then((picks) => live && setRosters((r) => ({ ...r, [sessionId]: picks })))
        .catch(() => live && setRosters((r) => ({ ...r, [sessionId]: 'failed' })));
    }, ROSTER_SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sessionId, known]);
  return known ?? null;
}

const SLOT_ORDER = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1', 'DEF'];
const positionOf = (slot: string) => slot.replace(/\d+$/, '') as keyof typeof positionColor;

function EntryPanel({
  row,
  rank,
  rows,
  top,
  floor,
  isMe,
  entry,
}: {
  row: LeaderboardRow;
  rank: number;
  rows: readonly LeaderboardRow[];
  top: number;
  floor: number;
  isMe: boolean;
  entry: TVInitialFocus;
}) {
  const router = useRouter();
  const roster = useRoster(row.gameSessionId);
  const accent = accentFor(row);
  const above = rows[rank - 2];
  const below = rows[rank];
  const perfect = row.endingKey === 'PERFECT';
  const picks = Array.isArray(roster) ? [...roster].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot)) : [];
  const percentile = Math.max(1, Math.round((rank / rows.length) * 100));
  return (
    <TVPanel tint={perfect ? color.gold : accent}>
      <View style={styles.entryHead}>
        <Text style={[styles.bigRank, rank <= 3 ? { color: MEDALS()[rank - 1] } : null]}>#{rank}</Text>
        <Avatar handle={row.handle} size={56} />
        <View style={styles.rowMain}>
          <View style={styles.handleRow}>
            <Text style={styles.bigHandle} numberOfLines={1}>
              {row.handle}
            </Text>
            {isMe ? <Text style={styles.you}>YOU</Text> : null}
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>
            {new Date(row.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            {row.respun ? ` · ${RESPIN_MARK} used a respin` : ''}
            {perfect ? ' · PERFECT' : ''}
          </Text>
        </View>
        <ReportButton userId={row.userId} handle={row.handle} />
      </View>

      <View style={styles.figures}>
        <TVFigure value={row.finalRating.toFixed(1)} label="Rating" tint={accent} size="lg" />
        <TVFigure value={`${row.wins}-${row.losses}`} label="Record" size="lg" />
        <TVFigure value={row.tier} label="Tier" tint={accent} size="lg" />
      </View>

      <View style={styles.standing}>
        <TVMeter fraction={(row.finalRating - floor) / Math.max(top - floor, 1)} tint={accent} />
        <View style={styles.standingLines}>
          <Text style={styles.standingText}>
            {above ? `${(above.finalRating - row.finalRating).toFixed(1)} behind #${rank - 1}` : 'Top of the board'}
          </Text>
          <Text style={styles.standingText}>{rank === rows.length && rows.length > 1 ? `#${rank} of ${rows.length}` : `Top ${percentile}%`}</Text>
          <Text style={styles.standingText}>
            {below ? `${(row.finalRating - below.finalRating).toFixed(1)} clear of #${rank + 1}` : 'Last on the board'}
          </Text>
        </View>
      </View>

      <TVLabel style={styles.sevenHead}>The seven behind it</TVLabel>
      <View style={styles.seven}>
        {SLOT_ORDER.map((slot, i) => {
          const pick = picks.find((p) => p.slot === slot);
          const card = pick ? lookupCard(pick.cardId) : undefined;
          const tint = positionColor[positionOf(slot)] ?? color.textDim;
          return (
            <Pressable
              // Keyed by slot: the same seven controls, re-labelled per row.
              key={slot}
              {...(i === 0 ? entry : null)}
              onPress={pick ? () => router.push(`/card/${encodeURIComponent(pick.cardId)}`) : undefined}
              accessibilityRole="button"
              accessibilityLabel={
                card ? `${slot}. ${displayName(card)}, ${card.year}. Rating ${card.rating.toFixed(1)}. Select for the card.` : `${slot}. ${roster === null ? 'Loading' : 'Not available'}.`
              }
              style={({ focused }: PressState) => [styles.pick, focused && styles.pickFocused]}
            >
              <Text style={[styles.pickSlot, { color: tint }]}>{slot}</Text>
              <Text style={styles.pickName} numberOfLines={1}>
                {card ? displayName(card) : roster === null ? '·  ·  ·' : roster === 'failed' ? 'Could not load' : pick ? 'Not in this version' : '—'}
              </Text>
              <Text style={styles.pickTeam} numberOfLines={1}>
                {card ? `${abbr(card.franchiseId)} '${String(card.year).slice(2)}` : ''}
              </Text>
              <Text style={styles.pickRating}>{card ? card.rating.toFixed(1) : ''}</Text>
            </Pressable>
          );
        })}
      </View>
      <TVHint>Select a player for the card · Menu to go back to the board</TVHint>
    </TVPanel>
  );
}

const abbr = (id: string) => {
  try {
    return franchise(id).abbr;
  } catch {
    return id.toUpperCase();
  }
};

function PointsPanel({
  row,
  rank,
  scores,
  isMe,
}: {
  row: PointsRow;
  rank: number;
  scores: readonly PointsRow[];
  isMe: boolean;
}) {
  const above = scores[rank - 2];
  const below = scores[rank];
  const leader = scores[0];
  const tint = rank <= 3 ? MEDALS()[rank - 1]! : color.action;
  return (
    <TVPanel tint={tint}>
      <View style={styles.entryHead}>
        <Text style={[styles.bigRank, rank <= 3 ? { color: tint } : null]}>#{rank}</Text>
        <Avatar handle={row.handle} size={56} />
        <View style={styles.rowMain}>
          <View style={styles.handleRow}>
            <Text style={styles.bigHandle} numberOfLines={1}>
              {row.handle}
            </Text>
            {isMe ? <Text style={styles.you}>YOU</Text> : null}
          </View>
          <Text style={styles.rowSub}>Every season finished, added up</Text>
        </View>
        <ReportButton userId={row.userId} handle={row.handle} />
      </View>
      <View style={styles.figures}>
        <TVFigure value={pts.format(row.points)} label="Points" tint={tint} size="lg" />
        <TVFigure value={String(row.seasons)} label="Seasons" size="lg" />
        <TVFigure value={row.seasons ? pts.format(Math.round(row.points / row.seasons)) : '—'} label="Per season" size="lg" />
      </View>
      <TVLine label="Best rating" value={row.bestRating !== null ? row.bestRating.toFixed(1) : '—'} />
      <TVLine label="Seasons with a respin" value={row.respunSeasons ? `${row.respunSeasons} ${RESPIN_MARK}` : 'None'} />
      <TVLine label="Gap to the place above" value={above ? `${pts.format(above.points - row.points)} behind #${rank - 1}` : 'Top of the board'} />
      <TVLine label="Lead over the place below" value={below ? `${pts.format(row.points - below.points)} clear of #${rank + 1}` : 'Last on the board'} />
      {leader ? (
        <View style={styles.standing}>
          <TVLabel>Share of the leader's total</TVLabel>
          <TVMeter fraction={row.points / Math.max(1, leader.points)} tint={tint} />
        </View>
      ) : null}
      <View style={styles.grow} />
      <TVHint>Menu to go back to the board</TVHint>
    </TVPanel>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    fill: { flex: 1 },
    grow: { flex: 1 },
    switchRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md },
    loading: { paddingVertical: space.xxxl, alignItems: 'center' },
    notice: { gap: space.md, paddingTop: space.md },
    noticeBox: { gap: 4, paddingTop: space.md, paddingHorizontal: space.xs },
    noticeTitle: { fontFamily: font.heading, fontSize: 20, color: color.text },
    noticeCopy: { fontFamily: font.body, fontSize: 13, lineHeight: 19, color: color.textDim },
    retry: { alignSelf: 'flex-start', paddingHorizontal: space.xl, height: 44, justifyContent: 'center', borderRadius: radius.md, backgroundColor: color.action },
    retryLabel: { fontFamily: font.display, fontSize: 18, color: color.onAction },
    gate: { paddingTop: space.md, paddingBottom: space.xxl },

    youRow: { borderColor: color.lineGold, backgroundColor: teamWash(color.gold, 0.08) },
    youRank: { fontFamily: font.displayBlack, fontSize: 26, color: color.goldBright, minWidth: 52, ...tabular },
    youTitle: { fontFamily: font.heading, fontSize: 18, color: color.goldBright },
    youArrow: { fontFamily: font.display, fontSize: 22, color: color.goldBright },

    mineRow: { borderColor: color.actionBright },
    rank: { fontFamily: font.display, fontSize: 20, color: color.textFaint, width: 28, ...tabular },
    rowMain: { flex: 1, minWidth: 0 },
    rowSub: { fontFamily: font.body, fontSize: 11, color: color.textDim },
    handleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    handle: { fontFamily: font.heading, fontSize: 17, color: color.text, flexShrink: 1 },
    respun: { fontFamily: font.label, fontSize: 13, color: color.textDim },
    you: { fontFamily: font.label, fontSize: 10, letterSpacing: tracking.wide, color: color.actionBright, borderWidth: 1, borderColor: color.actionBright, borderRadius: radius.pill, paddingHorizontal: 6 },
    bar: { height: 3, borderRadius: 2, backgroundColor: color.line, marginTop: 5 },
    barFill: { height: 3, borderRadius: 2 },
    right: { alignItems: 'flex-end' },
    rating: { fontFamily: font.display, fontSize: 22, ...tabular },
    recordSmall: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.normal, color: color.textDim, ...tabular },
    points: { fontFamily: font.display, fontSize: 22, color: color.text, ...tabular },

    panelTitle: { fontFamily: font.display, fontSize: 28, lineHeight: 30, color: color.text, marginBottom: space.md },
    figures: { flexDirection: 'row', gap: space.xxl, marginVertical: space.md, flexWrap: 'wrap' },
    ridge: { gap: space.sm, marginTop: space.sm },
    podium: { flexDirection: 'row', gap: space.xl, alignItems: 'flex-end', marginTop: space.md },
    podiumStep: { alignItems: 'center', gap: 4, width: 150 },
    podiumPlace: { fontFamily: font.displayBlack, fontSize: 28 },
    podiumName: { fontFamily: font.heading, fontSize: 16, color: color.text, maxWidth: 150 },
    podiumPoints: { fontFamily: font.display, fontSize: 20, color: color.silver, ...tabular },

    entryHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    bigRank: { fontFamily: font.displayBlack, fontSize: 48, lineHeight: 50, color: color.text, ...tabular },
    bigHandle: { fontFamily: font.display, fontSize: 28, color: color.text, flexShrink: 1 },
    standing: { gap: space.sm, marginTop: space.xs },
    standingLines: { flexDirection: 'row', justifyContent: 'space-between' },
    standingText: { fontFamily: font.label, fontSize: 13, letterSpacing: tracking.normal, color: color.silver, ...tabular },
    sevenHead: { marginTop: space.md, marginBottom: space.xs },
    seven: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    pick: {
      width: '48.8%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      height: 36,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.scrim,
    },
    pickFocused: { backgroundColor: color.surfaceHigh },
    pickSlot: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide, width: 34 },
    pickName: { flex: 1, fontFamily: font.heading, fontSize: 15, color: color.text },
    pickTeam: { fontFamily: font.label, fontSize: 11, color: color.textDim },
    pickRating: { fontFamily: font.display, fontSize: 16, color: color.text, width: 36, textAlign: 'right', ...tabular },
  }),
);
