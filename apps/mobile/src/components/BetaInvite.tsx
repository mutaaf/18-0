import { useState } from 'react';
import { Linking, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Svg, { Line, Rect } from 'react-native-svg';
import { Panel } from './Panel';
import { useFlag } from '@/features/flags';
import { TESTFLIGHT_URL } from '@/features/links';
import { track } from '@/features/telemetry';
import { color, font, radius, space, themed, tracking, type PressState } from '@/theme';

/**
 * The public TestFlight link, made to be passed on.
 *
 * Written for one situation: somebody has an iPhone Duo, and so does a friend.
 * The beta is where the two-panel spread lives -- field on one side of the
 * fold, the wheel and the picks on the other -- so the invitation says so
 * rather than "download our app".
 *
 * **Not on the web.** The site leads with the download showcase, the same link at the
 * top of the front page; a second invitation further down repeated it.
 *
 * **In the native app it is behind `share_beta`, off by default.** The same
 * bundle is the App Store build, and an App Store app that advertises its own
 * beta is a familiar rejection -- with a build in review, the default has to be
 * the version that passes. Turned on in PostHog, it shows to every iOS build
 * that can reach PostHog, including the App Store one: flip it once the review
 * is done, not before.
 *
 * Sharing goes through the system sheet where there is one (iOS, Android, and
 * browsers with `navigator.share`), and falls back to copying the link, with
 * the button saying it did. A share sheet that silently fails is the worst
 * outcome for a button whose whole job is to get a URL out of this screen.
 */
export function BetaInvite() {
  const offeredNative = useFlag('share_beta');
  const [copied, setCopied] = useState(false);
  const web = Platform.OS === 'web';
  if (!(Platform.OS === 'ios' && offeredNative)) return null;

  const share = async () => {
    track('app_link_opened', { target: 'testflight_share' });
    const message = `Join the 17-0 beta on TestFlight -- it plays as a two-panel spread on iPhone Duo: ${TESTFLIGHT_URL}`;
    const canSheet = !web || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');
    if (canSheet) {
      try {
        // iOS shows `url` as a rich link and drops it from `message`, Android
        // only reads `message` -- so the link rides in both.
        await Share.share(Platform.OS === 'ios' ? { message, url: TESTFLIGHT_URL } : { message });
        return;
      } catch {
        // Cancelled, or the browser refused: fall through to the clipboard.
      }
    }
    await Clipboard.setStringAsync(TESTFLIGHT_URL).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const join = () => {
    track('app_link_opened', { target: 'testflight' });
    Linking.openURL(TESTFLIGHT_URL).catch(() => {});
  };

  return (
    <Panel tint={color.navy} contentStyle={styles.body}>
      <View style={styles.top}>
        <DuoMark />
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>Public beta · iPhone Duo ready</Text>
          <Text style={styles.title}>Open it, and the field gets a whole panel</Text>
          <Text style={styles.detail}>
            Lineup on one side of the fold, wheel and picks on the other. Free on TestFlight for any iPhone, iPad or
            iPhone Duo.
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        {web ? (
          <Pressable
            onPress={join}
            accessibilityRole="link"
            accessibilityLabel="Join the TestFlight beta"
            style={({ hovered, pressed }: PressState) => [styles.primary, hovered && styles.lift, pressed && styles.pressed]}
          >
            <Text style={styles.primaryLabel}>Join the beta</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => void share()}
          accessibilityRole="button"
          accessibilityLabel="Send the beta link to a friend"
          style={({ hovered, pressed }: PressState) => [
            web ? styles.secondary : styles.primary,
            hovered && styles.lift,
            pressed && styles.pressed,
          ]}
        >
          <Text style={web ? styles.secondaryLabel : styles.primaryLabel}>
            {copied ? 'Link copied' : 'Send to a friend'}
          </Text>
        </Pressable>
      </View>
    </Panel>
  );
}

/** Two panels and a spine: the device, as a glyph. */
function DuoMark() {
  return (
    <Svg width={44} height={34} viewBox="0 0 44 34">
      <Rect x="1" y="1" width="20" height="32" rx="4" stroke={color.actionBright} strokeWidth="1.6" fill="none" />
      <Rect x="23" y="1" width="20" height="32" rx="4" stroke={color.actionBright} strokeWidth="1.6" fill="none" />
      <Line x1="22" y1="5" x2="22" y2="29" stroke={color.chalk} strokeOpacity="0.5" strokeWidth="1" strokeDasharray="2 3" />
      <Rect x="5" y="8" width="12" height="14" rx="2" fill={color.action} opacity="0.35" />
      <Rect x="27" y="8" width="12" height="3" rx="1.5" fill={color.textDim} />
      <Rect x="27" y="14" width="12" height="3" rx="1.5" fill={color.textFaint} />
      <Rect x="27" y="20" width="8" height="3" rx="1.5" fill={color.textFaint} />
    </Svg>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    body: { padding: space.lg, gap: space.md },
    top: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
    copy: { flex: 1, minWidth: 0, gap: 3 },
    eyebrow: {
      fontFamily: font.label,
      fontSize: 10,
      letterSpacing: tracking.wider,
      textTransform: 'uppercase',
      color: color.actionBright,
    },
    title: { fontFamily: font.heading, fontSize: 19, color: color.text },
    detail: { fontFamily: font.bodyRegular, fontSize: 12, lineHeight: 17, color: color.textDim },
    actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
    primary: {
      flexGrow: 1,
      minHeight: 44,
      paddingHorizontal: space.lg,
      borderRadius: radius.md,
      backgroundColor: color.action,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryLabel: { fontFamily: font.display, fontSize: 15, letterSpacing: tracking.wide, color: color.onAction, textTransform: 'uppercase' },
    secondary: {
      flexGrow: 1,
      minHeight: 44,
      paddingHorizontal: space.lg,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.lineBright,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryLabel: { fontFamily: font.display, fontSize: 15, letterSpacing: tracking.wide, color: color.text, textTransform: 'uppercase' },
    lift: { transform: [{ translateY: -1 }] },
    pressed: { opacity: 0.85 },
  }),
);
