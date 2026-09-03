import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { AccountButton } from '@/components/AccountButton';
import { NavBar } from '@/components/NavBar';
import { color } from '@/theme';

export default function TabsLayout() {
  return (
    <View style={styles.root}>
      <Tabs
        tabBar={(props) => <NavBar state={props.state} navigation={props.navigation as never} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: color.void },
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
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: color.void } });
