# iPhone Duo, and the two-panel spread

Open an iPhone Duo like a book and the play screen splits at the fold: the
field on the leading panel, and everything you act with -- the score, the
wheel, the filters, the search and the player list -- on the trailing one.
Stand it in tabletop and the field goes above the fold with the controls
below. Leaderboards and My Stats split the same way. Any window wide enough,
the web included, gets the same two panels down a virtual seam, so this is
one layout rather than a Duo feature with a fallback.

The switch for all of it is the `dual_panel` flag (fallback on).

## Where the fold comes from

| Platform | Source | What it sees |
|---|---|---|
| iOS 27.1+ | `apps/mobile/modules/fold` -- `FoldSensorView`, a full-window, untouchable native view mounted once by `FoldProvider` | `reservedRegions(kind: .division, options: .includeInactive)` every layout pass, plus `UIHingeInteraction` |
| Web | `src/features/fold/web.ts` | `window.viewport.segments` and `navigator.devicePosture`, where they exist |
| Everything else | nothing | no fold; a wide window still gets the virtual seam |

Things the SDK settles that are easy to get wrong, and that the code relies on:

- **There is no fold notification, trait or `UIDevice` property.** UIKit
  re-runs `layoutSubviews` on a fold only for a view that *read* the regions in
  its previous pass. That is why the sensor is a view that reads them every
  pass, rather than a module function JS polls.
- **Layout uses the region, never the hinge angle.** The angle only shades the
  seam (`SpreadLayout.tsx`).
- **The fold is not in the middle of the safe area.** Book pose: 951 x 669 pt,
  an 84 pt vertical bar on the trailing edge, fold band 455.5-495.5. Halving
  the safe width puts the gutter 42 pt off the crease. `spread.ts` uses the
  fold where it is; `spread.test.ts` holds it to the simulator's numbers.
- **Flat and folded lay out identically.** A flat device reports the fold as
  an inactive region at the same frame. The spread uses it either way, so
  folding changes a shadow, not the layout (HIG: avoid rearranging while
  folding).
- **The sides are safe now.** On the Duo the status bar is a vertical strip
  (84 pt, on the camera's side when closed and turned). `Screen` insets left
  and right by default; the account disc and the dock clear it too, and the
  dock moves to the trailing panel instead of sitting across the fold.
- **Safari's fold APIs are a preview behind feature flags** (Settings > Apps >
  Safari > Advanced > Feature Flags), and are unavailable in `WKWebView`.
  Only the JS API is read: one device report has Safari's
  `env(viewport-segment-*)` values far larger than the segments.

## Building

The module uses iOS 27.1 symbols behind `#available(iOS 27.1, *)`, so the app
must be **built with Xcode 27.1 or later** (the iOS 27.1 SDK). On an older SDK
the symbols do not exist and the build fails -- `#available` cannot rescue a
missing declaration. Built with the 27.1 SDK the app also goes edge to edge on
both displays and gets the vertical bar; that is decided by the SDK linked, not
by any Info.plist key.

EAS chooses Xcode 26.6 for Expo SDK 57 unless told otherwise -- 1.0 (6) was
built that way -- so every profile in `eas.json` pins
`macos-tahoe-26.6-xcode-27.1`, and `src/features/fold/build-image.test.ts`
fails if one stops. Xcode 27 apps launch only with the UIScene lifecycle,
which `plugins/with-scene-lifecycle.js` already provides.

## What has not been checked on hardware

Every number here comes from the iPhone Duo simulator (Xcode 27.1/27.2). Before
trusting it on a device:

- Open as a book on the play screen: the gutter sits on the crease, no slot
  of the field and no row of the list crosses it.
- Fold flat and back: nothing re-lays out except the seam's shadow.
- Tabletop: field above, controls below, keyboard does not cover the search.
- Close it mid-game: the outer display gets the phone layout with the same
  game in progress.
- Turn it closed and sideways both ways: nothing under the vertical bar.

If any of that is wrong, `dual_panel` off in PostHog restores the previous
layouts with no build.
