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
  the roster is full, Build Another on the result, Answer it on a challenge,
  Play on an empty My Stats. `usability.test.ts` fails a route that does not
  say (docs/performance.md, "Usability"); `test17_Journeys` walks the core
  journeys with the remote and counts the presses.
- **An overlay over a page is one the focus engine sees through.** tvOS will
  not move focus to anything a view covers, and it decides "covers" by the
  covering view's `isUserInteractionEnabled`, ancestors included.
  `pointerEvents="none"` sets that property, but react-native-tvos overrides
  the getter on every Fabric view to answer YES, so no React Native view is
  ever transparent to focus. The result's fireworks held the remote on Build
  Another for the whole show (up to nine seconds). Overlays therefore sit in
  `PassThroughView` (`modules/pass-through`, `passThroughView()`), a local
  Expo module whose view answers NO: the fireworks (`Celebration`) and the
  broadcast HUD (`PlayHud`). It is React Native's `View` everywhere but a TV.
  `UIFocusDebugger checkFocusabilityForItem:` from lldb names the view in
  the way.
- **A two-page spread is two focus guides** (`features/tv/FocusPane`), so left
  and right cross between the pages from any row, not only from rows that
  happen to be level with something on the other page.
- **A screen that stays mounted claims focus each time it is shown**
  (`useTVInitialFocus`): `hasTVPreferredFocus` alone claims once, and a claim
  made while the screen is still arriving is dropped. Account uses it, so the
  corner disc opens onto the page rather than the tab bar.
- **The tab bar is an `autoFocus` focus guide**, so pressing up from anywhere
  on a page lands on the navigation, and
  every page is a guide that remembers where you left it.
- **Menu** goes back from a pushed screen, to Play from any other tab, and home
  from Play -- Apple's tvOS review guidelines require that last one
  (`src/features/tv/menu-key.ts`).

## Navigation

A tab bar across the top (`components/TVTabBar.tsx`), the way tvOS's own
is: the tabs as words, the one the remote is on a white pill with dark type,
the one you are on a quiet grey pill. Up from anywhere on a tab lands on the
tab the bar was last on -- the one you picked -- because the bar is an
`autoFocus` guide.

**Never aim a focus guide's `destinations` at a `Pressable`.** On a TV it is
an animated component, not the native view a guide needs, so the guide has
nowhere to send focus and takes it itself: an invisible box that Select does
nothing on. Builds 27 and 28's tab bar moved as one dead block for exactly
that reason, and so did the dock and the rail before it. `test11_TabBar` in
`scripts/perf/tv` walks every tab with the remote and fails if it happens
again. A click switches tabs, not focus, because each tab is a whole
screen and mounting one per press across the bar is the cost this app cannot
pay. The dock and the Duo's rail are a phone's; `useNavRail()` is null on a
TV, and the account disc sits in the top right.

### My Stats, Challenges and Leaderboards

These three were not navigable on a TV, each for its own reason, found by
walking them with the remote (`test15_DiagnoseTabs` in `scripts/perf/tv`
prints where every press lands):

- **My Stats** had no focus target on it at all -- tiles, charts and the
  chase are Views and Text -- so down from the bar went nowhere, and a scroll
  view with nothing focusable in it does not scroll: the records, the chase
  and the tendencies below the fold were unreachable.
- **Challenges** had one button, and a TV has no share sheet, so it was not
  there; the challenges themselves are panels. Down from the bar went nowhere.
- **Leaderboards** laid out as the wide window's two-page spread: the podium's
  only focus targets were its tiny report flags, the "Sign in" gate under it
  trapped down, and the field was on the other page, reachable only from
  whatever happened to be level with it.

Each is now a list-and-detail page (`features/tv/views/`): the master column
on the left -- the title, a row of switches, a list the remote walks -- and a
panel on the right drawing whatever the remote is on, the way the TV app's
own library pages do. The phone screen decides everything (which boards,
what is fetched, who won) and passes it in, as it does for `TVHome`; phones
and the web are unchanged.

- **My Stats**: seven section rows (Overview, Form, Records, How you play,
  The chase, GM Mode, Tendencies), then every season in the log, to the end.
  A season's panel is the record, the rating and tier, how the model built
  the number (base, weak link, elite depth, chemistry), what kept it from
  17-0, and the seven; Select goes into the seven, each opens its card, and
  Menu comes back to the season.
- **Challenges**: filters (All, To answer, Waiting, Settled, Your seasons)
  along the top; a challenge's panel is a face-off with the verdict and the
  margin. Select on one that is yours to answer opens `/challenge`, exactly
  as its link does on a phone. A TV cannot send one, and says so.
