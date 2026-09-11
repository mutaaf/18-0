#!/bin/bash
#
# Does it still build, everywhere it ships?
#
#   pnpm verify:builds
#
# Typecheck and tests answer "is the code correct". This answers the different
# question of whether the three things a player can actually install still come
# out of it -- which is not the same question, and is the one that breaks
# quietly, because nothing in CI builds a native binary.
#
# From a clean regeneration on purpose. `ios/` and `android/` are gitignored
# build output, so a stale one can build long after the config that produced it
# stopped being right: an Android build once shipped the wrong applicationId for
# exactly that reason.
set -uo pipefail

cd "$(dirname "$0")/../../apps/mobile"

# The two toolchain locations this machine needs told about, and the reason this
# script exists rather than a line in a README:
#
#   DEVELOPER_DIR  xcodebuild otherwise picks whatever `xcode-select` last
#                  pointed at, which on a machine with more than one Xcode is a
#                  coin toss.
#   ANDROID_HOME   `expo prebuild --clean` deletes `android/local.properties`
#                  along with the rest of the directory, and Gradle's only other
#                  way to find the SDK is this variable. Without it the build
#                  fails with "SDK location not found" thirty seconds in, which
#                  reads like a broken project and is a missing export.
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

# EXPO_PUBLIC_* are inlined at build time, so a build without them is a build of
# a different app.
if [[ -f .env ]]; then set -a; . ./.env; set +a; fi

PASS=0
FAIL=0
SKIP=0

step() {
  local name="$1"; shift
  printf '\n  %s … ' "$name"
  local log; log=$(mktemp)
  if "$@" > "$log" 2>&1; then
    printf 'ok\n'
    PASS=$((PASS + 1))
  else
    printf 'FAILED\n'
    FAIL=$((FAIL + 1))
    # The last lines, because a Gradle or xcodebuild failure buries its cause
    # under several hundred lines of task names.
    sed 's/^/      /' "$log" | tail -25
  fi
  rm -f "$log"
}

echo
echo '18-0 — DOES IT BUILD'
echo '================================================================'

echo
echo 'WEB'
step 'export' npx expo export -p web

echo
echo 'NATIVE PROJECTS'
step 'prebuild, from clean' npx expo prebuild --clean
step 'bundle ids agree with app.config.js' node ../../scripts/verify/native-ids.mjs

echo
echo 'ANDROID'
if [[ -d "$ANDROID_HOME" ]]; then
  step 'release apk' bash -c 'cd android && ./gradlew --no-daemon assembleRelease'
else
  printf '\n  release apk … skipped, no SDK at %s\n' "$ANDROID_HOME"
  SKIP=$((SKIP + 1))
fi

echo
echo 'IOS'
if [[ -d "$DEVELOPER_DIR" ]]; then
  WS=$(find ios -maxdepth 1 -name '*.xcworkspace' | head -1)
  if [[ -n "$WS" ]]; then
    step 'simulator build' xcodebuild -workspace "$WS" \
      -scheme "$(basename "$WS" .xcworkspace)" -configuration Release \
      -destination 'generic/platform=iOS Simulator' build
  else
    printf '\n  simulator build … FAILED, no workspace after prebuild\n'
    FAIL=$((FAIL + 1))
  fi
else
  printf '\n  simulator build … skipped, no Xcode at %s\n' "$DEVELOPER_DIR"
  SKIP=$((SKIP + 1))
fi

echo
echo '================================================================'
if [[ $FAIL -eq 0 ]]; then
  echo "Builds everywhere it ships. ($PASS ok${SKIP:+, $SKIP skipped})"
else
  echo "$FAIL of $((PASS + FAIL)) failed."
fi
exit $((FAIL == 0 ? 0 : 1))
