# Turning on social sign-in

The code is written and inert. `src/services/auth.ts` and the buttons in
`AccountPanel` do nothing until `EXPO_PUBLIC_AUTH_PROVIDERS` is set, and that
variable is deliberately not set anywhere yet, because a sign-in button that
fails when tapped is worse than no sign-in button — and is the first thing App
Review taps.

**Both providers are configured and answering.** `/auth/v1/authorize?provider=apple`
and `?provider=google` each redirect to the right consent page with the right
client id. What has *not* been exercised is a real human completing a sign-in,
and in particular the linking path that keeps an anonymous player's ranked
history. That is the one test that matters; see the end of this file.

## Two identifier traps, both live in this project

**The team that owns the key is `Z73865R687`, not `95988FTS33`.** The second one
is in `ios-device.sh` and is the free personal team used to sign local device
builds. Apple signs the client secret with the team that owns the key, and using
the wrong one fails as `invalid_client`, which says nothing about which of the
two identifiers was wrong.

**The bundle identifier does not match the registered App ID.** `app.config.js`
says `com.eighteenzero.app`. The App ID registered under this team, and the one
the Services ID points at, is `com.eighteenzerodcai.app`. Sign-in is unaffected,
because the web flow presents the Services ID rather than the bundle. It will
matter at submission, when the binary's bundle id has to match a registered App
ID. Decide which one is real and make them agree before then.

## What the code already decides for you

- **Signing in never costs a player their history.** An anonymous account that
  has finished ranked seasons is *linked* to the provider (`linkIdentity`), not
  replaced. The account id survives, so leaderboard rows — which are keyed on it
  — carry over untouched. Using `signInWithIdToken` here would silently strand
  every season the player had already earned, which is the trap this is written
  to avoid.
- **Apple is enforced, not assumed.** App Store Guideline 4.8 requires Sign in
  with Apple wherever another third-party sign-in is offered. If the variable
  lists Google without Apple, iOS shows *no* providers at all and logs why,
  rather than shipping a build that gets rejected.
- **Playing still needs no account.** Sign-in is an offer on the account panel.
  Nothing gates on it, and Guideline 5.1.1(v) account deletion already exists.

## 1. Supabase

**Already done, on the hosted project:**

- **Manual linking is on.** Without it `linkIdentity` fails and the error names
  an internal API rather than the setting.
- **Redirect URLs are set**: `eighteenzero://auth-callback` (the native deep
  link, scheme from `app.config.js`), the deployed web build, and localhost for
  web development.
- **Anonymous sign-ins are capped at 1000/hour/IP** rather than the default 30,
  which mobile carrier NAT would have hit on its own.

The providers themselves are what `scripts/social-setup.sh` fills in, from the
credentials in the two sections below.

## 2. Apple

In the [Apple Developer](https://developer.apple.com/account/resources)
account:

1. **Identifiers → App IDs** — on the `com.eighteenzero.app` App ID, enable the
   **Sign In with Apple** capability.
2. **Identifiers → Services IDs** — `com.eighteenzerodcai.app.web` ("18-0 web")
   exists and is configured. This is the OAuth client id, and it is *not* the
   same string as the App ID:
   - Domain: `keqwdtnyotdovrtcswel.supabase.co`
   - Return URL: `https://keqwdtnyotdovrtcswel.supabase.co/auth/v1/callback`

   Registering the URLs is two steps, and the first one on its own looks like it
   worked: the domain and return URL are added to the *team*, and then have to be
   selected from the picker to attach them to this Services ID. The row reads
   "(2 Website URLs)" when it is actually done.
3. **Keys** — create a key with **Sign In with Apple** enabled and download the
   `.p8`. It downloads once and cannot be retrieved again.
4. In Supabase, the Apple provider wants the Services ID, the Team ID, the Key
   ID, and the contents of the `.p8`.

Apple's client secret is a JWT that **expires after at most six months**.
Supabase generates it from the key, so this does not need doing by hand, but it
is the part of this setup most likely to break quietly later. It is worth a
calendar reminder.

## 3. Google

Done. Project **18-0** (`eighteen-zero-game`), separate from CourtIQ because a
Cloud project has one consent screen, and players signing into 18-0 would
otherwise have seen "CourtIQ" on the permission dialog.

- Consent screen: External, **In production**. An External app starts in
  *Testing*, where only listed test users can sign in at all, so leaving it there
  would have looked like a broken login for everyone else.
- Branding carries the home page, the privacy policy at
  `digitalcraftai.com/privacy`, and all three authorized domains. Publishing is
  blocked until those are filled in.
- OAuth client: **Web application**, redirect
  `https://keqwdtnyotdovrtcswel.supabase.co/auth/v1/callback`. Web is the right
  kind even for the native app, because the round trip goes through Supabase,
  which is a web origin, rather than through Google's native SDK.
- No sensitive scopes, so no Google verification is required.

## 4. Switch it on

Do not do this by hand. Fill in `.local/social.env` (copy the `.example`) and run:

```
scripts/social-setup.sh
```

It reads the credentials and the `.p8` straight from that gitignored file,
configures the hosted project, reads the settings back to prove they landed, and
only then turns the buttons on: `EXPO_PUBLIC_AUTH_PROVIDERS` in
`apps/mobile/.env` and the `AUTH_PROVIDERS` repository variable that
`pages.yml` reads for the web build.

The ordering is the point. While that variable is empty the app shows no
sign-in buttons at all, so a half-configured provider cannot reach a user, or a
reviewer.

Nothing is echoed by the script. A private key that has been printed to a
terminal lives in a scrollback buffer and a session log afterwards, and should
be rotated rather than trusted.

## 5. Check it actually works

Not a substitute for trying it, but the things that will be wrong:

- Sign in on a **fresh anonymous account that has already finished a ranked
  season**, and confirm the leaderboard entry is still yours afterwards. This is
  the whole point of the linking path and the only way to catch it silently
  regressing to a new account.
- Sign in on the same provider from a **second device** and confirm you get the
  same name and history.
- Cancel the sheet halfway. It should return you to the panel with no error.
- Try Google on an iOS build with `EXPO_PUBLIC_AUTH_PROVIDERS=google` alone and
  confirm no buttons appear at all — that is Guideline 4.8 being enforced.

## Before submission

- The privacy policy at `apps/mobile/public/privacy.html` still has a
  placeholder contact address, and describes an app that collects no email
  address. Signing in with a provider changes that: Apple and Google return an
  email (Apple's may be a private relay address). **The policy needs updating to
  say so** before any build with sign-in enabled goes to review.
- App Store Connect's App Privacy answers need the same change.