- **Leaderboards**: the boards, then the period and the clean-only switch;
  your own place pinned first (Select jumps to your row); an entry's panel is
  rank, rating, record and tier, where it sits in the field and the gap either
  side, and the seven behind it -- the phone's own `fetchRoster`, asked once
  the remote rests on a row, not once per press. With the remote on the
  switches the panel is the board's overview and its ridge.

How they stay cheap and reachable (`features/tv/views/views.test.ts`):

- **Every page, list, panel and switch row is an `autoFocus` guide**, and no
  guide anywhere has `destinations` (see Navigation). Left and right cross
  between the list and the panel from any row.
- **The focused row lives outside React state** (`FocusTrack`): the rows are
  memoised and never read it, and only the panel subscribes. A press is two
  rows' lift and one panel render, not a list re-render.
- **The list mounts what the remote can reach** (`useTVRows`, as Play does):
  a five-hundred-season log is twelve rows until the remote walks towards the
  end, and a row focus is about to be handed to (your place) is mounted first.
- **Charts are drawn once.** The panel's sections are layers shown and hidden
  by opacity, so an Svg chart rasterises when the page mounts, never when the
  remote lands near it. A season's or an entry's panel is plain Views,
  re-labelled per move rather than remounted.
- **Menu in a panel goes back to the row it came from**, not out of the tab:
  a `BackHandler` listener added while focus is in the panel answers before
  the tab's own (`menu-key.ts`), and the row reclaims focus with
  `useTVInitialFocus`.

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

`features/tv/sound.ts` plays cues on a TV and nothing anywhere else: the
spin's whoosh and reel clicks, the
landing, a pick locking in, the record (with a fanfare for 17-0 and a falling
sting for perfection denied), Gut Check's fair, off and pass, a round's end,
and broadcast graphics wiping on. A focus move is silent: it was a cue once,
and an audio seek and play per remote press (see Real hardware). The players
load one per quarter second after launch rather than in front of it. `expo-audio` links on tvOS and is required
only by that module (`native-imports.test.ts`). Its config plugin is listed in
`app.config.js` only to switch off background audio and the Android record
permission.

The sounds are synthesised, not sampled: `node apps/mobile/scripts/make-tv-sounds.mjs`
writes the WAVs in `assets/sounds/tv/` from additive tones and seeded noise,
deterministically, and balances their loudness. No licence to keep. Change the
script, re-run it, commit both. Sound is on by default and switched in Account.

## Broadcast mode

The TV's default presentation, and a switch in Account, "On this TV". On by
default since the owner asked for it (a game on a television is already a
broadcast), and a preference rather than a flag -- it draws nothing a player
cannot already see and reads nothing remote, so there is no rollout to gate
(and an absent PostHog key reads as off). The stored preferences are version 1:
a version-0 store (before the default changed) is migrated to on, because it
cannot tell "never touched" from "turned on and off again" and almost everyone
is the first. From version 1 a switch in Account also records
`broadcastChosen`, so a later change of default can leave a deliberate "off"
alone (`migrateTVPrefs` and `restoreTVPrefs` in `state/restore.ts`, which also
validate every stored value at launch). `features/tv/hud`:

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

## Stadium lights

The phone lights its big moments on the GPU: the turf's floodlights stutter on
in a Skia shader, and the result throws a Skia firework show. None of that runs
on a TV (see Real hardware). `features/tv/lights.tsx` is the TV's own rig,
built from the only things a real Apple TV composites for free:

- **Searchlights.** Each beam is a static native gradient (a soft radial on a
  narrow view, tipped back in perspective so it widens away from its lamp),
  inside one view twice its length centred on the lamp, so rotating that view
  swings the beam about the lamp. Rotation and opacity, on the UI thread.
- **Flashbulbs** in the stands: small soft radials that pop with opacity and
  scale.
- **A wash** from the top edge in the moment's colour -- the franchise's on a
  spin, the tier's on the record, gold at 17-0.

| Moment | Beams | Wash | Bulbs | Plays for |
|---|---|---|---|---|
| A spin lands | 2, cross and settle on the hero | 1 pulse, franchise colour | 3 | 2.3 s |
| A pick locks in | 2, a quick nod | -- | 2 | 1.5 s |
| The record (result page, broadcast record) | 4, lead in and land on the slam | 1 pulse, tier colour | 3 | 4.2 s; held under the broadcast record |
| 17-0 | 4, gold | 3 pulses, 450 ms apart | 3, twice each | 5.4 s; held under the broadcast record |

