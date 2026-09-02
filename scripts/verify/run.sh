#!/bin/bash
#
# Run the end-to-end harness against the hosted project.
#
#   scripts/verify/run.sh
#
# The keys are pulled from the Supabase CLI rather than read from a file, so
# no service-role key is ever written to disk in this repository.
#
# This exists because the harness *skips* whole sections when SERVICE_KEY is
# absent and still prints "0 failed". A run that quietly covered two thirds of
# the checks looks exactly like a clean one, which is the worst possible
# failure mode for a thing whose job is to tell you the truth.
set -euo pipefail

cd "$(dirname "$0")/../.."

REF=$(cat supabase/.temp/project-ref)
KEYS=$(supabase projects api-keys --project-ref "$REF" 2>/dev/null)
# The CLI prints an ASCII table, so both columns arrive padded with spaces.
field() { echo "$KEYS" | awk -F'|' -v want="$1" \
  '{ gsub(/[[:space:]]/, "", $1); gsub(/[[:space:]]/, "", $2); if ($1 == want) print $2 }'; }

export API_URL="https://$REF.supabase.co"
export ANON_KEY=$(field anon)
export SERVICE_KEY=$(field service_role)

for name in ANON_KEY SERVICE_KEY; do
  [[ -n "${!name}" ]] || { echo "could not read $name from the Supabase CLI" >&2; exit 1; }
done

exec node scripts/verify/e2e.mjs "$@"
