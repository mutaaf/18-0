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

The desktop layout is a different composition, not a scaled phone — left nav
rail, two-column gameplay, hover states.

## Modes

**Player IQ** hides every rating and stat line — name, position, franchise and
season only. You pick on what you actually know about football, and the numbers
arrive with your record. The detail screen is blanked too, so there is no way
around it mid-game.

**Rookie** shows everything. It is the beginner mode: useful for learning what
the model rewards before playing blind.

Blind seasons are counted separately in My Stats.

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

## Bringing the server online (optional)

The game is complete without it — the dataset is bundled and scoring is local.
Supabase only adds cross-device history, leaderboards and challenges.

```bash
supabase start
supabase db push                                   # schema + RLS
psql "$DATABASE_URL" -f supabase/seed/0001_dataset.sql   # 6,209 cards
pnpm --filter @18-0/domain build:edge              # bundle scoring for Deno
supabase functions deploy complete-game
```

Then set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in
`apps/mobile/.env` (see `.env.example`).

### Verifying it

```bash
supabase functions serve
eval "$(supabase status -o env | sed 's/^/export /')"
node scripts/verify/e2e.mjs
```

Plays a full ranked game and then tries to cheat it every way the threat model
cares about — forging a completed session, tampering with a result, completing
someone else's game, spinning into it, picking without a spin, taking a card
from outside the issued franchise-era. 22 checks, all of which must pass.

If the default ports collide with another local Supabase stack, the ports in
`supabase/config.toml` are already moved to the 544xx range.

## Regenerating the model

```bash
data/raw/fetch.sh                                    # re-fetch nflverse CSVs
pnpm --filter @18-0/data build:dataset               # rebuild the bundled cards
pnpm --filter @18-0/data analyze -- --write          # refit the calibration curve
pnpm --filter @18-0/data tune                        # re-measure the 18-0 gates
pnpm --filter @18-0/domain regen:fixtures            # move the seed fixtures with it
pnpm -r test
```

Anything that changes a published score should bump `version` in
`packages/domain/src/constants/config.ts`.


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
supabase db push                                    # apply migrations
psql "$DATABASE_URL" -f supabase/seed/0001_dataset.sql
supabase functions deploy spin select complete-game delete-account

set -a; . .local/hosted.env; set +a
node scripts/verify/e2e.mjs                         # 44 checks
```

Anonymous sign-ins are enabled and `site_url` points at the live demo. Both are
project settings rather than repository state, so they do not come back from a
`supabase db push` — if the project is ever recreated, set them again:

```bash
curl -X PATCH "https://api.supabase.com/v1/projects/<ref>/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"external_anonymous_users_enabled": true, "site_url": "https://mutaaf.github.io/18-0"}'
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
'com.eighteenzero.app' were found"*. The script exists because of that.

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