**Standing lights on the play screen.** The owner asked for the spotlight on
the play view itself, not only at its moments. So the play screen keeps two
lamps lit for as long as it is up (`RestingLights`, `RESTING_BEAMS` in
`lights-plan.ts`): one hanging just inside the top left of the glass and
shining down across the field, where it lands in a soft pool, and one at the
top right across the spin's hero and the list. A spin landing or a pick
locking in flares both and swings them out and back once, on the UI thread,
on top of that moment's show. Between moments nothing moves: three still
layers, which cost the compositor and not a thread. No idle sway -- a loop
would be work on the UI thread every frame, under every press, for as long as
the screen is up. Under Reduce Motion they stand lit and never swing.

The budget, which `performance.test.ts` holds: at most **eight animating
layers** in any show; transform and opacity only; no Svg, Skia, shadow or
rounded clip; **nothing of a show mounted between moments** -- a show unmounts
itself when it ends -- and at most four standing layers on the play screen,
none of them looping. **Nothing that paints is faded**: animated opacity on a
React Native view rebuilds its layer every frame (see The fourth pass), so
every fade and pop is on a bare wrapper around a still gradient. Under the broadcast record, which holds until Select, the
beams sway twice and then stand still (a still layer costs nothing per frame);
nothing loops. On the play screen a spin's lights overlap the remote's first
presses on the new list, which is why they are short and few.

Reduce Motion: nothing sweeps, pops or strobes; the beams fade in where they
would have come to rest and the wash rises and falls once at half strength.
Photosensitivity: the wash is the only light covering much of the screen, it
never passes about a third of full strength, and the 17-0 strobe is three
pulses in a second at most (WCAG 2.3.1); bulbs are far smaller than the area
that counts as a flash; nothing strobes red.

Behind `tv_broadcast_lights` (fallback on), so a TestFlight build that
stutters can lose them remotely. The flag has to exist in PostHog
(`scripts/posthog-flags.ts --apply`): a key PostHog answers without reads as
off, and until then the lights show only on a TV that never reached PostHog. The simulator cannot say whether they are
smooth on an Apple TV HD: `tv_jank` on the play and result screens, build
against build, is the check.

Measured with `scripts/perf/tv/run.sh` on the same simulator, origin/main
against this change. "After" has broadcast mode on by default and the lights
on, so the play-screen rows now carry the HUD as well as the lights; gross
ms per press, `noop_press` being the harness's own cost. `test05` now
dismisses the broadcast record before it measures the result page:

| | Before | After |
|---|---|---|
| Harness's own cost per press (`noop_press`) | 31.5 ms | 29.0 ms |
| Focus move, play list | 89.4 ms | 86.4 ms (under the HUD now) |
| Focus move, play list under the HUD | 95.9 ms | 92.5 ms |
| Focus move, result page (after the record is dismissed) | 77.2 ms | 79.4 ms |
| A season (CPU) / peak memory | 7.71 s / 430 MB | 8.31-8.54 s / 439-445 MB (HUD + lights) |
| A season in broadcast mode (CPU) / peak memory | 8.32 s / 437 MB | 8.35 s / 445 MB |

The lights cost about 8 MB at peak and no CPU per press the simulator can
measure (the play-list rows moved within noise; a season's extra CPU is mostly
the HUD, now on by default). The simulator composites on a Mac GPU, so whether
they are smooth on an Apple TV HD is `tv_jank`'s to say.

The result page's own confetti (`Celebration`'s fallback on a TV) is not
started while the broadcast record covers the page -- it was animating a
hundred views nobody could see. It plays when the record is dismissed, if the
show is still on.

## Performance

The slowest Apple TV this app runs on is the Apple TV HD: an A8 and 2 GB,
the chip of a 2014 iPhone. Everything here is measured on the simulator, on a
Mac several times faster, so the numbers below are for comparing one build
with another -- never a promise about the hardware. What carries over is the
*shape*: work per remote press, renders per press, and anything that runs
every frame.

### What a remote press costs, and what it used to

Release build, "Apple TV 4K (at 1080p)" simulator, `scripts/perf/tv/run.sh`.
CPU is the app process's, per press, with the harness's own cost (an idle
second and a press that moves nothing, `test00_Controls`) taken off.

