import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';
import { resetAnalytics } from '@/features/analytics';
import { clearReminders } from '@/features/reminders';
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

    // On web the calls below navigate away, and the failure comes back as
    // query parameters on the redirect rather than as a return value -- so the
    // attempt has to leave a note for the page that comes back. Session
    // storage, not local: an abandoned attempt should not outlive the tab.
    rememberAttempt(provider, anonymous);

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
  // A streak reminder is about one account's streak. Leaving it scheduled
  // would tell the next person on this device to protect somebody else's.
  await clearReminders();
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


/**
 * What the browser was in the middle of when it navigated away.
 *
 * Web OAuth is not a function call -- it is a page leaving and a different page
 * arriving. Everything the failure handler needs to know (which provider, and
 * whether it was a link or a fresh sign-in) is in the frame that no longer
 * exists, so it is written down before the navigation and read back after.
 */
const ATTEMPT = '18-0:auth:attempt';

function rememberAttempt(provider: SocialProvider, anonymous: boolean): void {
  if (Platform.OS !== 'web' || typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(ATTEMPT, `${provider}:${anonymous ? 'link' : 'fresh'}`);
  } catch {
    // Private browsing refuses. The outcome is a slightly vaguer message.
  }
}

/**
 * The result of a redirect sign-in, if this page load is one.
 *
 * **This is the fix for a sign-in that had no way out.** On web, `linkIdentity`
 * navigates away, and when the identity already belongs to another account
 * Supabase reports it by redirecting back with `?error=...` -- not by throwing,
 * and not by returning. Nothing read those parameters, so the player landed on
 * `/account?error=server_error&error_code=identity_already_exists&...`, saw a
 * raw URL, and had no prompt offering the one thing that works: signing in to
 * the account that owns the identity.
 *
 * Returns null on an ordinary page load. Clears the parameters either way, so a
 * reload or a back-navigation does not re-report a failure that has been dealt
 * with.
 */
export function consumeRedirectOutcome():
  | (SignInOutcome & { provider?: SocialProvider })
  | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;

  const here = new URL(window.location.href);
  const query = here.searchParams;
  // Supabase answers in the fragment as well as the query, and which one
  // carries the description varies by provider.
  const fragment = new URLSearchParams(here.hash.replace(/^#/, ''));

  const described =
    query.get('error_description') ??
    fragment.get('error_description') ??
    query.get('error') ??
    fragment.get('error');

  const attempt = readAttempt();
  if (!described) return null;

  window.history.replaceState(null, '', here.pathname);

  return {
    ...outcome(described, attempt?.anonymous ?? true),
    ...(attempt ? { provider: attempt.provider } : {}),
  };
}

function readAttempt(): { provider: SocialProvider; anonymous: boolean } | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ATTEMPT);
    sessionStorage.removeItem(ATTEMPT);
    if (!raw) return null;
    const [provider, mode] = raw.split(':');
    if (provider !== 'apple' && provider !== 'google') return null;
    return { provider, anonymous: mode === 'link' };
  } catch {
    return null;
  }
}


/**
 * A pending season transfer, across the navigation that signs you in.
 *
 * Same problem as the attempt above and the same answer: the ticket is minted
 * by a session that is about to be replaced, and the page that comes back has
 * to know about it. Session storage on web; on native the process survives, but
 * it is written down anyway so one code path covers both.
 */
const TICKET = '18-0:auth:ticket';

export function rememberTransfer(ticket: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(TICKET, ticket);
  } catch {
    // Private browsing refuses; the seasons simply stay where they are.
  }
}

/** The ticket to claim, if a transfer was offered before this sign-in. */
export function consumeTransfer(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const ticket = sessionStorage.getItem(TICKET);
    sessionStorage.removeItem(TICKET);
    return ticket;
  } catch {
    return null;
  }
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
