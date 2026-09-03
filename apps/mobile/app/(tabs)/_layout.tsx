import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AccountButton } from '@/components/AccountButton';
import { DOCK_HEIGHT } from '@/components/Dock';
import { InstallBar } from '@/components/InstallBar';
import { NavBar } from '@/components/NavBar';
import { color, useLayout } from '@/theme';

export default function TabsLayout() {
  const layout = useLayout();
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
            paddingBottom: layout.wide ? DOCK_HEIGHT : 0,
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
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: color.void } });
