import { StyleSheet, Text, View } from 'react-native';
import { color, font, tabular, tracking } from '@/theme';

/**
 * The wordmark: chrome numerals with a gold edge, split by a gold bar rather
 * than a typed hyphen — it should read as a scoreboard separator.
 */
export function Brand({
  size = 30,
  subtitle,
  tint,
}: {
  size?: number;
  subtitle?: string;
  /** Overrides the numeral colour; used for the 18-0 celebration. */
  tint?: string;
}) {
  const barHeight = Math.max(2, Math.round(size * 0.14));
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel="18-0">
      <View style={styles.lockup}>
        <Text
          allowFontScaling={false}
          style={[styles.numeral, { fontSize: size, textShadowRadius: size * 0.16 }, tint ? { color: tint } : null]}
        >
          18
        </Text>
        <View
          style={[
            styles.bar,
            { width: size * 0.32, height: barHeight, marginHorizontal: size * 0.09 },
          ]}
        />
        <Text
          allowFontScaling={false}
          style={[styles.numeral, { fontSize: size, textShadowRadius: size * 0.16 }, tint ? { color: tint } : null]}
        >
          0
        </Text>
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lockup: { flexDirection: 'row', alignItems: 'center' },
  numeral: {
    fontFamily: font.display,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
    // The gold edge the brand mark has, without shipping an image for it.
    textShadowColor: color.goldGlow,
    textShadowOffset: { width: 0, height: 0 },
    ...tabular,
  },
  bar: { borderRadius: 2, backgroundColor: color.gold },
  subtitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
    marginTop: 3,
  },
});
