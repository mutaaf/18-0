import { StyleSheet, Text, View } from 'react-native';
import { font, tracking } from '@/theme';

/**
 * A player's initials in a coloured disc.
 *
 * Nobody uploads a picture, so the board would otherwise be a column of text.
 * The colour comes from the handle, which means it is stable for a person
 * across sessions and devices without anything being stored, and two people
 * scanning for their own row can find it by colour before they read it.
 */
export function Avatar({ handle, size = 40 }: { handle: string; size?: number }) {
  const tint = PALETTE[hash(handle) % PALETTE.length]!;
  return (
    <View
      style={[
        styles.disc,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: tint },
      ]}
      // The name is already read out by the row; this would just repeat it.
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Text style={[styles.initials, { fontSize: size * 0.38 }]}>{initials(handle)}</Text>
    </View>
  );
}

/** Two letters, skipping the generated `player-` prefix nobody chose. */
function initials(handle: string): string {
  const cleaned = handle.replace(/^player-/i, '');
  const words = cleaned.split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length > 1
      ? `${words[0]![0]}${words[1]![0]}`
      : cleaned.slice(0, 2);
  return letters.toUpperCase();
}

/** Deterministic, so a handle keeps its colour everywhere it appears. */
function hash(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i++) total = (total * 31 + value.charCodeAt(i)) >>> 0;
  return total;
}

/**
 * Saturated enough to tell apart at 28 pixels, and none of them the broadcast
 * red this app uses for anything live -- a row should not look like an alert.
 */
const PALETTE = [
  '#3B7DFF',
  '#7B5BFF',
  '#00A9A5',
  '#E0457B',
  '#F08C00',
  '#2FA84F',
  '#C2529B',
  '#0E7C86',
  '#8E44AD',
  '#D9822B',
];

const styles = StyleSheet.create({
  disc: { alignItems: 'center', justifyContent: 'center' },
  initials: {
    fontFamily: font.display,
    color: '#FFFFFF',
    letterSpacing: tracking.wide,
    includeFontPadding: false,
  },
});
