import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Panel } from './Panel';
import { TESTFLIGHT_URL } from '@/features/links';
import { track } from '@/features/telemetry';
import {
  dismissInstall,
  installKind,
  isStandalone,
  onInstallAvailability,
  promptInstall,
  type InstallKind,
} from '@/features/install';
import { color, font, radius, space, tracking, type PressState } from '@/theme';

/**
 * Where to get the game, on the one surface that needs to say so.
 *
 * **Web only, deliberately.** The same React ships inside the iOS and Android
 * apps, so without this gate the App Store build would advertise its own
 * TestFlight beta to somebody already holding the finished app -- nonsense to
 * read, and the kind of thing App Review takes exception to. `Platform.OS`
 * settles it in one line; there is no version of this panel worth showing to a
 * player who already installed.
 *
 * It is also hidden once the site is running as an installed PWA. Somebody who
 * has already added it to their home screen has done the thing this asks for.
 *
 * Three routes, honestly labelled:
 *
 *   - **iOS** is a real beta today, on a public TestFlight link, and the App
 *     Store build is in review. Both facts are stated rather than collapsed
 *     into "coming soon", because one of them is something you can act on now.
 *   - **Android** is genuinely coming and has no link to give, so it says so
 *     and offers nothing to tap.
 *   - **The web app** is the thing already open. Installed it behaves like the
 *     others -- full screen, offline, its own icon -- which is worth saying to
 *     somebody who would otherwise wait for a store.
 */
export function GetTheApp() {
  const [kind, setKind] = useState<InstallKind>('installed');
  const refresh = useCallback(() => setKind(installKind()), []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    refresh();
    return onInstallAvailability(refresh);
  }, [refresh]);

  // Inside a native build, or already installed: nothing here applies.
  if (Platform.OS !== 'web' || isStandalone()) return null;

  const open = (url: string, what: string) => {
    track('app_link_opened', { target: what });
    Linking.openURL(url).catch(() => {});
  };

  return (
    <Panel tint={color.navy} contentStyle={styles.body}>
      <Text style={styles.eyebrow}>Get 18-0</Text>
      <Text style={styles.title}>On your phone, three ways</Text>

      <View style={styles.routes}>
        <Route
          glyph={<AppleMark />}
          name="iPhone & iPad"
          detail="Public beta on TestFlight. App Store build is in review."
          action="Join the beta"
          onPress={() => open(TESTFLIGHT_URL, 'testflight')}
        />

        <Route
          glyph={<AndroidMark />}
          name="Android"
          detail="Coming to Google Play."
          soon
        />

        <Route
          glyph={<InstallMark />}
          name="Install this page"
          detail="Full screen, plays offline, keeps your seasons. No store needed."
          action={
            kind === 'prompt' ? 'Install' : kind === 'ios' ? 'Share → Add to Home Screen' : undefined
          }
          soon={kind === 'unsupported'}
          soonLabel={kind === 'unsupported' ? 'Not on this browser' : undefined}
          onPress={
            kind === 'prompt'
              ? () => {
                  track('app_link_opened', { target: 'pwa_install' });
                  void promptInstall().then((accepted) => {
                    // Accepting is the end of this panel's job on this device;
                    // the standalone check hides it from then on anyway, but
                    // the browser tab that fired the prompt is still open.
                    if (accepted) void dismissInstall();
                  });
                }
              : undefined
          }
        />
      </View>
    </Panel>
  );
}

