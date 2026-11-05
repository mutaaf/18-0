# Reply to App Review — Guideline 2.1, Information Needed

Apple's message of 2026-09-05 asked for six things, to be sent as a reply in
App Store Connect *and* kept in the App Review Information notes for future
submissions. Items 2–6 are below, written to be pasted as they are. Item 1 is a
screen recording made on a physical iPhone; the shot list it follows is at the
bottom, and `scripts/store/attach-review-file.mjs` attaches it to the version's
App Review Information so the next reviewer has it too.

The notes field takes 4,000 characters. `review-notes.txt` beside this file is
the same content, flattened to plain text and kept under that limit; pass it to
`scripts/store/submit-for-review.mjs --notes-file`.

---

**1. Screen recording.** Attached. Recorded on an iPhone 15 Pro Max running
iOS 27.0.1, with the TestFlight build being submitted, from a cold launch: a full seven-pick season to its result, the account
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
in anonymously on first launch, with no prompt. The app opens on the Play tab:
scroll to the three modes and tap one (Play Rookie shows every rating, Play Scout
shows stat lines only, Play GM Mode shows names only), then spin and pick seven
times; Reveal your result shows the rating and record. The Ranks tab, second in
the bottom bar, holds the leaderboards; every name carries a small report flag
(top right of each podium card, end of each row). Tap the avatar disc at the top
right of any screen to open Account, where Sign in with Apple is optional and
"Delete my account" sits just below the sign-in buttons.

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
2. Play tab → scroll to the modes → Play Rookie. Spin and pick all seven slots. Let the result screen finish.
3. Ranks tab. Tap the report flag on any name and show the sheet it opens.
4. Avatar disc (top right) → Account. Show Sign in with Apple (no need to
   complete it).
5. Scroll to "Delete my account", tap it, confirm. Show that the app returns to
   a fresh anonymous state.

Upload the file in the reply in App Store Connect → App Review → the rejected
submission → Reply to App Review.

## Follow-up note on the 4.3 reply, sent 2026-11-05

One addition to the reply above, so that my answers across this account are consistent.

17-0's code was written largely with an AI coding assistant (Claude Code) under my direction. Where I said I built it, I mean that I conceived and designed the game, directed the work and am responsible for it. No commercial template or app generation service was used, and it is not built for anyone else's content.

One correction: my reply for Cold Gas described 17-0 as fantasy football and Moon Club as a kids app. 17-0 is a football history puzzle, and Moon Club teaches beginners of any age how money and markets work.
