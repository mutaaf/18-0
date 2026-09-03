# Submitting the app

What the stores need, with the real values rather than a description of them,
so the forms can be filled without going and looking anything up.

Everything here that could be settled in code has been. What is left is the
handful of things that live in a console only a human can sign into.

## Identity

| | |
|---|---|
| Bundle identifier (iOS) | `com.eighteenzerodcai.app` |
| Package name (Android) | `com.eighteenzerodcai.app` |
| Apple Team ID | `Z73865R687` |
| Services ID (Sign in with Apple) | `com.eighteenzerodcai.app.web` |
| URL scheme | `eighteenzero` |
| Publisher | DigitalCraft AI |
| Support / privacy contact | mutaaf@digitalcraftai.com |
| Privacy policy | https://18-0.co/privacy |
| Marketing URL | https://18-0.co |

The bundle identifier was `com.eighteenzero.app` until 3 September 2026. That
value was never registered under this team and would have failed at submission.
See [`social-login.md`](social-login.md) for why changing it cost nothing in
sign-in, and what it does cost on a device that already had a build.

## Store listing

**Name:** 18-0

**Subtitle:** Build the perfect roster

**Description:**

> Seven spins, sixty years of pro football, one shot at an undefeated season.
>
> Each spin hands you one franchise and one era. Take a player, fill a slot, and
> live with it. Seven picks decide your season — no simulation, no luck after
> the whistle.
>
> Three ways to play. Rookie shows you every rating. Scout gives you the stat
> line and no grade. GM Mode gives you a name and a year, and nothing else.
>
> Every rating is computed from what actually happened, against the era it
> happened in. 18-0 lands about once every 6,000 games.

**Keywords:** football, roster, history, trivia, stats, seasons, draft, sports

**Category:** Games → Sports (secondary: Trivia)

**Age rating:** 4+ / Everyone. No gambling, no user-generated content beyond a
display name, no ads, no in-app purchases. Display names are moderated —
reportable, and hideable from the console — which is what the questionnaire is
asking about when it asks about user-generated content.

**Google Play short description** (80 characters allowed; this is 71):

> Seven spins, sixty years of football, one shot at an undefeated season.

**App Store promotional text** (170 characters allowed; this is 156). This is
the one line that can be changed without submitting a build, so it is where a
running thing gets said:

> Each spin hands you one franchise and one era. Seven picks decide a season, rated against the era it was played in. 18-0 lands about once every 6,000 games.

**Release notes / What's New, 0.1.0:**

> First release. Seven spins, seven picks, one season. Three ways to play —
> Rookie, Scout and GM Mode — plus a gameday board that opens while the league
> is on the field, and ranked seasons scored on the server. No account, no ads,
> and the whole game plays offline.

**Copyright**, for App Store Connect — year and holder, no symbol:
`2026 DigitalCraft AI`

## App Store — Review notes

Paste this into App Review Information. There is nothing for a reviewer to log
into, and saying so up front is the point of it.

If the build going up still has sign-in switched off — `EXPO_PUBLIC_AUTH_PROVIDERS`
unset, see [`social-login.md`](social-login.md) — drop the two sign-in
paragraphs. A reviewer should not be sent looking for buttons that are not
there, and with no third-party sign-in offered, 4.8 does not apply.

> **No demo account is needed.** The app signs you in anonymously on first
> launch, with no prompt and no sign-up screen. Every mode is playable
> immediately, ranked seasons included, and none of it asks for an account.
>
> **Signing in is optional.** The account panel offers Sign in with Apple and
> Google, and nothing in the game is gated behind either. What it buys is
> history: the provider is *linked* to the anonymous account already in use, so
> the seasons already played carry over rather than being replaced, and they
> survive losing the device. It is also what puts a ranked season on the public
> board: anonymous accounts are free and unlimited, so the board lists only
> seasons attached to a signed-in one. Playing is never affected either way.
>
> **Guideline 4.8.** Sign in with Apple is offered wherever Google is, and this
> is enforced in code rather than left to configuration: if the provider list
> names Google without Apple, iOS shows no sign-in buttons at all.
>
> **Guideline 5.1.1(v).** Account deletion is in the app. Tap the avatar disc
> in the top-right corner of any screen to open Account; "Delete my account" is
> at the bottom of that screen. It needs no sign-in, no email and no contact
> with support. It removes the account, the display name, every ranked season
> attached to it, and the analytics for that account.
>
> **Guideline 1.2.** The only user-generated content is a display name shown on
> the leaderboard. Names are checked against a denylist by the database when
> they are set, so a blocked name is refused rather than published and reviewed
> later. Every leaderboard row carries a report control, and a reported name can
> be hidden from the board.
>
> No ads, no in-app purchases, no gambling, no messaging between players. The
> game works with no network connection; only the leaderboard needs one.

