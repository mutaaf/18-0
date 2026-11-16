import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, type ErrorBoundaryProps } from 'expo-router';
import { currentRoute } from '@/features/diagnostics/context';
import { reportError } from '@/features/diagnostics';
import { color, font, radius, space, themed, tracking } from '@/theme';

/**
 * What a route shows when it throws while rendering, instead of a white screen.
 *
 * Exported as `ErrorBoundary` from the root layout and from the routes where
 * a player has something at stake (play, result). Expo Router wraps each of
 * those routes in its own boundary, so a bug in the result screen costs the
 * result screen, not the tab bar.
 *
 * The copy is held to the same standard as the rest of the game: it says what
 * is true. A season in progress *is* kept -- the game store is persisted -- and
 * a finished season *was* recorded before the result screen opened. Whether a
 * report was sent depends on the `diagnostics` flag and the browser's privacy
 * signal, so the screen asks rather than assumes, and says "nothing was sent"
 * when nothing was.
 *
 * Deliberately free of the safe-area context, the fold and every provider: the
 * root layout's boundary renders *instead of* the providers when the layout
 * itself is what broke, and a recovery screen that needs them would throw too.
 */

/** One answer per error object, so a re-render (or StrictMode) does not report twice. */
const sentFor = new WeakMap<Error, boolean>();

const COPY: Record<string, string> = {
  play: 'Your season in progress is saved on this device. Try again picks it up where it stopped.',
  result: 'This season was recorded before this screen opened, so it is safe in your seasons.',
};

export function RouteError({ error, retry }: ErrorBoundaryProps) {
  const [sent, setSent] = useState<boolean | null>(() => sentFor.get(error) ?? null);
  const route = currentRoute();

  useEffect(() => {
    if (sentFor.has(error)) return;
    const ok = reportError(error, { source: 'boundary', fatal: true });
    sentFor.set(error, ok);
    setSent(ok);
  }, [error]);

  const reassurance =
    COPY[route] ?? 'Your seasons are stored on this device and nothing about them has changed.';

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.kicker}>FUMBLE</Text>
        <Text style={styles.title}>This screen hit a bug.</Text>
        <Text style={styles.copy}>{reassurance}</Text>
        <Text style={styles.note}>
          {sent === null
            ? ' '
            : sent
              ? 'A report went out with the version and the screen it happened on. Nothing about you was in it.'
              : 'Nothing was sent from this device.'}
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={() => void retry()}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          >
            <Text style={styles.primaryText}>Try again</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to the home screen"
            onPress={() => {
              try {
                router.replace('/');
              } catch {
                // No navigator at all: the root layout is what broke. Retrying
                // is the only way forward, and the button above does that.
                void retry();
              }
            }}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>Home</Text>
          </Pressable>
        </View>
        {__DEV__ ? <Text style={styles.dev}>{String(error?.stack ?? error)}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: color.void },
    body: { flexGrow: 1, justifyContent: 'center', padding: space.xl, paddingTop: space.xxxl, maxWidth: 520, alignSelf: 'center', width: '100%' },
    kicker: { fontFamily: font.label, fontSize: 13, letterSpacing: tracking.wider, color: color.ignition, marginBottom: space.sm },
    title: { fontFamily: font.display, fontSize: 30, color: color.text, marginBottom: space.md },
    copy: { fontFamily: font.body, fontSize: 15, lineHeight: 22, color: color.silver, marginBottom: space.md },
    note: { fontFamily: font.bodyRegular, fontSize: 13, lineHeight: 19, color: color.textDim, marginBottom: space.xl },
    actions: { flexDirection: 'row', gap: space.md },
    primary: { backgroundColor: color.action, borderRadius: radius.md, paddingVertical: space.md, paddingHorizontal: space.xl },
    primaryText: { fontFamily: font.bodyBold, fontSize: 15, color: color.onAction },
    secondary: { borderColor: color.line, borderWidth: 1, borderRadius: radius.md, paddingVertical: space.md, paddingHorizontal: space.xl },
    secondaryText: { fontFamily: font.bodyBold, fontSize: 15, color: color.text },
    pressed: { opacity: 0.8 },
    dev: { marginTop: space.xl, fontFamily: font.bodyRegular, fontSize: 11, color: color.textFaint },
  }),
);
