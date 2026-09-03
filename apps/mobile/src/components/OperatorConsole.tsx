import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Panel } from './Panel';
import { Avatar } from './Avatar';
import {
  deletePlayer,
  fetchEvents,
  fetchOverview,
  fetchPlayerSeasons,
  fetchPlayers,
  restoreSeason,
  setHandleStatus,
  voidSeason,
  type OperatorEvent,
  type OperatorPlayer,
  type OperatorSeason,
  type Overview,
} from '@/services/operator';
import { color, font, radius, space, tabular, tracking, type PressState } from '@/theme';

/**
 * What is happening on the server, and what to do about it.
 *
 * Everything here is read through definer-rights functions that check the
 * operator list first, so this component has no authority of its own -- it is
 * a viewport, and the server decides what it can see.
 *
 * Destructive actions ask twice. Not a modal: the button becomes the
 * confirmation and says exactly what it is about to do, so there is no dialog
 * to dismiss reflexively and no way to fire one by mistiming a tap.
 */
export function OperatorConsole() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [players, setPlayers] = useState<OperatorPlayer[]>([]);
  const [events, setEvents] = useState<OperatorEvent[]>([]);
  const [search, setSearch] = useState('');
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, p, e] = await Promise.all([
        fetchOverview(),
        fetchPlayers(search),
        fetchEvents(onlyFailures),
      ]);
      setOverview(o);
      setPlayers(p);
      setEvents(e);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not reach the server.');
    }
    setLoading(false);
  }, [search, onlyFailures]);

  useEffect(() => {
    void load();
  }, [load]);

  // A console nobody refreshes is a console that lies. Thirty seconds is often
  // enough to watch a game being played and cheap enough to leave running.
  useEffect(() => {
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading && !overview) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={color.red} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.headRow}>
        <Text style={styles.sectionTitle}>Live</Text>
        <Pressable
          onPress={() => void load()}
          accessibilityRole="button"
          accessibilityLabel="Refresh the console"
          style={({ hovered }: PressState) => [styles.chip, hovered && styles.chipOn]}
        >
          <Text style={styles.chipText}>REFRESH</Text>
        </Pressable>
      </View>
      <Text style={styles.sectionCopy}>
        Server-side, and it refreshes itself every thirty seconds.
        {overview?.lastEventAt ? ` Last event ${ago(overview.lastEventAt)}.` : ''}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {overview ? (
        <View style={styles.tiles}>
          <Tile label="Players" value={overview.players} sub={`${overview.namedPlayers} signed in`} />
          <Tile
            label="Playing now"
            value={overview.inProgress}
            tint={overview.inProgress > 0 ? color.redBright : undefined}
          />
          <Tile label="Seasons today" value={overview.completionsToday} sub={`${overview.completionsTotal} all time`} />
          <Tile label="Games opened today" value={overview.sessionsToday} />
          <Tile
            label="Refused / hour"
            value={overview.refusalsHour}
            sub={`of ${overview.eventsHour} events`}
            tint={overview.refusalsHour > 0 ? color.gold : undefined}
          />
          <Tile
            label="p95 latency"
            value={overview.p95LatencyMs ?? 0}
            unit="ms"
            tint={(overview.p95LatencyMs ?? 0) > 1500 ? color.negative : undefined}
          />
          <Tile label="Challenges" value={overview.challengesOpen} sub={`${overview.challengesSettled} settled`} />
          <Tile
            label="Voided"
            value={overview.voided}
            sub={`${overview.hiddenHandles} handles hidden`}
            tint={overview.voided > 0 ? color.gold : undefined}
          />
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>Players</Text>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search handles"
        placeholderTextColor={color.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
        accessibilityLabel="Search players by handle"
      />
      <View style={styles.list}>
        {players.map((player) => (
          <PlayerRow
            key={player.userId}
            player={player}
            open={openPlayer === player.userId}
            onToggle={() => setOpenPlayer(openPlayer === player.userId ? null : player.userId)}
            onChanged={load}
          />
        ))}
        {players.length === 0 ? <Text style={styles.empty}>Nobody matches that.</Text> : null}
      </View>

      <View style={styles.headRow}>
        <Text style={styles.sectionTitle}>Trail</Text>
        <Pressable
          onPress={() => setOnlyFailures((was) => !was)}
          accessibilityRole="switch"
          accessibilityState={{ checked: onlyFailures }}
          accessibilityLabel="Show only refusals"
          style={({ hovered }: PressState) => [
            styles.chip,
            (onlyFailures || hovered) && styles.chipOn,
          ]}
        >
          <Text style={[styles.chipText, onlyFailures && styles.chipTextOn]}>REFUSALS ONLY</Text>
        </Pressable>
      </View>
      <View style={styles.trail}>
        {events.map((event, i) => (
          <View key={`${event.requestId}-${i}`} style={styles.event}>
            <Text style={styles.eventTime}>{clock(event.occurredAt)}</Text>
            <View style={styles.eventBody}>
              <Text style={styles.eventName}>
                <Text style={event.outcome === 'ok' ? styles.ok : styles.bad}>
                  {event.outcome === 'ok' ? '· ' : '! '}
                </Text>
                {event.event}
                {event.actorHandle ? <Text style={styles.eventWho}> {event.actorHandle}</Text> : null}
              </Text>
              {Object.keys(event.detail).length > 0 ? (
                <Text style={styles.eventDetail} numberOfLines={2}>
                  {JSON.stringify(event.detail)}
                </Text>
              ) : null}
            </View>
            {event.latencyMs !== null ? (
              <Text style={styles.eventLatency}>{event.latencyMs}ms</Text>
            ) : null}
          </View>
        ))}
        {events.length === 0 ? <Text style={styles.empty}>Nothing on the trail.</Text> : null}
      </View>
    </View>
  );
}

function Tile({
  label,
  value,
  sub,
  unit,
  tint,
}: {
  label: string;
  value: number;
  sub?: string;
  unit?: string;
  tint?: string;
}) {
  return (
    <Panel tint={tint} style={styles.tile} contentStyle={styles.tileBody}>
      <Text style={[styles.tileValue, tint ? { color: tint } : null]}>
        {value.toLocaleString()}
        {unit ? <Text style={styles.tileUnit}>{unit}</Text> : null}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </Panel>
  );
}

function PlayerRow({
  player,
  open,
  onToggle,
  onChanged,
}: {
  player: OperatorPlayer;
  open: boolean;
  onToggle: () => void;
  onChanged: () => Promise<void>;
}) {
  const [seasons, setSeasons] = useState<OperatorSeason[]>([]);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!open) return setArmed(false);
    void fetchPlayerSeasons(player.userId).then(setSeasons).catch(() => setSeasons([]));
  }, [open, player.userId]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
      await onChanged();
      if (open) setSeasons(await fetchPlayerSeasons(player.userId).catch(() => []));
    } finally {
      setBusy(false);
    }
  };

  const hidden = player.handleStatus !== 'ok';

  return (
    <Panel tint={hidden ? color.gold : undefined} contentStyle={styles.player}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${player.handle ?? 'unnamed'}, ${player.completions} seasons`}
        style={styles.playerHead}
      >
        <Avatar handle={player.handle ?? 'player'} size={32} />
        <View style={styles.playerText}>
          <Text style={styles.playerHandle} numberOfLines={1}>
            {player.handle ?? 'unnamed'}
            {hidden ? <Text style={styles.flagged}> · {player.handleStatus}</Text> : null}
            {!player.isPermanent ? <Text style={styles.anon}> · device only</Text> : null}
          </Text>
          <Text style={styles.playerMeta}>
            {player.completions}/{player.sessions} finished
            {player.bestRating !== null ? ` · best ${player.bestRating.toFixed(1)}` : ''}
            {player.assisted > 0 ? ` · ${player.assisted} assisted` : ''}
            {player.voided > 0 ? ` · ${player.voided} voided` : ''}
            {player.lastSeen ? ` · ${ago(player.lastSeen)}` : ''}
          </Text>
        </View>
        <Text style={styles.disclosure}>{open ? '−' : '+'}</Text>
      </Pressable>

      {open ? (
        <View style={styles.playerOpen}>
          <View style={styles.actions}>
            <Action
              label={hidden ? 'Unhide handle' : 'Hide handle'}
              disabled={busy}
              onPress={() => void act(() => setHandleStatus(player.userId, hidden ? 'ok' : 'hidden'))}
            />
            {/* Two taps, and the second one names the thing it is about to do.
                A dialog here would be dismissed on reflex. */}
            <Action
              label={armed ? `Delete ${player.handle ?? 'this account'} for good` : 'Delete account'}
              danger
              disabled={busy}
              onPress={() => {
                if (!armed) return setArmed(true);
                void act(() => deletePlayer(player.userId, 'operator console'));
              }}
            />
          </View>

          {seasons.length > 0 ? (
            <View style={styles.seasons}>
              {seasons.map((season) => (
                <View key={season.id} style={styles.season}>
                  <Text style={styles.seasonMeta}>
                    {season.record} ·{' '}
                    {season.finalRating === null ? 'unfinished' : season.finalRating.toFixed(1)}
                    {season.mode ? ` · ${season.mode}` : ''}
                    {season.assisted ? ' · assisted' : ''}
                  </Text>
                  <Pressable
                    onPress={() =>
                      void act(() =>
                        season.voidedAt
                          ? restoreSeason(season.id)
                          : voidSeason(season.id, 'operator console'),
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={
                      season.voidedAt ? 'Restore this season' : 'Void this season'
                    }
                    style={({ hovered }: PressState) => [
                      styles.void,
                      season.voidedAt && styles.voidOn,
                      hovered && { opacity: 0.8 },
                    ]}
                  >
                    <Text style={[styles.voidText, season.voidedAt && styles.voidTextOn]}>
                      {season.voidedAt ? 'VOIDED' : 'VOID'}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>No seasons.</Text>
          )}
        </View>
      ) : null}
    </Panel>
  );
}

function Action({
  label,
  danger,
  disabled,
  onPress,
}: {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered }: PressState) => [
        styles.action,
        danger && styles.actionDanger,
        hovered && { opacity: 0.85 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={[styles.actionLabel, danger && styles.actionLabelDanger]}>{label}</Text>
    </Pressable>
  );
}

/** Relative time, to the coarsest unit that is still true. */
function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const styles = StyleSheet.create({
  root: { gap: space.sm },
  centre: { paddingVertical: space.xxl, alignItems: 'center' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  sectionTitle: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
    marginTop: space.md,
  },
  sectionCopy: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint },
  error: { fontFamily: font.bodyRegular, fontSize: 13, color: color.negative },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { flexGrow: 1, flexBasis: 150, minWidth: 0 },
  tileBody: { padding: space.md, gap: 1 },
  tileValue: {
    fontFamily: font.display,
    fontSize: 26,
    color: color.text,
    includeFontPadding: false,
    ...tabular,
  },
  tileUnit: { fontFamily: font.body, fontSize: 13, color: color.textFaint },
  tileLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    textTransform: 'uppercase',
    color: color.textDim,
  },
  tileSub: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },

  search: {
    height: 42,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: space.md,
    color: color.text,
    fontFamily: font.body,
    fontSize: 14,
    backgroundColor: '#0A0E1799',
  },
  list: { gap: space.sm },
  player: { padding: space.md, gap: space.sm },
  playerHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  playerText: { flex: 1, minWidth: 0 },
  playerHandle: { fontFamily: font.body, fontSize: 15, color: color.text },
  flagged: { fontFamily: font.label, fontSize: 11, color: color.gold },
  anon: { fontFamily: font.label, fontSize: 11, color: color.textFaint },
  playerMeta: { fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
  disclosure: { fontFamily: font.display, fontSize: 20, color: color.textFaint, width: 16, textAlign: 'center' },

  playerOpen: { gap: space.sm, borderTopWidth: 1, borderTopColor: color.line, paddingTop: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  action: {
    paddingVertical: 6,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FFFFFF08',
  },
  actionDanger: { borderColor: `${color.negative}66`, backgroundColor: `${color.negative}14` },
  actionLabel: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, color: color.textDim },
  actionLabelDanger: { color: color.negative },

  seasons: { gap: 4 },
  season: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  seasonMeta: { flex: 1, minWidth: 0, fontFamily: font.bodyRegular, fontSize: 12, color: color.textDim },
  void: {
    paddingVertical: 2,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
  },
  voidOn: { borderColor: `${color.gold}66`, backgroundColor: `${color.gold}14` },
  voidText: { fontFamily: font.label, fontSize: 9, letterSpacing: tracking.wide, color: color.textFaint },
  voidTextOn: { color: color.gold },

  trail: { gap: 2 },
  event: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingVertical: 3 },
  eventTime: { fontFamily: font.body, fontSize: 11, color: color.textFaint, width: 68, ...tabular },
  eventBody: { flex: 1, minWidth: 0 },
  eventName: { fontFamily: font.body, fontSize: 12, color: color.text },
  eventWho: { color: color.textDim },
  eventDetail: { fontFamily: font.bodyRegular, fontSize: 10, color: color.textFaint },
  eventLatency: { fontFamily: font.body, fontSize: 10, color: color.textFaint, ...tabular },
  ok: { color: color.positive },
  bad: { color: color.negative },

  empty: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint },

  chip: {
    paddingVertical: 3,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    marginTop: space.md,
  },
  chipOn: { borderColor: `${color.red}80`, backgroundColor: `${color.red}1F` },
  chipText: { fontFamily: font.label, fontSize: 9, letterSpacing: tracking.wide, color: color.textFaint },
  chipTextOn: { color: color.redBright },
});