| | Before | After | |
|---|---|---|---|
| Focus move, front page | 66 ms | 20 ms | −69% |
| Focus move, play list after a spin | 109 ms | 47 ms | −57% |
| Focus move, result page | 99 ms | 56 ms | −43% |
| Focus move, leaderboard | 76 ms | 41 ms | −46% |
| Focus move, play list under the broadcast HUD | 99 ms | 67 ms | −32% |
| Gut Check, one call (stamp, fly-out, next card) | 195 ms | 106 ms | −46% |
| Tab switch along the rail | 306 ms | 181 ms | −41% |
| One spin, Select to list ready (CPU) | 1.75 s | 1.16 s | −34% |
| Renders per focus move | 2 | 2 | already minimal |
| Main thread, 15 s down the play list (Time Profiler) | 2.39 s | 1.53 s | −36%, before the turf and row changes |
| UI frames dropped, focus moves (front page, play list) | 0.1/s, worst 65 ms | 0/s, worst 17 ms | |
| UI frames dropped across a season | 3.2/s, worst 228 ms | 2.2/s, worst 135 ms | |
| Peak memory over a season | 492 MB | 442 MB | −50 MB |
| Peak memory, three Gut Check rounds | 385 MB | 380 MB | |
| Process start to first frame | ~320 ms | ~320 ms | unchanged |
| Result page: Build Another to the roster, during the fireworks | up to 9.5 s | immediate | see Focus |
| A season in broadcast mode | stuck after the 7th pick | completes | |

Memory is the simulator's resident size, which counts Metal and the
simulator's own mappings: read it as a trend.

### Budgets

Simulator, Release, net of the harness. A change that crosses one of these
is a regression until a profile says why.

- A focus move: **no React commit** in a list of rows (2 renders where a
  control reads `focused`), **≤ 30 ms** on the front page, **≤ 60 ms** in a
  long list.
- Nothing runs every frame while the screen is still, except the turf (every
  other frame on a TV) and a running show.
- A full-screen overlay is a `PassThroughView`, or the remote cannot reach
  what is under it.
- Peak memory over a season **≤ 460 MB** on the simulator.

### The rules the numbers came from

`src/features/tv/performance.test.ts` fails the build on each of these.

- **Reanimated applies transform, opacity and shadows without a commit.**
  Reanimated 4 ships with `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS` and its Android
  twin off, so every frame of every focus lift committed the whole shadow tree
  and laid the screen out again -- a third of the main thread while the remote
  moved down the play list, and more the longer the list. They are on, in
  `apps/mobile/package.json` (`reanimated.staticFeatureFlags`; both native
  builds read it at pod install and gradle time). The synchronous path takes a
  view only if *every* prop it animates is on Reanimated's list, so the focus
  language animates transform, opacity and shadows and nothing that lays out.
- **A control is cheap until it is focused.** `TVPressable` mounts its rim and
  sheen on its first focus, and the sheen is a native CSS gradient on one view
  rather than an Svg (seven native components). A spin is a hundred rows.
- **A player row paints its team wash natively** (`experimental_backgroundImage`,
  a CAGradientLayer on the card itself), built once per pair of colours.
- **Rows below the first screen arrive in place**, and so does the row the
  remote is handed: tvOS refuses preferred focus to a view still fading in,
  and the remote used to land on the "All" filter instead, where Select does
  nothing. `Reveal` asks for Reduce Motion once for the app.
- **An overlay is one the focus engine sees through** (`modules/pass-through`;
  see Focus).
- **The front page under a game listens for whether one is under way**, not
  for its status, which moves three times a spin.
- **The turf ticks every other frame** (docs/graphics.md).
- **A spin mounts only the rows the remote can reach**, and more as it nears
  the end (`useTVRows`; see The third pass).
- **No Svg behind every screen or in the broadcast graphics, and no rounded
  clip over anything that moves** (see The third pass).
- **Focus state stays out of React.** A move renders nothing in a control
  that does not read `focused` (see The fourth pass); one that does -- a style
  or children callback -- re-renders itself and the control losing focus, and
  nothing else.

### Re-measuring

```bash
brew install xcodegen                 # once; the harness's project is generated
pnpm verify:tv --install              # a Release build, installed and launched
scripts/perf/tv/run.sh                # every test, ~15 minutes
scripts/perf/tv/run.sh test03_PlayListFocusMoves test00_Controls
scripts/perf/tv/js-probe.sh test03_PlayListFocusMoves            # renders, commits per press
PROFILE=30 scripts/perf/tv/js-probe.sh test03_PlayListFocusMoves # + JS and main thread ms
```

