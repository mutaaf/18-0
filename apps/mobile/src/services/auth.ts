import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';
import { resetAnalytics } from '@/features/analytics';
import { invalidateIdentity } from '@/features/cache';

/**
 * Optional sign-in, without losing what you have already played.
 *
 * Playing needs no account and never will — an anonymous account is created
 * behind the scenes the first time a ranked season is finished. Signing in is
 * an offer, not a gate: it is what makes a leaderboard entry survive losing the
 * phone.
 *
 * That shapes the whole implementation. The obvious call, signInWithIdToken,
 * returns a *different* user, and the anonymous account holding every ranked
 * season the player has already earned would be left behind with no way back to
 * it. So a player who is signed in anonymously gets linkIdentity, which attaches
 * the provider to the account that already exists and keeps its id — and the
 * leaderboard, which is keyed on that id, does not notice anything happened.
 */
export type SocialProvider = 'apple' | 'google';

const LABELS: Record<SocialProvider, string> = { apple: 'Apple', google: 'Google' };

export const providerLabel = (provider: SocialProvider): string => LABELS[provider];

/**
 * Which providers this build offers, from EXPO_PUBLIC_AUTH_PROVIDERS.
 *
 * Empty unless it is set, so the buttons do not exist until the provider
 * credentials are actually configured in the Supabase project. A sign-in button
 * that fails when tapped is worse than no sign-in button, and is the kind of
 * thing App Review taps first.
 *
 * App Store Guideline 4.8: an app offering any third-party sign-in must also
 * offer Sign in with Apple. Rather than trusting a deployment variable to get
 * that right, an Apple-less configuration is refused outright below.
 */
export const socialProviders: readonly SocialProvider[] = (() => {
  const raw = process.env.EXPO_PUBLIC_AUTH_PROVIDERS ?? '';
  const asked = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is SocialProvider => value === 'apple' || value === 'google');

  const unique = [...new Set(asked)];
  if (Platform.OS === 'ios' && unique.length > 0 && !unique.includes('apple')) {
    console.warn(
      '[auth] EXPO_PUBLIC_AUTH_PROVIDERS offers third-party sign-in without Apple, ' +
        'which App Store Guideline 4.8 does not allow. No providers will be shown.',
    );
    return [];
  }
  // Apple first, because on iOS it is the one that has to be at least as
  // prominent as the others.
  return unique.sort((a, b) => (a === 'apple' ? -1 : b === 'apple' ? 1 : 0));
})();

export const socialSignInAvailable = socialProviders.length > 0;

export interface SignInOutcome {
  readonly ok: boolean;
  /** True when the player closed the sheet themselves. Not worth an error message. */
  readonly cancelled?: boolean;
  /**
   * The provider is already attached to a different account.
   *
   * Ordinary, not exceptional: it happens to anyone who signs in on a second
   * device, because the anonymous account there is not the one that owns the
   * identity. Linking is correctly refused, and the useful next step is to sign
   * in to the account that does own it, which `signInWith(p, { switch: true })`
   * does.
   */
  readonly alreadyLinked?: boolean;
  readonly error?: string;
}

/**
 * Sign in with a provider, keeping the current account if there is one.
 *
 * The redirect comes back to the app's own scheme (`eighteenzero://`) on
 * native and to the page it started from on web. The code in that callback is
 * exchanged for a session here rather than by a deep-link handler somewhere
 * else, so the whole round trip is one awaited call and a caller can simply
 * refresh when it returns.
 */
