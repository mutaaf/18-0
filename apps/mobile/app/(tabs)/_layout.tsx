import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AccountButton } from '@/components/AccountButton';
import { DOCK_HEIGHT } from '@/components/Dock';
import { InstallBar } from '@/components/InstallBar';
import { NavBar } from '@/components/NavBar';
import { WhatsNew } from '@/components/WhatsNew';
import { useNavRail } from '@/features/fold';
import { color, themed, useLayout, useThemeId } from '@/theme';

export default function TabsLayout() {
  // Subscribes this screen to the palette. React Navigation memoizes the
  // element it was handed, so a theme change reaches the component that
  // *creates* this screen's children or it reaches nothing -- which showed up
  // as a repainted picker sitting inside a screen still wearing the old
  // colours. `theme.test.ts` asserts every route does this.
  useThemeId();
  const layout = useLayout();
  const rail = useNavRail();
  return (
    <View style={styles.root}>
      <Tabs
        tabBar={(props) => <NavBar state={props.state} navigation={props.navigation as never} />}
        screenOptions={{
          headerShown: false,
          // The dock floats over the content rather than taking a column away
          // from it, so a tab screen stops short of where it sits. Screens
          // outside the tabs have no dock and reserve nothing.
          sceneStyle: {
            backgroundColor: color.void,
            // With the rail up nothing floats at the bottom, and the screens
            // stop short of the rail instead -- by nothing on a Duo, whose
            // safe area already holds that column.
            paddingBottom: rail ? 0 : layout.wide ? DOCK_HEIGHT : 0,
            paddingRight: rail ? rail.reserve : 0,
          },
        }}
      >
        <Tabs.Screen name="games" options={{ title: 'Games' }} />
        <Tabs.Screen name="leaderboard" options={{ title: 'Leaderboards' }} />
        <Tabs.Screen name="index" options={{ title: 'Play' }} />
        <Tabs.Screen name="challenges" options={{ title: 'Challenges' }} />
        <Tabs.Screen name="stats" options={{ title: 'My Stats' }} />
        {/* Reachable, but not a tab: the account rides in the corner instead. */}
        <Tabs.Screen name="account" options={{ title: 'Account', href: null }} />
      </Tabs>
      <AccountButton />
      {/* Under the content and above the navigation, on every tab screen. An
          install prompt that covers the game is an obstruction; one that sits
          out of the way and disappears for good when dismissed is an offer. */}
      <InstallBar />
      {/* Here rather than in the root layout: a tab is somewhere a player is
          between games, so the sheet never lands on a spin, a result being
          built, or the /embed frame inside another site's page. */}
      <WhatsNew />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({ root: { flex: 1, backgroundColor: color.void } }));
