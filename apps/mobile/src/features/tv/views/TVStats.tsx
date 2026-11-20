import { memo, useMemo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { eraLabel, franchise } from '@17-0/data';
import { Pressable } from '@/components/Pressable';
import { ModeRing, RatingTrend, WinsChart } from '@/components/charts';
import { MODE_LABEL, type GameMode } from '@/state/game';
import type { HistoryEntry, ProfileStats } from '@/state/history';
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
  TVTitle,
  useFocusTrack,
  useMasterDetail,
  useTracked,
  type FocusTrack,
} from './kit';

/**
 * My Stats on a TV: every section of the phone's page, and every season you
 * have played, as one list the remote walks -- with the section or the season
 * it is on drawn large in the panel beside it.
 *
 * The phone's page was Views and Text with not one focus target on it, so on
 * a TV the remote could not get into it at all, and a scroll view with nothing
 * focusable in it does not scroll: the charts and the chase below the fold
 * were unreachable. Here each section is a row, each season is a row, and
 * Select on a season goes into its roster (each player opens their card, as
 * on the phone's Games tab); Menu comes back to the row.
 */

type SectionKey = 'overview' | 'form' | 'records' | 'modes' | 'chase' | 'blind' | 'tendencies';

type Item =
  | { kind: 'section'; key: SectionKey; title: string; sub: string; value: string; tint?: string }
  | { kind: 'season'; game: HistoryEntry; n: number };

export interface TVStatsProps {
  games: readonly HistoryEntry[];
  stats: ProfileStats;
  ratings: readonly number[];
  wins: readonly number[];
  modes: readonly { key: GameMode; count: number }[];
}

const accentOf = (game: HistoryEntry) =>
  game.result.ending.key === 'PERFECT' ? color.gold : tierColor[game.result.ending.tier] ?? color.text;

const cityOf = (id: string) => {
  try {
    return franchise(id).name;
  } catch {
    return id.toUpperCase();
  }
};
const abbrOf = (id: string) => {
  try {
    return franchise(id).abbr;
  } catch {
    return id.toUpperCase();
  }
};

const fmt = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? '—' : n.toFixed(digits));
const dateOf = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function TVStats({ games, stats, ratings, wins, modes }: TVStatsProps) {
  const track = useFocusTrack(0);
  const md = useMasterDetail(track);

  const closest = useMemo(() => {
    let best: HistoryEntry | null = null;
    for (const g of games) {
      if (g.assisted || g.result.ending.key === 'PERFECT') continue;
      if (!best || g.result.distanceFromPerfection < best.result.distanceFromPerfection) best = g;
    }
    return best;
  }, [games]);

  const items = useMemo<Item[]>(() => {
    const topMode = [...modes].sort((a, b) => b.count - a.count)[0];
    const sections: Item[] = [
      {
        kind: 'section',
        key: 'overview',
        title: 'Overview',
        sub: `${stats.played} ${stats.played === 1 ? 'season' : 'seasons'} · best ${fmt(stats.bestRating)}`,
        value: stats.bestRecord ? `${stats.bestRecord.wins}-${stats.bestRecord.losses}` : '—',
        tint: stats.perfectSeasons > 0 ? color.gold : undefined,
      },
      { kind: 'section', key: 'form', title: 'Form', sub: `The last ${ratings.length} ratings, in order`, value: fmt(ratings.length ? ratings.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, ratings.length) : null) },
      { kind: 'section', key: 'records', title: 'Records', sub: 'Every season by its wins', value: String(wins.length) },
      {
        kind: 'section',
        key: 'modes',
        title: 'How you play',
        sub: topMode && topMode.count > 0 ? `Mostly ${MODE_LABEL[topMode.key]}` : 'Across the modes',
        value: String(modes.filter((m) => m.count > 0).length),
      },
      {
        kind: 'section',
        key: 'chase',
        title: 'The chase',
        sub: '17-0 seasons, and the ones that got away',
        value: `${stats.perfectSeasons}`,
        tint: stats.perfectSeasons > 0 ? color.gold : undefined,
      },
      { kind: 'section', key: 'blind', title: 'GM Mode', sub: 'Built with nothing on screen', value: String(stats.playerIqGames) },
      {
        kind: 'section',
        key: 'tendencies',
        title: 'Tendencies',
        sub: stats.topFranchise ? `Most often ${cityOf(stats.topFranchise)}` : 'Who you reach for',
        value: stats.bestCard ? fmt(stats.bestCard.rating) : '—',
      },
    ];
    return [...sections, ...games.map((game, n): Item => ({ kind: 'season', game, n }))];
  }, [games, stats, ratings, wins, modes]);

  const firstSeason = items.findIndex((i) => i.kind === 'season');

  const master = (
    <>
      <TVTitle kicker="Your record" title="My Stats" sub={`${stats.played} played · ${stats.perfectSeasons} perfect · ${stats.heartbreaks} at 16-1`} />
      <TVList
        items={items}
        onRowFocus={md.onRowFocus}
        renderRow={(item, index) =>
          item.kind === 'section' ? (
            <SectionRow key={item.key} item={item} index={index} claim={md.claimRow === index} onPress={item.key === 'tendencies' && stats.bestCard ? md.enter : undefined} />
          ) : (
            <SeasonRowSeat key={item.game.id + item.game.completedAt} first={index === firstSeason} total={games.length}>
              <SeasonRow game={item.game} n={item.n} index={index} claim={md.claimRow === index} onPress={md.enter} />
            </SeasonRowSeat>
          )
        }
      />
    </>
  );

  return (
    <TVSplit
      master={master}
      detail={
        <Detail
          track={track}
          items={items}
          stats={stats}
          ratings={ratings}
          wins={wins}
          modes={modes}
          closest={closest}
          entering={md.entering}
        />
      }
      onDetailEnter={md.onDetailEnter}
      onDetailLeave={md.onDetailLeave}
    />
  );
}

