# The GPU layer

Three things are drawn on the GPU with [Skia](https://shopify.github.io/react-native-skia/):
Metal on iOS, Vulkan or GL on Android, and CanvasKit (WebAssembly over WebGL)
on the web.

| Effect | Where | What it does |
|---|---|---|
| `effects/turf.tsx` | under the lineup (`Field.tsx`) | Mowing bands, grass grain, four floodlight pools and a slow sheen. The lights stutter on when the field appears, and burn brighter as an iPhone Duo folds. |
| `effects/seam.tsx` | the fold (`SpreadLayout.tsx`) | A line of field-green and ice light travelling along the hinge. Flat, it is quiet; folding brightens it and shades the pages either side. |
| `effects/fireworks.tsx` | the result (`Celebration.tsx`) | Hundreds of fluttering confetti and up to nine firework shells in one Skia picture. On a Duo the shells launch out of the fold and burst over both pages. 12+ wins gets a shell. |

Plain views do the rest, kid-friendly by design. A player landing in a slot
bounces in and throws sparks in the position's colour (`Field.tsx`, Reanimated).

## Rules the code depends on

- **Skia is imported only under `src/features/gpu/effects/`, and those modules
  are reached only through `gpu()`** (`src/features/gpu/index.tsx`). On the
  web, Skia's entry builds its API from `global.CanvasKit` when imported, so
  a static import anywhere in the startup graph throws before anything renders.
  `gpu.test.ts` fails the build on either kind of import.
- **Every effect has a fallback, and the fallback is what was there before.**
  It shows while CanvasKit loads, when the `gpu_effects` flag is off, and when
  loading fails: offline on a first visit, or a browser without WebAssembly.
  A failure is logged as `[gpu] effect fell back:` and never shown.
- **`canvaskit.wasm` is served from our own origin.** Nothing is fetched from a
  CDN, so there is no new third party in the privacy policy and offline play
  stays intact. `apps/mobile/scripts/copy-canvaskit.mjs` copies it into
  `public/` on install (it is gitignored), and `scripts/verify/web-head.mjs`
  fails an export without it. It loads only when the first effect does, not
  with the page.
- **Reduce Motion stops every clock.** The turf and seam keep their picture
  and stop redrawing. The celebration and the landing sparks do not run.
- **Colours are tokens.** The grass is `turfDeep`/`turfLit`, new in both
  palettes, because a field is green in every theme. `features/gpu/color.ts`
  turns a token into shader floats without importing Skia.
- **The show ends.** `features/gpu/show.ts` lays out a celebration as plain
  numbers with an end time, and the canvas is driven by one `withTiming` to
  that end. Nothing keeps redrawing after the party.

## The kill switch

`gpu_effects` (fallback on). Remember that **a flag PostHog does not mention is
off** (`docs/feature-flags.md`). A new flag ships dark until
`scripts/posthog-flags.ts --apply` has created it.

## What has not been seen on hardware

The shaders and the picture were checked in desktop Chrome, on CanvasKit over
WebGL. Metal on a real iPhone, and the hinge-driven brightening on a real Duo,
have not been watched yet. Headless Chrome's software WebGL draws the canvases
blank, so screenshot harnesses show the fallbacks.
