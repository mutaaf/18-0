#!/bin/bash
#
# Does the Apple TV app still build?
#
#   pnpm verify:tv              # prebuild for tvOS and build for the simulator
#   pnpm verify:tv --install    # ...and install and launch it on the Apple TV simulator
#
# The TV app is the phone app's Xcode target rewritten for tvOS by
# `@react-native-tvos/config-tv` when EXPO_TV=1 (docs/apple-tv.md). Nothing in
# CI builds it, and the ways it breaks are all invisible from a phone build: a
# library that drops tvOS from its podspec, a native module a phone screen
# starts importing statically (see src/features/tv/native-imports.test.ts), a
# Swift API that tvOS does not have. So this builds it, from clean, the same
# way `verify:builds` builds the phone -- which runs this first.
#
# It leaves `ios/` as a tvOS project. `verify:builds` regenerates the phone one
# straight after; on its own, run `npx expo prebuild --clean` before going back
# to `expo run:ios`.
set -uo pipefail

cd "$(dirname "$0")/../../apps/mobile"

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
# EXPO_PUBLIC_* are inlined at build time, so a build without them is a build of
# a different app.
if [[ -f .env ]]; then set -a; . ./.env; set +a; fi

# One derived-data folder for the TV build, wherever it is run from, so worktrees
# do not each leave a few gigabytes behind.
DERIVED="${TV_DERIVED_DATA:-$HOME/Library/Developer/Xcode/DerivedData/SeventeenZero-TV}"
# The stock device the tvOS runtime installs. Reused, never created per run.
DEVICE="${TV_SIMULATOR:-Apple TV 4K (4th generation) (at 1080p)}"

fail() { printf '\n  %s\n' "$1"; exit 1; }

if ! xcrun simctl list runtimes 2>/dev/null | grep -q 'tvOS'; then
  fail "No tvOS simulator runtime. Install it once with: xcodebuild -downloadPlatform tvOS"
fi

echo
echo '17-0 — DOES THE APPLE TV APP BUILD'
echo '================================================================'

printf '\n  prebuild for tvOS, from clean … '
log=$(mktemp)
if EXPO_TV=1 CI=1 npx expo prebuild --clean --platform ios > "$log" 2>&1; then
  echo ok
else
  echo FAILED; sed 's/^/      /' "$log" | tail -25; exit 1
fi

# config-tv rewrites the target in place. If it ever stops doing so (an Expo
# upgrade, the plugin dropped from app.config.js) the build below would
# happily produce an iPhone app and call it a pass.
grep -q 'SDKROOT = appletvos' ios/*.xcodeproj/project.pbxproj || fail 'the Xcode project is not a tvOS project (SDKROOT)'
grep -q 'platform :tvos' ios/Podfile || fail 'the Podfile does not target tvOS'

WS=$(find ios -maxdepth 1 -name '*.xcworkspace' | head -1)
SCHEME=$(basename "$WS" .xcworkspace)

printf '\n  tvOS simulator build … '
if xcodebuild -workspace "$WS" -scheme "$SCHEME" -configuration Release \
  -destination 'generic/platform=tvOS Simulator' -derivedDataPath "$DERIVED" build > "$log" 2>&1; then
  echo ok
else
  echo FAILED; grep -E 'error:|BUILD FAILED' "$log" | sort -u | sed 's/^/      /' | tail -25; exit 1
fi

APP="$DERIVED/Build/Products/Release-appletvsimulator/$SCHEME.app"
FAMILY=$(/usr/libexec/PlistBuddy -c 'Print :UIDeviceFamily:0' "$APP/Info.plist" 2>/dev/null)
[[ "$FAMILY" == 3 ]] || fail "the app is not a TV app (UIDeviceFamily $FAMILY)"
echo "  $APP"
rm -f "$log"

if [[ "${1:-}" == '--install' ]]; then
  UDID=$(xcrun simctl list devices available | grep -F "$DEVICE (" | grep -oE '[0-9A-F-]{36}' | head -1)
  [[ -n "$UDID" ]] || fail "No simulator named '$DEVICE'. Set TV_SIMULATOR to one from: xcrun simctl list devices"
  xcrun simctl boot "$UDID" 2>/dev/null || true
  open -a Simulator --args -CurrentDeviceUDID "$UDID"
  xcrun simctl install "$UDID" "$APP"
  xcrun simctl launch "$UDID" com.eighteenzerodcai.app
  echo "  launched on $DEVICE ($UDID)"
fi

echo
echo 'The Apple TV app builds.'