## App Store — App Privacy

Two types collected, both **linked to the user**, both **not used for tracking**.

| Type | Category | Purpose | Linked | Tracking |
|---|---|---|---|---|
| Usage Data | Product Interaction | Analytics | Yes | No |
| Identifiers | User ID | Analytics, App Functionality | Yes | No |

Nothing else. Specifically **not** collected: contact info beyond the sign-in
provider's own handling, location, contacts, health, financial info, browsing
history, search history, or sensitive info.

Say **no** to tracking. This is first-party product analytics with no
advertising network, no advertising identifier and no data shared with a data
broker, which is what "tracking" means in Apple's definition. **Adding any
advertising SDK changes that answer** and pulls an ATT prompt with it — see
[`monetization.md`](monetization.md) before wiring one in.

Account deletion is in the app, on the Account screen, which is what 5.1.1(v)
requires. It deletes the account, its seasons and its analytics in one request.

## Google Play — Data safety

Same declaration, different form.

- **App activity → App interactions**: collected, not shared, processed
  ephemerally = no, required = no, purpose = Analytics
- **Device or other IDs**: collected, not shared, purpose = Analytics
- **Data is encrypted in transit**: yes
- **Users can request data deletion**: yes, in-app — Account screen

## Google Play — Content rating (IARC)

The questionnaire is a list of yes/no answers about categories of content. Every
content question is a **no**; the only yes is user-generated content, which is a
display name and nothing else. The expected outcome is Everyone / PEGI 3, with
the user-generated-content follow-ups answered rather than avoided.

- **Violence** (realistic, fantasy, blood, depictions of injury): no. The game
  is spinning cards and picking players; nothing is depicted.
- **Sexuality, nudity, crude humour, language**: no.
- **Controlled substances** (drugs, alcohol, tobacco): no.
- **Gambling**: no. Nothing is wagered, nothing is bought, there is no simulated
  casino play and no in-app currency of any kind.
- **Miscellaneous** (horror, fear, discrimination): no.
- **Users can interact**: **no** — no chat, no messaging, no comments, and no
  way for one player to send another a message of any kind. Players see each
  other's display names on a leaderboard and nothing else. A challenge is a
  share link that carries a display name, a score and the same seven wheels; it
  is passed outside the app and has no message attached to it. If a form asks
  separately whether users can *share content* with each other, that link is the
  yes, and that is all it is.
- **Shares location**: no.
- **Digital purchases**: no.
- **User-generated content**: **yes** — a display name, shown on the
  leaderboard. Say so, and say what moderates it: names are checked against a
  denylist when they are set and refused if they match, every leaderboard row
  can be reported, and a reported name can be hidden from the board. That is a
  moderation system, a reporting mechanism and a published policy, which is what
  the follow-up questions ask for.

Answering "users can interact" yes because there is a shared leaderboard is the
common way this form gets over-rated. It asks about communication between
players, and there is none to declare.

## Sign in with Apple

Required by 4.8 because the app offers Google sign-in. It is implemented, and
`scripts/verify/linking.mjs` exercises the linking path against a live project.

The client secret is an ES256 JWT rather than the `.p8`, minted by
`scripts/apple-client-secret.py`. **It expires 4 March 2027** — six months is
Apple's maximum. Sign-in fails with `invalid_client` when it lapses, which says
nothing useful about why, so it is worth a calendar reminder rather than a
discovery.

## Before the build goes up

```bash
pnpm -r typecheck
pnpm -r test
node scripts/verify/e2e.mjs     # against the live project
```

Then check the two things a build can lose without failing:

```bash
pnpm verify:web    # exports the web build, then checks it
```

That one exports and then reads the *output* — the share preview tags and the
manifest, icons and service worker that make it installable. All of those can
stop shipping without anything failing, which is why they are checked against
what was built rather than against the source. CI runs the same check on every
deploy.

## Still open

- **Player photographs.** `packages/data/src/headshots.ts` hot-links 1,626
  images from the NFL's CDN. Its own header says they are not ours to
  redistribute. This was a deliberate proof-of-concept decision with a paid
  route planned; the card already degrades to the franchise wash without a
  photo, which every team-defence card has always done. Settle it before the
  binary is public.
