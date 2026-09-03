# Running 18-0

## On your phone (recommended — this is where it's designed to live)

```bash
pnpm install
cd apps/mobile
npx expo start
```

Scan the QR code with **Expo Go** (App Store / Play Store). Haptics, the
three-finger spin and the reveal all land properly on a real device; none of
them do in a browser.

Same network for phone and Mac. If that fails: `npx expo start --tunnel`.

## In a browser

```bash
cd apps/mobile
npx expo start --web
```

The desktop layout is a different composition, not a scaled phone — two-column
gameplay, hover states, and navigation in a dock that floats at the bottom and
magnifies under the pointer. It used to be a 208-pixel rail down the left,
which took a fifth of a laptop screen away from the thing the app is for.

## Modes

**GM Mode** hides every rating and stat line — name, position, franchise and
season only. You pick on what you actually know about football, and the numbers
arrive with your record. The detail screen is blanked too, so there is no way
around it mid-game. (It is stored as `player_iq`, which was its name until the
label changed; renaming the key would invalidate every ranked row on the server
and every saved season on every device to change a word that appears in one
file.)

**Scout** shows the stat line and withholds the grade. You read 69 receptions
for 1,313 yards and 17 touchdowns and decide what that is worth. It is the mode
between the other two, and the one most people actually want.

**Rookie** shows everything. It is the beginner mode: useful for learning what
the model rewards before playing blind.

**Gameday** exists only while the league is playing. It opens three hours before
the first kickoff of a real NFL gameday and closes six hours after the last, the
wheel narrows to the franchises actually on the field that day, and the season
ranks on a board belonging to that date and no other -- not the rating boards,
not points, because a wheel of two to twenty-six franchises is a different game.
Stat lines are shown and ratings are not, so a one-day board is a fair contest
without a second axis on top of the visibility one.

The calendar is generated from nflverse's schedule file and bundled, so the
panel on the home screen knows when the lights come on with no connection at
all. The board needs the server; the mode does not. `docs/gameday.md` has the
design, and `features/flags` carries the switch that turns the whole thing off
without an App Store review.

Each mode ranks on its own board, and Rookie ranks on none of them: with the
numbers on screen, the best roster is the one that reads them. Every finished
season counts towards points, Rookie included — that board measures how much
you have played, not how well one roster scored blind. Blind seasons are
counted separately in My Stats.

## Filling a position

Tap a position on the field to target it — the eligible list filters to that
position and the next player you tap goes straight into that slot. Tapping a
player without targeting still works; a running back or receiver will ask which
of its two slots you meant.

## The three-finger spin

Hold three fingers anywhere on screen while tapping **Spin** and the wheel
lands on whichever franchise-era holds the best card still available for a slot
you have not filled. On a pointer device, Shift-click Spin.

Any run that uses it is flagged **assisted**: it saves and shows its result but
cannot set a best rating, a best record, or a perfect-season count, and the
database keeps it off every leaderboard.

In a challenge and on a gameday it is not flagged, it is refused — the server
returns `assist_not_allowed_in_challenge` or `assist_not_allowed_in_gameday`.
Both are contests against other people, and a rigged wheel is not something to
record as a win on one.

## Bringing the server online (optional)

The game is complete without it — the dataset is bundled and scoring is local.
Supabase only adds cross-device history, leaderboards and challenges.

```bash
supabase start
supabase db push                                   # schema + RLS
pnpm --filter @18-0/domain build:edge              # bundle scoring for Deno

# The local database, on the port config.toml moves it to.
psql postgresql://postgres:postgres@127.0.0.1:54422/postgres \
  -f supabase/seed/0001_dataset.sql                # cards + gameday calendar
```

Edge Functions are served rather than deployed against a local stack — see
**Verifying it** below.

Then set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in
`apps/mobile/.env` (see `.env.example`).

**The seed is safe to run against a database people have played on.** It used to
open with a `truncate ... cascade`, which is right exactly once, on an empty
database: `game_selections` references `season_cards` and `game_spins`
references `franchises` and `eras`, so that cascade deletes every pick and every
spin anybody has ever made. Nothing is truncated now. Everything upserts, and a
card the rebuilt dataset no longer contains is *retired* rather than removed --
the row stays so the season played with it still resolves, and the spin and
select endpoints refuse it so it is never dealt again (migration 0020).

### Verifying it

```bash
supabase functions serve
eval "$(supabase status -o env | sed 's/^/export /')"
node scripts/verify/e2e.mjs
```

Plays a full ranked game and then tries to cheat it every way the threat model
cares about — forging a completed session, tampering with a result, completing
someone else's game, spinning into it, picking without a spin, taking a card
from outside the issued franchise-era, declaring its own gameday, rigging a
gameday spin — and then checks the moderation and operator boundaries and that
an account can delete itself.

Every check must pass. The harness prints its own total at the end (119 on a
normal run); this document deliberately does not repeat the number, because it
has been wrong here twice.

If the default ports collide with another local Supabase stack, the ports in
`supabase/config.toml` are already moved to the 544xx range.

## Regenerating the model

