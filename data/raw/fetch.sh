#!/bin/bash
BASE=https://github.com/nflverse/nflverse-data/releases/download
ok=0; fail=0
for y in $(seq 1999 2025); do
  for kind in "stats_player/stats_player_reg_${y}" "stats_team/stats_team_week_${y}"; do
    f=$(basename $kind).csv
    [ -s "$f" ] && continue
    if curl -sSL --retry 3 --retry-delay 2 -m 180 "$BASE/${kind}.csv" -o "$f" && [ -s "$f" ]; then ok=$((ok+1)); else fail=$((fail+1)); rm -f "$f"; fi
  done
done
curl -sSL -m 120 "$BASE/schedules/games.csv" -o games.csv
echo "DONE ok=$ok fail=$fail files=$(ls -1 *.csv | wc -l) size=$(du -sh . | cut -f1)"
