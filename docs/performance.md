# Performance on a phone

The Apple TV has its own budget and harness (`docs/apple-tv.md`,
"Performance"). This is the phone's: iPhone, iPad, Android and the web, which
run the same screens.

## Measuring

```bash
cd apps/mobile && EXPO_BASE_URL=/18-0 npx expo export -p web --output-dir ../../dist && cd ../..
node scripts/perf/phone/web.mjs dist                 # timed, median of 5 runs
node scripts/perf/phone/web.mjs dist --renders       # component renders per step
```

`scripts/perf/phone/web.mjs` plays a real Scout season in a 393x852 Chromium
with the CPU throttled 4x and 300 seasons of history seeded (a returning
player's front page, stats and result all walk the history; a fresh install
hides every cost that grows with it). For each step -- cold start, three tab
switches, opening a game, six spins, seven picks, the reveal -- it prints the
wall time, the main thread's busy time, the script and layout time, the
longest single task, and with `--renders` how many components rendered and
which ones most.

Read it this way:

- **Renders are the number to compare first.** They do not move with the
  machine's load, and a render saved on the web is a render saved on Hermes:
  the screens, stores and memo boundaries are the same code.
- **Busy and script time are noisy** by 5-10% between runs on a machine doing
  anything else. Compare an old and a new export interleaved, not one run
  against a number written down last week.
- **Wall times that include an animation** (the reel is 1.27 s by design, the
  hero holds 450 ms) are not latency. Compare busy time for those steps.
- **What it cannot see is native**: Fabric commits, Yoga, Svg rasterising on
  the main thread, Hermes loading the bundle. WebGL is off (headless Chrome
  draws the turf in software, which is most of the frame and nothing a phone
  pays), and on the web `useNativeDriver` animations run on the JS thread, so
  commits per step are far higher than on a phone.

The startup clock a real phone reports is `app_started` (`features/diagnostics/startup.ts`).

## Rules the numbers came from

`src/features/performance.test.ts` fails the build on each of these.

- **A player row's team wash is one gradient layer** on the card
  (`experimental_backgroundImage` natively, `backgroundImage` on the web), not
  an Svg. The Svg was seven components a row -- 33 DOM nodes a row became 25
  -- and on iOS a CPU raster per row, for a list that is a whole spin long.
  The TV had made the same change for the same reason.
- **The rows grow inside `PlayerList`**, not in the play screen. They arrive a
  batch per frame (`useGrowing`); with the counter in `Play`, every batch
  re-rendered the header, the hero, the bar and the chips.
- **No screen subscribes to a whole store.** `useGameStore()` with no selector
  re-renders on every write; the result screen did.
- **The front page's marquee is memoized.** The front page stays mounted under
  every game and re-renders on each pick (its resume card counts them); the
  marquee's thirty cards went with it.
- **A slot's landing sparks unmount once they have flown.** Kept, seven filled
  slots held seventy animated views that every later spin and pick
  re-rendered.
- **The result's off-screen share card mounts at `CUE.digits`**, not in the
  commit that puts the result on the glass, which was the longest single task
  of a season. The buttons that use it appear at `CUE.tail`; a skip settles
  the page and mounts it at once.

- **A ranked reveal navigates before it asks the server for its score.** The
  round trip used to sit between the tap and the result, behind a spinner on
  the Reveal button; the answer only ever takes the board switch away, so it
  arrives while the record builds (`confirmWithServer` in `play.tsx`; held by
  `src/features/tv/performance.test.ts`, and measured in docs/apple-tv.md,
  "The fifth pass"). A casual reveal, which never asked, is unchanged:
  9,767-9,853 renders before and 9,750-9,820 after.

## The 2026-11 pass, measured

Interleaved runs of the export before and after (`--runs 5` each, CPU 4x, 300
seasons of history; medians, ms):

| Step | Before | After |
|---|---|---|
| Opening a game and its first spin: renders | 7,411 | 5,621 (-24%) |
| Seven picks: renders | 11,259 | 7,526 (-33%) |
| Seven picks: script | 1,506 | 1,353 (-10%) |
| Seven picks: wall, tap to next frame | 2,027 | 1,780 (-12%) |
| Reveal: longest task | 207 | 181 (-13%) |
| Reveal: wall, tap to result | 340 | 312 (-8%) |
| Six spins, cold start, tab switches | -- | within run-to-run noise |

## Usability

Presses, not milliseconds: how many taps (or remote presses) the core
journeys take, and where a player meets a dead end -- a screen whose next
action is off the glass, a press that does nothing, a button that does not
say what it will do. Walked from a fresh install:

```bash
node scripts/perf/phone/journeys.mjs dist --shots /tmp/journeys   # phone-sized web, 393x852
scripts/perf/tv/run.sh test17_Journeys                            # Apple TV, with the remote
```

The phone and the web are the same screens; the counts are the web export's,
and the iPhone simulator was checked by eye (`journeys.mjs` cannot drive it).

