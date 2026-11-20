#!/bin/bash
# Prints "epoch cpu_seconds rss_kb" for the running 17-0 app, five times a second.
# A simulator app is a process on the Mac, so its CPU time and resident memory
# are read from the host. Run by run.sh, which passes the simulator's UDID:
# with a second simulator booted (another checkout's harness, another agent),
# `pgrep -x SeventeenZero | head -1` sampled whichever app came first, and
# blocks came back as "no samples" or as somebody else's numbers.
UDID="${1:-}"
while true; do
  pid=$(pgrep -f "Devices/${UDID}/.*\.app/SeventeenZero( |$)" | head -1)
  if [[ -n "$pid" ]]; then
    read -r t rss < <(ps -o time=,rss= -p "$pid" 2>/dev/null)
    [[ -n "${t:-}" ]] && printf '%s %s %s %s\n' "$(python3 -c 'import time;print(f"{time.time():.3f}")')" "$pid" "$t" "$rss"
  fi
  sleep 0.2
done
