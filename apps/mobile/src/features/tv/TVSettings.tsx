import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/Pressable';
import { color, font, radius, space, themed, tracking } from '@/theme';
import { useTVPrefs } from './prefs';
import { cue } from './sound';

/**
 * The Apple TV's own switches, at the top of the Account page.
 *
 * Each row is one focus target, the whole width of the panel: a 50-point
 * switch at the end of a line of copy is a small thing to find from a sofa.
 */
export function TVSettings() {
  const prefs = useTVPrefs();
  return (
    <View style={styles.group}>
      <Text style={styles.eyebrow}>On this TV</Text>
      <Row
        title="Sound effects"
        copy="Spins, picks, the record, Gut Check. Original sounds, made for this game."
        on={prefs.sound}
        onPress={() => {
          prefs.set({ sound: !prefs.sound });
          // Heard only when it has just been turned on.
          setTimeout(() => cue('lock'), 0);
        }}
      />
      <Row
        title="Broadcast mode"
        copy="A scorebug, lower thirds for every spin and pick, and the record as a full-screen graphic. For streams and podcasts."
        on={prefs.broadcast}
        onPress={() => prefs.set({ broadcast: !prefs.broadcast })}
      />
      {prefs.broadcast ? (
        <>
          <Row
            title="Clean feed"
            copy="Hides the remote hints in a game, so only the game and the graphics are in the picture."
            on={prefs.cleanFeed}
            onPress={() => prefs.set({ cleanFeed: !prefs.cleanFeed })}
            inset
          />
          <Row
            title="Ticker"
            copy="The crawl along the foot of the screen in a game."
            on={prefs.ticker}
            onPress={() => prefs.set({ ticker: !prefs.ticker })}
            inset
          />
        </>
      ) : null}
    </View>
  );
}

function Row({
  title,
  copy,
  on,
  onPress,
  inset,
}: {
  title: string;
  copy: string;
  on: boolean;
  onPress: () => void;
  inset?: boolean;
}) {
  return (
    <Pressable onPress={onPress} role="switch" aria-checked={on} aria-label={title} style={[styles.row, inset && styles.inset]}>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.copy}>{copy}</Text>
      </View>
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    group: { gap: space.sm },
    eyebrow: {
      fontFamily: font.label,
      fontSize: 11,
      letterSpacing: tracking.wider,
      textTransform: 'uppercase',
      color: color.textDim,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.lg,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.scrim,
    },
    inset: { marginLeft: space.xl },
    text: { flex: 1, minWidth: 0, gap: 2 },
    title: {
      fontFamily: font.heading,
      fontSize: 18,
      color: color.text,
      letterSpacing: tracking.normal,
    },
    copy: {
      fontFamily: font.bodyRegular,
      fontSize: 12,
      lineHeight: 16,
      color: color.silver,
    },
    track: {
      width: 50,
      height: 28,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: color.line,
      padding: 3,
      justifyContent: 'center',
    },
    trackOn: { borderColor: color.gold, backgroundColor: color.goldGlow },
    knob: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: color.textFaint,
      alignSelf: 'flex-start',
    },
    knobOn: { backgroundColor: color.gold, alignSelf: 'flex-end' },
  }),
);
