#!/bin/zsh
# Raw store captures from the real simulator build, for Lobby (store/lobby.json).
#   scripts/store/capture-lobby.sh <EighteenZero.app> <iphone-udid> <ipad-udid>
#
# The earlier set was shot from the live site. A web page has no safe area, so its header sat
# at the very top of the capture, and Lobby's phone frame put the Dynamic Island over the
# score and the Leaderboards title. A simulator build lays out around the island.
set -e
export MAESTRO_DRIVER_STARTUP_TIMEOUT=${MAESTRO_DRIVER_STARTUP_TIMEOUT:-240000}  # a fresh simulator needs longer than the default to start the driver
cd "$(dirname $0)/../.."
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export PATH="$HOME/.maestro/bin:$PATH" MAESTRO_CLI_NO_ANALYTICS=1
APP=$1; IPHONE=$2; IPAD=$3
shoot() { # udid kind
  UDID=$1
  xcrun simctl boot $1 2>/dev/null || true
  xcrun simctl bootstatus $1 -b >/dev/null
  xcrun simctl ui $1 appearance dark
  xcrun simctl status_bar $1 override --time 9:41 --dataNetwork wifi --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
  xcrun simctl install $1 $APP
  mkdir -p store/lobby/raw/$2
  # Maestro refuses an absolute takeScreenshot path; the names land in --test-output-dir.
  # The raws are quality-90 JPEG, as Lobby's other apps keep them: *.png is ignored here.
  T=$(mktemp -d)
  maestro --udid $UDID test --test-output-dir $T store/lobby/maestro/capture.yaml
  maestro --udid $UDID test --test-output-dir $T store/lobby/maestro/season.yaml
  for f in $(find $T -name '[1-9]-*.png'); do sips -s format jpeg -s formatOptions 90 $f --out store/lobby/raw/$2/$(basename $f .png).jpg >/dev/null; done
}
shoot $IPHONE iphone
shoot $IPAD ipad