```bash
data/raw/fetch.sh                                    # re-fetch nflverse CSVs
pnpm --filter @18-0/data build:dataset               # rebuild the bundled cards

# Two generated tables are keyed on the cards and go stale the moment the card
# list moves. Both have tests that fail when they do, which is how you find out.
python3 scripts/build-era-stories.py data/raw/games.csv   # franchise-era-records.ts
python3 scripts/build-headshots.py /tmp/rosters /tmp/players.csv   # headshots.ts

pnpm --filter @18-0/data analyze -- --write          # refit the calibration curve
pnpm --filter @18-0/data tune                        # re-measure the 18-0 gates
pnpm --filter @18-0/domain regen:fixtures            # move the seed fixtures with it
pnpm --silent --filter @18-0/data seed:sql > supabase/seed/0001_dataset.sql
pnpm --filter @18-0/domain build:edge                # the server scores with this
pnpm -r test
```

`build-headshots.py` needs nflverse's season rosters and `players.csv`; its
docstring has the two `curl` loops that fetch them.

Anything that changes a published score should bump `version` in
`packages/domain/src/constants/config.ts` -- and when the card pool grows, the
curve and the gates both need refitting or the "once every 6,000 games" on the
front page quietly stops being true. `analyze` first, then `tune`: the curve
governs 17-1, the gates govern 18-0. See `docs/scoring-model.md`.

## Correcting a stat line without shipping an app

Everything a card shows is bundled, so a display mistake would otherwise wait
for an app release — and two of them did, in one afternoon: pre-1999 defences
showing `— SACK`, and running backs showing yards under a label that read as a
count. Both were right in the repository within the hour and neither could
reach a phone.

So `build:dataset` also writes `apps/mobile/public/stat-lines.json` and a
77-byte manifest beside it, and a build whose own revision is behind adopts the
published lines at boot. Rebuild, push, and phones pick it up on their next
launch; the web build gets it from the same deploy.

It carries labels and values only, matched to cards the bundle already has, so
it can correct what a card *says* and never what it is worth. `/admin` shows
which revision this build shipped with, which one it applied, and how many
cards differ. Nothing waits for it and nothing fails without it.

## Adding next season's gamedays

The schedule moves every year and history does not, so it has its own build:

```bash
data/raw/fetch.sh                                    # refreshes games.csv too
pnpm --filter @18-0/data build:schedule              # rebuild the calendar
pnpm --silent --filter @18-0/data seed:sql > supabase/seed/0001_dataset.sql
pnpm -r test
```

Then load it wherever it needs to go — the local command is under **Bringing
the server online**, the hosted one under **The hosted project**.

`SCHEDULE_FIRST_SEASON` decides how far back the bundled calendar reaches
(default 2025); the server keeps every gameday it has ever been given, because
seasons carry a `gameday_key` and a rebuilt calendar must never orphan one. The
build refuses to write two overlapping windows, because `gamedayAt()` returns on
the first window it reaches.


---

## The hosted project

Live at project ref `keqwdtnyotdovrtcswel` (org DigitalCraft, West US North
California). The dashboard is at
<https://supabase.com/dashboard/project/keqwdtnyotdovrtcswel>.

Credentials are **not** in the repository. `.local/` is gitignored and holds
`hosted.env` (API URL, anon key, service key) and the database password. If you
lose them, `supabase projects api-keys --project-ref keqwdtnyotdovrtcswel`
prints the keys again; the database password can only be reset from the
dashboard.

```bash
set -a; . .local/supabase-db-password.env; set +a
supabase db push --yes                              # apply migrations

# The pooler connection the CLI already knows about, and the password it does
# not put in it. Re-running the seed is safe: it upserts, and retires rather
# than deletes.
PGPASSWORD="$SUPABASE_DB_PASSWORD" \
  psql "$(cat supabase/.temp/pooler-url)" -f supabase/seed/0001_dataset.sql

pnpm --filter @18-0/domain build:edge               # the functions carry this
supabase functions deploy spin select complete-game delete-account

set -a; . .local/hosted.env; set +a
node scripts/verify/e2e.mjs                         # every check must pass
```

Anonymous sign-ins are enabled and `site_url` points at `https://18-0.co`. Both are
project settings rather than repository state, so they do not come back from a
`supabase db push` — if the project is ever recreated, set them again:

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/<ref>/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"external_anonymous_users_enabled": true, "site_url": "https://18-0.co"}'
```

### Watching it

Everything the server decides lands in `audit_events`, and the two rollups over
it are the shape worth looking at:

```sql
select * from public.ops_events_hourly  order by hour desc limit 20;
select * from public.ops_rejection_rate order by hour desc limit 20;
```

A rising `rejection_rate` is either an attack or a regression. Both are worth a
look; neither is visible without this.


### Moderation

A leaderboard handle is the only user-generated content in the game. Names are
filtered at claim time against `handle_denylist`, players can report one from
the board, and three distinct reporters take a name off it automatically —
because "timely response" cannot mean "whenever somebody reads the queue".

```sql
-- What is waiting, worst first
select * from public.ops_moderation_queue;

-- Act on one. Both close every open report against that account.
select public.moderation_uphold('<user-uuid>');   -- hide the handle
select public.moderation_dismiss('<user-uuid>');  -- put it back

