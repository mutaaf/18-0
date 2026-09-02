import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

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
export async function signInWith(provider: SocialProvider): Promise<SignInOutcome> {
  if (!supabase) return { ok: false, error: 'backend_not_configured' };
  if (!socialProviders.includes(provider)) return { ok: false, error: 'provider_not_configured' };

  const redirectTo = Platform.OS === 'web' ? webRedirect() : Linking.createURL('auth-callback');

  try {
    const { data: auth } = await supabase.auth.getSession();
    const anonymous = auth.session?.user.is_anonymous === true;

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

    if (start.error) return { ok: false, error: explain(start.error.message, anonymous) };

    // On web the call above navigates away and nothing after this runs.
    if (Platform.OS === 'web') return { ok: true };

    const url = start.data?.url;
    if (!url) return { ok: false, error: 'The sign-in page could not be opened.' };

    const result = await WebBrowser.openAuthSessionAsync(url, redirectTo);
    if (result.type !== 'success') return { ok: false, cancelled: true };

    const code = new URL(result.url).searchParams.get('code');
    if (!code) {
      // An error here is the provider's, and its text is meant for the person
      // who caused it — pass it through rather than inventing one.
      const described = new URL(result.url).searchParams.get('error_description');
      return { ok: false, error: described ?? 'Sign-in did not complete.' };
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return { ok: false, error: explain(error.message, anonymous) };
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Sign-in failed.' };
  }
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

function explain(message: string, anonymous: boolean): string {
  // Manual linking is off by default on a Supabase project, and the failure it
  // produces names an internal API rather than the setting.
  if (anonymous && /manual linking|identity_not_allowed|not enabled/i.test(message)) {
    return 'Signing in is not switched on for this build yet.';
  }
  if (/provider is not enabled/i.test(message)) {
    return 'That sign-in method is not switched on yet.';
  }
  // An already-claimed identity is the one genuinely interesting case: the
  // provider belongs to another account, so linking it would silently merge two
  // leaderboard histories or throw one away.
  if (/already (been )?(registered|linked|exists)|identity_already_exists/i.test(message)) {
    return 'That account is already signed in on another profile.';
  }
  return message;
}
