# Reply to App Review — Guideline 2.1, Information Needed

Apple's message of 2026-09-05 asked for six things, to be sent as a reply in
App Store Connect *and* kept in the App Review Information notes for future
submissions. Items 2–6 are below, written to be pasted as they are. Item 1 is a
screen recording that has to be made on a physical iPhone by a person; the shot
list for it is at the bottom.

The notes field takes 4,000 characters. `review-notes.txt` beside this file is
the same content, flattened to plain text and kept under that limit; pass it to
`scripts/store/submit-for-review.mjs --notes-file`.

---

**1. Screen recording.** Attached. Recorded on an iPhone running the current
iOS, from a cold launch: a full seven-pick season to its result, the account
screen with optional Sign in with Apple, account deletion, and the leaderboard's
report control on a display name.

**2. Purpose and audience.** 17-0 is a pro football history game for adult and
teenage football fans. Each spin deals one franchise and one era; the player
takes one real season from it to fill a seven-slot roster, and the finished
roster is rated against the era each season was played in and given a projected
17-game record. The goal is a perfect 17-0 season, which happens about once in
6,000 games. The value is a short, replayable test of football knowledge built
on real historical statistics. There are no wagers, prizes, purchases or ads.

**3. How to reach the features.** No login or setup is needed. The app signs
in anonymously on first launch, with no prompt. Tap Play on the home screen,
choose a mode (Rookie shows every rating, Scout shows stat lines only, GM Mode
shows names only), then spin and pick seven times; the result screen shows the
rating and record. The Leaderboards tab holds the boards; every row has a report
control. Tap the avatar disc at the top right of any screen to open Account,
where Sign in with Apple is optional and "Delete my account" is at the bottom.

**4. External services.**
- Supabase (database, anonymous and optional Apple/Google sign-in, server-side
  scoring of ranked seasons and the leaderboard)
- PostHog (first-party product analytics and feature flags; no advertising
  identifier, no tracking)
- Sign in with Apple and Google Sign-In (optional, account linking only)
- Season statistics from nflverse (CC BY 4.0, attributed in the published privacy policy) and
  Pro-Football-Reference (licensed), bundled in the app at build time. No
  statistics are fetched at runtime and no AI services are used.

**5. Regional differences.** None. The app is the same in every territory and
plays fully offline; only the leaderboard needs a connection.

**6. Third-party material.** The app uses no team names, logos, marks or
colours: franchises are identified by city only, and every palette is generated.
Player names appear with statistics from their real seasons, which are factual
data used in the same way as fantasy football and sports-reference sites. The
statistics are licensed as listed in item 4. Player photographs are switched off
in this build and on the server: the app shows no photographs or likenesses of
players.

---

## Shot list for item 1

Record with Control Centre → Screen Recording, on the physical device, on the
build that is being submitted (TestFlight). One continuous take, about two
minutes:

1. Start from the home screen with the app closed. Tap the 17-0 icon.
2. Play tab → Rookie. Spin and pick all seven slots. Let the result screen finish.
3. Leaderboards tab. Tap the report control on any row and show what it
   does.
4. Avatar disc (top right) → Account. Show Sign in with Apple (no need to
   complete it).
5. Scroll to "Delete my account", tap it, confirm. Show that the app returns to
   a fresh anonymous state.

Upload the file in the reply in App Store Connect → App Review → the rejected
submission → Reply to App Review.