export async function signInWith(
  provider: SocialProvider,
  { switchAccount = false }: { switchAccount?: boolean } = {},
): Promise<SignInOutcome> {
  if (!supabase) return { ok: false, error: 'backend_not_configured' };
  if (!socialProviders.includes(provider)) return { ok: false, error: 'provider_not_configured' };

  const redirectTo = Platform.OS === 'web' ? webRedirect() : Linking.createURL('auth-callback');

  // Declared out here so the catch below can explain the failure in the same
  // terms as the returns inside.
  let anonymous = false;

  try {
    const { data: auth } = await supabase.auth.getSession();
    // switchAccount means the player has been told the identity belongs to
    // another account and asked to be taken to it, so linking is not what they
    // want any more.
    anonymous = !switchAccount && auth.session?.user.is_anonymous === true;

    // Linking preserves the account id and everything hanging off it. Signing
    // in fresh is only right when there is nothing to preserve.
    const start = anonymous
      ? await supabase.auth.linkIdentity({
          provider,
          options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' },
        })
      : await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo, skipBrowserRedirect: Platform.OS !== 'web' },
        });

    if (start.error) return outcome(start.error.message, anonymous);

    // On web the call above navigates away and nothing after this runs.
    if (Platform.OS === 'web') return { ok: true };

    const url = start.data?.url;
    if (!url) return { ok: false, error: 'The sign-in page could not be opened.' };

    const result = await WebBrowser.openAuthSessionAsync(url, redirectTo);
    if (result.type !== 'success') return { ok: false, cancelled: true };

    const returned = new URL(result.url);
    const code = returned.searchParams.get('code');
    if (!code) {
      /**
       * The callback came back with a failure rather than a code.
       *
       * This is where both real sign-in failures actually surfaced, and it was
       * the one path that did not translate them: the provider's own words
       * went to the screen untouched, so a player read "Identity is already
       * linked to another user" and "Unable to exchange external code: c4e2"
       * with no idea what either meant or what to do. Supabase reports through
       * the redirect, not through the call, so this branch matters more than
       * the ones that already mapped.
       */
      const described =
        returned.searchParams.get('error_description') ??
        returned.searchParams.get('error') ??
        // Some providers answer in the fragment rather than the query.
        new URLSearchParams(returned.hash.replace(/^#/, '')).get('error_description');
      return described
        ? outcome(described, anonymous)
        : { ok: false, error: 'Sign-in did not complete.' };
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return outcome(error.message, anonymous);
    return { ok: true };
  } catch (cause) {
    // exchangeCodeForSession throws rather than returning for some failures,
    // and the raw text went straight to the screen: a player saw "Identity is
    // already linked to another user" with nothing to do about it.
    return outcome(cause instanceof Error ? cause.message : 'Sign-in failed.', anonymous);
  }
}

/**
 * Sign out, leaving the account where it is.
 *
 * Only ever offered on an account with a real identity attached. An anonymous
 * account has no credentials, so signing out of one does not release it, it
 * abandons it: there is no way back in, and every ranked season on it is
 * stranded. Deleting is the honest verb for that, and the panel already has it.
 */
export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut().catch(() => {});
  // The identity is cached to disk, so without this the next screen can still
  // paint the name of the account that just left.
  invalidateIdentity();
  // And the analytics identity, or the next person to use this device would be
  // filed under the account that just signed out.
  await resetAnalytics();
}

/**
 * The providers already attached to this account.
 *
 * Used to show what someone signed in with, and to keep them from unlinking the
 * only way they have of getting back in.
 */
export async function linkedProviders(): Promise<readonly SocialProvider[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error || !data) return [];
  return data.identities
    .map((identity) => identity.provider)
    .filter((p): p is SocialProvider => p === 'apple' || p === 'google');
}

function webRedirect(): string {
  const { origin, pathname } = globalThis.location;
  return `${origin}${pathname}`;
}

const ALREADY_LINKED = /already .*(linked|registered|exists)|identity_already_exists/i;

/** Turn a provider or Supabase message into something the panel can act on. */
function outcome(message: string, anonymous: boolean): SignInOutcome {
  if (ALREADY_LINKED.test(message)) {
    return {
      ok: false,
      alreadyLinked: true,
      error: 'That account is already signed in somewhere else.',
    };
  }
  return { ok: false, error: explain(message, anonymous) };
}

function explain(message: string, anonymous: boolean): string {
  // Apple's rejection of the client secret arrives as this, with a short code
  // that identifies the request and nothing about the cause. It always means
  // the secret is wrong or has expired -- Apple caps it at six months -- so say
  // so rather than repeating a string nobody can act on.
  if (/exchange external code|invalid_client/i.test(message)) {
    return 'Sign in with Apple is not set up correctly on the server yet.';
  }
  // Manual linking is off by default on a Supabase project, and the failure it
  // produces names an internal API rather than the setting.
  if (anonymous && /manual linking|identity_not_allowed|not enabled/i.test(message)) {
    return 'Signing in is not switched on for this build yet.';
  }
  if (/provider is not enabled/i.test(message)) {
    return 'That sign-in method is not switched on yet.';
  }
  return message;
}
