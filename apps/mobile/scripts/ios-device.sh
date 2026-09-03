#!/bin/bash
#
# Build 18-0 and install it on a paired iPhone, signed with a personal Apple
# team. No paid membership, no cloud build.
#
#   pnpm ios:device                       # first paired device
#   pnpm ios:device 00008130-0016...      # a specific one
#
# Why not `expo run:ios --device`: it does not pass `-allowProvisioningUpdates`,
# so with no existing provisioning profile it stops at signing. A personal team
# has no profile until Xcode makes one, which is exactly the case this script
# exists to handle.
#
# Release, not Debug, on purpose. Release embeds the JavaScript bundle in the
# app, so it runs with the laptop closed. A Debug build needs Metro alive on
# the same network, which defeats the point of putting it on a phone.
set -euo pipefail

cd "$(dirname "$0")/.."

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
if [[ ! -d "$DEVELOPER_DIR" ]]; then
  echo "Xcode not found at $DEVELOPER_DIR" >&2
  exit 1
fi

# EXPO_PUBLIC_* values are inlined into the bundle at build time, so the app
# carries the backend with it rather than depending on this machine.
if [[ -f .env ]]; then
  set -a; . ./.env; set +a
fi

UDID="${1:-}"
if [[ -z "$UDID" ]]; then
  # The identifier `devicectl` prints is a CoreDevice UUID and xcodebuild does
  # not accept it. This is the one that works.
  # sed, not awk: BSD awk on macOS has no match() capture argument, and that is
  # the awk this will actually run under.
  # Only the connected section. `xctrace` prints `== Devices Offline ==` between
  # `== Devices ==` and `== Simulators ==`, so a range ending at the simulators
  # happily selects a phone that is paired but not here -- and xcodebuild then
  # fails on a destination it cannot reach, which reads like a signing problem
  # rather than an unplugged cable. The range stops at the blank line that ends
  # the section.
  UDID=$(xcrun xctrace list devices 2>/dev/null \
    | sed -n '/== Devices ==/,/^$/p' \
    | grep -E '^(iPhone|iPad)' \
    | sed -n 's/.*(\([0-9A-Fa-f][0-9A-Fa-f-]\{24,\}\))[[:space:]]*$/\1/p' \
    | head -1 || true)
  # `|| true` because finding no phone is a normal outcome this script handles
  # below. Without it `grep`'s exit 1 travels through `pipefail` into the
  # assignment and `set -e` ends the run right here -- silently, before the
  # message that says what to plug in.
fi
if [[ -z "$UDID" ]]; then
  # Paired but asleep, locked, or unplugged is the overwhelmingly common case,
  # and it deserves a different sentence from "no phone has ever been paired".
  if xcrun xctrace list devices 2>/dev/null \
      | sed -n '/== Devices Offline ==/,/== Simulators ==/p' | grep -qE '^(iPhone|iPad)'; then
    echo "Your iPhone is paired but offline. Plug it in and unlock it." >&2
  else
    echo "No paired iPhone found. Plug it in, unlock it, and trust this Mac." >&2
  fi
  xcrun xctrace list devices 2>/dev/null | sed -n '/== Devices ==/,/== Simulators ==/p' >&2
  exit 1
fi
echo "→ device $UDID"

[[ -d ios ]] || npx expo prebuild -p ios

TEAM="${APPLE_TEAM_ID:-95988FTS33}"
echo "→ signing with team $TEAM"

xcodebuild \
  -workspace ios/180.xcworkspace \
  -scheme 180 \
  -configuration Release \
  -destination "id=$UDID" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" \
  build

APP=$(find ~/Library/Developer/Xcode/DerivedData -maxdepth 6 -name '180.app' \
  -path '*Release-iphoneos*' 2>/dev/null | head -1)
[[ -n "$APP" ]] || { echo "Built, but the .app could not be located." >&2; exit 1; }

xcrun devicectl device install app --device "$UDID" "$APP"

cat <<'NOTE'

Installed.

If it will not open and iOS says the developer is not trusted, that is a
one-time step this script cannot do for you:

  Settings → General → VPN & Device Management → Apple Development → Trust

The profile lasts 7 days. When it expires the app stops launching with no
warning; run this again.
NOTE