/** The "Season log" heading, ahead of the first season only. */
function SeasonRowSeat({ first, total, children }: { first: boolean; total: number; children: ReactNode }) {
  if (!first) return <>{children}</>;
  return (
    <>
      <TVLabel style={styles.listHead}>Season log · {total}</TVLabel>
      {children}
    </>
  );
}

const SectionRow = memo(function SectionRow({
  item,
  index,
  claim,
  onPress,
}: {
  item: Extract<Item, { kind: 'section' }>;
  index: number;
  claim: boolean;
  onPress?: () => void;
}) {
  return (
    <TVRow index={index} claim={claim} onPress={onPress} label={`${item.title}. ${item.sub}. ${item.value}`} accent={item.tint ?? color.action}>
      {(focused) => (
        <>
          <Text style={[styles.sectionNo, focused && { color: color.text }]}>{String(index + 1).padStart(2, '0')}</Text>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {item.sub}
            </Text>
          </View>
          <Text style={[styles.rowValue, item.tint ? { color: item.tint } : null]} numberOfLines={1}>
            {item.value}
          </Text>
        </>
      )}
    </TVRow>
  );
});

const SeasonRow = memo(function SeasonRow({
  game,
  n,
  index,
  claim,
  onPress,
}: {
  game: HistoryEntry;
  n: number;
  index: number;
  claim: boolean;
  onPress: () => void;
}) {
  const { result } = game;
  const accent = accentOf(game);
  const mode = game.mode ? MODE_LABEL[game.mode] : 'Rookie';
  return (
    <TVRow
      index={index}
      claim={claim}
      onPress={onPress}
      accent={accent}
      label={`Season ${n + 1}. ${result.record.wins} and ${result.record.losses}, ${result.ending.label}, tier ${result.ending.tier}, rating ${result.finalRating.toFixed(1)}, ${mode}${game.assisted ? ', assisted' : ''}${game.respun ? ', used a respin' : ''}`}
    >
      {() => (
        <>
          <Text style={[styles.seasonRecord, { color: accent }]}>
            {result.record.wins}-{result.record.losses}
          </Text>
          <View style={styles.rowMain}>
            <Text style={[styles.seasonEnding, { color: accent }]} numberOfLines={1}>
              {result.ending.label.toUpperCase()}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {dateOf(game.completedAt)} · {mode}
              {game.assisted ? ' · Assisted' : ''}
              {game.respun ? ' · ↻' : ''}
            </Text>
          </View>
          <View style={styles.seasonRight}>
            <Text style={styles.seasonRating}>{result.finalRating.toFixed(1)}</Text>
            <Text style={styles.seasonTier}>TIER {result.ending.tier}</Text>
          </View>
        </>
      )}
    </TVRow>
  );
});

