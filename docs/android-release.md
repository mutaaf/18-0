# Getting onto Google Play

[`submission.md`](submission.md) has the store answers and the iOS build. This
is the other half: how the Android binary gets to Google, and what has to
happen in a browser before any of it can be automated.

The order below is not a preference. Each step is blocked by the one above it,
and Play does not say so until you are already in the step that fails.

## Where this stands, 4 September 2026

A developer account exists.

| | |
|---|---|
| Account type | Personal |
| Name | Mutaaf Aziz |
| Account ID | `8415004055631614600` |
| Registration fee | paid |
| Identity verification | passed |
| Package name | `com.eighteenzerodcai.app` |

**`Create app` is still greyed out.** The console says "Complete account
verifications to create new apps". So there is no app record, no listing draft,
no track, and no upload of any kind is possible yet — not by hand, not by API.
Everything downstream of the app record is written here because it is known,
not because it has been done.

The only Android artifact this project has ever produced is
`android/app/build/outputs/apk/release/app-release.apk`. It cannot be used, for
three separate reasons, each of which is on its own fatal:

- it is signed with the Expo template `debug.keystore`, which Play rejects
- it is an APK, and Play takes an AAB for a new app
- it carries `com.eighteenzero.app`, the applicationId from before 3 September

The third one is the interesting one. `android/` is prebuild output and
gitignored, and `expo run:android` does not regenerate a tree that already
exists — so when the identifier changed, `ios/` was hand-edited and `android/`
was left alone. That APK is what a stale prebuild looks like. `pnpm
verify:native` exists because of it, and it is the check to run on the machine
that cuts the release.

## The two verifications, which only a person can do

Both live under Play Console → your account → account verifications. They are
ordered, and the second one enforces the order.

**1. Verify that you have access to an Android mobile device.** This means
installing the Play Console app on a real Android phone and signing into it
with this account. An emulator does not satisfy it. There is no way to do this
from a desktop browser, and no way to do it from a Mac.

**2. Verify your contact phone number.** SMS or a call with a code. The page
says "Before you can verify your contact phone number, you must complete all
other verification tasks", and the button is greyed out until the device check
passes. Doing this one first is not an option, so borrowing a phone for ten
minutes settles both in one sitting.

Until both are green, the rest of this document is unreachable. That is the
whole blocker.

## Creating the app record, and the first upload by hand

Once `Create app` unlocks: create the app, set the package name to
`com.eighteenzerodcai.app`, and fill the listing.

Nothing here needs to be written. It already exists:

| What | Where |
|---|---|
| Name, short description, full description | [`submission.md`](submission.md) → Store listing |
| Phone screenshots, 1080x1920 | `apps/mobile/assets/store/screenshots/play-phone/` |
| Feature graphic, 1024x500 | `apps/mobile/assets/store/play-feature-graphic.png` |
| Data safety answers | [`submission.md`](submission.md) → Google Play — Data safety |
| Content rating (IARC) answers | [`submission.md`](submission.md) → Google Play — Content rating |
| Privacy policy URL | `https://18-0.co/privacy` — see [`hosting.md`](hosting.md) |

**The first release has to be uploaded through the console by hand.** The Play
Developer API will not accept an upload for a package that has never had one,
and this is the single most common surprise when automating Play. `eas submit`
does not fail with "this app has no releases"; it fails with a permissions or
"application not found" error that reads like the service account is wrong, and
the hours go into re-checking the service account instead. Upload one AAB to
the internal testing track in the browser, then automate.

The AAB comes from EAS:

```bash
cd apps/mobile
eas build --platform android --profile production --non-interactive --no-wait
```

`production` has no `buildType` override, so it produces an AAB. (`preview`
sets `"buildType": "apk"` on purpose — that profile is for installing on a
device, not for Play.)

**`versionCode` is automatic, and it did not used to be.** EAS holds the
number (`cli.appVersionSource: "remote"`) and raises it on every production
build, per platform. That is worth knowing because the obvious setting,
`autoIncrement` against a local version source, cannot work here at all: it
writes to `app.json` and this project's config is a dynamic `app.config.js`.
The stopgap was an `EXPO_BUILD_NUMBER` read from the environment, which meant
remembering to raise it by hand -- and Play, like App Store Connect, rejects a
number it has already seen, so forgetting produced a failed upload rather than
a warning. `app.config.js` now sets no `versionCode` at all, deliberately.