The harness (`scripts/perf/tv/TVPerfUITests`) drives the installed app with
`XCUIRemote` -- Select, arrows, the way a person does -- and prints each
measured block: wall time, CPU, CPU per press, memory. It plays Rookie, which
reaches no leaderboard, and plays Gut Check with Select ("don't know"), which
records nothing. XCTest's own CPU, hitch and launch metrics record nothing on
a tvOS simulator, so the runner samples the process from the host instead.
For where the time goes, attach Time Profiler while a test runs:

```bash
xcrun xctrace record --device <udid> --template 'Time Profiler' \
  --attach $(pgrep -x SeventeenZero) --time-limit 15s --output play.trace
```

### Measuring the real thing

The simulator cannot say whether an Apple TV stutters. So the app measures it
on every TV it runs on (`features/tv/jank.ts`, behind `tv_jank_probe`): for
two seconds after each remote press it times every UI-thread frame and how
late the JS thread gets to a timer set at the press, then sends one
`tv_jank` event per screen to PostHog -- presses, frames, hitches (over
25 ms), stalls (over 50 ms), the worst frame, the JS delay, and the build.
Comparing one TestFlight build's numbers with the last is how a fix is
confirmed, and the screen with the worst hitch rate is the next thing to fix.

### What only the hardware can say

- **The Apple TV HD itself.** Every number above is a Mac running a
  simulator. The A8 is several times slower on the CPU and much slower on the
  GPU; the cuts above are proportional there, but the absolute cost of a focus
  move, a spin landing (a hundred rows mounting) and the turf at 30 frames a
  second has not been watched on one.
- **GPU time.** The simulator draws with the Mac's GPU, so GPU work (the
  fireworks; the turf and the focus shadows until Real hardware, below) is
  invisible to these measurements. Instruments'
  Animation Hitches on a device is the check.
- **Thermal and memory pressure** over a long session on 2 GB.

### Real hardware

The first TestFlight build with the overhaul (23, before the pass above) was
slow everywhere on a real Apple TV: presses lagged, animations stuttered,
screens and launch were slow. The simulator had not shown it, because the
expensive parts were GPU and AVFoundation work that the Mac does for free.
What was taken out, and what a test keeps out (`performance.test.ts`):

- **Animated shadows.** The focus lift animated `shadowOpacity` and
  `shadowOffset`. With no `shadowPath`, Core Animation renders a shadow
  offscreen from the layer's alpha, every frame the layer changes. Focus is
  now transform and opacity only, and the HUD panels and the broadcast record
  card dropped theirs.
- **The specular sweep.** A gradient band clipped inside a rounded rim: a mask
  pass per frame of every focus. Gone; the rim is unclipped.
- **A sound per focus move,** and fourteen AVPlayers made in the launch effect.
- **The shaders.** The turf and the seam hold still on a TV (`STILL` in
  `features/gpu/clock.ts`). On tvOS they draw on the main thread focus runs
  on, at 4K.
- **A layout state per Pressable.** The lift's width is a shared value now,
  so a hundred rows mounting is one render each, not two.

Build 26 was better and still choppy. The second pass took out what was
left, all of it CPU or offscreen GPU work the simulator does not show:

- **Every layer shadow.** Not only animated ones: a shadow with no
  `shadowPath` is re-rendered whenever anything under it moves, and on a TV
  the whole app sits under the stage's 1.5x scale. `themed()` builds every
  stylesheet without `shadow*` on a TV (`dropShadows`, called from
  `features/tv/platform.ts`); the few inline ones are guarded by hand.
- **Skia, entirely.** `gpu()` returns each effect's fallback on a TV, so
  nothing loads Skia, compiles a shader at launch, or holds a 4K Metal layer.
- **Svg paints the remote lands on.** react-native-svg rasterises on the CPU,
  on the main thread. The home's tiles swapped an Svg gradient on focus, so
  every press redrew one mid-lift. The home, `Panel`, the glass and the play
  screen's team wash are native gradient layers (`experimental_backgroundImage`)
  on a TV.
- **The dock's swell,** which animated width on the JS thread.
- **Screens out of sight** stop rendering (`freezeOnBlur`).

The rule this leaves: on a TV, animate transform and opacity and nothing else,
and treat any per-frame GPU effect as guilty until a device says otherwise.

### The third pass

