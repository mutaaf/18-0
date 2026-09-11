# 18-0 on Watch

A Chrome extension that puts a playable 18-0 card into a row on
[espn.com/watch](https://www.espn.com/watch/), to show what the game looks like
sitting where people already are.

<br>

## Load it

Chrome → `chrome://extensions` → **Developer mode** on → **Load unpacked** →
choose this folder. Then open `espn.com/watch`.

It is loaded unpacked on purpose and is not published. See
[What this is, and is not](#what-this-is-and-is-not).

<br>

## Use it

The toolbar button has three controls.

| | |
|---|---|
| **Show the card** | Off leaves the page completely untouched. |
| **Match the Watch UI** | On, it takes the page's own shape and voice — the same box and corner as its neighbours as a tile, the section-label typography as a band. Off, it announces itself. |
| **Placement** | **Tile in a row**, or **Inline header** — a band across the full width of the shelf. |
| **Row** / **Gap** | Where it goes. A tile goes *in* a row. A band goes in a *gap*, named by the row below it — "Above JUST FOR YOU" — because a row name alone is ambiguous about which side of it the band lands on. The last gap has no row below it and is listed as "Below the last row". |

Clicking the card opens the game over the page. Escape closes it.

<br>

## How it finds a row

Structurally, not by selector. The Watch page is a React app with generated
class names, so anything matching `.WatchShelf__row` works until the next deploy
and then fails silently — the card never appears and there is nothing to debug.

What does not change is the *shape* of a carousel: a container whose children are
several boxes of near-identical width sharing a top edge. That is what
`findRows()` looks for, and it is why the picker names rows by their visible
heading rather than by a path.

Rows arrive after first paint and re-render on navigation, so a `MutationObserver`
re-places the card — debounced, and behind a cheap guard that does no work at all
while the card is still where it belongs. Re-scanning a page like this one on
every mutation is a page that janks.

**The position is resolved once and then defended.** Re-deriving it on every pass
means the answer has to be stable on every pass, and it is not: a carousel is a
list inside a scroller inside a section, all three can look like a row, and
inserting the card changes the measurements that decide between them. So the card
moves, which changes the measurements, which moves the card. It resolves once,
remembers the node, and looks again only when that node has left the document.

Two more things were measured off the live page rather than assumed:

- **A tile goes in the row's second slot.** The first sits under the left edge of
  a `SECTION.overflow-hidden` and moves with the rail's scroll — it measured at
  `x=-4` on a fresh load and around `x=-110` a moment later.
- **The thumbnail is found by shape, not by tag.** Asking for `img, picture,
  video` returned a `<picture>` measuring 300×19, a lazy image that had not
  resolved, and the card rendered as a squashed strip. The widest child with a
  thumbnail's proportions is the artwork, whatever it is made of.

## Testing it

    node extensions/espn-watch/fixture-check.mjs

`fixture.html` is a page shaped like the real one — several rows, each wrapped
twice, mutating after load — run in headless Chrome. The checks are the symptoms:
one card, never more, never moved after placement, fully on screen, in both
placements.

Worth knowing what it does *not* do: it has never reproduced the original
flicker. No synthetic page I could build resolves rows differently between passes
the way espn.com does, so the check passes even with the guard removed. It holds
the property; the bug itself was diagnosed by measuring the live page.

<br>

## What it loads

`https://18-0.co/embed` — a play-only surface with no sign-in, no handle and no
account deletion, and the only path on the site that may be framed.

That split is a security decision rather than a design one. The obvious way to
get a game into a frame is to stop sending `X-Frame-Options`, and doing that
site-wide would put the account screen — including a button that deletes an
account and every season on it — inside a page whose owner controls where the
cursor lands. Clickjacking is a real attack against precisely that button. So
`vercel.json` scopes `frame-ancestors` to `/embed` and names the origins allowed
to hold it; everything else still refuses to be framed at all.

The frame reports which screen it is on — entry, play, result — with
`postMessage`, so the panel can size itself to a two-line card or a seven-row
roster. It is one-way and advisory, the listener checks the origin before
reading anything, and the payload is the name of a screen.

<br>

## What this is, and is not

**It is** a demo. It runs on the machine you load it on, it adds one card to a
page, and it changes nothing else on it. The panel that opens says who put it
there, in both looks, because something that opens a window over somebody's page
should say so.

**It is not** an integration, an endorsement, or anything to publish. Injecting
UI into a site you do not own is fine for showing an idea to your own team and is
a different question entirely once it is distributed — which is why this is
loaded unpacked rather than sitting in the Chrome Web Store, and why the manifest
asks for `espn.com/watch` and nothing wider.

18-0 is unaffiliated with, and not endorsed by, ESPN or any league or club.