function Route({
  glyph,
  name,
  detail,
  action,
  onPress,
  soon,
  soonLabel,
}: {
  glyph: React.ReactNode;
  name: string;
  detail: string;
  action?: string;
  onPress?: () => void;
  soon?: boolean;
  soonLabel?: string;
}) {
  // A row with nothing to tap is a row, not a button: no press feedback, and no
  // accessibility role promising something it cannot do.
  const Wrapper: React.ElementType = onPress ? Pressable : View;

  return (
    <Wrapper
      {...(onPress
        ? {
            onPress,
            accessibilityRole: 'link' as const,
            accessibilityLabel: `${name}. ${detail} ${action}`,
            style: ({ hovered }: PressState) => [styles.route, hovered && styles.routeHover],
          }
        : { style: styles.route, accessible: true, accessibilityLabel: `${name}. ${detail}` })}
    >
      <View style={styles.mark}>{glyph}</View>
      <View style={styles.routeText}>
        <Text style={styles.routeName}>{name}</Text>
        <Text style={styles.routeDetail}>{detail}</Text>
      </View>
      {soon ? (
        <Text style={styles.soon}>{soonLabel ?? 'SOON'}</Text>
      ) : action ? (
        <Text style={styles.action} numberOfLines={1}>
          {action}
        </Text>
      ) : null}
    </Wrapper>
  );
}

/** Apple's mark, in silver rather than the brand's red. */
function AppleMark() {
  return (
    <Svg width={17} height={20} viewBox="0 0 24 24">
      <Path
        fill={color.silver}
        d="M17.05 12.54c-.02-2.32 1.9-3.43 1.98-3.49-1.08-1.58-2.76-1.8-3.36-1.82-1.43-.15-2.79.84-3.52.84-.72 0-1.84-.82-3.03-.8-1.56.02-3 .91-3.8 2.3-1.62 2.81-.41 6.96 1.16 9.24.77 1.11 1.69 2.36 2.89 2.31 1.16-.05 1.6-.75 3-.75s1.79.75 3.02.72c1.25-.02 2.04-1.13 2.8-2.25.88-1.29 1.24-2.54 1.26-2.6-.03-.01-2.42-.93-2.44-3.7z"
      />
      <Path
        fill={color.silver}
        d="M14.7 5.3c.64-.78 1.07-1.86.95-2.94-.92.04-2.03.61-2.69 1.38-.59.69-1.11 1.79-.97 2.85 1.03.08 2.07-.52 2.71-1.29z"
      />
    </Svg>
  );
}

/** The robot's head, drawn rather than the full mascot: it reads at 18 points. */
function AndroidMark() {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 12.5a7 7 0 0 1 14 0v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5z"
        fill={color.textDim}
      />
      <Path
        d="M7.5 8.5L6 6 M16.5 8.5L18 6"
        stroke={color.textDim}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <Rect x="9" y="11" width="1.8" height="1.8" rx="0.9" fill="#0A0E17" />
      <Rect x="13.2" y="11" width="1.8" height="1.8" rx="0.9" fill="#0A0E17" />
    </Svg>
  );
}

function InstallMark() {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
      <Rect x="4" y="2.5" width="16" height="19" rx="3" stroke={color.redBright} strokeWidth={1.7} />
      <Path d="M9.5 18.5h5" stroke={color.redBright} strokeWidth={1.7} strokeLinecap="round" />
      <Path
        d="M12 7v6 M9 10l3 3 3-3"
        stroke={color.redBright}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.xs },
  eyebrow: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  title: {
    fontFamily: font.heading,
    fontSize: 19,
    color: color.text,
    marginBottom: space.xs,
  },
  routes: { gap: space.xs },
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FFFFFF06',
  },
  routeHover: { borderColor: color.lineBright, backgroundColor: '#FFFFFF0D' },
  mark: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF14',
    backgroundColor: '#FFFFFF08',
  },
  routeText: { flex: 1, minWidth: 0, gap: 1 },
  routeName: { fontFamily: font.bodyBold, fontSize: 14, color: color.text },
  routeDetail: { fontFamily: font.bodyRegular, fontSize: 11, lineHeight: 15, color: color.textFaint },
  action: {
    fontFamily: font.label,
    fontSize: 11,
    letterSpacing: tracking.wide,
    color: color.redBright,
    flexShrink: 1,
  },
  soon: {
    fontFamily: font.label,
    fontSize: 9,
    letterSpacing: tracking.wide,
    color: color.textFaint,
  },
});