/**
 * The panel. The only thing that subscribes to the focused row, so a move
 * re-renders this and the two rows that lit and unlit -- never the list.
 */
function Detail({
  track,
  items,
  stats,
  ratings,
  wins,
  modes,
  closest,
  entering,
}: {
  track: FocusTrack;
  items: readonly Item[];
  stats: ProfileStats;
  ratings: readonly number[];
  wins: readonly number[];
  modes: readonly { key: GameMode; count: number }[];
  closest: HistoryEntry | null;
  entering: boolean;
}) {
  const index = useTracked(track);
  const item = items[Math.max(0, index)] ?? items[0]!;
  const section = item.kind === 'section' ? item.key : null;
  const season = item.kind === 'season' ? item.game : null;
  const entry = useTVInitialFocus(entering);
  return (
    <View style={styles.fill}>
      <TVLayer shown={section === 'overview'}>
        <OverviewPanel stats={stats} closest={closest} />
      </TVLayer>
      <TVLayer shown={section === 'form'}>
        <FormPanel ratings={ratings} />
      </TVLayer>
      <TVLayer shown={section === 'records'}>
        <RecordsPanel wins={wins} stats={stats} />
      </TVLayer>
      <TVLayer shown={section === 'modes'}>
        <ModesPanel modes={modes} />
      </TVLayer>
      <TVLayer shown={section === 'chase'}>
        <ChasePanel stats={stats} closest={closest} />
      </TVLayer>
      <TVLayer shown={section === 'blind'}>
        <BlindPanel stats={stats} games={ratings.length} />
      </TVLayer>
      <TVLayer shown={section === 'tendencies'}>
        <TendenciesPanel stats={stats} entry={section === 'tendencies' ? entry : null} />
      </TVLayer>
      <TVLayer shown={season !== null}>{season ? <SeasonPanel game={season} entry={entry} /> : null}</TVLayer>
    </View>
  );
}

const PanelHead = ({ kicker, title, tint }: { kicker: string; title: string; tint?: string }) => (
  <View style={styles.panelHead}>
    <TVLabel style={tint ? { color: tint } : undefined}>{kicker}</TVLabel>
    <Text style={styles.panelTitle} numberOfLines={1}>
      {title}
    </Text>
  </View>
);

const OverviewPanel = memo(function OverviewPanel({ stats, closest }: { stats: ProfileStats; closest: HistoryEntry | null }) {
  const perfect = stats.perfectSeasons > 0;
  return (
    <TVPanel tint={perfect ? color.gold : color.action}>
      <PanelHead kicker="Overview" title="Everything you have built" />
      <View style={styles.tiles}>
        <Tile value={String(stats.played)} label="Seasons played" />
        <Tile value={fmt(stats.bestRating)} label="Best rating" tint={color.goldBright} />
        <Tile value={stats.bestRecord ? `${stats.bestRecord.wins}-${stats.bestRecord.losses}` : '—'} label="Best record" />
        <Tile value={fmt(stats.averageRating)} label="Average rating" />
        <Tile value={String(stats.perfectSeasons)} label="17-0 seasons" tint={perfect ? color.goldBright : undefined} />
        <Tile value={String(stats.heartbreaks)} label="16-1 seasons" />
        <Tile value={String(stats.playerIqGames)} label="Built blind" />
        <Tile value={fmt(stats.bestPlayerIqRating)} label="Best blind rating" />
      </View>
      {closest ? (
        <View style={styles.callout}>
          <TVLabel>Closest to perfect</TVLabel>
          <Text style={styles.calloutText}>
            {closest.result.record.wins}-{closest.result.record.losses} on {dateOf(closest.completedAt)},{' '}
            {closest.result.distanceFromPerfection.toFixed(1)} short of the 17-0 line.
          </Text>
        </View>
      ) : null}
      <View style={styles.grow} />
      <TVHint>Down for the form, the records and every season you have played</TVHint>
    </TVPanel>
  );
});

function Tile({ value, label, tint }: { value: string; label: string; tint?: string }) {
  return (
    <View style={styles.tile}>
      <TVFigure value={value} label={label} tint={tint} />
    </View>
  );
}

