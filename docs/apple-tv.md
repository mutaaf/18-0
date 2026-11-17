# Apple TV

The whole app, on tvOS, from the same code. Not a second app: the same Expo
project, the same bundle id (`com.eighteenzerodcai.app`) and the same JavaScript,
with the Xcode target rewritten for tvOS at prebuild time.

## How the TV target is made

- **`react-native` is `react-native-tvos`.** `apps/mobile/package.json` aliases
  it (`npm:react-native-tvos@0.86.3-0`). The fork is a superset: it builds the
  iPhone, Android and web apps exactly as `react-native@0.86.3` did, and adds
  tvOS. Expo's guidance is to alias it everywhere in a project that targets TV
  at all, rather than swapping packages per build, which is what keeps the
  lockfile single. Its version tracks React Native's: when RN moves, move the
  alias to the matching `0.x.y-n` release of react-native-tvos.
- **`@react-native-tvos/config-tv`** is the last plugin in `app.config.js`. It is
  inert unless `EXPO_TV=1`, so a phone prebuild is unchanged. With it, the iOS
  target becomes a tvOS one (`SDKROOT = appletvos`, device family 3, the Podfile
  on `platform :tvos`) and gets the Apple TV brand assets.
- **The icon and the Top Shelf** are two-layer images in `apps/mobile/assets/tv/`,
  drawn by `apps/mobile/scripts/make-tv-icons.py` from the same crest as every
  other icon. Xcode rejects a wrong size, so the script asserts them.

```bash
EXPO_TV=1 npx expo prebuild --clean --platform ios   # in apps/mobile
pnpm verify:tv                                       # that, plus a simulator build
pnpm verify:tv --install                             # ...installed and launched
```

`pnpm verify:builds` runs `verify:tv` first, then regenerates the phone project,
so `ios/` ends as the phone project. Run on its own, `verify:tv` leaves `ios/`
as a tvOS project: `npx expo prebuild --clean` before `expo run:ios` again.

The simulator runtime is a separate download: `xcodebuild -downloadPlatform tvOS`
once per Xcode. It installs the stock "Apple TV 4K (4th generation)" devices;
`verify:tv --install` uses the 1080p one and never creates a device.

## What tvOS does not have

tvOS links only the native modules whose podspecs declare it. The ones this app
uses that do not:

| Module | On a TV |
|---|---|
| expo-haptics | No Taptic Engine. Every call is a no-op (`features/haptics.ts`). |
| expo-clipboard | No pasteboard. Copy reports "not copied" (`features/clipboard.ts`). |
| expo-sharing, react-native-view-shot | No share sheet. Sharing is unavailable (`shareAvailable`). |
| expo-notifications | No notification centre. Reminders report `unsupported`, as on the web. |
| expo-web-browser | No browser for an OAuth round trip. No sign-in buttons; see below. |
| `modules/fold` | The iPhone Duo's hinge sensor. Never asked for on a TV. |

Each of those looks its native module up the moment it is imported, so a single
static `import * as Haptics from 'expo-haptics'` anywhere in the startup graph
kills the TV app before its first frame -- while every phone build, typecheck
and test stays green. They are reached only through one guarded module each,
and `src/features/tv/native-imports.test.ts` fails the build on a static import
anywhere else.

Skia (the GPU layer), Reanimated, SVG, gesture handler, screens, safe area,
async storage, expo-image and expo-iap all link on tvOS.

`isTV` (`src/features/tv/platform.ts`) is the one question. On tvOS
`Platform.OS` is still `'ios'`, so a check for `'ios'` alone also matches a TV.

## Accounts on a TV

No account is ever required (invariant 3), and that is what a TV does: it plays
signed out, and a ranked season is kept under the anonymous account the server
creates on the first ranked finish, exactly as on a phone before sign-in.
Sign in with Apple and Google both need a browser for the OAuth round trip, and
tvOS has none, so the buttons are not offered. A device-code sign-in ("go to
this address on your phone") is the honest way to add one later; nothing about
ranked integrity changes either way -- spins, scoring, `assisted`, `mode` and
`gameday_key` remain server facts (invariant 2).

## TestFlight

`.github/workflows/tvos-github.yml` is `ios-github.yml` for the TV: prebuild with
`EXPO_TV=1`, archive for `generic/platform=tvOS`, upload as `appletvos`, and hand
the build to the public TestFlight group with `beta-release.mjs --platform TV_OS`.
It runs an hour after each iPhone beta, only when the app changed since its own
`testflight-tvos` tag, and shares the `release` concurrency group, so the two
lanes never ask for the next build number at once. The number comes from the
same counter as the iPhone app (`next-build-number.mjs`), so a number names one
build on either platform.

One App Store record carries both (universal purchase): same bundle id, same
distribution certificate. What the TV lane needs on top of the iPhone lane:

- **The tvOS platform on the record.** `scripts/store/tvos-platform.mjs` adds it
  (an editable TV_OS App Store version, the API's "Add Platform"); App Store
  Connect refuses a tvOS upload without one. Done once, on 2026-11-17, as
  1.1.0. It creates the version and nothing else -- no build attached, no
  listing, no submission. Store submission stays the owner's call.
- **A tvOS App Store provisioning profile.** `scripts/store/tvos-profile.mjs`
  finds or makes "17-0 tvOS App Store" (TVOS_APP_STORE, every distribution
  certificate on the team) and writes it out; its base64 goes in the repository
  secret `TVOS_PROVISIONING_PROFILE_BASE64`:

  ```bash
  set -a; . .local/asc.env; set +a
  node scripts/store/tvos-profile.mjs --out .local/ios-credentials/tvos-profile.mobileprovision
  base64 -i .local/ios-credentials/tvos-profile.mobileprovision | gh secret set TVOS_PROVISIONING_PROFILE_BASE64
  ```

The workflow stops at its first step with that sentence if the secret is
missing, and refuses a profile that is not a tvOS one.
