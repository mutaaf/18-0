import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { DATASET } from '@18-0/data';
import { Dock } from './Dock';
import type { DockIconName } from './DockIcons';
import { color, font, radius, space, tracking, useLayout } from '@/theme';

const ICONS: Record<string, string> = {
  games: 'M9 5.5h8.5a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5H9a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 9 5.5z M4.5 8v9.5A2.5 2.5 0 0 0 7 20',
  leaderboard: 'M8 21h8 M12 17v4 M7 4h10v5a5 5 0 0 1-10 0z M7 5H4v2a3 3 0 0 0 3 3 M17 5h3v2a3 3 0 0 1-3 3',
  index: 'M4 6h16v12H4z M12 6v12 M4 10h3 M17 10h3 M4 14h3 M17 14h3',
  challenges: 'M12 3.4l7 2.5v5.6c0 4.6-3.5 7.1-7 8.6-3.5-1.5-7-4-7-8.6V5.9z M13 7.6L9.8 13H12l-.7 4 3.4-5.4h-2.2z',
  stats: 'M4 20V10 M10 20V4 M16 20v-7 M22 20h-20',
  account: 'M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5 M4.5 20.5a7.5 7.5 0 0 1 15 0',
};

const LABELS: Record<string, string> = {
  games: 'Games',
  leaderboard: 'Ranks',
  index: 'Play',
  challenges: 'Versus',
  stats: 'Stats',
  account: 'You',
};

/** The full name, for screen readers and the desktop rail. */
const FULL_LABELS: Record<string, string> = {
  games: 'Games',
  leaderboard: 'Leaderboards',
  index: 'Play',
  challenges: 'Challenges',
  stats: 'My Stats',
  account: 'Account',
};

function Glyph({ name, active, tint, size = 20 }: { name: string; active: boolean; tint?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={ICONS[name] ?? ''}
        stroke={tint ?? (active ? color.redBright : color.textFaint)}
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
 * A phone gets the expected bottom bar. Anything wide enough — a desktop
 * window, a tablet, a phone turned sideways — gets a dock: navigation that
 * floats over the content instead of taking a column away from it.
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

  // The account is reachable from the disc in the corner, not from the shelf.
  // `href: null` keeps it out of the router's links but not out of the state a
  // custom tab bar is handed, so it comes out here.
  const routes = state.routes
    .map((route, index) => ({ route, index }))
    .filter(({ route }) => route.name !== 'account');

  const go = (index: number) => {
    const route = state.routes[index]!;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!event.defaultPrevented) navigation.navigate(route.name);
  };

  if (layout.wide) {
    return (
      <Dock
        activeIndex={routes.findIndex(({ index }) => index === state.index)}
        onSelect={(position) => go(routes[position]!.index)}
        items={routes.map(({ route }) => ({
          key: route.key,
          label: FULL_LABELS[route.name] ?? route.name,
          short: LABELS[route.name] ?? route.name,
          icon: route.name as DockIconName,
        }))}
      />
    );
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
      {routes.map(({ route, index }) => {
        const active = state.index === index;
        const isPlay = route.name === 'index';
        return (
          <Pressable
            key={route.key}
            onPress={() => go(index)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={FULL_LABELS[route.name] ?? route.name}
            style={styles.barItem}
          >
            {isPlay ? (
              <View style={[styles.playDisc, active && styles.playDiscActive]}>
                <Glyph name={route.name} active tint="#FFFFFF" size={24} />
              </View>
            ) : (
              <Glyph name={route.name} active={active} />
            )}
            <Text
              style={[
                styles.barLabel,
                active && { color: color.redBright },
                isPlay && styles.playLabel,
              ]}
            >
              {LABELS[route.name] ?? route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // --- phone bar
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
    backgroundColor: '#080B0FF2',
    // Room for the raised Play disc to break the top edge without clipping.
    paddingTop: space.lg,
    overflow: 'visible',
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
  /**
   * Play sits above the bar rather than in it. Four of these five tabs are
   * places to review what you already did; only one of them is the game.
   */
  playDisc: {
    width: 54,
    height: 54,
    borderRadius: 27,
    marginTop: -26,
    marginBottom: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.red,
    borderWidth: 3,
    borderColor: '#080B0F',
    shadowColor: color.red,
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  playDiscActive: { backgroundColor: color.redBright },
  playLabel: { color: color.redBright, fontFamily: font.bodyBold },
});
