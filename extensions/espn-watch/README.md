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

**Sponsorship and copy** are on the options page — right-click the toolbar icon,
or press **Sponsorship & copy…** in the popup. Every string the card shows is a
field, and `{sponsor}` can go in any of them:

    Title      18-0 — build the perfect roster
    Subtitle   Seven spins · Plays here
    Button     Play a season
    Sponsor    Presented by {sponsor}

With no sponsor name set, the token is removed **along with the words holding
it** — "Presented by {sponsor}" becomes nothing rather than "Presented by", and
"Seven spins · {sponsor}" becomes "Seven spins". So one set of defaults reads
correctly sponsored and unsponsored, and nobody maintains two.

<br>

## What it counts

The popup shows, for this browser:

    12m 30s watched · 3m 05s played · 11 shown, 3 opened

**Watched** counts while a video on the page is playing. **Played** counts while
the game is open. Both require the tab to be in front — a timer that keeps
running in a background tab reports an afternoon of engagement for a window
somebody forgot about.

**None of it leaves the machine.** There is no endpoint, no request, and no
identifier attached. That is a deliberate default rather than an unfinished
feature: the numbers a pitch needs are exactly as convincing measured on one
laptop, and measuring them on one laptop collects nothing about anybody. Turning
it into a pipeline is a separate decision with consent and retention attached,
and not one a default should make quietly.

<br>

## Linking an ESPN account

SWID is the identifier ESPN sets for a signed-in fan. It is stable, unique to a
person, and readable by any script on the page — which makes it trivial to take
and exactly the sort of thing that should not be taken quietly.

So it is asked for, once, in the panel, and only when there is a signed-in fan to
ask: *"Your seasons would carry your ESPN identity so they can rank on a shared
leaderboard."* Declining is a real answer and is not asked twice.

On yes, the SWID is hashed with a per-install random salt and **the raw value is
never stored or sent**. The result is stable enough to be the same fan tomorrow
and useless to anyone who sees it — it cannot be reversed, and it cannot be
matched against anybody else's copy of the same fan. Unlinking deletes the hash
*and the salt*, so a later yes produces a different identity with nothing joining
the two.

If this ever became something people install from a store rather than a demo
loaded unpacked, it would need a privacy policy naming it and a lawful basis —
and the salt should not be the only thing between a hash and a rainbow table of
every SWID in circulation.

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

The fixture carries the decoys that actually fooled it: tiles whose children are
absolutely-positioned overlays, and captions of differing length in a rail that
centres its children. It also loads `content.css` — it did not at first, so every
alignment assertion was measuring an unstyled card and passing on nothing.

Worth knowing what it does *not* do: it has never reproduced the original
flicker. No synthetic page I could build resolves rows differently between passes
the way espn.com does, so that check passes even with the guard removed. It holds
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

<br>

## Handing it to a team that will ship it

Everything here works. What follows is where a demo and a product differ, written
down so it is not rediscovered.

**The row detection is a heuristic, and it is the fragile part.** It is
structural rather than selector-based, which is the right trade for something
that must survive ESPN's deploys — but "children of even width that advance
across the page" is a description of a carousel, not a contract. It found 301
rows before the progression test was added. A shipped version wants a
selector-first path with this as the fallback, and something that reports when it
finds zero rows rather than silently placing nothing.

**Nothing here is bundled or versioned.** There is no build step, no minifier and
no `web_accessible_resources`; the scripts are loaded as plain files in the order
the manifest lists them, and they share one isolated world by convention. That is
deliberate for something read as much as run, and it is not how you ship a
Manifest V3 extension to a store.

**The attribution has no pipeline, on purpose.** Counters are written to
`chrome.storage.local` and read back by the popup. Sending them anywhere adds
consent, retention, an endpoint, and a schema the game's own telemetry already
has opinions about — see `apps/mobile/src/features/telemetry.ts`, which is the
natural shape to reuse rather than invent a second one.

**The ESPN link is demo-grade in exactly one way.** The consent flow, the
hashing and the delete-on-unlink are all real. What is missing is that a
per-install salt is the only thing between a SHA-256 and a rainbow table of every
SWID in circulation, and a published extension needs a server-side pepper, a
privacy policy naming SWID, and a stated lawful basis.

**The frame contract is the one thing outside this folder.** `/embed` is
framable and nothing else on `18-0.co` is; `vercel.json` names the origins, and
[`docs/hosting.md`](../../docs/hosting.md) explains why the split exists and the
two ways its configuration silently fails. Adding an origin means editing that
file, and a deployment that quietly does not happen is what a mistake there looks
like.

**`version` in the manifest is `1.0.0` and has never moved.** Nothing reads it
yet; a store listing will.
