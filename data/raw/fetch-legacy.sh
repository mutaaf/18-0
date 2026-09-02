#!/bin/bash
# 1980-1998, which nflverse does not cover.
#
# Two sources, each pulled once and cached: a public mirror of NFL.com's own
# season files for the statistics, and nflverse rosters for the positions the
# mirror leaves blank. Requests are spaced with jitter and every file is skipped
# if it is already on disk, so a re-run costs nothing.
#
# The mirror is 49% complete against those rosters and omits Emmitt Smith and
# Joe Montana outright, so `build:dataset` leaves these seasons out unless
# LEGACY_SEASONS=1 is set. See docs/FINDINGS.md.
set -u
cd "$(dirname "$0")" && mkdir -p nfl && cd nfl

pause() { python3 -c "import time,random; time.sleep(random.uniform(1.5, 4.0))"; }
get() { # url, dest
  [ -s "$2" ] && return 0
  curl -sSL --retry 3 --retry-delay 2 -m 300 "$1" -o "$2" && [ -s "$2" ] || { rm -f "$2"; return 1; }
  pause
}

MIRROR=https://raw.githubusercontent.com/Nu11ified/nfl-career-dataproject/HEAD/Data
for f in Basic_Stats Career_Stats_Passing Career_Stats_Rushing Career_Stats_Receiving \
         Career_Stats_Defensive Career_Stats_Fumbles Game_Logs_Quarterback \
         Game_Logs_Runningback Game_Logs_Wide_Receiver_and_Tight_End; do
  get "$MIRROR/$f.csv" "$f.csv" || echo "  missed $f"
done

ROSTERS=https://github.com/nflverse/nflverse-data/releases/download/rosters
for y in $(seq 1980 1998); do
  get "$ROSTERS/roster_$y.csv" "roster_$y.csv" || echo "  missed roster_$y"
done

echo "DONE files=$(ls -1 *.csv | wc -l) size=$(du -sh . | cut -f1)"
