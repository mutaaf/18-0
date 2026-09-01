import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { DATASET } from '@18-0/data';
import { Brand } from './Brand';
import { color, font, radius, space, tracking, useLayout, type PressState } from '@/theme';

const ICONS: Record<string, string> = {
  games: 'M12 3a9 9 0 1 0 9 9 M12 7v5l3.5 2 M12 3l-3 2.4 3 2.4',
  leaderboard: 'M8 21h8 M12 17v4 M7 4h10v5a5 5 0 0 1-10 0z M7 5H4v2a3 3 0 0 0 3 3 M17 5h3v2a3 3 0 0 1-3 3',
  index: 'M4 6h16v12H4z M12 6v12 M4 10h3 M17 10h3 M4 14h3 M17 14h3',
  challenges: 'M4 4l7 7 M20 4l-7 7 M9 15l-5 5 M15 15l5 5 M11 11l2 2',
  stats: 'M4 20V10 M10 20V4 M16 20v-7 M22 20h-20',
};

const LABELS: Record<string, string> = {
  games: 'Games',
  leaderboard: 'Ranks',
  index: 'Play',
  challenges: 'Versus',
  stats: 'Stats',
};

/** The full name, for screen readers and the desktop rail. */
const FULL_LABELS: Record<string, string> = {
  games: 'Games',
  leaderboard: 'Leaderboards',
  index: 'Play',
  challenges: 'Challenges',
  stats: 'My Stats',
};

function Glyph({ name, active }: { name: string; active: boolean }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d={ICONS[name] ?? ''}
        stroke={active ? color.redBright : color.textFaint}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * One navigation component, two compositions.
 *
 * A phone gets the expected bottom bar. A desktop window gets a persistent
 * left rail with the wordmark and a footer — an app chrome, not a stretched
 * phone control.
 */
/**
 * The slice of the tab-bar props this component actually uses. Typed locally
 * so it does not depend on a transitive navigator package.
 */
export interface NavBarProps {
  state: {
    index: number;
    routes: readonly { key: string; name: string }[];
  };
  navigation: {
    emit: (event: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

export function NavBar({ state, navigation }: NavBarProps) {
  const layout = useLayout();
  const insets = useSafeAreaInsets();

  const go = (index: number) => {
    const route = state.routes[index]!;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!event.defaultPrevented) navigation.navigate(route.name);
  };

  if (layout.wide) {
    return (
      <View style={[styles.rail, { paddingTop: insets.top + space.xl }]}>
        <View style={styles.railBrand}>
          <Brand size={26} subtitle="Est. 2026" />
        </View>
        <View style={styles.railItems}>
          {state.routes.map((route, index) => {
            const active = state.index === index;
            return (
              <Pressable
                key={route.key}
                onPress={() => go(index)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={FULL_LABELS[route.name] ?? route.name}
                style={({ hovered }: PressState) => [
                  styles.railItem,
                  hovered && styles.railItemHover,
                  active && styles.railItemActive,
                ]}
              >
                <View style={[styles.railMarker, active && styles.railMarkerActive]} />
                <Glyph name={route.name} active={active} />
                <Text style={[styles.railLabel, active && { color: color.text }]}>
                  {FULL_LABELS[route.name] ?? route.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.railFooter}>
          <Text style={styles.railFooterLabel}>Bundled history</Text>
          <Text style={styles.railFooterValue}>
            {DATASET.coverage.firstSeason}–{DATASET.coverage.lastSeason}
          </Text>
          <Text style={styles.railFooterValue}>{DATASET.cards.length.toLocaleString()} rated seasons</Text>
          <Text style={styles.railFooterNote}>Plays fully offline</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
      {state.routes.map((route, index) => {
        const active = state.index === index;
        return (
          <Pressable
            key={route.key}
            onPress={() => go(index)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={FULL_LABELS[route.name] ?? route.name}
            style={styles.barItem}
          >
            <Glyph name={route.name} active={active} />
            <Text style={[styles.barLabel, active && { color: color.redBright }]}>
              {LABELS[route.name] ?? route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const RAIL_WIDTH = 208;

const styles = StyleSheet.create({
  // --- desktop rail
  rail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: RAIL_WIDTH,
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: color.line,
    backgroundColor: '#070A0EE6',
    justifyContent: 'space-between',
  },
  railBrand: { paddingLeft: space.sm },
  railItems: { gap: 2 },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingVertical: 11,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
  },
  railItemHover: { backgroundColor: '#FFFFFF08' },
  railItemActive: { backgroundColor: '#FFFFFF0A' },
  railMarker: { position: 'absolute', left: 0, top: 12, bottom: 12, width: 2, borderRadius: 1 },
  railMarkerActive: { backgroundColor: color.red },
  railLabel: { fontFamily: font.label, fontSize: 13, letterSpacing: tracking.wide, color: color.textFaint },
  railFooter: { gap: 1, paddingLeft: space.sm },
  railFooterLabel: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  railFooterValue: { fontFamily: font.body, fontSize: 11, color: color.textDim },
  railFooterNote: { fontFamily: font.bodyRegular, fontSize: 10, color: color.textFaint, marginTop: 4 },

  // --- phone bar
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    backgroundColor: '#080B0FF2',
    paddingTop: space.md,
  },
  barItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minHeight: 48,
    paddingHorizontal: 2,
  },
  barLabel: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    color: color.textFaint,
    textTransform: 'uppercase',
  },
});
