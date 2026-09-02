import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { color, font, space } from '@/theme';

/**
 * A landing pad for the OAuth redirect.
 *
 * `eighteenzero://auth-callback` is normally consumed by the browser session
 * that opened it: expo-web-browser resolves its promise with the URL and
 * services/auth.ts does the code exchange. But Expo Router listens for deep
 * links too, and both can fire for the same redirect. When the router wins the
 * race there is no such route, so the app lands on "Unmatched Route: page could
 * not be found" — at the end of a sign-in, which reads as a broken app rather
 * than as a routing detail.
 *
 * This exists so that never happens. It deliberately does no work: the sign-in
 * is already being handled by whoever opened the session, and doing the
 * exchange again here would race with it and burn a single-use code.
 */
export default function AuthCallback() {
  const router = useRouter();

  useEffect(() => {
    const settle = setTimeout(() => router.replace('/(tabs)/leaderboard'), 400);
    return () => clearTimeout(settle);
  }, [router]);

  return (
    <View style={styles.screen}>
      <ActivityIndicator color={color.gold} />
      <Text style={styles.copy}>Finishing sign-in…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    backgroundColor: color.void,
  },
  copy: { fontFamily: font.bodyRegular, fontSize: 14, color: color.textDim },
});