const FormPanel = memo(function FormPanel({ ratings }: { ratings: readonly number[] }) {
  const best = ratings.length ? Math.max(...ratings) : null;
  const worst = ratings.length ? Math.min(...ratings) : null;
  const recent = ratings.slice(-5);
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  const first = ratings.slice(0, 5);
  const before = first.length ? first.reduce((a, b) => a + b, 0) / first.length : null;
  const delta = avg !== null && before !== null && ratings.length >= 10 ? avg - before : null;
  return (
    <TVPanel>
      <PanelHead kicker="Form" title={`Your last ${ratings.length} ratings`} />
      <View style={styles.figures}>
        <TVFigure value={fmt(avg)} label="5-season average" />
        <TVFigure value={fmt(best)} label="Best in the run" tint={color.goldBright} />
        <TVFigure value={fmt(worst)} label="Lowest" />
        {delta !== null ? (
          <TVFigure value={`${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`} label="Since the start" tint={delta >= 0 ? color.positive : color.negative} />
        ) : null}
      </View>
      <View style={styles.chart}>
        <Text style={styles.chartKey}>
          <Text style={{ color: color.action }}>━ rating</Text>
          {'    '}
          <Text style={{ color: color.ice }}>┅ 5-season average</Text>
          {'    '}
          <Text style={{ color: color.gold }}>● best</Text>
        </Text>
        <RatingTrend ratings={ratings} height={300} />
      </View>
    </TVPanel>
  );
});

const RecordsPanel = memo(function RecordsPanel({ wins, stats }: { wins: readonly number[]; stats: ProfileStats }) {
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const w of wins) m.set(w, (m.get(w) ?? 0) + 1);
    return m;
  }, [wins]);
  const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const winning = wins.filter((w) => w >= 9).length;
  return (
    <TVPanel>
      <PanelHead kicker="Records" title="Every season, by its wins" />
      <View style={styles.figures}>
        <TVFigure value={stats.bestRecord ? `${stats.bestRecord.wins}-${stats.bestRecord.losses}` : '—'} label="Best record" tint={color.goldBright} />
        <TVFigure value={common ? `${common[0]}-${17 - common[0]}` : '—'} label="Most common" />
        <TVFigure value={wins.length ? `${Math.round((winning / wins.length) * 100)}%` : '—'} label="Winning seasons" />
        <TVFigure value={String(counts.get(16) ?? 0)} label="16-1" />
      </View>
      <View style={styles.chart}>
        <WinsChart wins={wins} height={280} />
      </View>
    </TVPanel>
  );
});

const MODE_TINTS = (): Record<GameMode, string> => ({ rookie: color.action, scout: color.silver, player_iq: color.ice, gameday: color.gold });

const ModesPanel = memo(function ModesPanel({ modes }: { modes: readonly { key: GameMode; count: number }[] }) {
  const total = modes.reduce((t, m) => t + m.count, 0);
  const tints = MODE_TINTS();
  return (
    <TVPanel>
      <PanelHead kicker="How you play" title="Which lens you pick up" />
      <View style={styles.modes}>
        <ModeRing parts={modes} labels={MODE_LABEL} tints={tints} size={180} />
      </View>
      <View style={styles.modeBars}>
        {modes.map((m) => (
          <View key={m.key} style={styles.modeBar}>
            <Text style={styles.modeName}>{MODE_LABEL[m.key]}</Text>
            <View style={styles.grow}>
              <TVMeter fraction={total ? m.count / total : 0} tint={tints[m.key]} />
            </View>
            <Text style={styles.modeCount}>{m.count}</Text>
          </View>
        ))}
      </View>
      <TVHint>Only GM Mode and Scout reach a board. Rookie teaches the model.</TVHint>
    </TVPanel>
  );
});

const ChasePanel = memo(function ChasePanel({ stats, closest }: { stats: ProfileStats; closest: HistoryEntry | null }) {
  const earned = stats.perfectSeasons > 0;
  return (
    <TVPanel tint={earned ? color.gold : color.ice}>
      <PanelHead kicker="The chase" title={earned ? 'Perfection, earned' : 'Perfection, still out there'} tint={earned ? color.gold : undefined} />
      <View style={styles.figures}>
        <TVFigure value={String(stats.perfectSeasons)} label="17-0 seasons" tint={earned ? color.goldBright : undefined} size="lg" />
        <TVFigure value={String(stats.heartbreaks)} label="16-1 seasons" size="lg" />
      </View>
      {closest ? (
        <View style={styles.callout}>
          <TVLabel>Closest without it</TVLabel>
          <Text style={styles.calloutText}>
            {closest.result.record.wins}-{closest.result.record.losses}, {closest.result.finalRating.toFixed(1)}:{' '}
            {closest.result.distanceFromPerfection.toFixed(1)} short.
            {closest.result.perfectEligibility.failedGates.length
              ? ` ${closest.result.perfectEligibility.failedGates[0]!.message}`
              : ''}
          </Text>
          <View style={styles.meterSeat}>
            <TVMeter fraction={1 - Math.min(1, closest.result.distanceFromPerfection / 20)} tint={color.gold} />
          </View>
        </View>
      ) : null}
      <View style={styles.grow} />
      <Text style={styles.note}>17-0 lands about once every 6,000 games. 16-1 about once every 49.</Text>
    </TVPanel>
  );
});

