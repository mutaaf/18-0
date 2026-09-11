import { StyleSheet, Text, View } from 'react-native';
import { color, font, radius, space, themed, tracking } from '@/theme';

/**
 * The mark that says a new act has started.
 *
 * The landing page had one of these already and did not know it: `Hall` put a
 * label and a line of explanation over its strip, and every other block on the
 * screen simply began. That is what made a page full of real content read as
 * flat — not the panels, the absence of anywhere for the eye to land between
 * them. So the two lines became a component, with a lit rail on the left
 * borrowed from `Panel`, and the blocks that were floating got one each.
 *
 * It is a header for assistive technology as well as for the eye. Screen
 * readers get a landmark to skip between, which the page previously offered
 * exactly one of.
 */
export function SectionHead({ label, note }: { label: string; note?: string }) {
  return (
    <View style={styles.head} accessible accessibilityRole="header">
      <View style={styles.rule} />
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  head: { flexDirection: 'row', gap: space.md, alignItems: 'stretch' },
  rule: { width: 3, borderRadius: radius.pill, backgroundColor: color.action },
  text: { flex: 1, minWidth: 0, gap: 2, paddingVertical: 1 },
  label: {
    fontFamily: font.display,
    fontSize: 22,
    color: color.text,
    letterSpacing: tracking.tight,
    includeFontPadding: false,
  },
  note: {
    fontFamily: font.bodyRegular,
    fontSize: 13,
    lineHeight: 19,
    color: color.textDim,
    maxWidth: 560,
  },
}));
