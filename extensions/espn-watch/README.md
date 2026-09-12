# 18-0 on Watch

A Chrome extension that puts a playable 18-0 card into a row on
[espn.com/watch](https://www.espn.com/watch/), to show what the game looks like
sitting where people already are.

<br>

## Load it

Chrome → `chrome://extensions` → **Developer mode** on → **Load unpacked** →
choose this folder. Then open `espn.com/watch`.

**Handing it to somebody else:**
[download the zip](https://github.com/mutaaf/18-0/releases/latest/download/18-0-on-watch.zip)
— 194K, this folder and nothing else, so there is no monorepo to unzip and no
path to go hunting for. `pnpm pack:extension` rebuilds it; the same sources make
the same bytes, so a release asset can be checked against a rebuild.

It is loaded unpacked on purpose and is not published. See
[What this is, and is not](#what-this-is-and-is-not).

<br>

## Use it

The toolbar button has four controls.

| | |
|---|---|
| **Show the card** | Off leaves the page completely untouched. |
| **Match the Watch UI** | On, it takes the page's own shape and voice — the same box, corner and hover as its neighbours as a tile, the section-label typography as a band. Off, it announces itself. |
| **Tile in a row** | A card among the thumbnails, in the **Row** you choose. |
| **Inline header** | A band across the full width of the shelf, in the **Gap** you choose. |

**The two placements are independent, and both can be on at once.** Each has its
own position, because they are different kinds of answer: a tile goes *in* a
row, and a band goes in a *gap*, named by the row below it — "Above JUST FOR
YOU" — because a row name alone is ambiguous about which side of it the band
lands on. The last gap has no row below it and is listed as "Below the last row".

They were one **Placement** setting with one shared position. An install from
then still works: a stored `tile` or `header` is read as the flags that replaced
it, along with the row it had chosen, and retired the first time either switch
is touched.

Clicking the card opens the game over the page. Escape closes it.

The panel holds two views — **Play** and **Leaderboard** — chosen by a segmented
control in its header. They are two URLs on the same route rather than two
routes; see [What it loads](#what-it-loads) for why that is not a detail.

**Slots, sponsorship and copy** are on the options page — right-click the
toolbar icon, or press **Corners, text & sponsor…** in the popup.

<br>

## The four corners

The card is a picture with four named corners over it, and each corner is a
slot: a place, a type, whether it is shown, and — for the image types — a file.

| slot | default | |
|---|---|---|
| `topLeft` | `logoImage` | The mark, and the tagline under it |
| `topRight` | `image` | A file, and the headline beside it |
| `bottomLeft` | `pill` | The call to action |
| `bottomRight` | `sponsoredPill` | The sponsor line, and the sponsor's logo |

**The tile and the band build the same four.** They are one composition at two
sizes, and while each built its own corners the two drifted — the sponsor line
moved on one and not the other, and the band grew a second answer to a question
the tile had already answered. Now there is one layer and two grids: the tile
has two columns and the artwork's height to spend, the band has three — slots,
copy, slots.

**Every corner names its own cell.** Auto-placement reads fine until a slot is
switched off, at which point the next one slides into the empty cell and the
bottom-left pill appears in the top right. A position is the point of a named
slot; it does not get to depend on its neighbours.

**`logoImage` is not `image`** because it has something to draw with no file
set: the wordmark is markup, so the default install shows a logo without
shipping an asset. Point it at a file and the file wins.

**Two lines do not survive the tile.** The headline is dropped at 300×169 —
three words of 9px type in the part of the card that is not the wordmark either
wrap into the button below or shrink past reading, and the image alone still
says what the corner is. The tagline is dropped in the *matched* look only,
where it is the flourish the corner badge used to be. Both are on the band,
which has a line's width to put them on.

**An image is an `https://` address or a file this extension ships** —
`icons/crest.png`. Everything else is refused before it reaches a `src`:
`javascript:`, `data:`, `//host/path`, and anything climbing out of the folder
with `..`. It is an allowlist of two schemes rather than a list of what to ban,
because a denylist is one scheme away from being wrong. A refused path is saved
and simply not drawn, and the options page says which one and why — an options
page that silently discards what somebody typed is one they retype it into.

A bundled path is resolved through `chrome.runtime.getURL`, because a relative
`src` set from a content script resolves against espn.com rather than against
the extension and 404s in silence. That call is also the first thing to go when
the extension is reloaded under a page still running it, so a missing one is a
slot without an image and never a card that fails to be placed.

**The only image shipped is ours** — the crest every launcher icon is generated
from. No club or league mark is bundled, referenced or defaulted to; the slots
exist precisely so that pointing one at a file is a local decision made by
whoever typed the path. See the licence note in the root README.

<br>

## Copy

Every string the card shows is a field, and `{sponsor}` can go in any of them:

    Title      18-0 — build the perfect roster
    Subtitle   Seven spins · Plays here
    Action     Play a season
    Tagline    Build · Play · Goat
    Headline   Can you go perfect?
    Sponsor    Presented by {sponsor}

With no sponsor name set, the token is removed **along with the words holding
it** — "Presented by {sponsor}" becomes nothing rather than "Presented by", and
"Seven spins · {sponsor}" becomes "Seven spins". So one set of defaults reads
correctly sponsored and unsponsored, and nobody maintains two.

The tagline and the headline are copy rather than slots of their own. A slot
says where something is and what kind of thing it is; what it *says* is the
thing the copy model already holds, already fills `{sponsor}` into, and already
edits with one line of HTML on the options page. A second model beside it would
be a second place to look for a string.

Four settings were absorbed and are still read out of storage, the way
`placement` is. `sponsorBanner` is now the bottom-right slot's own switch — two
switches for one question is one of them somebody turns off looking for the
other. `copy.tileBadge` is the top-right headline, the same few words in the
same corner. And `logoOn` and `logo` were one image in one place before a
corner was a slot: they are `topLeft`'s `show` and `image` now, which is the
same mark in the same corner and can also be moved, retyped or switched off
with the three beside it.

### The call to action

A label and a link, on the tile beside the subtitle, on the band beside the
button, and in the panel's footer. It is a **link in all three**, never a second
button: the primary action is playing, and on the tile that is the whole
artwork — a pill beside it would be two primary actions and a decision nobody
asked to make.

Empty link means no call to action anywhere, and the switch above it means the
same while keeping the link configured. Both are silent on the card, so the
options page says which one is in force rather than leaving somebody to guess
why nothing appeared. `{sponsor}` works in the link as well as the label, since a
campaign URL usually wants the name in it.

### The light on a mark

A corner holding an image gets it lit rather than placed — `logoImage` and
`image` both, because which corner holds a mark is configuration and a
treatment that only worked in one of them would be a setting that looks broken
in the other. Three layers read the pointer's position over the card — written
as two custom properties, everything else is `calc()` — and produce one light
with three consequences:

| | |
|---|---|
| the gloss | a highlight that moves toward the cursor, **masked with the logo's own image** so it travels *through* the mark. Unmasked it is a rectangle of shine over a transparent PNG, which reads as a pane of glass in front of the card rather than as light on the thing. |
| the tilt | a small perspective rotation away from the cursor, so the mark is an object above the artwork and not a sticker printed on it. |
| the shadow | `drop-shadow`, not `box-shadow`: cast by the alpha channel, so a crest with a crown casts the crown. It falls opposite the highlight, which is the part the eye checks. |

Under `prefers-reduced-motion` the light **settles rather than vanishing** — a
fixed sweep across the top-left of the mark, where the card's own light comes
from, with the shadow it would cast from there. Turning the treatment off
entirely is the easy thing to write and it leaves somebody who asked for less
movement looking at a flat sticker.

The shipped crest is 320px wide and drawn at around 60, because an asset the
size it is drawn at looks correct on the machine it was built on and soft on
every retina screen after that. The check asserts the ratio.

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

**Still there is not still ours.** The band goes in as the first child of a
container React hydrates, and React matches a container's existing children to
its own by position: it claimed our div as the element for the shelf below,
emptied it, and rendered the whole Featured carousel *inside* it. The node was
still in the document, still had our id, still had the parent we remembered —
so "is it settled" answered yes and nothing ever looked again. What the page
showed was espn.com's own row sitting inside an enormous empty band, until it
was reloaded.

Two things follow. Ownership is a reference to a node we created, not an id
anybody can keep. And recovering from it may not call `remove()`: the page's own
content is inside our node now, so removing it would take the Featured row off
espn.com to fix our layout bug. The node stays exactly where it is and only our
claim on it goes — no id, no classes, no margins — leaving an anonymous wrapper
that lays out like the one React thinks it has. Three of those and the band
stops asking.

The band also waits for `readyState` to reach `complete` before going in at all,
which is what stops it being there for hydration to find. `?steal=1` reproduces
the theft in the fixture.

Three more things were measured off the live page rather than assumed:

- **A tile goes in the row's second slot.** The first sits under the left edge of
  a `SECTION.overflow-hidden` and moves with the rail's scroll — it measured at
  `x=-4` on a fresh load and around `x=-110` a moment later.
- **The thumbnail is found by shape, not by tag.** Asking for `img, picture,
  video` returned a `<picture>` measuring 300×19, a lazy image that had not
  resolved, and the card rendered as a squashed strip. The widest child with a
  thumbnail's proportions is the artwork, whatever it is made of.
- **A shelf is not "the first ancestor with a heading in it".** That is what
  `shelfOf` used to ask, and on the real page the answer is
  `DIV.Carousel__Outer` — which contains *ten* headings, because a programme
  title is an `h3`. The band went inside the carousel, between a section label
  and the rail that label introduces, and then lined itself up against a
  programme name. What is actually true, climbing from the rail: every wrapper
  up to the shelf holds exactly one rail, and the first ancestor holding several
  is the container of all the shelves. So the shelf is the last element on that
  climb still holding one, and the section label is the heading that is *not*
  inside a rail. Both are structural in the same way `findRows` is.

## How it looks like it belongs

Three things are copied off a real neighbouring tile rather than chosen, and
they are the difference between a card in the row and a card on top of it: the
box (width, artwork height, corner, margins), the **transition timing**, and the
**hover transform**.

The height is the *tallest* tile's, not the anchor's. A real row is not one
height — measured on espn.com, three neighbours at 217, 224 and 240 — and these
rails centre their children, so matching the anchor left the card eight pixels
below the top of the line: the one card in the row sitting slightly low, which
is exactly the tell that something else put it there. Matching the tallest lines
it up however the rail aligns, and it cannot push the row down, because it is a
height the row already has.

The last of those cannot be read with `getComputedStyle` — a `:hover` rule is
not in the computed style of an element nobody is pointing at — so the page's
stylesheets are walked for a hover rule that describes the tile or something
inside it, and its transform is taken. `cssRules` throws on a cross-origin
sheet, which is most of a CDN's, so a sheet that will not open is skipped; the
walk is budgeted, because it counts rules rather than elements.

The artwork itself is the game's: the field the app's own `Field` component
draws — chalk yard lines, hash marks, mowing stripes at one and a half per cent
— with the season along the bottom edge as eighteen marks, seventeen in chalk
and the eighteenth in gold. Nothing is fetched; it is inline SVG and CSS, and
there are no gradient ids, because a fixed id resolves against the whole
document and a second card would silently blank the first.

## Testing it

    node extensions/espn-watch/fixture-check.mjs

`fixture.html` is a page shaped like the real one — several rows, wrapped as
deep as the live page wraps them, mutating after load — run in headless Chrome.
The checks are the symptoms: one card, never more, never moved after placement,
fully on screen, in either placement and in both at once.

The fixture carries the decoys that actually fooled it: tiles whose children are
absolutely-positioned overlays, captions of differing length in a rail that
centres its children, and programme titles that are `h3` headings inside the
tiles — which is what sent the band into the carousel. It also loads
`content.css` — it did not at first, so every alignment assertion was measuring
an unstyled card and passing on nothing.

Three of its checks exist because an earlier version passed while the band was
in entirely the wrong place: a band *inside* a carousel still precedes the first
rail, so "it sits above the first row" was true of it. They ask where it
actually is — a sibling of the shelves, outside the shelf below it, above that
shelf's own label — and the alignment is measured against the section label
rather than against any heading.

`?tile=0&band=1`, `?tile=1&band=1` and `?match=0` drive the placements and the
two looks. `?placement=header` still works, and is checked, because a stored
setting from before the rename has to keep meaning what it meant. `?panel=1`
opens the panel on the board, reads the frame's `src` and its height, clicks
through to Play and reads both again — then takes the panel away, because its
frame points at the real embed and the fixture must never be able to wait for
the network. `--host-resolver-rules=MAP * ~NOTFOUND` is what guarantees that:
virtual time pauses while a fetch is outstanding, so a request that hangs rather
than refuses is a harness that times out with nothing on stdout, which is a test
that hangs instead of failing. Every file the fixture needs sits beside it.

One run is made with `--force-prefers-reduced-motion`, and it asserts the
awkward half of that preference: the tilt is gone **and the light is still
there**. A media query that turns the whole treatment off passes "respects
Reduce Motion" and fails the person who set it.

Three things about the shine are checked rather than looked at, because all
three fail invisibly: a gloss with no mask is a rectangle of light that looks
deliberate enough nobody files it; a `calc()` the parser rejects drops the whole
declaration, so the mark just goes flat; and an asset the size it is drawn at is
only soft on somebody else's screen.

setting from before the rename has to keep meaning what it meant. `?off=topRight`
switches one slot off, which is the only state in which a named cell can be told
from auto-placement — with all four on the two agree, and with one off
auto-placement slides the call to action into the empty corner.

`?dead=1` reproduces a reloaded extension, in which every `chrome.*` call
throws, and checks that the card is still placed and the panel still opens. Two
things are guarded there rather than one: `store` refuses a dead context, and
`openPanel` builds the panel before it counts the open. Removing the ordering
alone does not fail the check any more — removing both does, which is the code
as it was when the bug existed. What fails today is an unguarded
`chrome.runtime.getURL` for a slot's bundled image: the card never reaches the
row, because placement was made to depend on artwork.

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

The frame reports which screen it is on — entry, play, result, board — with
`postMessage`, so the panel can size itself to a two-line card or a seven-row
roster. It is one-way and advisory, the listener checks the origin before
reading anything, and the payload is the name of a screen. A screen the height
table does not name is dropped, so **adding a view to the embed means adding it
to `FRAME_HEIGHT`** or the panel silently stays whatever height it was.

The leaderboard is `https://18-0.co/embed?view=board` — a *view on the embed
route*, not a second path, and that is the security decision above rather than a
naming preference. `vercel.json` scopes `frame-ancestors` to `/embed`; a
`/leaderboard` frame would need that file changed, and a deployment that quietly
did not happen is what a mistake there looks like — a panel that opens on a page
refusing to be framed. The check asserts the exact URL for this reason.

<br>

## What this is, and is not

**It is** a demo. It runs on the machine you load it on, it adds a card and a
band to a page — one, the other, or both — and it changes nothing else on it.
The panel that opens says who put it there, in both looks, because something
that opens a window over somebody's page should say so.

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

**Nothing here is bundled or versioned.** There is no build step and no
minifier; the scripts are loaded as plain files in the order the manifest lists
them, and they share one isolated world by convention. That is deliberate for
something read as much as run, and it is not how you ship a Manifest V3
extension to a store. `web_accessible_resources` names `icons/*.png` and nothing
else, scoped to espn.com — a slot's bundled image has to be reachable from the
page, and every file listed there is a file any script on a matched page can
read.

It names the two ESPN hosts the content script already runs on rather than
`<all_urls>`, because a resource readable from anywhere is a way for any site to
detect that this extension is installed.

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
