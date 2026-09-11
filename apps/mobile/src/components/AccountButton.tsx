import { useEffect, useState } from 'react';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { fetchProgress, identity, isBackendConfigured, type Identity, type Progress } from '@/services/supabase';
import { identifyPlayer } from '@/features/analytics';
import { ratingBucket } from '@/features/telemetry';
import { useHistoryStore } from '@/state/history';
import { careerReport } from '@/state/career';
import { color, font, space, themed, tracking, type PressState } from '@/theme';

const SIZE = 46;

/**
 * The width of the top-right corner this disc owns, measured in from the
 * screen's right edge and including the gap nothing else should cross.
 *
 * The disc floats over every tab screen, so a screen that wants a control of
 * its own up there has to know how much room is already spoken for. Games did
 * not: its Quick Play pill was drawn straight under the disc, which covered the
 * word "PLAY" and left two overlapping tap targets in the same corner.
 */
export const ACCOUNT_DOCK_WIDTH = space.lg + SIZE + space.sm;

/**
 * You, floating in the top right corner.
 *
 * Your account was a sixth tab, which put the one thing on the shelf that is
 * not a part of the game on the same shelf as the game. Every app that has
 * ever had an account has put it in this corner instead, and it costs the
 * navigation nothing to follow that.
 *
 * It is a disc rather than a tile because it is a person: a graphite ground
 * lit from the top, a rim, and your initials in the middle once you have a
 * name. Signed out, it is an outline with a gold ring around it, because
 * signing in is the one thing this corner ever asks of you.
 */
export function AccountButton() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [me, setMe] = useState<Identity | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const games = useHistoryStore((s) => s.games);
  // This button is mounted on every tab screen, so whatever it does to the
  // history it does on every route change. The report is one walk, cached on
  // the array, and shared with whatever else is on screen.
  const career = careerReport(games);
  const favouriteMode = career.modes[0]?.mode;

  // Keyed on the route so it picks up a name the moment you claim one, without
  // any of the screens having to know this button exists.
  useEffect(() => {
    if (!isBackendConfigured) return;
    let alive = true;
    // The level rides on the same route change the identity does. It is a
    // second round trip, but an unbadged disc after a season that earned a
    // level is worse than a badge that arrives a moment late.
    void fetchProgress()
      .then((p) => alive && setProgress(p))
      .catch(() => undefined);
    identity()
      .then((who) => {
        if (!alive) return;
        setMe(who);
        // Person properties, so the events already being sent belong to
        // somebody rather than to a stream. A no-op unless analytics is
        // configured, and it only calls out when something actually changed.
        if (who) {
          void identifyPlayer({
            userId: who.userId,
            handle: who.handle,
            named: who.named,
            seasons: career.total,
            bestRatingBucket:
              career.bestRating === null ? undefined : ratingBucket(career.bestRating),
            favouriteMode,
          });
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pathname, career.total, career.bestRating, favouriteMode]);

  // Nothing to travel to from the screen you are already on.
  if (pathname.endsWith('/account')) return null;

  const named = me?.named === true && Boolean(me.handle);
  const rim = named ? '#FFFFFF2E' : `${color.gold}80`;

  return (
    <View style={[styles.dock, { top: insets.top + space.md }]} pointerEvents="box-none">
      <Pressable
        onPress={() => router.push('/(tabs)/account')}
        accessibilityRole="button"
        accessibilityLabel={named ? `Account, signed in as ${me?.handle}` : 'Account, not signed in'}
        style={({ hovered, pressed }: PressState) => [
          styles.button,
          hovered && { opacity: 0.88 },
          pressed && { transform: [{ scale: 0.94 }] },
        ]}
      >
        <Svg width={SIZE} height={SIZE} viewBox="0 0 46 46" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="ab-ground" x1="0" y1="0" x2="0.3" y2="1">
              <Stop offset="0" stopColor="#2A3448" />
              <Stop offset="1" stopColor={color.panelBottom} />
            </LinearGradient>
            <LinearGradient id="ab-gloss" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Circle cx="23" cy="23" r="23" fill="url(#ab-ground)" />
          {/* The light lands on the top of a sphere, not across a flat disc. */}
          <Path d="M0 23a23 23 0 0 1 46 0c0-8-10-13-23-13S0 15 0 23z" fill="url(#ab-gloss)" />
          <Circle cx="23" cy="23" r="22.25" fill="none" stroke={rim} strokeWidth="1.5" />
        </Svg>

        {/* Positioned, because the ground behind it is: an absolutely placed
            sibling paints over static content no matter which came first. */}
        <View style={styles.face}>
          {named ? (
            <Text style={styles.initials}>{initials(me!.handle!)}</Text>
          ) : (
            <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 11.5a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5 M4.5 20.5a7.5 7.5 0 0 1 15 0"
                stroke={color.gold}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          )}
        </View>

        {/* The level, on the disc rather than beside it: the corner has one
            control in it and adding a second would make the first ambiguous.
            Only once there is something to show -- a badge reading 1 before
            anybody has played is a chore, not a reward. */}
        {progress && progress.level > 1 ? (
          <View style={styles.level}>
            <Text style={styles.levelText}>{progress.level}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

/** Two letters, skipping the generated `player-` prefix nobody chose. */
function initials(handle: string): string {
  const cleaned = handle.replace(/^player-/i, '');
  const words = cleaned.split(/[\s._-]+/).filter(Boolean);
  return (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : cleaned.slice(0, 2)).toUpperCase();
}

const styles = themed(() => StyleSheet.create({
  dock: { position: 'absolute', right: space.lg, zIndex: 20 },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 9,
  },
  face: { alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  level: {
    position: 'absolute',
    bottom: -3,
    right: -3,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.gold,
    borderWidth: 2,
    borderColor: color.void,
    zIndex: 2,
  },
  levelText: {
    fontFamily: font.display,
    fontSize: 11,
    color: color.ink,
    includeFontPadding: false,
  },
  initials: {
    fontFamily: font.display,
    fontSize: 15,
    color: color.text,
    letterSpacing: tracking.wide,
    includeFontPadding: false,
  },
}));
