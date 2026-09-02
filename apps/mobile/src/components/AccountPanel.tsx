import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { track } from '@/features/telemetry';
import {
  linkedProviders,
  providerLabel,
  signInWith,
  socialProviders,
  socialSignInAvailable,
  type SocialProvider,
} from '@/services/auth';
import {
  canRenameNow,
  claimHandle,
  deleteAccount,
  handleProblem,
  identity,
  isBackendConfigured,
  type Identity,
} from '@/services/supabase';
import { color, font, radius, space, tracking, type PressState } from '@/theme';

/**
 * Your name on the board, and the way off it.
 *
 * Playing needs no account, so most people arrive here with an anonymous
 * identity they never chose. Claiming a name is the moment they ask to be
 * visible — and because that is also the moment an account starts to matter,
 * the way to delete it lives in the same panel rather than three levels into a
 * settings screen nobody opens.
 */
export function AccountPanel() {
  const [me, setMe] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(isBackendConfigured);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [linked, setLinked] = useState<readonly SocialProvider[]>([]);

  const refresh = useCallback(async () => {
    if (!isBackendConfigured) return;
    setLoading(true);
    setMe(await identity().catch(() => null));
    if (socialSignInAvailable) setLinked(await linkedProviders().catch(() => []));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!isBackendConfigured) return null;

  const claim = async () => {
    const problem = handleProblem(draft);
    if (problem) {
      setNote(problem);
      return;
    }
    setBusy(true);
    const result = await claimHandle(draft);
    setBusy(false);
    if (result.ok) {
      track('handle_claimed', {});
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setDraft('');
      setNote(null);
      setRenaming(false);
      await refresh();
    } else {
      setNote(result.error ?? 'That did not work.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  };

  const connect = async (provider: SocialProvider) => {
    setBusy(true);
    setNote(null);
    const result = await signInWith(provider);
    setBusy(false);
    // Closing the sheet is a decision, not a failure. Saying "sign-in did not
    // complete" to somebody who just changed their mind is noise.
    if (result.cancelled) return;
    if (result.ok) {
      track('signed_in', { provider });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await refresh();
    } else {
      setNote(result.error ?? 'Could not sign in.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  };

  const remove = async () => {
    setBusy(true);
    const result = await deleteAccount();
    setBusy(false);
    setConfirmingDelete(false);
    if (result.ok) {
      track('account_deleted', {});
      setMe(null);
      setNote('Account deleted. Your seasons on this device are untouched.');
    } else {
      setNote(result.error ?? 'Could not delete the account.');
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.label}>Your place on the board</Text>

      {loading ? (
        <ActivityIndicator color={color.textFaint} style={{ alignSelf: 'flex-start' }} />
      ) : me?.named && !renaming ? (
        <>
          <View style={styles.claimed}>
            <Text style={styles.handle}>{me.handle}</Text>
            {me.handleStatus !== 'ok' ? (
              <View style={styles.flag}>
                <Text style={styles.flagText}>
                  {me.handleStatus === 'hidden' ? 'Hidden from the board' : 'Under review'}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.copy}>
            Ranked seasons you finish appear under this name. Casual seasons never leave your
            device.
          </Text>
          {canRenameNow(me) ? (
            <Pressable
              onPress={() => {
                setDraft(me.handle ?? '');
                setNote(null);
                setRenaming(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Change my display name"
              style={styles.dangerLink}
            >
              <Text style={styles.subtleLink}>Change name</Text>
            </Pressable>
          ) : (
            // The date, not "in 12 days" — a countdown computed here would be
            // wrong the moment this screen is left open, and this panel is
            // rendered from a cache that can be hours old.
            <Text style={styles.cooldown}>
              Names can be changed once a month. Yours unlocks on{' '}
              {new Date(me.renameAvailableAt!).toLocaleDateString(undefined, {
                month: 'long',
                day: 'numeric',
              })}
              .
            </Text>
          )}
        </>
      ) : (
        <>
          <Text style={styles.copy}>
            {renaming
              ? 'Pick your new name. You can change it again in a month.'
              : 'Nothing you have played is on the board. Pick a name and your ranked seasons will be.'}
          </Text>
          <View style={styles.claimRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Choose a name"
              placeholderTextColor={color.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={32}
              style={styles.input}
              accessibilityLabel="Choose a display name"
              onSubmitEditing={claim}
            />
            <Pressable
              onPress={claim}
              disabled={busy || draft.trim().length < 2}
              accessibilityRole="button"
              accessibilityLabel="Claim this name"
              style={({ hovered, pressed }: PressState) => [
                styles.claimButton,
                hovered && { backgroundColor: color.redBright },
                (busy || draft.trim().length < 2) && styles.claimButtonMuted,
                pressed && { opacity: 0.85 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.claimLabel}>{renaming ? 'Save' : 'Claim'}</Text>
              )}
            </Pressable>
          </View>
          {renaming ? (
            <Pressable
              onPress={() => {
                setRenaming(false);
                setDraft('');
                setNote(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="Keep my current name"
              style={styles.dangerLink}
            >
              <Text style={styles.subtleLink}>Keep {me?.handle}</Text>
            </Pressable>
          ) : null}
        </>
      )}

      {note ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}

      {me && socialSignInAvailable ? (
        <View style={styles.signIn}>
          {linked.length > 0 ? (
            <Text style={styles.copy}>
              Signed in with {linked.map(providerLabel).join(' and ')}. Your name and your
              seasons come back on any device.
            </Text>
          ) : (
            <>
              <Text style={styles.copy}>
                Your seasons live on this device and this device only. Sign in and they
                follow you — nothing you have already played is lost.
              </Text>
              <View style={styles.providerRow}>
                {socialProviders.map((provider) => (
                  <Pressable
                    key={provider}
                    onPress={() => connect(provider)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Continue with ${providerLabel(provider)}`}
                    style={({ hovered, pressed }: PressState) => [
                      styles.provider,
                      hovered && styles.providerHover,
                      pressed && { opacity: 0.85 },
                      busy && { opacity: 0.6 },
                    ]}
                  >
                    <Text style={styles.providerLabel}>
                      Continue with {providerLabel(provider)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>
      ) : null}

      {me ? (
        <View style={styles.dangerZone}>
          {confirmingDelete ? (
            <>
              <Text style={styles.dangerCopy}>
                This deletes your account, your name, and every ranked season attached to it. It
                cannot be undone. Seasons saved on this device stay.
              </Text>
              <View style={styles.dangerRow}>
                <Pressable
                  onPress={remove}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Permanently delete my account"
                  style={({ pressed }: PressState) => [styles.dangerConfirm, pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.dangerConfirmLabel}>Delete permanently</Text>
                </Pressable>
                <Pressable
                  onPress={() => setConfirmingDelete(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Keep my account"
                  style={styles.dangerCancel}
                >
                  <Text style={styles.dangerCancelLabel}>Keep it</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Pressable
              onPress={() => setConfirmingDelete(true)}
              accessibilityRole="button"
              accessibilityLabel="Delete my account"
              style={styles.dangerLink}
            >
              <Text style={styles.dangerLinkLabel}>Delete my account</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#0A0E1799',
  },
  label: {
    fontFamily: font.label,
    fontSize: 10,
    letterSpacing: tracking.wider,
    textTransform: 'uppercase',
    color: color.textFaint,
  },
  claimed: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  handle: { fontFamily: font.heading, fontSize: 22, color: color.text, includeFontPadding: false },
  flag: {
    borderWidth: 1,
    borderColor: `${color.gold}66`,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  flagText: { fontFamily: font.label, fontSize: 9, letterSpacing: tracking.wide, color: color.gold },
  copy: { fontFamily: font.bodyRegular, fontSize: 13, lineHeight: 19, color: color.textFaint },

  claimRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  input: {
    flex: 1,
    minWidth: 0,
    height: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#0B0F18',
    color: color.text,
    fontFamily: font.bodyRegular,
    fontSize: 15,
  },
  claimButton: {
    height: 44,
    minWidth: 88,
    paddingHorizontal: space.lg,
    borderRadius: radius.sm,
    backgroundColor: color.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimButtonMuted: { backgroundColor: '#2A2F3C' },
  claimLabel: {
    fontFamily: font.label,
    fontSize: 13,
    letterSpacing: tracking.wide,
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },

  note: { fontFamily: font.bodyRegular, fontSize: 12, color: color.gold },
  subtleLink: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textDim, textDecorationLine: 'underline' },
  cooldown: { fontFamily: font.bodyRegular, fontSize: 12, lineHeight: 18, color: color.textFaint },

  signIn: { marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.line, gap: space.sm },
  providerRow: { gap: space.sm },
  provider: {
    height: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: '#0F1420',
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerHover: { borderColor: color.gold },
  providerLabel: {
    fontFamily: font.label,
    fontSize: 14,
    letterSpacing: tracking.wide,
    color: color.text,
    textTransform: 'uppercase',
  },

  dangerZone: { marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.line, gap: space.sm },
  dangerLink: { alignSelf: 'flex-start', paddingVertical: 4 },
  dangerLinkLabel: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textFaint, textDecorationLine: 'underline' },
  dangerCopy: { fontFamily: font.bodyRegular, fontSize: 12, lineHeight: 18, color: color.textDim },
  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dangerConfirm: {
    paddingHorizontal: space.lg,
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: color.negative,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerConfirmLabel: { fontFamily: font.label, fontSize: 12, letterSpacing: tracking.wide, color: color.negative },
  dangerCancel: { paddingHorizontal: space.md, height: 40, justifyContent: 'center' },
  dangerCancelLabel: { fontFamily: font.bodyRegular, fontSize: 13, color: color.textDim },
});