### What Play starts

Every generic way into a season -- Play on the front page and its closer,
the dock's PLAY pressed on the front page, Build Another, Games' and an empty
My Stats' Play, the site's "Play in the browser", the embed, the play screen
opened with nothing under way -- starts **the lens last started**, with the
ranked switch as the player left it, and says which on its face ("Play ·
Scout"). A button that names a lens starts that lens, and that becomes the
last. Gameday and challenges never do: one is open only inside its window and
the other is somebody else's one-off question, so Play after either goes back
to the lens the player chose. No history is Scout. The rules and their tests
are `apps/mobile/src/state/next-season.ts`; the embed keeps ranked on, as its
frame has no switch to turn it back.

### Phone and web, 2026-11-24

| Journey | Before | After |
|---|---|---|
| First visit to the first spin (site) | 2 taps + 1 scroll; Play below the fold | 1 tap ("Play Scout in the browser" starts it) |
| First launch to the first spin (app) | 1 tap | 1 tap, and the button names the lens |
| A season, seven picks | 16 taps + 3-5 scrolls past full positions | 16 taps, 0 scrolls |
| Result to the next season | 1 tap, lens unstated | 1 tap, "Build Another · Scout" |
| PLAY in the dock, on the front page | dead press | resumes, or starts the last lens |
| Empty My Stats to a season | 2 taps (detour to the front page) | 1 tap |
| Games' Quick play | always Scout, always ranked, unlabelled | the last lens, the ranked choice, named |
| After a challenge or a gameday, Play starts | GM Mode / Scout (whatever was left in `mode`) | the last lens the player chose |
| Switching lens | 1 tap + 1 scroll | unchanged |
| My Stats, Challenges, Leaderboards, Games | 1 tap each | unchanged |

The 16 taps of a season are seven picks, six spins, the reveal and two slot
choices (a running back or receiver who fits both of two slots): not dead
ends, because RB1 and RB2 weigh differently (`ROSTER_WEIGHTS`).

### Apple TV, 2026-11-24

Remote presses, `test17_Journeys`, a fresh install on "Apple TV 4K (at 1080p)":

| Journey | Before | After |
|---|---|---|
| Launch to the first spin | 1 (Play focused at launch) | 1, and Play names the lens |
| A season, seven picks | 17 (7 picks, 6 spins, 2 slot choices, Reveal, the broadcast record) | 17 |
| Result to the next season | 2 (dismiss the record, Build Another) | 2, and Build Another names the lens |
| Menu from a season | the front page, on Resume or Play | unchanged |
| Switching lens | 3 (down, right, Select) | 3; Play then names the new lens |
| Empty My Stats to a season | 2 (a detour through the front page) | 1, and the remote starts on it |
| A challenge to answer | no initial focus | the remote starts on "Answer it" (or "Back to 17-0") |
| My Stats / Challenges / Leaderboards from launch | 7 / 6 / 4 | 7 / 6 / 4 (see below) |
| Menu from a tab | Play, focused | unchanged |

Left open: up from the front page lands on **Games**, the bar's first tab,
until a tab has been picked, because the bar is an `autoFocus` guide with no
memory yet. Landing on the tab you are on would save two presses to My Stats
and Challenges, but the only way to aim a guide is `destinations`, which this
bar is forbidden by test (`performance.test.ts`, builds 27 and 28). The front
page's "Your seasons" and "Leaderboards" tiles are the shorter way in.

### The rules, held by `apps/mobile/src/features/usability.test.ts`

- **Every Apple TV screen says where the remote starts** (`hasTVPreferredFocus`
  or `useTVInitialFocus`), or is on a short list of exemptions with the reason.
  The challenge screen had none, so the remote landed wherever UIKit's search
  went.
- **No Play button is a bare "Play a season" or "Quick play"**: each names the
  lens it starts.
- **An empty state starts the thing it is empty of**, rather than sending the
  player to find the button somewhere else.
- **A spin lists the players who can still go somewhere first**
  (`features/play-order.ts`); a full position's rows sink below them.

## Tried and not kept

- **Inline requires** (`inlineRequires: true` in Metro). Expo Router requires
  every route at launch, so deferring each import to its first use looked like
  a free cold start. On the web export it moved the cost rather than removing
  it (cold-start script time within noise, the first spin slower), and it
  changes when every module's side effects run. Not worth that risk unmeasured
  on Hermes.
- **`freezeOnBlur` on phones.** It stops the front page re-rendering under a
  game, but a frozen screen is hidden with Suspense, and the card sheet is a
  modal through which the screen beneath stays visible. Not without a device
  to watch it on.
- **FlashList for the eligible list** was not tried. The measured spins
  mounted between 16 and 29 rows, all but one screenful of them a batch per frame
  after the first; the list shares one scroll with the hero and the field,
  which `scrollTo` and `verify:fold` both depend on. Worth measuring only if a
  spin's pool grows past a few screens.
