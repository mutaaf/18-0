import { StyleSheet, Text, View } from 'react-native';
import { color, font, tabular, tracking } from '@/theme';

/**
 * The wordmark. The hyphen is drawn rather than typed so it reads as a
 * scoreboard separator, not punctuation.
 */
export function Brand({ size = 30, subtitle }: { size?: number; subtitle?: string }) {
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel="18-0">
      <View style={styles.lockup}>
        <Text style={[styles.numeral, { fontSize: size }]}>18</Text>
        <View
          style={[
            styles.dash,
            {
              width: size * 0.34,
              height: Math.max(2, Math.round(size * 0.13)),
              marginHorizontal: size * 0.1,
            },
          ]}
        />
        <Text style={[styles.numeral, { fontSize: size }]}>0</Text>
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lockup: { flexDirection: 'row', alignItems: 'center' },
  numeral: {
    fontFamily: font.displayBlack,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
    ...tabular,
  },
  dash: { borderRadius: 2, backgroundColor: color.red },
  subtitle: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    color: color.textFaint,
    textTransform: 'uppercase',
    marginTop: 3,
  },
});
