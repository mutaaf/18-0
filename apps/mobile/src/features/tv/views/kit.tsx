import { createContext, memo, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, TVFocusGuideView, View, type ViewStyle } from 'react-native';
import { Pressable } from '@/components/Pressable';
import { DECORATIVE, color, font, radius, space, tabular, teamWash, themed, tracking, type PressState } from '@/theme';
import { useTVInitialFocus } from '../initial-focus';
import { isTV } from '../platform';
import { useTVRows } from '../rows';

/*
 * The parts the TV's list-and-detail screens share (My Stats, Challenges,
 * Leaderboards): a master list on the left that the remote walks, and a detail
 * panel on the right that shows whatever the remote is on.
 *
 * Why they look the way they do (docs/apple-tv.md, "Navigation" and
 * "Real hardware"):
 *
 * - **Every page is a focus guide with `autoFocus`**, never one with
 *   `destinations`. A guide aimed at our Pressable (an animated component on a
 *   TV) has nowhere to send focus and takes it itself: the dead block that
 *   made the tab bar unusable in builds 27 and 28.
 * - **The detail follows the remote without re-rendering the list.** Which
 *   row is focused lives in a `FocusTrack` outside React state; the rows are
 *   memoised and never read it, and only the panel subscribes. A focus move is
 *   one row's lift and one panel's render, not fifty rows.
 * - **The list mounts what the remote can reach** (`useTVRows`): a history of
 *   five hundred seasons is twelve rows until the remote walks towards the end.
 * - **Native gradients, no shadows, no Svg under focus.** Charts that are Svg
 *   draw once and are shown and hidden by opacity, never remounted by a move.
 */

/** Which row the remote is on: -1 when it is not in the list. */
export interface FocusTrack {
  get(): number;
  set(index: number): void;
  subscribe(listener: () => void): () => void;
}

function createTrack(initial: number): FocusTrack {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(index) {
      if (index === value) return;
      value = index;
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A track that lives as long as the screen. */
export function useFocusTrack(initial = -1): FocusTrack {
  const [track] = useState(() => createTrack(initial));
  return track;
}

/** The focused index, for the one component that draws from it. */
export function useTracked(track: FocusTrack): number {
  return useSyncExternalStore(track.subscribe, track.get, track.get);
}

/**
 * Menu, while the remote is in a detail panel: back to the list, not out of
 * the tab. The tab's own Menu handler (`menu-key.ts`) is older, and
 * BackHandler asks the newest listener first.
 */
export function useTVBack(active: boolean, onBack: () => void): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!isTV || !active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      latest.current();
      return true;
    });
    return () => sub.remove();
  }, [active]);
}

/**
 * Select on a row goes into its detail, and Menu comes back to the same row.
 *
 * `enter` hands focus to the panel's first control (spread `entry` over it);
 * Menu, or the remote leaving the panel, hands it back to the row it came
 * from (pass `claimRow` to the rows). Both are `useTVInitialFocus` claims,
 * which retry until UIKit accepts them.
 */
export function useMasterDetail(track: FocusTrack) {
  const [inDetail, setInDetail] = useState(false);
  const [entering, setEntering] = useState(false);
  const [returnTo, setReturnTo] = useState(-1);
  const returning = useRef(false);

  const enter = useCallback(() => setEntering(true), []);
  const onDetailEnter = useCallback(() => {
    setInDetail(true);
    setEntering(false);
  }, []);
  const onDetailLeave = useCallback(() => setInDetail(false), []);
  const back = useCallback(() => {
    returning.current = true;
    setReturnTo(track.get());
  }, [track]);
  /** Hand focus to another row of the list (your own place on a board). */
  const jumpTo = useCallback((index: number) => {
    returning.current = true;
    setReturnTo(index);
  }, []);
  useTVBack(inDetail, back);

  /** Called by a row as it takes focus: the claim back to it has landed. */
  const onRowFocus = useCallback((index: number) => {
    track.set(index);
    if (returning.current) {
      returning.current = false;
      setReturnTo(-1);
    }
  }, [track]);

  return { inDetail, entering, enter, jumpTo, onDetailEnter, onDetailLeave, claimRow: returnTo, onRowFocus };
}

