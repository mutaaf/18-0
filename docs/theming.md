# Theming

18-0 has two visual identities and can gain more. This is how that works, what
it is allowed to touch, and the one mistake the whole design exists to prevent.

## The two themes

| | Broadcast | Turf |
| --- | --- | --- |
| Ground | near-black with navy in it | saturated deep navy, with a woven pinstripe |
| Action | broadcast red `#D50A0A` | field green `#5FBB46` |
| Label on action | white | near-black — white on that green is 2.4:1 |
| Shape | hard-edged, 6–20pt corners | soft, 10–28pt corners |
| Feel | a night game, lights blowing out the corners | a one o'clock kickoff |

Gold does not move. It is not a hue here, it is *the chase*, and the crown an
earned 18-0 wears is the same colour in both.

Turf is navy and field green — the stands and the grass. The club rule in
CLAUDE.md still applies: no club names, marks, logos or colours, and the green
is deliberately pulled toward turf rather than the brighter action green a
particular north-western club is known for.

## What a theme may change

Surface only: colour, and how round things are. A theme may not reach anything
that decides what a season scores — same invariant as feature flags, for the
same reason. `packages/domain`, `packages/data` and `supabase/` know nothing
about any of this.

## The trap this design exists to close

Every component file ends with a stylesheet built at *module scope*:

```ts
const styles = StyleSheet.create({ root: { backgroundColor: color.void } })
```

That runs once, when the module is first imported, and copies the string out of
the palette. Nothing can change it afterwards — not a context, not a re-render,
not a state update. A theme switch would move the whole app except the forty
places that actually paint it.

The observation that avoids rewriting all forty: *every other* colour read in
this codebase already happens during render — `fill={color.silver}` in JSX,
`borderColor: tint ?? color.line` in a style array. Module-scope
`StyleSheet.create` is the only thing that freezes. So it gets one wrapper:

```ts
const styles = themed(() => StyleSheet.create({ ... }))
```

`themed` returns a proxy that resolves to the current theme's sheet on every
property access, building each theme's sheet once. No component body changed.

Two consequences worth knowing:

- **`color` and `radius` are mutated in place**, never reassigned. Forty modules
  captured those object references at import time; swapping the export would
  leave every one of them pointing at the palette that is no longer active.
  This is the only place in the codebase that mutates a module-level object.
- **A `memo`d component needs `useThemeId()`**. A theme change moves none of its
  props, so nothing re-renders it. `StadiumBackdrop`, `Field`'s `Turf` and
  `PlayerCard` each call it; anything new that is memoized must too.

## Adding a colour

Add the token to `Palette` in `src/theme/palettes.ts` and give it a value in
**both** themes. Never reach past `color` for a literal.

`theme.test.ts` enforces this by reading the source tree, and it catches two
different versions of the same mistake:

- a **dark literal** (`'#0A0E17'`) is a ground standing in for a token, and it
  stays black when everything around it turns navy;
- a literal **equal to a token's value** (`'#D50A0A14'`) is that token spelled
  out by hand — it looked right for as long as the action colour was red, and
  left a maroon card sitting in the middle of a green theme the moment it was
  not.

White-alpha overlays (`#FFFFFF0A`) and black shadows are the deliberate
exceptions: they are lighting, not colour, and read correctly on any dark
ground. Anything else needs a line in `isAllowed()` and a reason.

The same file also asserts that both palettes declare exactly the same tokens —
a missing one is `undefined`, which React Native drops in silence — and that
label and body text clear 4.5:1 against what they sit on.

## Adding a theme

1. Add the id to `ThemeId` and a `Theme` to `THEMES` / `THEME_LIST`.
2. Fill in every token. The test will tell you which ones you missed.
3. That is all. The picker enumerates `THEME_LIST`, and each option paints its
   own swatch from its own palette.

## Shipping it

The picker is behind `theme_picker`, which is **off by default** — a device that
never reaches PostHog is a device this has not been evaluated on. To turn it on,
create a boolean feature flag named exactly `theme_picker` in PostHog and roll
it out. The registry entry carries the rest.

Turning the flag off puts anybody already on Turf back onto Broadcast, from
wherever they are: `useThemeFlagGuard()` runs in the root layout, not in the
picker, because a kill switch that only runs where the control is drawn reaches
somebody exactly when they go looking for the control.

The reverse is not symmetrical on purpose. Turning the flag back on restores
nobody to Turf — re-theming somebody's app without them asking is the thing this
is avoiding, not a feature.

## Where the choice lives

`AsyncStorage` under `18-0:theme`, restored by `startTheme()` at boot alongside
the other non-blocking starts. Nothing waits for it: the app renders in
Broadcast and repaints when it lands, which on a warm start is a frame or two.

On web the same call paints `<html>`, `<body>` and the `theme-color` meta tag,
because the browser paints the document before React mounts and keeps showing it
through overscroll — without it a navy app bounces against a black gutter and
mobile Safari's address bar stays the wrong colour the whole time.
