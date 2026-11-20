#!/bin/bash
#
# What a remote press costs the JS thread (docs/apple-tv.md, "The fourth pass").
#
#   pnpm verify:tv --install                                # once: a Release build
#   scripts/perf/tv/js-probe.sh test03_PlayListFocusMoves   # renders, commits, lateness per press
#   PROFILE=30 scripts/perf/tv/js-probe.sh test03_PlayListFocusMoves   # + JS / main thread ms
#
# The harness (run.sh) charges a block with the whole process's CPU, which on
# a TV is mostly the main thread. A real Apple TV's complaint was the JS
# thread: `tv_jank` said it ran ~300 ms late after every press on the play
# list, and the Mac's CPU hides that. So this bundles the installed app's JS
# again with render-probe.js in front (renders, commits and timer lateness per
# press, posted to a listener here), swaps it into the installed build, runs
# the given harness tests, and puts the original bundle back.
#
# PROFILE=<seconds> also attaches Time Profiler from PROFILE_DELAY (default
# 24 s, past test03's spin) and prints each thread's milliseconds and the JS
# thread's heaviest frames (threads.py) -- the only view of the commits React
# did not make, such as a scroll view's state updates.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MOBILE="$ROOT/apps/mobile"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
DEVICE="${TV_SIMULATOR:-Apple TV 4K (4th generation) (at 1080p)}"
OUT="${PERF_OUT:-${TMPDIR:-/tmp}/17-0-tv-perf}"
UDID=$(xcrun simctl list devices available | grep -F "$DEVICE (" | grep -oE '[0-9A-F-]{36}' | head -1)
[[ -n "$UDID" ]] || { echo "No simulator named '$DEVICE'"; exit 1; }
APP=$(xcrun simctl get_app_container "$UDID" com.eighteenzerodcai.app 2>/dev/null) \
  || { echo 'The app is not installed: pnpm verify:tv --install'; exit 1; }
HERMESC="$MOBILE/ios/Pods/hermes-engine/destroot/bin/hermesc"
[[ -x "$HERMESC" ]] || { echo "No hermesc at $HERMESC: run pnpm verify:tv first"; exit 1; }

stamp=$(date +%Y%m%d-%H%M%S)
work="$OUT/js-probe-$stamp"
mkdir -p "$work/assets"

echo "bundling with the probe …"
(
  cd "$MOBILE"
  if [[ -f .env ]]; then set -a; . ./.env; set +a; fi
  EXPO_TV=1 NODE_ENV=production npx expo export:embed --entry-file "$HERE/render-probe.js" --platform ios \
    --dev false --reset-cache --minify false --bundle-output "$work/main.js" --assets-dest "$work/assets"
) > "$work/bundle.log" 2>&1 || { tail -20 "$work/bundle.log"; exit 1; }
"$HERMESC" -emit-binary -O -out "$work/main.jsbundle" "$work/main.js" > /dev/null 2>&1 || { echo 'hermesc failed'; exit 1; }

cp "$APP/main.jsbundle" "$work/original.jsbundle"
restore() {
  cp "$work/original.jsbundle" "$APP/main.jsbundle"
  [[ -n "${listener:-}" ]] && kill "$listener" 2>/dev/null
}
trap restore EXIT
cp "$work/main.jsbundle" "$APP/main.jsbundle"
xcrun simctl terminate "$UDID" com.eighteenzerodcai.app 2>/dev/null

node -e "
  const fs = require('node:fs');
  require('node:http').createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c));
    req.on('end', () => { fs.appendFileSync(process.argv[1], b + '\n'); res.end(); });
  }).listen(8787, '127.0.0.1');
" "$work/presses.log" &
listener=$!

if [[ -n "${PROFILE:-}" ]]; then
  PERF_OUT="$OUT" "$HERE/run.sh" "$@" > "$work/run.txt" 2>&1 &
  harness=$!
  sleep "${PROFILE_DELAY:-24}"
  pid=$(pgrep -f "Devices/${UDID}/.*\.app/SeventeenZero( |$)" | head -1)
  xcrun xctrace record --device "$UDID" --template 'Time Profiler' --attach "$pid" \
    --time-limit "${PROFILE}s" --output "$work/profile.trace" > /dev/null 2>&1
  wait "$harness"
  xcrun xctrace export --input "$work/profile.trace" \
    --xpath '/trace-toc/run[@number="1"]/data/table[@schema="time-profile"]' --output "$work/profile.xml" > /dev/null 2>&1
else
  PERF_OUT="$OUT" "$HERE/run.sh" "$@" > "$work/run.txt" 2>&1
fi
sleep 3

grep -E "passed|failed|^  [a-z_]+ " "$work/run.txt"
echo
python3 - "$work/presses.log" <<'PY'
import re, statistics as st, sys
by = {}
for line in open(sys.argv[1]):
    m = re.search(r'press (\w+) late=(-?\d+) renders=(\d+) commits=(\d+)', line)
    if m:
        kind = 'moves' if m.group(1) in ('up', 'down', 'left', 'right') else m.group(1)
        by.setdefault(kind, []).append(tuple(int(g) for g in m.groups()[1:]))
for kind, rows in by.items():
    late, renders, commits = zip(*rows)
    print(f'  {kind:8} {len(rows):4} presses   renders/press {st.mean(renders):5.1f} (median {st.median(renders):g})'
          f'   commits/press {st.mean(commits):4.2f}   timer late median {st.median(late):g} ms')
PY
if [[ -f "$work/profile.xml" ]]; then
  echo
  python3 "$HERE/threads.py" "$work/profile.xml" | head -40
fi
echo
echo "  presses: $work/presses.log"
