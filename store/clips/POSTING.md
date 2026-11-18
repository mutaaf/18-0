# Posting the 17-0 clips

`npm run clips` makes these in `dist-clips/` (gitignored): one master MP4 per clip (1080x1920, H.264 High, 30 fps,
a silent AAC track, no watermark), `contact-sheet.png` (each clip's first frame) and `qa/<id>.png` (0 s, 1 s, middle
and end, with the apps' button zones drawn on). Upload the same file to TikTok, YouTube Shorts and Instagram Reels,
directly; never re-upload a file saved out of another app (it carries that app's watermark). The clips are silent
on purpose: add a sound in each app's own editor.

Every end card reads **Play free at 18-0.co**, the address the live site uses (`https://18-0.co`, its canonical
tag and og:url; see docs/hosting.md). The game calls itself 17-0 on screen; the address is still 18-0.co.

## What every clip shows, truthfully

Real seasons played in the exported web build with the network cut off, so nothing reaches a server, a board or
analytics. The wheel is seeded so a take replays exactly. The record at the end is the app's own deterministic
model for those seven picks; the captions only repeat it.

- **Gameday clips** (`tg-*`): the browser clock is set to Thanksgiving, Thursday Nov 26 2026, and the season
  starts from the home screen's own Gameday marquee. The wheel then holds only that day's six franchises (CHI,
  DET, PHI, DAL, KC, BUF, from the bundled schedule). Ratings are hidden in Gameday, so the scripted player picks
  by the stat lines on screen. While the reel spins it flickers past other abbreviations before it lands; it only
  ever lands on the six, which is why the caption says "Lands on today's six teams". Offline, the marquee button
  says "Be the first season on today's board": that is the app's own copy with no board to read.
- **Rookie clip**: Rookie mode, every rating on screen; the player takes the top-rated player who fits.

No club names, logos or marks appear: the app shows cities and abbreviations only, and the clips add nothing.

## The clips

| Clip | Hook (first second) | Length |
| --- | --- | --- |
| tg-heartbreak | A Thanksgiving Gameday season revealed: 16-1, Heartbreak | ~23.7 s |
| tg-wheel | The wheel spinning, then landing on PHI 2015-2019 | ~22.3 s |
| rookie-elite | A Rookie season revealed: 13-4, Elite, ratings on screen | ~24.9 s |

Two hook styles: payoff first (tg-heartbreak, rookie-elite) and the spin itself (tg-wheel).

## Post in this order

Pinned comment for every clip: **Play free in your browser: 18-0.co**

1. **tg-heartbreak**, Monday Nov 23 or Tuesday Nov 24, so it has a few days to find its audience before the games.
   Caption: *16-1 with only Thanksgiving's six teams on the wheel. One game short. Can you go 17-0?*
   #thanksgivingfootball #nfl #footballtok #17and0
2. **tg-wheel**, the morning of Thursday Nov 26, before the early kickoff (Gameday opens 10:00 Eastern).
   Caption: *Thanksgiving Gameday: the wheel only lands on today's six teams. Spin, pick one, live with it.*
   #thanksgiving #nfl #footballgame #browsergame
3. **rookie-elite**, the weekend after (Nov 28 or 29). Not tied to the holiday, so it keeps working after it.
   Caption: *Seven spins, seven picks, every rating on screen. 13-4. Beat it.*
   #nfl #footballtok #nflhistory #browsergame

Keep each one up at least 48 hours before judging it; compare the 3-second hold and the average watch time, not
the views. If tg-heartbreak holds better than tg-wheel, lead with a payoff hook next time.

## Re-cutting

Edit `store/clips/clips.json` (segments, speeds, captions) and run `npm run clips -- --skip-capture` to re-cut from
the takes in `dist-clips/raw/`, or `npm run clips -- --only=tg-wheel` for one clip. New seasons: `npm run clips --
--search=1-30 --mode=gameday` prints each seed's record, and `TAKES` in `scripts/clips.mjs` names the seeds used.
A Gameday take only works for a date in `packages/data/generated/schedule.json`; the clock is `THANKSGIVING`.