-- Adjust what is refused at claim time
insert into public.handle_denylist (pattern, kind, reason)
values ('somestring', 'substring', 'offensive');
```

Claiming a *new* name clears any moderation state on the old one: the decision
was about a name, not a person.

> **A grant that looks revoked and is not.** PostgreSQL grants `EXECUTE` on a
> new function to `PUBLIC`. `revoke execute … from anon, authenticated` is
> therefore a no-op — those roles were never using a grant of their own. Every
> callable function here must also `revoke execute … from public`, and 0003
> exists partly to fix two that did not: any signed-in player could clear the
> flag on their own handle, and could burn through another player's rate limit.


---

## Running it on a real device

Three routes, and they are genuinely different trade-offs rather than three
ways to do the same thing.

### 1. Tethered to this machine — works right now, costs nothing

```bash
cd apps/mobile && pnpm device        # Metro on 8082, bound to the LAN
```

Install **Expo Go**, join the same Wi-Fi, scan the QR. The backend comes from
`apps/mobile/.env`, which is gitignored and already points at the hosted
project.

The JavaScript is served from this Mac, so the app stops working when the
laptop sleeps or leaves the network. Right for developing, wrong for carrying
around. `pnpm device:clear` if the bundler starts lying to you.

### 2. Standalone Android, locally — free, no accounts at all

```bash
cd apps/mobile && pnpm android:device
```

Builds a release APK and installs it on a connected device or a running
emulator. Like the iOS route it embeds the JavaScript, so it needs no Metro.

**Signed with the debug keystore.** That is the Expo template's default and it
is what makes a local install need no key management — and it is also why this
APK can never go to Play. A store build needs a real upload key, which belongs
in EAS credentials, not in this repository.

Only the target's own architecture is built. The default universal APK carries
native libraries for all four ABIs and comes out at 111 MB, which was enough to
make the emulator's package service fall over mid-install; the ABI-matched one
is 49 MB.

Two things worth knowing if the emulator misbehaves. It needs more Gradle
memory than the template allocates — the script passes it on the command line
rather than in `android/gradle.properties`, which prebuild regenerates — and
running a long build while the emulator is up can starve `system_server` until
it stops responding. A cold boot fixes it:

```bash
emulator -avd Pixel_8_API_36 -wipe-data -gpu auto -memory 4096 -cores 4
```

### 3. Standalone Android via EAS — free, no Apple account, no laptop

```bash
npm i -g eas-cli && eas login        # a free Expo account
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL      --value "<url>"
eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key>"
eas build -p android --profile preview
```

Produces an installable APK. **The secrets are not optional**: EAS cloud builds
never see `.env`, because it is gitignored, so a build without them installs
fine and silently has no leaderboard. They are set once per project and are the
same values already in `.local/hosted.env`.

They are deliberately not in `eas.json`. Not because the anon key is sensitive
— it is public by design and already sits in the deployed web bundle — but so
it can be rotated without a commit. An *empty* value in `eas.json` would be
worse than none at all: it shadows the secret rather than falling back to it.

### 4. Standalone iPhone via EAS — needs an Apple account

`eas build -p ios --profile preview` needs a paid Apple Developer membership
($99/yr) to sign for a physical device; TestFlight is the sane distribution
from there. The free alternative is a local build signed against a personal team, which is
what this project is set up for.

```bash
cd apps/mobile && pnpm ios:device
```

That builds natively and installs straight onto a paired iPhone. It finds the
device itself; pass a UDID to pick a specific one.

**Not `expo run:ios --device`.** That command does not pass
`-allowProvisioningUpdates` to xcodebuild, so with no existing provisioning
profile it stops at signing — and a personal team has no profile until Xcode
creates one, which is precisely this case. It fails with *"No profiles for
'com.eighteenzerodcai.app' were found"*. The script exists because of that.

It builds **Release**, not Debug, so the JavaScript is embedded and the app runs
with the laptop closed. A Debug build needs Metro alive on the same network,
which defeats the point of putting it on a phone.

One manual step remains the first time, and no script can do it: iOS will
refuse to launch an app signed by an untrusted developer.

> Settings → General → VPN & Device Management → Apple Development → Trust Prerequisites,
all already true on this machine: Xcode installed and selected
(`xcode-select -p` must point inside Xcode.app, not CommandLineTools —
switching needs `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`),
CocoaPods available, and the phone paired and trusted.

**It expires after 7 days.** A personal-team provisioning profile is good for a
week, after which the app refuses to launch until you run the same command
again. That is Apple's limit on unpaid accounts, not a project setting.

The signing team is written into the generated Xcode project rather than
configured by hand. `ios/` and `android/` are gitignored: they are generated
from `app.config.js` by `expo prebuild`, so they are build output, and
committing them lets the config and the native project silently disagree. If
the native project is missing or stale, delete it and let `run:ios` regenerate
it — nothing in it is authored.

Note that `expo prebuild` reads `apps/mobile/.env`, so a device build has the
backend baked in and the leaderboard works away from this machine — unlike the
tethered route, which needs Metro alive.
