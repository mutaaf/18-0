#!/usr/bin/env bash
#
# The extension, as one folder somebody can unzip and load.
#
#   bash scripts/pack-extension.sh
#
# The download on the site used to be the whole repository, because GitHub can
# archive a repository and cannot archive a directory inside one. That is a
# ninety-megabyte monorepo to unzip and then a path to go hunting for, handed to
# somebody whose entire job in this transaction is to press Load unpacked. This
# is the folder and nothing else.
#
# Not a `.crx`. Chrome has refused to install those outside the Web Store for
# years, and a signed package that cannot be installed is a worse answer than a
# folder that can.
#
# Deterministic on purpose: the same sources produce the same bytes, so the file
# can be attached to a release and checked against a rebuild. `zip -X` drops the
# extra file attributes and the timestamps are pinned.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/extensions/espn-watch"
OUT="$ROOT/dist/18-0-on-watch.zip"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

test -f "$SRC/manifest.json" || { echo "No manifest at $SRC"; exit 2; }

mkdir -p "$STAGE/18-0-on-watch" "$ROOT/dist"

# Only what the extension actually loads. The fixture and its checks are how it
# is developed, not part of what it is -- and a reviewer reading an unfamiliar
# folder should not have to work out which half is the product.
( cd "$SRC" && tar -cf - \
    manifest.json config.js content.js content.css identity.js \
    options.html options.js popup.html popup.js README.md icons \
) | ( cd "$STAGE/18-0-on-watch" && tar -xf - )

# Pinned so two builds of the same sources are the same file.
find "$STAGE/18-0-on-watch" -exec touch -t 202001010000.00 {} +

rm -f "$OUT"
( cd "$STAGE" && zip -q -X -r "$OUT" 18-0-on-watch )

SIZE=$(( $(wc -c < "$OUT") / 1024 ))
echo "dist/18-0-on-watch.zip — ${SIZE}K"
echo
echo "Unzip it, open chrome://extensions, turn on Developer mode,"
echo "press Load unpacked and choose the 18-0-on-watch folder."
