import { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { startAnalytics } from '@/features/analytics';
import { startFlags } from '@/features/flags';
import { Rajdhani_600SemiBold, Rajdhani_700Bold } from '@expo-google-fonts/rajdhani';
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_700Bold,
} from '@expo-google-fonts/montserrat';
import { color, font } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [ready, error] = useFonts({
    Rajdhani_600SemiBold,
    Rajdhani_700Bold,
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_700Bold,
  });

  useEffect(() => {
    if (ready || error) SplashScreen.hideAsync().catch(() => {});
  }, [ready, error]);

  // Installs a second sink on the telemetry that already exists. With no
  // PostHog key configured this does nothing at all and makes no network call,
  // which is the state the repository ships in.
  useEffect(() => {
    startAnalytics();
    // Flags resolve to their shipped fallbacks until this lands, and stay
    // there if it never does. Nothing waits for it.
    void startFlags();
  }, []);

  // A challenge arrives as `?c=<token>` on the site's own address rather than
  // as a path of its own. The site is a static export on GitHub Pages, which
  // serves exactly the files that were exported: a link to /challenge/<token>
  // would 404 before any of this ran. A query parameter on the index always
  // loads, and the route it wants is pushed from here once the app is up.
  useEffect(() => {
    if (!ready && !error) return;
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const token = new URLSearchParams(window.location.search).get('c');
    if (!token) return;
    // Cleared first, so a reload or a back-navigation does not re-open it.
    window.history.replaceState(null, '', window.location.pathname);
    router.push({ pathname: '/challenge', params: { t: token } });
  }, [ready, error]);

  if (!ready && !error) {
    return <View style={styles.boot} />;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {error ? (
          <View style={styles.fontWarning}>
            <Text style={styles.fontWarningText}>Running with system fonts.</Text>
          </View>
        ) : null}
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.void },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="play" />
          <Stack.Screen name="result" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="card/[id]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="admin" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="challenge" options={{ animation: 'slide_from_bottom' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  boot: { flex: 1, backgroundColor: color.void },
  fontWarning: { backgroundColor: '#00000000', paddingHorizontal: 12, paddingTop: 2 },
  fontWarningText: { fontFamily: font.bodyRegular, fontSize: 9, color: color.textFaint },
});
