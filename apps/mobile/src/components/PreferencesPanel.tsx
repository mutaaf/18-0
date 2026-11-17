import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/Pressable';
import { GlassSurface } from './GlassSurface';
import { ThemePicker } from './ThemePicker';
import { reminderState, setReminders, type ReminderState } from '@/features/reminders';
import { setUsageStats, usageStatsOn, usageStatsSupported } from '@/features/boxoffice';
import { color, font, radius, space, themed, tracking, type PressState } from '@/theme';
import { isTV } from '@/features/tv/platform';

/**
 * The things a player is actually allowed to change.
 *
 * Deliberately short. Every row here moves something that already exists --
 * the palette the whole app is painted in, whether the one notification
 * this game sends is sent, and (on iPhone) whether usage counts are shared.
 * A settings screen fills up with switches that
 * describe intentions rather than control anything, and the way to not have
 * that screen is to refuse the first one.
 */
export function PreferencesPanel() {
  const [reminders, setState] = useState<ReminderState | null>(null);
  const [busy, setBusy] = useState(false);
  // null until read; the row only exists where the app shares anything (iOS).
  const [usage, setUsage] = useState<boolean | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void reminderState().then((state) => alive && setState(state));
    if (usageStatsSupported) void usageStatsOn().then((v) => alive && setUsage(v));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (busy || reminders === null) return;
    setBusy(true);
    // The resolved state, not the requested one: declining the system prompt
    // leaves the switch off, and a switch that has already animated on is a
    // switch that is lying about what the app can do.
    setState(await setReminders(reminders !== 'on'));
    setBusy(false);
  }, [busy, reminders]);

  const toggleUsage = useCallback(async () => {
    if (usageBusy || usage === null) return;
    setUsageBusy(true);
    setUsage(await setUsageStats(!usage));
    setUsageBusy(false);
  }, [usageBusy, usage]);

  return (
    <GlassSurface round={0.04} maxRound={radius.lg} style={styles.panel}>
      <Text style={styles.eyebrow}>Preferences</Text>

      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>Streak reminders</Text>
          <Text style={styles.rowCopy}>{explain(reminders)}</Text>
        </View>
        {reminders === null ? (
          <ActivityIndicator color={color.textFaint} />
        ) : reminders === 'unsupported' || reminders === 'blocked' ? null : (
          <Toggle label="Streak reminders" on={reminders === 'on'} busy={busy} onPress={toggle} />
        )}
      </View>

      {/* Box Office usage events (features/boxoffice.ios.ts). Off deletes the
          queue and the install id; nothing else in the app reads this. */}
      {usageStatsSupported && usage !== null ? (
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Share usage stats</Text>
            <Text style={styles.rowCopy}>
              {usage
                ? 'A few counts, like a season started or how it ended, with a random id made on this phone. No name, roster, location or advertising id.'
                : 'Off. Nothing is sent, and the random id is deleted.'}
            </Text>
          </View>
          <Toggle label="Share usage stats" on={usage} busy={usageBusy} onPress={toggleUsage} />
        </View>
      ) : null}

      {/* Renders nothing until `theme_picker` is rolled out, which is why the
          divider belongs to it rather than sitting above it. */}
      <ThemePicker />
    </GlassSurface>
  );
}

/**
 * A switch.
 *
 * No animation: this one flips on the result of an async round trip through the
 * operating system, and a knob that slides on press and then slides back
 * because permission was declined is worse than a knob that simply moves when
 * the answer arrives.
 */
function Toggle({ label, on, busy, onPress }: { label: string; on: boolean; busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: busy }}
      accessibilityLabel={label}
      style={({ hovered, pressed }: PressState) => [
        styles.track,
        on && styles.trackOn,
        hovered && !on && { borderColor: color.lineBright },
        (pressed || busy) && { opacity: 0.8 },
      ]}
    >
      <View style={[styles.knob, on && styles.knobOn]} />
    </Pressable>
  );
}

function explain(state: ReminderState | null): string {
  switch (state) {
    case 'on':
      return 'One notification, three hours before a streak would end. Nothing else.';
    case 'off':
      return 'Off. A streak can end without anything telling you.';
    case 'blocked':
      return 'Turned off for 17-0 in your device settings. Only Settings can turn it back on.';
    case 'unsupported':
      return isTV
        ? 'Not on Apple TV, which has nowhere to show one. The app on a phone can remind you.'
        : 'Not available in a browser. Install the app to get one.';
    default:
      return 'Checking…';
  }
}

const styles = themed(() => StyleSheet.create({
  panel: { padding: space.lg, gap: space.md },
  eyebrow: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontFamily: font.bodyBold, fontSize: 15, color: color.text },
  rowCopy: { fontFamily: font.bodyRegular, fontSize: 11, lineHeight: 16, color: color.textFaint },

  track: {
    width: 50,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#FFFFFF0A',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  trackOn: { borderColor: color.gold, backgroundColor: `${color.gold}2E` },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: color.textFaint, alignSelf: 'flex-start' },
  knobOn: { backgroundColor: color.gold, alignSelf: 'flex-end' },
}));
