import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  SairaCondensed_600SemiBold,
  SairaCondensed_700Bold,
  SairaCondensed_800ExtraBold,
  SairaCondensed_900Black,
} from '@expo-google-fonts/saira-condensed';
import { Barlow_400Regular, Barlow_500Medium, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { color, font } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [ready, error] = useFonts({
    SairaCondensed_600SemiBold,
    SairaCondensed_700Bold,
    SairaCondensed_800ExtraBold,
    SairaCondensed_900Black,
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_700Bold,
  });

  useEffect(() => {
    if (ready || error) SplashScreen.hideAsync().catch(() => {});
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