const BlindPanel = memo(function BlindPanel({ stats, games }: { stats: ProfileStats; games: number }) {
  return (
    <TVPanel tint={color.ice}>
      <PanelHead kicker="GM Mode" title="Built blind" />
      <View style={styles.figures}>
        <TVFigure value={String(stats.playerIqGames)} label="Blind seasons" size="lg" />
        <TVFigure value={fmt(stats.bestPlayerIqRating)} label="Best blind rating" tint={color.ice} size="lg" />
      </View>
      <Text style={styles.body}>
        No ratings and no stat lines on screen: a name, a team and a year. The GM Mode board ranks your best one.
      </Text>
      {stats.played > 0 ? (
        <View style={styles.meterSeat}>
          <TVLabel>Share of your seasons</TVLabel>
          <TVMeter fraction={stats.playerIqGames / Math.max(1, stats.played)} tint={color.ice} />
        </View>
      ) : null}
      <View style={styles.grow} />
      <TVHint>{games ? 'Rated seasons only: assisted seasons do not count here' : ' '}</TVHint>
    </TVPanel>
  );
});

const TendenciesPanel = memo(function TendenciesPanel({ stats, entry }: { stats: ProfileStats; entry: TVInitialFocus | null }) {
  const router = useRouter();
  const card = stats.bestCard;
  return (
    <TVPanel>
      <PanelHead kicker="Tendencies" title="Who you reach for" />
      <TVLine label="Most-used franchise" value={stats.topFranchise ? cityOf(stats.topFranchise) : '—'} />
      <TVLine label="Most-used era" value={stats.topEra ? eraLabel(stats.topEra as never) : '—'} />
      <TVLine label="Favourite lens" value={stats.topMode ? MODE_LABEL[stats.topMode as GameMode] ?? stats.topMode : '—'} />
      {card ? (
        <View style={styles.callout}>
          <TVLabel>Highest-rated pick</TVLabel>
          <Pressable
            {...(entry ?? {})}
            onPress={() => router.push(`/card/${encodeURIComponent(card.cardId)}`)}
            accessibilityRole="button"
            accessibilityLabel={`${card.name}, ${card.year} ${cityOf(card.franchiseId)}, rating ${card.rating.toFixed(1)}. Select for the card.`}
            style={styles.bestCard}
          >
            <Text style={[styles.pickSlot, { color: positionColor[slotPosition(card.slot)] }]}>{card.slot}</Text>
            <View style={styles.rowMain}>
              <Text style={styles.pickName} numberOfLines={1}>
                {card.name}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {card.year} {cityOf(card.franchiseId)}
              </Text>
            </View>
            <Text style={styles.pickRating}>{card.rating.toFixed(1)}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.grow} />
      <TVHint>Select for the card · Menu to go back</TVHint>
    </TVPanel>
  );
});

/** The order the phone's field reads a roster in, not the order it was picked. */
const SLOT_ORDER = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE1', 'DEF'];

const slotPosition = (slot: string) => (slot === 'DEF' ? 'DEF' : slot.replace(/\d/g, '')) as keyof typeof positionColor;

/**
 * One season, in full: the record and the rating, how the model built the
 * number, what kept it from 17-0, and the seven -- each of which opens.
 * Plain views only: this is the part of the panel that changes on every move.
 */
function SeasonPanel({ game, entry }: { game: HistoryEntry; entry: TVInitialFocus }) {
  const router = useRouter();
  const { result } = game;
  const b = result.breakdown;
  const accent = accentOf(game);
  const perfect = result.ending.key === 'PERFECT';
  const gates = result.perfectEligibility.failedGates;
  const chemistry = b.chemistryDetail.links.slice(0, 3);
  return (
    <TVPanel tint={accent}>
      <View style={styles.seasonHead}>
        <View>
          <Text style={[styles.bigRecord, { color: accent }]}>
            {result.record.wins}-{result.record.losses}
          </Text>
          <Text style={[styles.endingLabel, { color: accent }]} numberOfLines={1}>
            {result.ending.label.toUpperCase()}
          </Text>
        </View>
        <View style={styles.grow} />
        <View style={styles.ratingBlock}>
          <Text style={styles.bigRating}>{result.finalRating.toFixed(1)}</Text>
          <View style={[styles.tierChip, { borderColor: accent, backgroundColor: teamWash(accent, 0.16) }]}>
            <Text style={[styles.tierChipText, { color: accent }]}>TIER {result.ending.tier}</Text>
          </View>
        </View>
      </View>
      <Text style={styles.meta} numberOfLines={1}>
        {dateOf(game.completedAt)} · {game.mode ? MODE_LABEL[game.mode] : 'Rookie'}
        {game.assisted ? ' · Assisted' : ''}
        {game.respun ? ' · ↻ Respin' : ''}
      </Text>

      <View style={styles.seasonBody}>
        <View style={styles.breakdown}>
          <TVLabel>How it was rated</TVLabel>
          <TVLine label="Base" value={b.baseRating.toFixed(1)} />
          <TVLine label="Weak link" value={b.weakLinkPenalty ? `−${Math.abs(b.weakLinkPenalty).toFixed(1)}` : '0.0'} tint={b.weakLinkPenalty ? color.negative : undefined} />
          <TVLine label="Elite depth" value={`+${b.eliteBonus.toFixed(1)}`} tint={b.eliteBonus ? color.positive : undefined} />
          <TVLine label="Chemistry" value={`+${b.chemistryBonus.toFixed(1)}`} tint={b.chemistryBonus ? color.positive : undefined} />
          <TVLine label="Team rating" value={b.rawTeamRating.toFixed(1)} />
          {chemistry.length ? (
            <Text style={styles.small} numberOfLines={2}>
              {chemistry.map((l) => l.label).join(' · ')}
            </Text>
          ) : null}
          <View style={styles.gate}>
            <TVLabel style={{ color: perfect ? color.gold : color.textFaint }}>{perfect ? '17-0 cleared' : 'To 17-0'}</TVLabel>
            {perfect ? (
              <Text style={[styles.small, { color: color.goldBright }]}>Every gate cleared.</Text>
            ) : (
              <>
                <Text style={styles.small} numberOfLines={1}>
                  {result.distanceFromPerfection > 0 ? `${result.distanceFromPerfection.toFixed(1)} short of the line` : 'Over the line'}
                </Text>
                {gates.slice(0, 2).map((g) => (
                  <Text key={g.message} style={styles.small} numberOfLines={2}>
                    · {g.message}
                  </Text>
                ))}
              </>
            )}
          </View>
        </View>

        <View style={styles.roster}>
          <TVLabel>The seven</TVLabel>
          {[...game.roster].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot)).map((pick, i) => (
            <Pressable
              // Keyed by place, not by player: the same seven controls are
              // re-labelled as the remote moves, not torn down and made again.
              key={i}
              {...(i === 0 ? entry : null)}
              onPress={() => router.push(`/card/${encodeURIComponent(pick.cardId)}`)}
              accessibilityRole="button"
              accessibilityLabel={`${pick.slot}. ${pick.name}. ${pick.year} ${cityOf(pick.franchiseId)}. Rating ${pick.rating.toFixed(1)}. Select for the card.`}
              style={({ focused }: PressState) => [styles.pick, focused && styles.pickFocused]}
            >
              <Text style={[styles.pickSlot, { color: positionColor[slotPosition(pick.slot)] }]}>{pick.slot}</Text>
              <View style={styles.rowMain}>
                <Text style={styles.pickName} numberOfLines={1}>
                  {pick.name}
                </Text>
              </View>
              <Text style={styles.pickTeam}>
                {abbrOf(pick.franchiseId)} &apos;{String(pick.year).slice(2)}
              </Text>
              <Text style={styles.pickRating}>{pick.rating.toFixed(1)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <TVHint>Select a player for the card · Menu to go back to the list</TVHint>
    </TVPanel>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    fill: { flex: 1 },
    grow: { flex: 1 },
    listHead: { marginTop: space.md, marginBottom: 2, marginLeft: space.xs },

    sectionNo: { fontFamily: font.display, fontSize: 20, color: color.textFaint, width: 28, ...tabular },
    rowMain: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: font.heading, fontSize: 19, color: color.text },
    rowSub: { fontFamily: font.body, fontSize: 11, color: color.textDim },
    rowValue: { fontFamily: font.display, fontSize: 24, color: color.text, ...tabular },

    seasonRecord: { fontFamily: font.displayBlack, fontSize: 26, width: 62, ...tabular },
    seasonEnding: { fontFamily: font.label, fontSize: 13, letterSpacing: tracking.wide },
    seasonRight: { alignItems: 'flex-end' },
    seasonRating: { fontFamily: font.display, fontSize: 22, color: color.text, ...tabular },
    seasonTier: { fontFamily: font.label, fontSize: 10, letterSpacing: tracking.wide, color: color.textFaint },

    panelHead: { gap: 0, marginBottom: space.md },
    panelTitle: { fontFamily: font.display, fontSize: 28, lineHeight: 30, color: color.text },

    tiles: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
    tile: {
      width: '25%',
      paddingRight: space.md,
      paddingVertical: space.sm,
      borderTopWidth: 1,
      borderTopColor: color.line,
    },
    callout: {
      marginTop: space.lg,
      padding: space.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.scrim,
      gap: 6,
    },
    calloutText: { fontFamily: font.body, fontSize: 14, lineHeight: 20, color: color.text },

    figures: { flexDirection: 'row', gap: space.xxl, marginBottom: space.md, flexWrap: 'wrap' },
    chart: { gap: space.sm, marginTop: space.sm },
    chartKey: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide },

    modes: { alignItems: 'flex-start', marginBottom: space.lg },
    modeBars: { gap: space.sm },
    modeBar: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    modeName: { fontFamily: font.label, fontSize: 14, color: color.silver, width: 90 },
    modeCount: { fontFamily: font.display, fontSize: 18, color: color.text, width: 40, textAlign: 'right', ...tabular },

    meterSeat: { gap: space.sm, marginTop: space.md },
    note: { fontFamily: font.body, fontSize: 12, color: color.textFaint },
    body: { fontFamily: font.body, fontSize: 14, lineHeight: 21, color: color.silver, marginTop: space.sm, maxWidth: 520 },

    bestCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      paddingHorizontal: space.md,
      height: 52,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.lineBright,
      backgroundColor: color.surfaceRaised,
    },

    seasonHead: { flexDirection: 'row', alignItems: 'flex-end', gap: space.lg, paddingTop: space.sm },
    bigRecord: { fontFamily: font.displayBlack, fontSize: 64, lineHeight: 68, ...tabular },
    endingLabel: { fontFamily: font.label, fontSize: 15, letterSpacing: tracking.wider },
    ratingBlock: { alignItems: 'flex-end', gap: 4 },
    bigRating: { fontFamily: font.display, fontSize: 48, lineHeight: 48, color: color.text, ...tabular },
    tierChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
    tierChipText: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide },
    meta: { fontFamily: font.body, fontSize: 12, color: color.textDim, marginTop: space.xs },

    seasonBody: { flex: 1, flexDirection: 'row', gap: space.xl, marginTop: space.md },
    breakdown: { width: 220, gap: 0 },
    small: { fontFamily: font.body, fontSize: 11, lineHeight: 16, color: color.textDim, marginTop: 4 },
    gate: { marginTop: space.md, gap: 0 },

    roster: { flex: 1, minWidth: 0, gap: 5 },
    pick: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      height: 40,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.scrim,
    },
    pickFocused: { backgroundColor: color.surfaceHigh },
    pickSlot: { fontFamily: font.label, fontSize: 13, letterSpacing: tracking.wide, width: 40 },
    pickName: { fontFamily: font.heading, fontSize: 16, color: color.text },
    pickTeam: { fontFamily: font.label, fontSize: 12, color: color.textDim, width: 62, textAlign: 'right' },
    pickRating: { fontFamily: font.display, fontSize: 18, color: color.text, width: 44, textAlign: 'right', ...tabular },
  }),
);