After the tab bar (#85) the owner still felt lag on hardware. What was left
was work the remote never needed: rows mounted that nobody reached, CPU
rasters behind every screen, rounded clipping over moving graphics, and one
loop that never rested.

- **A spin mounts the rows the remote can reach** (`features/tv/rows.ts`,
  `useTVRows`). A phone mounts the whole spin a dozen rows a frame; on a TV
  those eight commits of the play screen landed in exactly the second the
  remote was first pressed, and a hundred rows is a hundred focus targets
  searched on every press, for a pick almost always made on the first
  screen. A TV mounts twelve, and a row taking focus six from the end mounts
  the next twelve (one commit). The row the remote is handed after a spin is
  always mounted, however far down the first open player is. Nothing
  unmounts, so this is not a FlatList: the rows share one scroll with the
  spin's hero, and a virtualized list drops rows the focus engine may hold.
- **The backdrop behind every screen** (`StadiumBackdrop`) was a full-screen
  Svg -- three radial gradients and Turf's pinstripe pattern, rasterised on
  the CPU by every screen that mounted. On a TV it is one view with native
  radial gradients. The pinstripe is left out there: 3.5% white, invisible
  from a sofa, and the most expensive fill in the Svg.
- **The broadcast graphics** (`features/tv/hud`): the panel glass and the
  record's glow were Svgs, and each panel clipped its children to rounded
  corners (`overflow: 'hidden'`), which Core Animation does as an offscreen
  mask pass every frame the panel wipes. The glass is now the panel's own
  background layer (a CAGradientLayer, rounded without a mask because it has
  no sublayers), and the hairline stops short of the corners instead of being
  clipped by them.
- **Gut Check's remote legend** shows its swipe three times per question, then
  rests, instead of looping for as long as the deck is open.

Measured with `scripts/perf/tv/run.sh`, before and after, on the same
simulator. CPU per press is gross here; `noop_press` is the harness's own
cost, to take off by hand:

| | Before | After | |
|---|---|---|---|
| One spin, Select to list ready (CPU) | 1.02 s | 0.87 s | −15% |
| A season, Rookie (CPU) | 8.14 s | 7.91 s | −3% |
| Peak memory over a season | 441 MB | 423 MB | −18 MB |
| Peak memory, a season in broadcast mode | 459 MB | 431 MB | −28 MB |
| Peak memory, down the play list | 367 MB | 353 MB | −14 MB |
| Focus move, play list (gross) | 95.9 ms | 92.4 ms | within noise |
| Focus move, play list under the HUD (gross) | 94.4 ms | 98.1 ms | within noise |
| Focus move, front page / result / leaderboard (gross) | 78 / 81 / 67 ms | 88 / 79 / 68 ms | within noise |
| Tab switch / Gut Check call (gross) | 184 / 173 ms | 186 / 171 ms | within noise |
| Harness's own cost per press (`noop_press`) | 29.5 ms | 31.2 ms | |

Read the focus rows for what they are: a simulator rasterises an Svg on a
Mac CPU in a fraction of a millisecond, and an offscreen mask pass on a Mac
GPU costs nothing it can measure, so the per-press cost of this pass was
never going to show here. What the simulator can see -- the spin's commits
and the memory of rows nobody reached -- moved. The rest is for `tv_jank`
on hardware to confirm.

**Rejected: laying the app out natively at 1920 x 1080.** The stage's 1.5x
is a static transform on one view: Core Animation composites it, re-renders
nothing for it, and adds no offscreen pass for it (the glass's clip is a
rectangle). No press costs more because of it. What it costs is sharpness:
text and borders are rasterised at the stage's size and magnified. Laying
out at 1920 means scaling every size in the app, and only the module-scope
stylesheets pass through one place (`themed()`); inline styles, `size`
props, Svg view boxes, animation distances, the breakpoints and every
`measureInWindow` reader do not, and a half-converted app is screens at two
scales at once. If sharpness becomes the complaint, the cheap fix is native:
raise `contentsScale` on the text layers under the stage by `TV_SCALE`, which
keeps the layout and draws glyphs at the size they are shown.

**Left as they are:** the broadcast crawl (`PlayHud`) loops while it is
shown, because moving is what a crawl is for -- one text layer translated on
the UI thread, and it can be switched off. The 17-0 ring on the result
(`Scoreboard`) breathes opacity only, on a perfect season only. The stats
charts and the small icons are Svgs that draw once at mount and never under
the remote's focus.

### The fourth pass

The first numbers from real Apple TVs (`tv_jank`, tvOS 26.6.1, TestFlight
builds 31, 33 and 34) put the remaining lag on the JS thread, not the frames:

| Build | Route | Presses | Frames | Hitch % | Stall % | Worst frame | JS late, median | JS late, worst |
|---|---|---|---|---|---|---|---|---|
| 34 (608fae9) | /play | 16 | 1383 | 6.44 | 2.17 | 387 ms | 337 ms | 548 ms |
| 33 (5cf66b7) | /play | 24 | 2099 | 4.95 | 2.19 | 406 ms | 241 ms | 519 ms |
| 31 (59cb0d3) | /play | 32 | 2836 | 4.94 | 1.80 | 353 ms | 298 ms | 575 ms |
| 34 | /games | 3 | 138 | 7.25 | 0 | 41 ms | 266 ms | 508 ms |
| 34 | /leaderboard | 1 | | | | | 238 ms | |
| 34 | /challenges | 3 | 249 | 2.41 | 0 | 33 ms | 15 ms | 15 ms |

Everything JS-driven -- a focus handler, a press, a navigation -- waited about
a third of a second behind each press on the play list. Challenges, which
keeps focus out of React state, was 15 ms. The simulator showed none of it:
its JS thread is a Mac core, and a 0 ms timer there fires a frame late at
worst. So this pass measured the JS thread's *work* rather than wall time,
with Time Profiler on the simulator's JS thread and a render counter in the
app (`scripts/perf/tv/js-probe.sh`), down and up the play list
(`test03_PlayListFocusMoves`):

| Per focus move, play list | Before | After |
|---|---|---|
| React renders | 26 (median 21) | 3 (median 0) |
| React commits | 1.95 | 0.03 |
| Shadow-tree commits from scroll state | ~18 (every scrolled frame) | 1, once the scroll rests |
| JS thread CPU (Time Profiler, 30 s of moves) | 941 ms (~18 ms a move) | 204 ms (~4 ms a move) |
| Main thread CPU (same window) | 4.0 s | 2.2 s |
| Harness, gross ms per move | 91.5 | 51.6 |

Where the JS thread's time went, and what took it:

- **A scroll view's state, every frame.** Fabric's scroll view answers every
  `scrollViewDidScroll:` with a state update (its content offset), and the JS
  thread turns each into a commit of the whole shadow tree: a Yoga pass and a
  walk of every node to round it to the pixel grid. The focus engine scrolls
  the list for nearly every press, about twenty frames, so a press queued
  twenty whole-screen commits -- the largest single share of the JS thread
  (26% before anything else changed, 40% once the rest had). Nothing on the
  JS side needs the offset per frame (`onScroll` is separate), so on a TV the
  update waits until scrolling has rested 120 ms and is made once
  (`modules/pass-through/ios/ScrollStateCoalescer.swift`, swizzled at launch,
  tvOS only; a phone's scrolling is untouched). A `measure` in that moment
  reads an offset at most that old.
- **Focus in React state.** `TVPressable` set `focused` (and `visited`, on a
  control's first focus) on every focus and blur: two renders and a commit per
  press, and a commit is the whole-tree layout above. Focus and press now
  reach React state only in a control that reads them (a style or children
  callback); a player row does not. The rim is mounted with the control, so a
  first focus is not a render either. The lifted control's `zIndex` went with
  the state: rows lift into the gap around them.
- **Reanimated syncing settled animations back to React.** With
  `FORCE_REACT_RENDER_FOR_SETTLED_ANIMATIONS` (on by default in Reanimated
  4.5) a timer re-renders every animated component a second after its
  animation settles -- each focus spring, so a commit per press, a second
  late. Off (`reanimated.staticFeatureFlags` in `apps/mobile/package.json`),
  the settled values stay in Reanimated's registry and are applied to React's
  own commits, as before 4.2.

And on the main thread, which the hardware's hitch rate pointed at too:

- **Animated opacity rebuilds the view's layer.** React Native answers an
  opacity change by invalidating the layer: an unclipped border is drawn
  again as an image on the CPU, and `experimental_backgroundImage` gradients
  are torn down and made again. The focus rim faded its own bordered view, so
  every frame of every focus spring rasterised two rims on the main thread (a
  quarter of it during moves). The rim clips now (it holds no children), so
  Core Animation draws its border; and every fade in the stadium lights is on
  a bare wrapper around a still gradient -- the wash was rebuilding a
  full-screen radial gradient on every frame of every pulse.

What is left on the JS thread per press is the focus and blur events
themselves reaching JS. For comparison, Challenges -- the 15 ms screen on
hardware -- measures 45 renders and one commit per move on the same probe (its
panel re-renders for each row), so the play list is now the cheaper of the two.

The whole harness, origin/main (the numbers #94 and the third pass recorded) against this change, gross ms
per press with `noop_press` the harness's own cost. Every test passes,
12-15 included. The simulator's process CPU is mostly the main thread, so
these moved by the rim and the scroll commits; the JS thread's share is the
table above:

| | Before | After |
|---|---|---|
| Harness's own cost per press (`noop_press`) | 29.0 ms | 33.0 ms |
| Focus move, play list | 86.4 ms | 52.6 ms |
| Focus move, play list under the HUD | 92.5 ms | 55.3 ms |
| Focus move, front page / result / leaderboard | 88 / 79.4 / 68 ms | 53.8 / 52.5 / 51.7 ms |
| Focus move, My Stats / Challenges / Leaderboards pages | -- | 59.4 / 52.5 / 62.5 ms |
| Tab switch / Gut Check call | 186 / 171 ms | 136.7 / 172 ms |
| A season (CPU) / peak memory | 8.31-8.54 s / 439-445 MB | 8.73 s / 460 MB |
| A season in broadcast mode (CPU) / peak memory | 8.35 s / 445 MB | 8.23 s / 453 MB |

A season's peak is at the budget (460 MB): every control now mounts its rim
up front (one view each) and the play screen keeps its standing lights. If
it crosses, the rim is the first thing to look at. The real check is
`tv_jank` on the next TestFlight build: `/play`'s `js_median_ms` should come
down towards Challenges' 15 ms.

The rules, in `performance.test.ts`: no React state set on focus in a
control that does not read it; the rim clipped and childless; nothing in the
lights fades a view that paints; the Reanimated flag stays off.

### The fifth pass: the reveal

Real Apple TVs (`screen_ready`, tvOS 26.6.1, build 34) put the result screen
at 1486 ms to its first frame and 1856 ms settled, against 412 for play and
121 for Challenges. And that number starts at the navigation: it never saw
the time between Select on Reveal and the navigation being asked for.

Measured with `test16_Reveal` (three seasons, each ending in one measured
Select on Reveal) under `js-probe.sh`, which now also reports the app's own
`screen_ready`, when each commit of a heavy press landed and what it was made
of, and large commits outside any press (the page arriving later):

```bash
PROFILE=12 PROFILE_AT=reveal_ready scripts/perf/tv/js-probe.sh test16_Reveal
```

What it found, in order of cost:

- **The server round trip was in front of the navigation.** A ranked reveal
  awaited `rankedComplete` before `router.replace`, with the Reveal button
  showing a spinner: 1.1-1.3 s on the simulator between Select and the
  result's first commit, with the JS thread idle. On a real network, more,
  and none of it in `screen_ready`. The answer changes nothing the result
  shows until its board switch (a downgrade takes the switch away; the note
  is diagnostics only), so the reveal now navigates first and asks after
  (`confirmWithServer` in `play.tsx`). A late answer downgrades only the
  season it was asked for: one that comes back after Build Another leaves the
  next season alone.
- **The page under the broadcast record was the whole first commit.** The
  scoreboard, the roster, both panels, the confetti and the share card, all
  behind an opaque graphic -- and then all of it again, four times: once
  because the graphic told the page it was up from an effect, through a store,
  and once because the spread starts as a single page and is measured into a
  book. Now the screen knows whether the record is up on its first render, the
  graphic is memoized, and the page mounts in the hold after the slam
  (`SLAM + 400 ms`), built (`useTimeline(..., { from: 'end' })`) -- its
  choreography had always played behind the glass, where nobody saw it. Select
  before then brings it at once, under the graphic's fade. A TV waits for the
  spread's measurement (at most 120 ms) before mounting the page.
- **The share card never mounts on a TV**, which has nowhere to share to.

| Reveal, simulator, Release | Before | After |
|---|---|---|
| Select to the result's first commit | 1117-1335 ms | 35-44 ms |
| `screen_ready` first frame (from the navigation) | 130-146 ms | 34-58 ms |
| Commits building the page on arrival | 5 (~2,760 renders) | 0; the record is 225 renders |
| Renders in the press's first 1.5 s | 3,068-3,072 | 707-714 |
| The page, later, under the record | -- | 1 commit, ~390 renders, at ~2.47 s |
| JS thread, 12 s around one reveal (Time Profiler) | 549 ms | 185-233 ms |
| Process CPU, 5 s from Select | 1.30-1.44 s | 0.78-0.82 s |

The record graphic and the page under it look as they did
(`VIEW_SHOTS`, `reveal-record.png` and `reveal-page.png`): the record is
unchanged, and the page was always settled by the time anybody dismissed it.

What is left on the press: the play screen re-renders once for the
completed game (~320 renders) in the frame before it unmounts, and the
navigation itself. The check is `screen_ready` for `/result` on the next
TestFlight build, and the time from Select to it, which is now most of it.

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
