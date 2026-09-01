import { StyleSheet, Text, View } from 'react-native';
import { color, font, radius, tabular, tracking } from '@/theme';

/**
 * Ratings carry their own weight: a 99 should look different from an 82 at a
 * glance, without relying on colour alone to say so (PRFAQ §34).
 */
export function ratingTone(rating: number): { fg: string; bg: string; border: string } {
  // Deliberately near-white, not gold: a 99 should read as hot, and gold is
  // reserved for an earned 18-0.
  if (rating >= 97) return { fg: '#FFFFFF', bg: '#FFFFFF14', border: '#FFFFFF59' };
  if (rating >= 93) return { fg: '#7FE3B0', bg: '#3FD68C14', border: '#3FD68C4D' };
  if (rating >= 88) return { fg: '#8FC4FF', bg: '#4D9DFF14', border: '#4D9DFF40' };
  if (rating >= 80) return { fg: color.text, bg: '#FFFFFF0A', border: color.line };
  return { fg: color.textDim, bg: '#00000033', border: color.line };
}

export function RatingBadge({
  rating,
  size = 'md',
}: {
  rating: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  const tone = ratingTone(rating);
  const scale = size === 'lg' ? 26 : size === 'sm' ? 13 : 17;
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tone.bg, borderColor: tone.border, paddingHorizontal: scale * 0.4 },
      ]}
    >
      <Text style={[styles.value, { color: tone.fg, fontSize: scale }]}>{rating.toFixed(1)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontFamily: font.display,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
    ...tabular,
  },
});
