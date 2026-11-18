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

- **Every button shows where the remote is, the tvOS way.** `@/components/Pressable`
  and `@/components/TextInput` are React Native's own components on a phone and
  the web (the same object, not a wrapper). On a TV a focused Pressable springs
  up (1.03 for a full-width row to 1.12 for a small button: small things grow
  more), drops a soft shadow, lights a `focusRing` rim drawn at the element's
  own corner radius over a faint white wash, and runs one specular sweep across
  its face. All of it is Reanimated on the UI thread; nothing loops. A screen
  can pass `tvFocus="rim"` (no lift) or `"none"` (draws its own), or read
  `focused` from the style callback. The first version used `outline`, which
  UIKit draws as a square box whatever the corners -- a hard white rectangle
  over every rounded card. The test fails an import of either straight from
  `react-native`. `focusRing` is a palette token, white in both themes.
- **A focused thing grows past its edges**, and a scroll view clips: a page
  whose first tile sits at the scroll's edge pulls the scroll out by the room a
  lift needs and pads it back in (`TVHome`).
- **UIKit will not focus what it cannot see.** `hasTVPreferredFocus` on a view
  still at opacity 0 (a `Reveal` entrance) is ignored and the remote lands
  somewhere else; the control that should take focus is not faded in.
- **The remote starts somewhere sensible** (`hasTVPreferredFocus`): Play (or
  Resume) on the front page, the first player who fits after a spin, the first
  eligible slot when a pick fits two, Spin once a pick is placed, Reveal when
  the roster is full, Build Another on the result.
- **Nothing may lie over the page once its show is over.** tvOS will not move
  focus to anything a view covers, and `pointerEvents="none"` does not count:
  react-native-tvos reports every plain view as interactive. The result's
  fireworks overlay stayed mounted after the show and the remote could never
  cross from Build Another to the roster; on a TV it now unmounts when the
  show ends (`Celebration`). `UIFocusDebugger checkFocusabilityForItem:` from
  lldb names the view in the way.
- **A two-page spread is two focus guides** (`features/tv/FocusPane`), so left
  and right cross between the pages from any row, not only from rows that
  happen to be level with something on the other page.
- **A screen that stays mounted claims focus each time it is shown**
  (`useTVInitialFocus`): `hasTVPreferredFocus` alone claims once, and a claim
  made while the screen is still arriving is dropped. Account uses it, so the
  corner disc opens onto the page rather than the rail.
- **The rail and the dock are focus guides** aimed at the tab you are on, so
  pressing right (or down) from anywhere on a page lands on the navigation, and
  every page is a guide that remembers where you left it.
- **Menu** goes back from a pushed screen, to Play from any other tab, and home
  from Play -- Apple's tvOS review guidelines require that last one
  (`src/features/tv/menu-key.ts`).

## The screens on a TV

- **Home** is its own component (`features/tv/TVHome.tsx`), not the phone's
  long page: a hero with Play (or Resume and Discard) and the ranked switch,
  a shelf of the three lenses as large tiles, and a shelf of everything else
  (Gameday when there is one, Gut Check, Leaderboards, Your seasons). Every
  decision on it is the phone screen's, passed in, so the two cannot disagree.
- **Play**: the position filters are a row above the list rather than a bar
  floating over it (the focus engine scrolled the focused row under the bar),
  and there is no search field. Each player row is one focus target; the
  details are a long press of Select (said in the list's heading). The list
  returns to its top when the hero above it collapses, or the row the remote
  was just given slid out of view.
- **Gut Check**: the two calls flank the card, a remote legend with a moving
  fingertip sits under it, a call is stamped on the card before it flies, and
  each new card deals in from below.
- **Copy** says Select, never Tap (`pressVerb`, `features/tv/platform.ts`).
- **Svg backgrounds** sit in an absolutely positioned wrapper. Sized "100%"
  straight inside a padded box, native react-native-svg takes the padding off
  its own size, and a gradient stops short of the right and bottom edges -- the
  Gut Check card, `Panel`, `GlassSurface`, the manager and collectible cards.

## Sound

`features/tv/sound.ts` plays fourteen cues on a TV and nothing anywhere else:
focus moves (quiet, rate-limited), the spin's whoosh and reel clicks, the
landing, a pick locking in, the record (with a fanfare for 17-0 and a falling
sting for perfection denied), Gut Check's fair, off and pass, a round's end,
and broadcast graphics wiping on. `expo-audio` links on tvOS and is required
only by that module (`native-imports.test.ts`). Its config plugin is listed in
`app.config.js` only to switch off background audio and the Android record
permission.

The sounds are synthesised, not sampled: `node apps/mobile/scripts/make-tv-sounds.mjs`
writes the WAVs in `assets/sounds/tv/` from additive tones and seeded noise,
deterministically, and balances their loudness. No licence to keep. Change the
script, re-run it, commit both. Sound is on by default and switched in Account.

## Broadcast mode

For somebody putting the game on a stream or a podcast: Account, "On this TV",
Broadcast mode. A preference, off until asked for, not a flag -- it draws
nothing a player cannot already see and reads nothing remote, so there is no
rollout to gate (and an absent PostHog key reads as off). `features/tv/hud`:

- a **scorebug** above the lineup: the lens, seven pips, and the average pick
  rating in Rookie only. Scout and GM Mode say "Hidden": the graphic never
  shows what the mode hides;
- **lower thirds** for each landed spin (city, era, the era's story line) and
  each pick (player, slot, stat line), six seconds each, wiped on;
- a **crawl** along the foot of the screen (switchable);
- the **record as a full-screen graphic** over the result: the seven picks
  deal in under a riser, the record slams onto a card, and the 17-0 gate says
  cleared, denied by which gate, or short by how much. It holds until Select;
- **Gut Check's live tally** of fair, off and pass;
- **clean feed** hides the remote hints in a game.

Display only, all of it: the HUD reads the same store and `GameResult` the
screens read and writes nothing. Nothing reaches a score (invariant 1).

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
