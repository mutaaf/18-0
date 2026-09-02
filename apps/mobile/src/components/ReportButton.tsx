import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  REPORT_REASONS,
  isBackendConfigured,
  reportHandle,
  type ReportReason,
} from '@/services/supabase';
import { color, font, radius, space, tracking, type PressState } from '@/theme';

/**
 * Reporting a name on the leaderboard.
 *
 * Deliberately quiet — a flag on every row, not a button competing with the
 * score. It is there because App Store Review Guideline 1.2 requires a way to
 * report user-generated content, and because the only such content here is a
 * display name, this is the whole of that surface.
 *
 * Reporting is idempotent by design: the database keeps one open report per
 * person per handle, so a second tap says thank you rather than piling on.
 */
export function ReportButton({ userId, handle }: { userId: string; handle: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isBackendConfigured) return null;

  const submit = async (reason: ReportReason) => {
    setBusy(true);
    const result = await reportHandle(userId, handle, reason);
    setBusy(false);
    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDone(true);
    } else {
      setError(result.error ?? 'Could not send that.');
    }
  };

  const close = () => {
    setOpen(false);
    setError(null);
    // `done` is intentionally sticky: the flag stays marked for the session so
    // a player is not left wondering whether the report went anywhere.
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={done ? `Already reported ${handle}` : `Report ${handle}`}
        hitSlop={8}
        style={({ hovered }: PressState) => [styles.flag, hovered && { opacity: 1 }]}
      >
        <Text style={[styles.flagGlyph, done && { color: color.gold }]}>⚑</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Dismiss">
          {/* Stops a tap inside the sheet from closing it. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            {done ? (
              <>
                <Text style={styles.title}>Thanks — that's logged</Text>
                <Text style={styles.copy}>
                  A name that enough people report comes off the board while it is reviewed.
                </Text>
                <Pressable onPress={close} style={styles.doneButton} accessibilityRole="button">
                  <Text style={styles.doneLabel}>Close</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.title}>Report “{handle}”</Text>
                <Text style={styles.copy}>What's wrong with this name?</Text>
                {REPORT_REASONS.map((reason) => (
                  <Pressable
                    key={reason.value}
                    onPress={() => submit(reason.value)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={reason.label}
                    style={({ hovered, pressed }: PressState) => [
                      styles.reason,
                      hovered && { borderColor: color.lineBright },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={styles.reasonLabel}>{reason.label}</Text>
                  </Pressable>
                ))}
                {busy ? <ActivityIndicator color={color.textFaint} /> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Pressable onPress={close} style={styles.cancel} accessibilityRole="button">
                  <Text style={styles.cancelLabel}>Cancel</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flag: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', opacity: 0.4 },
  flagGlyph: { fontSize: 13, color: color.textFaint },

  backdrop: {
    flex: 1,
    backgroundColor: '#04060BCC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 380,
    gap: space.sm,
    padding: space.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  title: { fontFamily: font.heading, fontSize: 20, color: color.text, includeFontPadding: false },
  copy: { fontFamily: font.bodyRegular, fontSize: 13, lineHeight: 19, color: color.textFaint },

  reason: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#0B0F18',
  },
  reasonLabel: { fontFamily: font.bodyRegular, fontSize: 14, color: color.text },

  error: { fontFamily: font.bodyRegular, fontSize: 12, color: color.negative },

  doneButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: color.red,
    marginTop: space.sm,
  },
  doneLabel: {
    fontFamily: font.label,
    fontSize: 13,
    letterSpacing: tracking.wide,
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  cancel: { minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  cancelLabel: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim },
});
