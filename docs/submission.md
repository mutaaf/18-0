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
| Privacy policy | https://digitalcraftai.com/privacy |
| Marketing URL | https://mutaaf.github.io/18-0 |

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
