import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { summarize, type Call } from '@/features/gut-check';
import { DECORATIVE, color, font, space, tabular, themed, tracking } from '@/theme';
import { HudPanel, useBroadcast, usePop, useWipe } from './kit';

/**
 * Gut Check's tally, as a broadcast graphic: fair, off and passed, live, for a
 * host polling the room before the call goes in. Each number pops when it
 * moves. Display only -- the calls themselves are recorded by the deck.
 */
export function GutCheckTally({ calls, total }: { calls: readonly Call[]; total: number }) {
  const on = useBroadcast();
  if (!on) return null;
  return <Tally calls={calls} total={total} />;
}

function Tally({ calls, total }: { calls: readonly Call[]; total: number }) {
  const p = useWipe(true, 200);
  const s = summarize(calls);
  const off = s.tooHigh + s.tooLow;
  return (
    // Top right of the deck's own column, which already sits inside the
    // TV-safe margins.
    <View style={[styles.seat, { top: space.sm, right: space.sm }]} pointerEvents="none" {...DECORATIVE}>
      <HudPanel progress={p} from="right" accent={color.gold}>
        <View style={styles.body}>
          <View style={styles.head}>
            <Text style={styles.kicker}>Gut Check · live</Text>
            <Text style={styles.count}>
              {calls.length}/{total}
            </Text>
          </View>
          <View style={styles.cells}>
            <Cell label="Fair" value={s.fair} tone={color.positive} />
            <Cell label="Off" value={off} tone={color.negative} />
            <Cell label="Pass" value={s.skipped} tone={color.silver} />
          </View>
          {off > 0 ? (
            <Text style={styles.split}>
              ▲ {s.tooLow} higher · ▼ {s.tooHigh} lower
            </Text>
          ) : null}
        </View>
      </HudPanel>
    </View>
  );
}

function Cell({ label, value, tone }: { label: string; value: number; tone: string }) {
  const pop = usePop(value);
  const s = useAnimatedStyle(() => ({ transform: [{ scale: 0.7 + 0.3 * pop.value }] }));
  return (
    <View style={styles.cell}>
      <Animated.Text style={[styles.value, { color: tone }, s]}>{value}</Animated.Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    seat: { position: 'absolute' },
    body: { paddingHorizontal: space.lg, paddingVertical: space.sm, minWidth: 220, gap: space.xs },
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    kicker: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wider, textTransform: 'uppercase', color: color.gold },
    count: { fontFamily: font.display, fontSize: 16, color: color.silver, ...tabular },
    cells: { flexDirection: 'row', gap: space.lg },
    cell: { alignItems: 'center', minWidth: 48 },
    value: { fontFamily: font.display, fontSize: 34, lineHeight: 36, ...tabular },
    label: { fontFamily: font.label, fontSize: 11, letterSpacing: tracking.wide, textTransform: 'uppercase', color: color.textDim },
    split: { fontFamily: font.label, fontSize: 12, color: color.silver, letterSpacing: tracking.normal },
  }),
);
