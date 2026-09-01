import { Tabs } from 'expo-router';
import { NavBar, RAIL_WIDTH } from '@/components/NavBar';
import { color, useLayout } from '@/theme';

export default function TabsLayout() {
  const layout = useLayout();
  return (
    <Tabs
      tabBar={(props) => <NavBar state={props.state} navigation={props.navigation as never} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: {
          backgroundColor: color.void,
          paddingLeft: layout.wide ? RAIL_WIDTH : 0,
        },
      }}
    >
      <Tabs.Screen name="games" options={{ title: 'Games' }} />
      <Tabs.Screen name="index" options={{ title: 'Play' }} />
      <Tabs.Screen name="stats" options={{ title: 'My Stats' }} />
    </Tabs>
  );
}
