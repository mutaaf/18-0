import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Linking from 'expo-linking';
import { PRIVACY_URL } from '@/features/links';
import { track } from '@/features/telemetry';
import { ManagerCard } from './ManagerCard';
import { ProviderButton } from './ProviderButton';
import { useHistoryStore } from '@/state/history';
import { careerReport } from '@/state/career';
import {
  consumeRedirectOutcome,
  consumeTransfer,
  linkedProviders,
  providerLabel,
  rememberTransfer,
  signInWith,
  signOut,
  socialProviders,
  socialSignInAvailable,
  type SocialProvider,
} from '@/services/auth';
import {
  canRenameNow,
  claimHandle,
  claimSeasonTransfer,
  deleteAccount,
  handleProblem,
  identity,
  isBackendConfigured,
  offerSeasonTransfer,
  transferableSeasons,
  type Identity,
} from '@/services/supabase';
import { color, font, radius, space, themed, tracking, type PressState } from '@/theme';

/**
 * Your name on the board, and the way off it.
 *
 * Playing needs no account, so most people arrive here with an anonymous
 * identity they never chose. Claiming a name is the moment they ask to be
 * visible — and because that is also the moment an account starts to matter,
 * the way to delete it lives in the same panel rather than three levels into a
 * settings screen nobody opens.
 */
