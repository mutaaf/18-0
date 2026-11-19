import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { startAds } from '@/features/ads';
import { startAnalytics } from '@/features/analytics';
import { startDiagnostics, useDiagnostics } from '@/features/diagnostics';
import { startFlags, useFlag } from '@/features/flags';
import { startRespinStore } from '@/features/respins';
import { FoldProvider } from '@/features/fold';
import { TVSafeArea, TVStage } from '@/features/tv/Stage';
import { useTVJankProbe } from '@/features/tv/jank';
import { useTVMenuKey } from '@/features/tv/menu-key';
import { isTV } from '@/features/tv/platform';
import { warmSounds } from '@/features/tv/sound';
import { startStatLines } from '@/features/stat-lines';
import { useThemeFlagGuard } from '@/features/theme-flag';
import { Rajdhani_600SemiBold, Rajdhani_700Bold } from '@expo-google-fonts/rajdhani';
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_700Bold,
} from '@expo-google-fonts/montserrat';
import { color, startTheme, themed } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Before the first render, not in an effect: an error thrown while the first
// screen draws should land in a handler rather than in nothing.
startDiagnostics();

// A render error anywhere below this layout replaces the app with a recovery
// screen rather than a blank one, and is reported. Routes with something at
// stake (play, result) export their own, so a bug there costs only that screen.
export { RouteError as ErrorBoundary } from '@/components/RouteError';

export default function RootLayout() {
  useThemeFlagGuard();
  // Apple TV: Menu goes back while there is a back, and home at the root.
  useTVMenuKey();
  useTVJankProbe();
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
  useDiagnostics(Boolean(ready || error));

  // Said to the console, not the player. On the web `useFonts` gives up after
  // a few seconds on a slow connection -- the faces usually still arrive and
  // swap in -- and this used to print "Running with system fonts." in 9-point
  // type across the top of every screen, pushing the whole app down by a line
  // for the rest of the session.
  useEffect(() => {
    if (error) console.warn('[fonts] fell back to system fonts:', error.message);
  }, [error]);

  // Installs a second sink on the telemetry that already exists. With no
  // PostHog key configured this does nothing at all and makes no network call,
  // which is the state the repository ships in.
  useEffect(() => {
    startAnalytics();
    // Flags resolve to their shipped fallbacks until this lands, and stay
    // there if it never does. Nothing waits for it.
    void startFlags();
    // Display text only, and only when this build is behind the published
    // table. Nothing waits for it. See `features/stat-lines`.
    void startStatLines();
    // The app renders in the shipped palette and repaints when this lands,
    // which is a frame or two on a warm start. A theme is not worth holding a
    // splash screen for.
    void startTheme();
    // Marquee, on the web build at 18-0.co only (features/ads-policy.ts). An
    // async cross-origin script; with no fill every call resolves at once.
    startAds();
    // Apple TV: the sound effects, loaded before the first spin needs one.
    warmSounds();
  }, []);

  // App Store transactions the server never confirmed are redeemed at launch
  // (docs/respins.md). iOS only; a no-op everywhere else.
  const respinsOn = useFlag('respins');
  useEffect(() => {
    void startRespinStore(respinsOn);
  }, [respinsOn]);

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
      {/* Pass-throughs except on a television, where the app is laid out on a
          1280 x 720 stage scaled to fill the screen, and the safe area is the
          overscan margin (theme/layout.ts, features/tv/Stage.tsx). */}
      <TVStage>
      <SafeAreaProvider>
        <TVSafeArea>
        {/* Inside the safe-area provider because a spread is computed from
            both: where the fold is, and what the system bars take. */}
        <FoldProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.void },
            animation: 'fade',
            // On a TV, a screen underneath another stops rendering until it
            // is back on top: the home behind the play screen was re-rendering
            // on every store change mid-spin, on the JS thread focus waits on.
            freezeOnBlur: isTV,
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="play" />
          <Stack.Screen name="result" options={{ animation: 'fade', gestureEnabled: false }} />
          {/* Pushed rather than presented on a TV: a native modal is another
              view controller, outside the stage that scales the app up. */}
          <Stack.Screen
            name="card/[id]"
            options={isTV ? { animation: 'fade' } : { presentation: 'modal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="admin" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="challenge" options={{ animation: 'slide_from_bottom' }} />
          {/* No swipe-back: the whole screen is a swipe deck, and a left-edge
              drag meant for a card would close it. */}
          <Stack.Screen name="rate" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
        </Stack>
        </FoldProvider>
        </TVSafeArea>
      </SafeAreaProvider>
      </TVStage>
    </GestureHandlerRootView>
  );
}

const styles = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: color.void },
  boot: { flex: 1, backgroundColor: color.void },
}));
