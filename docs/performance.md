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
