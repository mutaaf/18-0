import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion, ZoomIn } from 'react-native-reanimated';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { DockIcon } from './DockIcons';
import { Panel } from './Panel';
import {
  destinationFor,
  useWhatsNew,
  type Callout,
  type CalloutArt,
  type CalloutHref,
  type ReleaseNotes,
} from '@/features/whats-new';
import { DECORATIVE, color, elevate, font, radius, space, themed, tracking, type PressState } from '@/theme';

/**
 * The What's New sheet: a headline, two to four callouts, the full notes folded
 * away, and one way out.
 *
 * When it shows is `features/whats-new/decide.ts`; what it says is
 * `apps/mobile/store/whats-new.json`. Mounted in the tab layout only, so it
 * never lands on a game in progress, a result being built, or the `/embed`
 * frame inside somebody else's page.
 *
 * A callout with a `to` is a way in, not only an announcement: tapping it
 * closes the sheet and opens that tab, so "every name can be reported now"
 * ends on the leaderboard with the flags rather than on whatever tab was
 * underneath.
 */
export function WhatsNew() {
  const [notes, dismiss] = useWhatsNew();
  const router = useRouter();
  if (!notes) return null;
  const go = (href: CalloutHref) => {
    dismiss();
    router.navigate(href);
  };
  return <WhatsNewSheet notes={notes} onDismiss={dismiss} onGo={go} />;
}

// Each callout takes one of the app's own accents in turn, so four cards read
// as four things rather than one grey wall (the same reasoning as Panel's tint).
const tints = () => [color.action, color.gold, color.ice, color.ignition];

// Every entrance honours the system's Reduce Motion: with it on they simply
// appear. Kept short, so a player who taps straight through is not waiting.
const enter = (index: number) =>
  FadeInDown.delay(120 + index * 70).duration(320).reduceMotion(ReduceMotion.System);

