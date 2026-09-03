# What this app uses, and on whose terms

A record of every third-party input, what happens to it, and what is published
as a result. It exists because "we have a licence" is not a single fact: reading
a source, deriving from it, and republishing the derivation are three different
permissions, and this project does all three.

Last reviewed **2026-09-03**.

## The short version

| Input | Used for | What ships | Terms |
|---|---|---|---|
| nflverse, 1999–2025 | Season statistics | Derived ratings, short stat lines | CC BY 4.0 — attributed |
| Pro-Football-Reference, 1980–1998 | Season statistics, standings, brackets | Derived ratings, short stat lines | Licensed to read. **Redistribution unconfirmed** |
| NFL CDN | Player photographs | Nothing — hot-linked at view time | **No licence.** See below |
| Club names, marks, logos, colours | — | Nothing, deliberately | Not used |

## What "derived" means here

No source file is republished. What ships is:

- **A rating per card** — a number computed by `@18-0/domain` from that season's
  statistics, z-scored against its own era and mapped through a calibration
  curve. It is not in any source and cannot be inverted back to one.
- **A short stat line per card** — four or five figures, the same facts a
  scoreboard shows.
- **The season ledger** at `/ledger.html`, which publishes the ratings, the
  component breakdown behind each, and a SHA-256 of every source file — the
  hashes, not the files.

The source data itself lives in `data/raw/`, which is gitignored in full. It is
not in the repository, not in the app bundle, and not on the web build.

## The open question

Pro-Football-Reference licensed the season tables and confirmed the reading
method. **Whether that licence covers redistributing derived ratings has not
been confirmed in writing**, and the derivation is now published in four places:
the app bundle on two public domains, the App Store and Play builds, the seeded
database, and the ledger.

That is the one item on this page that is not settled. It is worth settling in
writing rather than by inference, because the answer is almost certainly yes and
the cost of asking is an email.

**What to ask for, specifically:** permission to publish statistics *derived*
from the licensed season tables — a computed rating per player-season, plus a
short stat line — in a free consumer app and on a public website, with
attribution. Not permission to redistribute the tables, which is not wanted and
is not done.

## Player photographs — not licensed, and the larger exposure

`packages/data/src/headshots.ts` carries **1,626 image URLs** on the NFL's CDN,
fetched when a card is opened. Its own header says the images "are not ours to
redistribute". That was a deliberate proof-of-concept decision taken when
nothing was public; the app is now installable from the web, on a phone, and
heading for two stores.

Worth naming the inconsistency plainly: this project avoids club names, marks
and colours on the grounds that *the statistics are facts and the club name is a
trademark* — and then displays copyrighted photographs of the players. The
photographs are the larger exposure of the two, and unlike a trademark question
they are the kind of thing that gets an app pulled after it is live rather than
rejected before.

Removing them is one line. `headshotUrl()` returning `null` is enough:
`CollectibleCard` already degrades — `{photo ? … : null}`, with the comment *"a
missing one simply leaves the wash"* — and every team defence card has run
without a photo since the first build, so the fallback is proven in production.

Open options, in increasing cost: remove them; licence a source; commission or
generate something that is ours.

## What is deliberately not used

- **Club names, marks, logos and colours.** Franchises are identified by city —
  "Baltimore", not the club — because a city is a place and the statistics are
  facts, while the club name is a trademark. Team palettes are generated per
  franchise rather than copied. The consequence is documented: a franchise that
  has relocated renders under its current city even for a season played
  elsewhere.
- **Anything requiring a league relationship.** The app is unaffiliated with,
  and not endorsed by, any league or club, and says so.

## Where the attributions actually appear

- `README.md`, licence section
- The ledger's footer, on every public build
- `data/raw/seasons/*.json` — each file records its own `source` string, which
  the ledger reads and publishes alongside the file's hash

Attribution that lives in one place goes stale when the sources change. These
three are generated from, or sit beside, the thing they describe.
