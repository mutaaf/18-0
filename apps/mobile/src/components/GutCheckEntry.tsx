import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/Pressable';
import { useRouter } from 'expo-router';
import { useFlag } from '@/features/flags';
import { color, font, radius, space, themed, tracking, type PressState } from '@/theme';

/**
 * The way into Gut Check (app/rate.tsx). A row on Home, under the quick-play
 * bar, and a single line on the result screen next to "Ratings look off?" --
 * the moment a player has an opinion of a rating is the moment to offer ten
 * more. Behind `gut_check`, like the screen it opens.
 */
export function GutCheckEntry({ inline = false }: { inline?: boolean }) {
  const router = useRouter();
  const on = useFlag('gut_check');
  if (!on) return null;
  const open = () => router.push('/rate');
  if (inline) {
    return (
      <Pressable onPress={open} accessibilityRole="link" accessibilityLabel="Open Gut Check: swipe through ten ratings" hitSlop={8}>
        {({ hovered }: PressState) => (
          <Text style={[styles.inline, hovered && { color: color.text }]}>Swipe through 10 more in Gut Check →</Text>
        )}
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel="Gut Check. Swipe right if a rating is right, left if it is off. Ten cards."
      style={({ hovered, pressed }: PressState) => [styles.row, (hovered || pressed) && styles.rowHot]}
    >
      <View style={styles.cards}>
        <View style={[styles.mini, styles.miniBack]} />
        <View style={styles.mini}>
          <Text style={styles.miniGlyph}>✓</Text>
        </View>
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>Gut Check</Text>
        <Text style={styles.sub}>Fair or off? Swipe 10 ratings.</Text>
      </View>
      <Text style={styles.go}>Play</Text>
    </Pressable>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      marginTop: space.sm,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.surface,
    },
    rowHot: { borderColor: color.lineBright, backgroundColor: color.surfaceRaised },
    cards: { width: 34, height: 34 },
    mini: {
      position: 'absolute',
      left: 6,
      top: 2,
      width: 22,
      height: 30,
      borderRadius: 5,
      borderWidth: 1.5,
      borderColor: color.positive,
      backgroundColor: color.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
      transform: [{ rotate: '10deg' }],
    },
    miniBack: { left: 2, borderColor: color.line, transform: [{ rotate: '-8deg' }] },
    miniGlyph: { fontFamily: font.bodyBold, fontSize: 12, color: color.positive },
    text: { flex: 1 },
    title: { fontFamily: font.display, fontSize: 17, color: color.text },
    sub: { fontFamily: font.body, fontSize: 12, color: color.silver },
    go: { fontFamily: font.label, fontSize: 14, letterSpacing: tracking.wide, color: color.action, textTransform: 'uppercase' },
    inline: { fontFamily: font.body, fontSize: 12, color: color.action, marginTop: space.xs },
  }),
);
