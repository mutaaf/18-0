# Turning on social sign-in

The code is written and inert. `src/services/auth.ts` and the buttons in
`AccountPanel` do nothing until `EXPO_PUBLIC_AUTH_PROVIDERS` is set, and that
variable is deliberately not set anywhere yet, because a sign-in button that
fails when tapped is worse than no sign-in button — and is the first thing App
Review taps.

**None of this has been exercised against a real Apple or Google project.** The
flow is written to Supabase's documented behaviour; nobody has watched it work.
Treat the first run as a test, not a deployment.

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
2. **Identifiers → Services IDs** — create one (for example
   `com.eighteenzero.app.web`). This is the OAuth client id, and it is *not* the
   same string as the App ID. Configure it with:
   - Domain: `keqwdtnyotdovrtcswel.supabase.co`
   - Return URL: `https://keqwdtnyotdovrtcswel.supabase.co/auth/v1/callback`
3. **Keys** — create a key with **Sign In with Apple** enabled and download the
   `.p8`. It downloads once and cannot be retrieved again.
4. In Supabase, the Apple provider wants the Services ID, the Team ID, the Key
   ID, and the contents of the `.p8`.

Apple's client secret is a JWT that **expires after at most six months**.
Supabase generates it from the key, so this does not need doing by hand, but it
is the part of this setup most likely to break quietly later. It is worth a
calendar reminder.

## 3. Google

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials):

1. Configure the OAuth consent screen. External, and it can stay in *Testing*
   while you try this; it must be **published** before Play review.
2. Create an **OAuth client ID → Web application**. Authorised redirect URI:
   `https://keqwdtnyotdovrtcswel.supabase.co/auth/v1/callback`
3. Paste the client id and secret into Supabase's Google provider.

A Web client is the right kind even for the native app: the round trip goes
through Supabase, which is a web origin, and not through Google's native SDK.

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