## Signing, and the distinction that matters later

Let EAS generate and hold the upload keystore. Play App Signing then takes the
uploaded bundle, strips the upload signature, and re-signs it with the key that
devices actually verify.

These are two different keys and the difference is the whole point:

| | Upload key | App signing key |
|---|---|---|
| Held by | EAS (or you) | Google |
| Proves | this upload came from us | this app is that app, on every device |
| If lost | ask Play support to register a new one; releases continue | without Play App Signing, the app can never be updated again |

Losing the upload key is an inconvenience. Losing an app signing key you held
yourself is terminal — the package name is burned and existing installs can
never receive another update. Opting into Play App Signing means that key is
Google's problem, permanently, and it cannot be opted out of afterwards.

## The service account, for automated submission

This is what lets a machine upload without a browser. Play Console → Setup →
API access.

1. Link a Google Cloud project (or create one from that page).
2. In Google Cloud, create a service account.
3. Back in Play Console, grant it a role with release permissions —
   **Release manager**, or an equivalent custom role with access to the app.
4. In Google Cloud, create a JSON key for it and download it.

That JSON is a Google private key. It goes in exactly two places:

| Where | Name |
|---|---|
| GitHub repository secret | `PLAY_SERVICE_ACCOUNT_JSON` |
| The release machine | `apps/mobile/play-service-account.json` |

The local path is gitignored (`.gitignore`, `apps/mobile/play-service-account.json`).
That rule is new. Before it, nothing stopped the file being committed, and a
committed Google private key is a credential rotation, not an amended commit.

`eas.json` is already pointed at it and needs no change:

```json
"android": {
  "serviceAccountKeyPath": "./play-service-account.json",
  "track": "internal"
}
```

Grants through the Play Console take a little while to propagate. A submission
that fails minutes after the role is granted is worth retrying before it is
worth debugging.

## What the automation then does

With the app record created, one release uploaded by hand, and the service
account in place, a release is two commands:

```bash
cd apps/mobile
eas build  --platform android --profile production --non-interactive --no-wait
eas submit --platform android --profile production --latest --non-interactive
```

`--latest` picks up the finished build, so the two can be separate CI steps or
separate jobs. The submission lands on the **internal** track, which is a
deliberate stopping point: nothing reaches the public without someone promoting
it in the console. Widening that means changing `track` in `eas.json`, and it
should be a change somebody argues for.

There is no release workflow in `.github/workflows/` yet — `ci.yml` and
`pages.yml` are all there is. `PLAY_SERVICE_ACCOUNT_JSON` is named here so the
secret and the workflow are added in the same pass, once there is an app to
submit to.

Before any of this, the checks in [`submission.md`](submission.md) → "Before the
build goes up" still apply, `pnpm verify:native` in particular. It is the one
that would have caught the stale `android/` tree.

## Still open

- **Both verifications.** Nothing else can start.
- **Player photographs.** `packages/data/src/headshots.ts` hot-links images
  that are not ours to redistribute. Same blocker as iOS, and it blocks a
  public track rather than an internal one. See
  [`submission.md`](submission.md) → Still open.
- **No release workflow.** Written as commands here, not yet as CI.
- **Nothing has ever been submitted to Play.** Every step below the
  verifications is documented, not verified.

## Checklist

1. [ ] Sign into the Play Console app on an Android phone — device verification
2. [ ] Verify the contact phone number (unlocks only after step 1)
3. [ ] `Create app`, package `com.eighteenzerodcai.app`
4. [ ] Fill the listing, Data safety and IARC from [`submission.md`](submission.md)
5. [ ] Opt into Play App Signing; let EAS hold the upload keystore
6. [ ] `pnpm verify:native`, then `eas build --platform android --profile production`
7. [ ] Upload that AAB to the internal track **by hand**, in the browser
8. [ ] Play Console → Setup → API access: service account, Release manager, JSON key
9. [ ] JSON key → `PLAY_SERVICE_ACCOUNT_JSON` secret and `apps/mobile/play-service-account.json`
10. [ ] `eas submit --platform android --profile production --latest` — every release after the first