export function WhatsNewSheet({
  notes,
  onDismiss,
  onGo,
}: {
  notes: ReleaseNotes;
  onDismiss: () => void;
  onGo?: (href: CalloutHref) => void;
}) {
  const [open, setOpen] = useState(false);
  const palette = tints();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <View style={styles.backdrop}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            entering={ZoomIn.duration(260).reduceMotion(ReduceMotion.System)}
            style={styles.sheet}
            accessibilityViewIsModal
            aria-modal
            role="dialog"
            aria-label={`What's new in version ${notes.version}`}
          >
            <View style={styles.glow} pointerEvents="none" {...DECORATIVE}>
              <Svg width="100%" height={240}>
                <Defs>
                  <RadialGradient id="whatsnew-flood" cx="50%" cy="0%" rx="70%" ry="100%">
                    <Stop offset="0" stopColor={color.action} stopOpacity="0.32" />
                    <Stop offset="0.55" stopColor={color.backdropCool} stopOpacity="0.12" />
                    <Stop offset="1" stopColor={color.backdropCool} stopOpacity="0" />
                  </RadialGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="240" fill="url(#whatsnew-flood)" />
              </Svg>
            </View>

            <View style={styles.kickerRow}>
              <View style={styles.kicker}>
                <Text style={styles.kickerText}>NEW IN {notes.version}</Text>
              </View>
              <Text style={styles.kickerAside} {...DECORATIVE}>
                ✦ ✦ ✦
              </Text>
            </View>

            <Text style={styles.headline} accessibilityRole="header">
              {notes.headline}
            </Text>
            <Text style={styles.subhead}>{notes.subhead}</Text>

            <View style={styles.grid}>
              {notes.callouts.map((callout, i) => {
                const tint = palette[i % palette.length] ?? color.action;
                const href = onGo ? destinationFor(callout) : null;
                return (
                  <Animated.View key={callout.title} entering={enter(i)} style={styles.cell}>
                    {href && onGo ? (
                      <Pressable
                        onPress={() => onGo(href)}
                        accessibilityRole="link"
                        accessibilityLabel={`${callout.title}. ${callout.line}`}
                        accessibilityHint={`Closes what's new and opens ${PLACE[href]}`}
                        style={({ hovered, pressed }: PressState) => [
                          styles.card,
                          hovered && styles.cardHover,
                          pressed && styles.cardPressed,
                        ]}
                      >
                        <Card callout={callout} tint={tint} go={PLACE[href]} />
                      </Pressable>
                    ) : (
                      <Card callout={callout} tint={tint} />
                    )}
                  </Animated.View>
                );
              })}
            </View>

            <Pressable
              onPress={() => setOpen((v) => !v)}
              accessibilityRole="button"
              aria-expanded={open}
              accessibilityState={{ expanded: open }}
              accessibilityLabel={open ? 'Hide the full notes' : 'Show the full notes'}
              style={({ hovered, pressed }: PressState) => [
                styles.accordion,
                (hovered || pressed) && { borderColor: color.lineBright },
              ]}
            >
              <Text style={styles.accordionLabel}>The full notes</Text>
              <View style={open ? styles.chevronOpen : undefined} {...DECORATIVE}>
                <Svg width={14} height={14} viewBox="0 0 24 24">
                  <Path d="M6 9l6 6 6-6" stroke={color.silver} strokeWidth={2.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </View>
            </Pressable>
            {open ? (
              <View style={styles.notes}>
                {notes.notes.map((note) => (
                  <View key={note} style={styles.noteRow}>
                    <View style={styles.noteDot} {...DECORATIVE} />
                    <Text style={styles.noteText}>{note}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Pressable
              onPress={onDismiss}
              accessibilityRole="button"
              accessibilityLabel="Close what's new"
              style={({ hovered, pressed }: PressState) => [
                styles.dismiss,
                hovered && { backgroundColor: color.actionBright },
                pressed && { transform: [{ scale: 0.98 }] },
              ]}
            >
              <Text style={styles.dismissLabel}>Back to the field</Text>
            </Pressable>
          </Animated.View>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** What a callout's tab is called on the card and to a screen reader. */
const PLACE: Record<CalloutHref, string> = {
  '/': 'Play',
  '/games': 'Games',
  '/leaderboard': 'Leaderboards',
  '/challenges': 'Challenges',
  '/stats': 'My Stats',
  '/account': 'Account',
};

function Card({ callout, tint, go }: { callout: Callout; tint: string; go?: string }) {
  return (
    <Panel tint={tint} style={styles.card} contentStyle={styles.cardBody}>
      <View style={styles.art} {...DECORATIVE}>
        <Art name={callout.art} />
      </View>
      <Text style={styles.cardTitle}>{callout.title}</Text>
      <Text style={styles.cardLine}>{callout.line}</Text>
      {go ? (
        <View style={styles.goRow} {...DECORATIVE}>
          <Text style={[styles.goLabel, { color: tint }]}>{go.toUpperCase()}</Text>
          <Svg width={12} height={12} viewBox="0 0 24 24">
            <Path d="M5 12h13M13 6l6 6-6 6" stroke={tint} strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
      ) : null}
    </Panel>
  );
}

const ICON = require('../../assets/icon.png');

/** The app's own art: its icon, or one of the dock's tiles. */
function Art({ name }: { name: CalloutArt }) {
  if (name === 'icon') return <Image source={ICON} style={styles.icon} />;
  return <DockIcon name={name === 'play' ? 'index' : name} size={44} />;
}

const styles = themed(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: color.scrim },
  scroll: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    paddingVertical: space.xxl,
  },
  sheet: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: color.glass,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: color.lineBright,
    padding: space.xl,
    gap: space.md,
    overflow: 'hidden',
    ...elevate(12),
    shadowColor: color.backdropCool,
    shadowOpacity: 0.45,
  },
  // A floodlight over the top of the sheet, pooled where the headline is: the
  // stadium backdrop's light, falling off rather than ending in an edge.
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 240 },

  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  kicker: {
    alignSelf: 'flex-start',
    backgroundColor: color.gold,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 4,
  },
  kickerText: { fontFamily: font.display, fontSize: 13, letterSpacing: tracking.wide, color: color.inkDeep },
  kickerAside: { fontFamily: font.display, fontSize: 12, color: color.goldBright, letterSpacing: tracking.wide },

  headline: {
    fontFamily: font.display,
    fontSize: 40,
    lineHeight: 40,
    color: color.text,
    letterSpacing: tracking.tight,
    marginTop: space.xs,
  },
  subhead: { fontFamily: font.body, fontSize: 14, lineHeight: 20, color: color.silver },

  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xs, marginTop: space.xs },
  cell: { width: '50%', padding: space.xs },
  card: { flex: 1 },
  cardHover: { transform: [{ translateY: -2 }] },
  cardPressed: { transform: [{ scale: 0.97 }] },
  cardBody: { padding: space.md, gap: 4, minHeight: 148 },
  art: { width: 44, height: 44, marginBottom: space.xs },
  icon: { width: 44, height: 44, borderRadius: 11 },
  cardTitle: { fontFamily: font.display, fontSize: 18, lineHeight: 20, color: color.text },
  cardLine: { fontFamily: font.body, fontSize: 12, lineHeight: 17, color: color.silver },
  // Pinned to the foot of the card, so a short line and a long one put the
  // way in at the same height across the grid.
  goRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 'auto', paddingTop: space.xs },
  goLabel: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide },

  accordion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginTop: space.xs,
    minHeight: 44,
  },
  accordionLabel: { fontFamily: font.label, fontSize: 15, letterSpacing: tracking.normal, color: color.silver },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  notes: { gap: space.sm, paddingHorizontal: space.xs },
  noteRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  noteDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.action, marginTop: 7 },
  noteText: { flex: 1, fontFamily: font.bodyRegular, fontSize: 13, lineHeight: 19, color: color.silver },

  dismiss: {
    marginTop: space.sm,
    backgroundColor: color.action,
    borderRadius: radius.pill,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissLabel: { fontFamily: font.display, fontSize: 18, letterSpacing: tracking.wide, color: color.onAction },
}));