export function AccountPanel({ rank }: { rank?: number | null } = {}) {
  const games = useHistoryStore((s) => s.games);
  // Memoised on the array itself, so this and the career panels below share one
  // walk of the history rather than each running their own.
  const career = careerReport(games);

  const [me, setMe] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(isBackendConfigured);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [linked, setLinked] = useState<readonly SocialProvider[]>([]);
  /** Set when a provider turns out to belong to a different account. */
  const [elsewhere, setElsewhere] = useState<SocialProvider | null>(null);
  /** How many ranked seasons this anonymous account could take with it. */
  const [carryable, setCarryable] = useState(0);

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

  // A web sign-in that failed reports itself by coming back as a URL, not by
  // returning -- so the page that arrives has to look. Without this the player
  // sees `?error=identity_already_exists` in the address bar and no prompt.
  useEffect(() => {
    const redirected = consumeRedirectOutcome();
    if (redirected) {
      if (redirected.alreadyLinked && redirected.provider) {
        setElsewhere(redirected.provider);
        // The offer is only worth making if there is something to bring, so
        // the count is fetched before the prompt is drawn rather than after
        // the player has been promised something.
        void transferableSeasons().then((t) => {
          if (t?.eligible) setCarryable(t.seasons);
        });
      }
      setNote(redirected.error ?? 'Sign-in did not complete.');
      return;
    }

    // A sign-in that succeeded may have a ticket waiting from the account it
    // left. Claimed here rather than inside `connect`, because on web the
    // navigation means `connect` never returns.
    const ticket = consumeTransfer();
    if (!ticket) return;
    void claimSeasonTransfer(ticket).then(async (moved) => {
      if (moved === null) {
        setNote('Those seasons could not be carried over.');
        return;
      }
      if (moved > 0) {
        setNote(`${moved} ${moved === 1 ? 'season' : 'seasons'} carried over.`);
        await refresh();
      }
    });
  }, [refresh]);

  const connect = async (provider: SocialProvider, switchAccount = false, carry = false) => {
    setBusy(true);
    setNote(null);
    setElsewhere(null);

    // Minted while the anonymous session is still the current one -- holding
    // it is the only proof of control there is, and signing in replaces it.
    // A ticket that is never claimed simply expires.
    if (carry) {
      const ticket = await offerSeasonTransfer();
      if (ticket) rememberTransfer(ticket);
    }

    const result = await signInWith(provider, { switchAccount });
    setBusy(false);
    // Closing the sheet is a decision, not a failure. Saying "sign-in did not
    // complete" to somebody who just changed their mind is noise.
    if (result.cancelled) return;
    if (result.ok) {
      track('signed_in', { provider, switched: switchAccount });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Native returns here; on web the page navigated and the effect above
      // does this instead.
      const ticket = consumeTransfer();
      if (ticket) {
        const moved = await claimSeasonTransfer(ticket);
        if (moved && moved > 0) {
          setNote(`${moved} ${moved === 1 ? 'season' : 'seasons'} carried over.`);
        }
      }
      await refresh();
      return;
    }
    // Not a dead end. This is what happens on a second device, and the useful
    // answer is to go to the account that owns the identity.
    if (result.alreadyLinked) setElsewhere(provider);
    setNote(result.error ?? 'Could not sign in.');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  };

  const leave = async () => {
    setBusy(true);
    await signOut();
    setBusy(false);
    setLinked([]);
    setElsewhere(null);
    setNote('Signed out. Your seasons are still on the account you signed in with.');
    await refresh();
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
      <ManagerCard identity={me} career={career} providers={linked} rank={rank} />

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
            {/* A player who has finished a ranked season IS on the board, under
                the generated placeholder. Telling them nothing they have played
                is on it contradicts the rank shown directly above and reads as
                the app having lost their seasons. */}
            {renaming
              ? 'Pick your new name. You can change it again in a month.'
              : rank
                ? `You are #${rank} as ${me?.handle}. Pick a name to replace it.`
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
                hovered && { backgroundColor: color.actionBright },
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

      {elsewhere ? (
        <>
          <Text style={styles.copy}>
            Your {providerLabel(elsewhere)} account already has seasons on it. Signing in takes
            you to that one.
            {carryable > 0
              ? ` Your ${carryable} ranked ${carryable === 1 ? 'season' : 'seasons'} from this device can come with you.`
              : ' Anything played on this device stays here.'}
          </Text>
          <Pressable
            onPress={() => connect(elsewhere, true, carryable > 0)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Sign in to the existing ${providerLabel(elsewhere)} account`}
            style={({ hovered, pressed }: PressState) => [
              styles.claimButton,
              hovered && { backgroundColor: color.actionBright },
              pressed && { opacity: 0.85 },
              busy && styles.claimButtonMuted,
            ]}
          >
            <Text style={styles.claimLabel}>
              {carryable > 0 ? 'Use that account and bring my seasons' : 'Use that account'}
            </Text>
          </Pressable>
        </>
      ) : null}

      {/* Not gated on having an account. Signing in is how a season reaches
          the board at all now, and requiring a ranked game first meant the
          card said "this device only" with nothing on screen to change it.
          With no session to preserve, signInWith() simply creates one. */}
      {socialSignInAvailable ? (
        <View style={styles.signIn}>
          {linked.length > 0 ? (
            <>
              <Text style={styles.copy}>
                Signed in with {linked.map(providerLabel).join(' and ')}. Your name and your
                seasons come back on any device.
              </Text>
              {/* Only offered here. Signing out of an anonymous account would
                  abandon it rather than release it, because there is nothing to
                  sign back in with. */}
              <Pressable
                onPress={leave}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                style={styles.dangerLink}
              >
                <Text style={styles.subtleLink}>Sign out</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.copy}>
                Your seasons live on this device and this device only. Sign in and they
                follow you — nothing you have already played is lost.
              </Text>
              <View style={styles.providerRow}>
                {socialProviders.map((provider) => (
                  <ProviderButton
                    key={provider}
                    provider={provider}
                    disabled={busy}
                    onPress={() => connect(provider)}
                  />
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

      {/* Reachable from inside the app, not only from the store listing. It is
          the page that says what leaving your name on the board actually
          costs, so it belongs next to the thing that asks for it. */}
      <Pressable
        onPress={() => void Linking.openURL(PRIVACY_URL)}
        accessibilityRole="link"
        accessibilityLabel="Read the privacy policy"
        style={styles.dangerLink}
      >
        <Text style={styles.dangerLinkLabel}>Privacy</Text>
      </Pressable>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  panel: {
    gap: space.sm,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: `${color.ink}99`,
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
    backgroundColor: color.ink,
    color: color.text,
    fontFamily: font.bodyRegular,
    fontSize: 15,
  },
  claimButton: {
    height: 44,
    minWidth: 88,
    paddingHorizontal: space.lg,
    borderRadius: radius.sm,
    backgroundColor: color.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimButtonMuted: { backgroundColor: color.surfaceHigh },
  claimLabel: {
    fontFamily: font.label,
    fontSize: 13,
    letterSpacing: tracking.wide,
    color: color.onAction,
    textTransform: 'uppercase',
  },

  note: { fontFamily: font.bodyRegular, fontSize: 12, color: color.gold },
  subtleLink: { fontFamily: font.bodyRegular, fontSize: 12, color: color.textDim, textDecorationLine: 'underline' },
  cooldown: { fontFamily: font.bodyRegular, fontSize: 12, lineHeight: 18, color: color.textFaint },

  signIn: { marginTop: space.sm, paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.line, gap: space.sm },
  providerRow: { gap: space.sm },

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
}));
