#!/bin/bash
#
# Give an agent its own checkout.
#
#   scripts/agent-worktree.sh gameday-board
#   scripts/agent-worktree.sh gameday-board --from origin/main   # the default
#
# Creates ../18-0-<name> on branch agent/<name>, links the things git does not
# carry, and installs. Print the path, work there, delete it when done:
#
#   git worktree remove ../18-0-<name>
#
# ---------------------------------------------------------------------------
# Why this exists
# ---------------------------------------------------------------------------
#
# Three agents shared one working tree and it cost real time three times. A
# commit landed on somebody else's feature branch because the branch was
# switched underneath it. A stale branch nearly reverted 1,593 cards. And an
# end-to-end run failed on a spin that was fine, because two harnesses were
# playing real games against the same database at the same moment -- which
# looked exactly like a regression and was chased as one.
#
# None of those are mistakes anybody made twice. They are what a shared
# mutable checkout does: `git status` describes somebody else's work, staging
# by path becomes a discipline rather than a default, and a rebase moves a file
# under a process that is still reading it.
#
# A worktree is the cheap fix. Same repository, same object store, same
# history, separate index and separate files.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "usage: scripts/agent-worktree.sh <name> [--from <ref>]" >&2
  echo "  e.g. scripts/agent-worktree.sh photos-licence" >&2
  exit 1
fi
if [[ ! "$NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Name must be lower-case letters, digits and hyphens: got '$NAME'" >&2
  exit 1
fi

FROM="origin/main"
if [[ "${2:-}" == "--from" ]]; then FROM="${3:?--from needs a ref}"; fi

BRANCH="agent/$NAME"
DEST="$ROOT/../18-0-$NAME"

if [[ -e "$DEST" ]]; then
  echo "$DEST already exists. Remove it first:" >&2
  echo "  git worktree remove $DEST" >&2
  exit 1
fi

# Always from the remote, never from whatever happens to be checked out here.
# Branching from a colleague's in-progress work is how a stale branch ends up
# reverting a dataset.
echo "→ fetching"
git fetch --quiet origin

echo "→ worktree $DEST on $BRANCH from $FROM"
git worktree add --quiet -b "$BRANCH" "$DEST" "$FROM"

# ---------------------------------------------------------------------------
# The things git does not carry
# ---------------------------------------------------------------------------
#
# Symlinked rather than copied. `data/raw` is gigabytes of CSVs nobody should
# re-fetch, and credentials should exist in exactly one place on the disk --
# copies rot, and a copy of a secret is a second thing to delete.
# A path git already tracks something inside -- `data/raw` holds `fetch.sh` --
# exists in a fresh worktree, and `ln -s source existing-dir` puts the link
# *inside* it rather than replacing it. So a destination that is already a
# directory gets its missing entries linked one at a time instead.
link() {
  local rel="$1"
  [[ -e "$ROOT/$rel" ]] || return 0

  if [[ -d "$DEST/$rel" ]]; then
    local entry
    for entry in "$ROOT/$rel"/*; do
      [[ -e "$entry" ]] || continue
      local base
      base="$(basename "$entry")"
      [[ -e "$DEST/$rel/$base" ]] && continue
      ln -s "$entry" "$DEST/$rel/$base"
    done
    echo "→ linked the contents of $rel"
    return 0
  fi

  mkdir -p "$(dirname "$DEST/$rel")"
  ln -s "$ROOT/$rel" "$DEST/$rel"
  echo "→ linked $rel"
}

link .local
link data/raw
link apps/mobile/.env

echo "→ installing"
(cd "$DEST" && pnpm install --silent --prefer-offline)

cat <<NOTE

Ready: $DEST
  branch  $BRANCH (from $FROM)

  cd $DEST
  pnpm -r test

Push with \`git push -u origin $BRANCH\` and open a pull request. When it is
merged:

  git worktree remove $DEST
  git branch -d $BRANCH

The linked paths point back at the main checkout, so \`data/raw\` and the
credentials are shared and everything else is yours alone.
NOTE