/**
 * A list-and-detail page: the master column (title, switchers, list) on the
 * left, the detail panel on the right. Each side is its own `autoFocus` guide
 * (as `FocusPane` is), so left and right cross between them from any row and
 * come back to where they left.
 */
export function TVSplit({
  master,
  detail,
  onDetailEnter,
  onDetailLeave,
}: {
  master: ReactNode;
  detail: ReactNode;
  onDetailEnter?: () => void;
  onDetailLeave?: () => void;
}) {
  return (
    <View style={styles.split}>
      <TVFocusGuideView autoFocus style={styles.master}>
        {master}
      </TVFocusGuideView>
      <TVFocusGuideView autoFocus style={styles.detail} onFocusEnter={onDetailEnter} onFocusLeave={onDetailLeave}>
        {detail}
      </TVFocusGuideView>
    </View>
  );
}

/** The page's name, the way the broadcast package letters a segment. */
export function TVTitle({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <View style={styles.title}>
      <View style={styles.kickerRow}>
        <View style={styles.kickerDot} />
        <Text style={styles.kicker} numberOfLines={1}>
          {kicker}
        </Text>
      </View>
      <Text style={styles.titleText} numberOfLines={1}>
        {title}
      </Text>
      {sub ? (
        <Text style={styles.sub} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

export interface SwitchItem<K extends string> {
  key: K;
  label: string;
  /** A count or a short note after the label. */
  note?: string;
}

/**
 * A row of choices, left and right along it. Select chooses: a choice here
 * reloads a board, and choosing on focus would fetch one per press as the
 * remote crossed the row. The row is a guide, so down from the tab bar or up
 * from the list lands on it whatever is level.
 */
export function TVSwitcher<K extends string>({
  items,
  value,
  onChange,
  onFocus,
  label,
}: {
  items: readonly SwitchItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** The remote arrived on the row: the panel shows the overview. */
  onFocus?: () => void;
  /** Read before each chip's own label ("Board", "Period"). */
  label: string;
}) {
  return (
    <TVFocusGuideView autoFocus style={styles.switcher}>
      {items.map((item) => (
        <Chip
          key={item.key}
          item={item}
          on={item.key === value}
          onPress={onChange}
          onFocus={onFocus}
          label={label}
        />
      ))}
    </TVFocusGuideView>
  );
}

const Chip = memo(function Chip<K extends string>({
  item,
  on,
  onPress,
  onFocus,
  label,
}: {
  item: SwitchItem<K>;
  on: boolean;
  onPress: (key: K) => void;
  onFocus?: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={() => onPress(item.key)}
      onFocus={onFocus}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label}: ${item.label}${item.note ? `, ${item.note}` : ''}${on ? ', showing' : ''}`}
      style={({ focused }: PressState) => [styles.chip, on && styles.chipOn, focused && styles.chipFocused]}
    >
      {({ focused }: PressState) => (
        <>
          <Text style={[styles.chipLabel, on && styles.chipLabelOn, focused && styles.chipLabelFocused]} numberOfLines={1}>
            {item.label}
          </Text>
          {item.note ? (
            <Text style={[styles.chipNote, on && styles.chipLabelOn, focused && styles.chipLabelFocused]} numberOfLines={1}>
              {item.note}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}) as <K extends string>(props: {
  item: SwitchItem<K>;
  on: boolean;
  onPress: (key: K) => void;
  onFocus?: () => void;
  label: string;
}) => ReactNode;

/**
 * The master list: a scroll the focus engine moves as the remote walks it,
 * mounting rows as it goes (`useTVRows`). `renderRow` must return a memoised
 * row, keyed, that calls `onRowFocus(index)` as it takes focus.
 */
export function TVList<T>({
  items,
  renderRow,
  onRowFocus,
  header,
  footer,
  reach = 0,
}: {
  items: readonly T[];
  /** A row that must be mounted however far down it is: one focus is about to be handed to. */
  reach?: number;
  renderRow: (item: T, index: number) => ReactNode;
  onRowFocus: (index: number) => void;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  const rows = useTVRows(items, Math.max(0, reach));
  const grow = rows.onRowFocus;
  // One callback for every row, so a memoised row never re-renders for it.
  const latest = useRef(onRowFocus);
  latest.current = onRowFocus;
  const focusRow = useCallback((index: number) => {
    latest.current(index);
    grow(index);
  }, [grow]);
  return (
    <ScrollView style={styles.listScroll} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
      <RowFocus.Provider value={focusRow}>
        {header}
        {items.slice(0, rows.count).map(renderRow)}
        {footer}
      </RowFocus.Provider>
    </ScrollView>
  );
}

const RowFocus = createContext<(index: number) => void>(() => {});

/**
 * One row of a master list: a single focus target, lit the tvOS way, that
 * tells the list it has the remote and can be handed focus back (`claim`).
 */
export const TVRow = memo(function TVRow({
  index,
  claim,
  onPress,
  label,
  accent,
  children,
  style,
}: {
  index: number;
  /** Take focus: the remote is coming back here from the detail panel. */
  claim: boolean;
  onPress?: () => void;
  label: string;
  /** The stripe down the row's leading edge. */
  accent?: string;
  children: (focused: boolean) => ReactNode;
  style?: ViewStyle;
}) {
  const focusRow = useContext(RowFocus);
  const back = useTVInitialFocus(claim);
  const backFocus = back.onFocus;
  const onFocus = useCallback(() => {
    backFocus();
    focusRow(index);
  }, [backFocus, focusRow, index]);
  return (
    <Pressable
      hasTVPreferredFocus={back.hasTVPreferredFocus}
      onFocus={onFocus}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Focus last, over a row's own tint (your place, the pitch).
      style={({ focused }: PressState) => [styles.row, style, focused && styles.rowFocused]}
    >
      {({ focused }: PressState) => (
        <>
          {accent ? <View style={[styles.rowStripe, { backgroundColor: accent }]} {...DECORATIVE} /> : null}
          {children(Boolean(focused))}
        </>
      )}
    </Pressable>
  );
});

/** A small capitals heading inside a list or a panel. */
export function TVLabel({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

/**
 * The detail panel's ground: the glass of a broadcast graphic, lit from the
 * top by `tint`. A native gradient layer, so changing the tint as the remote
 * moves is a property change and not a raster.
 */
export function TVPanel({ tint, children, style }: { tint?: string; children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={[styles.panel, { experimental_backgroundImage: panelWash(tint ?? color.action) }, style]}>
      <View style={[styles.panelRule, { backgroundColor: tint ?? color.action }]} {...DECORATIVE} />
      {children}
    </View>
  );
}

const panelWash = (tint: string) =>
  `radial-gradient(ellipse 90% 60% at 0% 0%, ${teamWash(tint, 0.2)} 0%, ${teamWash(tint, 0)} 100%), ` +
  `linear-gradient(170deg, ${color.panelTop} 0%, ${teamWash(color.surface, 0.94)} 55%, ${teamWash(color.void, 0.9)} 100%)`;

/**
 * One layer of a panel that holds several, shown by opacity. A chart is Svg,
 * which rasterises on the CPU on the thread focus runs on; shown and hidden,
 * it is drawn once, not once per press that lands near it.
 */
export function TVLayer({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <View
      style={[StyleSheet.absoluteFill, { opacity: shown ? 1 : 0 }]}
      pointerEvents={shown ? 'auto' : 'none'}
      accessibilityElementsHidden={!shown}
      importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
    >
      {children}
    </View>
  );
}

/** A big number with its name under it: the scoreboard's unit. */
export function TVFigure({
  value,
  label,
  tint,
  size = 'md',
}: {
  value: string;
  label: string;
  tint?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <View style={styles.figure}>
      <Text
        style={[styles.figureValue, size === 'lg' && styles.figureValueLg, size === 'sm' && styles.figureValueSm, tint ? { color: tint } : null]}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text style={styles.figureLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A label and its value across a hairline: a line of a stat sheet. */
export function TVLine({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.lineValue, tint ? { color: tint } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * A horizontal meter: where a value sits between two ends. Two plain views,
 * the fill scaled by width once per render -- nothing animates.
 */
export function TVMeter({ fraction, tint, marker }: { fraction: number; tint: string; marker?: number }) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <View style={styles.meter} {...DECORATIVE}>
      <View style={[styles.meterFill, { width: `${f * 100}%`, backgroundColor: tint }]} />
      {marker !== undefined ? (
        <View style={[styles.meterMark, { left: `${Math.max(0, Math.min(1, marker)) * 100}%` }]} />
      ) : null}
    </View>
  );
}

/** The foot of a panel: what the remote's buttons do here. */
export function TVHint({ children }: { children: ReactNode }) {
  return (
    <Text style={styles.hint} numberOfLines={1}>
      {children}
    </Text>
  );
}

/** Width of the master column, in stage points. */
export const MASTER_WIDTH = 452;

const styles = themed(() =>
  StyleSheet.create({
    split: { flex: 1, flexDirection: 'row', gap: space.xl, paddingTop: space.sm },
    master: { width: MASTER_WIDTH },
    detail: { flex: 1, minWidth: 0, paddingBottom: space.lg },

    title: { gap: 2, marginBottom: space.md, paddingLeft: space.xs },
    kickerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    kickerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.action },
    kicker: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wider, textTransform: 'uppercase', color: color.silver },
    titleText: { fontFamily: font.displayBlack, fontSize: 36, lineHeight: 38, color: color.text, letterSpacing: tracking.tight },
    sub: { fontFamily: font.body, fontSize: 12, color: color.textDim },

    switcher: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm, paddingHorizontal: space.xs, paddingVertical: space.xs },
    chip: {
      paddingHorizontal: space.md - 2,
      height: 36,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.scrim,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    chipOn: { borderColor: color.action, backgroundColor: teamWash(color.action, 0.22) },
    chipFocused: { backgroundColor: color.text, borderColor: color.text },
    chipLabel: { fontFamily: font.label, fontSize: 14, letterSpacing: tracking.normal, color: color.textDim },
    chipLabelOn: { color: color.text },
    chipLabelFocused: { color: color.void },
    chipNote: { fontFamily: font.label, fontSize: 12, color: color.textFaint, ...tabular },

    listScroll: { flex: 1, marginHorizontal: -space.md },
    list: { paddingHorizontal: space.md + space.xs, paddingTop: space.sm, paddingBottom: space.xxxl, gap: space.sm },

    row: {
      minHeight: 58,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: teamWash(color.surface, 0.72),
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: space.lg,
      paddingRight: space.md,
      gap: space.md,
    },
    rowFocused: { backgroundColor: color.surfaceHigh, borderColor: color.lineBright },
    rowStripe: { position: 'absolute', left: 6, top: 12, bottom: 12, width: 3, borderRadius: 2 },

    label: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wider, textTransform: 'uppercase', color: color.textFaint },

    panel: {
      flex: 1,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: color.lineBright,
      paddingHorizontal: space.xl,
      paddingVertical: space.lg,
    },
    // Stops short of the rounded corners rather than being clipped by them:
    // no mask pass (docs/apple-tv.md, "The third pass").
    panelRule: { position: 'absolute', top: -1, left: space.xl, right: space.xl, height: 3, borderRadius: 2 },

    figure: { gap: 0, minWidth: 0 },
    figureValue: { fontFamily: font.display, fontSize: 34, lineHeight: 36, color: color.text, ...tabular },
    figureValueLg: { fontSize: 64, lineHeight: 64 },
    figureValueSm: { fontSize: 24, lineHeight: 26 },
    figureLabel: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, textTransform: 'uppercase', color: color.textDim },

    line: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: space.lg,
      paddingVertical: 7,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: color.line,
    },
    lineLabel: { fontFamily: font.body, fontSize: 13, color: color.textDim, flexShrink: 0 },
    lineValue: { fontFamily: font.heading, fontSize: 16, color: color.text, flexShrink: 1, textAlign: 'right', ...tabular },

    meter: { height: 6, borderRadius: 3, backgroundColor: color.line },
    meterFill: { height: 6, borderRadius: 3 },
    meterMark: { position: 'absolute', top: -4, width: 2, height: 14, marginLeft: -1, backgroundColor: color.text },

    hint: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide, color: color.textFaint, marginTop: space.sm },
  }),
);
