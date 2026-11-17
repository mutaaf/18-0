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

## The 10-foot layout

The screens are sized in phone points, and an Apple TV is 1920 x 1080 points
watched from across a room. Rather than a second set of sizes in five hundred
stylesheets, the app is laid out on a **1280 x 720 stage scaled by 1.5**
(`TV_SCALE`, `src/theme/layout.ts`; `TVStage`, `src/features/tv/Stage.tsx`). A
TV therefore gets the wide-window composition that already exists -- the field
beside the list, two-panel spreads, the navigation rail -- with every label half
again as large. Three rules keep it honest, and `native-imports.test.ts`
enforces each:

- **Measure the window with `useWindowSize`**, never `useWindowDimensions`: React
  Native's answer is the glass, half again too wide for the stage.
- **Convert `measureInWindow` with `toStage`**: it answers on the glass, after the
  scale, and a spread mixing the two put the seam in the wrong place.
- **A native modal is outside the stage** (another view controller), so `Modal`
  contents are wrapped in their own `TVStage`, and the card screen is pushed
  rather than presented on a TV.

**Overscan.** Apple's TV-safe area (80 points at the sides, 60 top and bottom)
is handed to every safe-area consumer as the insets (`TVSafeArea`). Backgrounds
run to the edge of the glass; the screens, the rail, the dock and the account
disc keep inside it.

## Focus

- **Every button shows where the remote is.** `@/components/Pressable` and
  `@/components/TextInput` are React Native's own components on a phone and the
  web (the same object, not a wrapper) and add a `focusRing` outline and a
  slight lift on a TV. The test fails an import of either straight from
  `react-native`. `focusRing` is a palette token, white in both themes, because
  it has to read on the action colour too.
- **The remote starts somewhere sensible** (`hasTVPreferredFocus`): Play (or
  Resume) on the front page, the first player who fits after a spin, the first
  eligible slot when a pick fits two, Spin once a pick is placed, Reveal when
  the roster is full, Build Another on the result.
- **The rail and the dock are focus guides** aimed at the tab you are on, so
  pressing right (or down) from anywhere on a page lands on the navigation, and
  every page is a guide that remembers where you left it.
- **Menu** goes back from a pushed screen, to Play from any other tab, and home
  from Play -- Apple's tvOS review guidelines require that last one
  (`src/features/tv/menu-key.ts`).

## Gut Check on the Siri Remote

The swipe deck (`app/rate.tsx`) reads the remote through `useTVRemote`
(`src/features/tv/remote.ts`) and `remoteAction` (`remote-calls.ts`, tested):

| On the remote | Judging | Asked which way |
|---|---|---|
| Swipe or click right | Fair | Fair after all |
| Swipe or click left | Off -- asks which way | -- |
| Swipe or click up | -- | Deserves more (`too_low`) |
| Swipe or click down | -- | Deserves less (`too_high`) |
| Click (select) | Don't know (skip) | Fair after all |

A swipe on the touch surface and a click on the clickpad's edge are both
accepted, because people do both. The round buttons are the legend, not focus
stops -- if they were, a swipe would move focus between them instead of making
a call -- so the one focusable control on the deck is the middle button, and a
click presses it. Menu closes the deck. Every call is the same
`giveRatingFeedback` row the touch deck writes; nothing here touches a score.

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

So on a TV there is no share button (the result screen offers Build Another
alone, and a challenge says plainly that a TV has nowhere to send a link), no
"copy link", no streak reminders (the switch says why), no TestFlight invite and
no sign-in buttons.

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
