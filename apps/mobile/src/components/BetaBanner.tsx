import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Linking, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { ACCOUNT_DOCK_WIDTH } from './AccountButton';
import { isEmbedded } from '@/features/embed';
import { useNavRail } from '@/features/fold';
import { TESTFLIGHT_URL } from '@/features/links';
import { track } from '@/features/telemetry';
import { DECORATIVE, color, font, radius, space, themed, tracking, useLayout, type PressState } from '@/theme';

/**
 * The beta, as the first thing on the site.
 *
 * The invitation used to be a panel two-thirds of the way down the front page,
 * below the leaderboard strip -- past where most visitors stop scrolling, on the
 * one page whose job is to turn a visitor into a player. This is the same link
 * as a strip above everything else.
 *
 * **Web only, and never in a frame.** The native bundle is the App Store build,
 * where advertising its own beta is a familiar rejection (`share_beta` governs
 * the in-app panel instead), and a page hosting the embed did not ask for our
 * call to action. **Not on Android**, where a TestFlight link goes nowhere.
 */
export function BetaBanner() {
  const layout = useLayout();
  const [copied, setCopied] = useState(false);
  const screen = useWindowDimensions();
  const rail = useNavRail();
  const slot = useRef<View>(null);
  const [clear, setClear] = useState(0);
  if (!offered()) return null;

  // The account disc floats in the top-right corner of the window, and the
  // banner is the first thing in the column beneath it: at most widths the two
  // met, and the disc sat on the copy-link button. The slot measures where its
  // right edge lands and pads by exactly the overlap, so a wide window whose
  // column ends well short of the corner keeps its full width. With the rail
  // up the disc lives at the rail's foot, and nothing needs clearing.
  const measure = () =>
    slot.current?.measureInWindow((x, _y, width) => {
      const overlap = rail ? 0 : Math.max(0, x + width - (screen.width - ACCOUNT_DOCK_WIDTH));
      setClear((prev) => (Math.abs(prev - overlap) < 1 ? prev : overlap));
    });

  const join = () => {
    track('app_link_opened', { target: 'testflight_banner' });
    Linking.openURL(TESTFLIGHT_URL).catch(() => {});
  };

  const copy = async () => {
    track('app_link_opened', { target: 'testflight_banner_copy' });
    await Clipboard.setStringAsync(TESTFLIGHT_URL).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const stacked = !layout.wide;

  return (
    <View ref={slot} onLayout={measure} style={{ paddingRight: clear }}>
    <View style={[styles.banner, stacked && styles.bannerStacked]}>
      <Ground />
      <View style={styles.lead}>
        <View style={styles.chip}>
          <LiveDot />
          <Text style={styles.chipLabel}>Public beta</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={2}>
            17-0 for iPhone is on TestFlight
          </Text>
          <Text style={styles.detail} numberOfLines={2}>
            Free, plays offline, and opens into two pages on iPhone Duo.
          </Text>
        </View>
      </View>
      <View style={[styles.actions, stacked && styles.actionsStacked]}>
        <Pressable
          onPress={join}
          accessibilityRole="link"
          accessibilityLabel="Join the 17-0 beta on TestFlight"
          style={({ hovered, pressed }: PressState) => [
            styles.join,
            stacked && styles.grow,
            hovered && styles.joinHover,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.joinLabel}>Join the beta</Text>
          <Text style={styles.joinArrow}>→</Text>
        </Pressable>
        <Pressable
          onPress={() => void copy()}
          accessibilityRole="button"
          accessibilityLabel="Copy the beta link"
          style={({ hovered, pressed }: PressState) => [
            styles.ghost,
            hovered && styles.ghostHover,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.ghostLabel, copied && { color: color.actionBright }]}>
            {copied ? 'Copied' : 'Copy link'}
          </Text>
        </Pressable>
      </View>
    </View>
    </View>
  );
}

function offered(): boolean {
  if (Platform.OS !== 'web' || isEmbedded()) return false;
  if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)) return false;
  return true;
}

/** Navy into void, lit green from the leading edge: the field under lights. */
function Ground() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none" {...DECORATIVE}>
      <Defs>
        <LinearGradient id="betaGround" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color.navy} stopOpacity="1" />
          <Stop offset="1" stopColor={color.navyDeep} stopOpacity="1" />
        </LinearGradient>
        <RadialGradient id="betaGlow" cx="0%" cy="50%" r="60%">
          <Stop offset="0" stopColor={color.action} stopOpacity="0.32" />
          <Stop offset="1" stopColor={color.action} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#betaGround)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#betaGlow)" />
    </Svg>
  );
}

/** A dot that breathes, so the strip reads as live rather than as an ad. */
function LiveDot() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled || reduce) return;
        loop = Animated.loop(
          Animated.timing(pulse, {
            toValue: 1,
            duration: 1800,
            easing: Easing.out(Easing.quad),
            useNativeDriver: Platform.OS !== 'web',
          }),
        );
        loop.start();
      });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);

  return (
    <View style={styles.dotBox}>
      <Animated.View
        style={[
          styles.dotRing,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
          },
        ]}
      />
      <View style={styles.dot} />
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.lg,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
      marginBottom: space.lg,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.actionDeep,
      overflow: 'hidden',
      shadowColor: color.action,
      shadowOpacity: 0.22,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 4 },
    },
    bannerStacked: { flexDirection: 'column', alignItems: 'stretch', gap: space.md },
    lead: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 999,
      backgroundColor: color.actionGlow,
      borderWidth: 1,
      borderColor: color.actionDeep,
      alignSelf: 'center',
    },
    chipLabel: {
      fontFamily: font.label,
      fontSize: 10,
      letterSpacing: tracking.wider,
      textTransform: 'uppercase',
      color: color.actionBright,
    },
    copy: { flex: 1, minWidth: 0, gap: 2 },
    title: { fontFamily: font.heading, fontSize: 17, color: color.text },
    detail: { fontFamily: font.bodyRegular, fontSize: 12, lineHeight: 16, color: color.textDim },
    actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    actionsStacked: { alignSelf: 'stretch' },
    grow: { flexGrow: 1 },
    join: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.sm,
      minHeight: 42,
      paddingHorizontal: space.lg,
      borderRadius: 999,
      backgroundColor: color.action,
      shadowColor: color.action,
      shadowOpacity: 0.45,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 2 },
    },
    joinHover: { backgroundColor: color.actionBright, transform: [{ translateY: -1 }] },
    joinLabel: {
      fontFamily: font.display,
      fontSize: 15,
      letterSpacing: tracking.wide,
      textTransform: 'uppercase',
      color: color.onAction,
    },
    joinArrow: { fontFamily: font.bodyBold, fontSize: 16, color: color.onAction },
    ghost: {
      minHeight: 42,
      paddingHorizontal: space.md,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: color.lineBright,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ghostHover: { borderColor: color.actionBright },
    ghostLabel: {
      fontFamily: font.label,
      fontSize: 12,
      letterSpacing: tracking.wide,
      textTransform: 'uppercase',
      color: color.text,
    },
    pressed: { opacity: 0.85 },
    dotBox: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.actionBright },
    dotRing: {
      position: 'absolute',
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: color.actionBright,
    },
  }),
);
