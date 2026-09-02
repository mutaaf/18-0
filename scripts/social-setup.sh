#!/bin/bash
#
# Turn on Sign in with Apple and Google for the hosted project.
#
#   cp .local/social.env.example .local/social.env   # then fill it in
#   scripts/social-setup.sh
#
# Credentials are read from .local/social.env and the .p8 file it points at.
# Nothing is echoed: a private key that has been printed to a terminal is a
# private key that lives in a scrollback buffer and a session log, and should be
# rotated rather than trusted. The script prints only whether each field landed.
set -euo pipefail

cd "$(dirname "$0")/.."

[[ -f .local/social.env ]] || {
  echo "Missing .local/social.env. Copy .local/social.env.example and fill it in." >&2
  exit 1
}
set -a; . ./.local/social.env; set +a

for name in APPLE_SERVICES_ID APPLE_KEY_ID APPLE_KEY_FILE GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  [[ -n "${!name:-}" ]] || { echo "$name is empty in .local/social.env" >&2; exit 1; }
done
[[ -f "$APPLE_KEY_FILE" ]] || { echo "No key file at $APPLE_KEY_FILE" >&2; exit 1; }

REF=$(cat supabase/.temp/project-ref)

# The CLI's own token, so this needs no separate credential.
TOKEN=$(security find-generic-password -s "Supabase CLI" -w 2>/dev/null || true)
case "$TOKEN" in
  go-keyring-base64:*) TOKEN=$(printf '%s' "${TOKEN#go-keyring-base64:}" | base64 -d);;
esac
[[ -n "$TOKEN" ]] || { echo "Not logged in to the Supabase CLI. Run: supabase login" >&2; exit 1; }

BUNDLE_ID=$(grep -o "bundleIdentifier: '[^']*'" apps/mobile/app.config.js | cut -d\' -f2)

# jq builds the body so the key's newlines are encoded properly. Passing a PEM
# through shell interpolation is how it silently arrives as one line.
BODY=$(jq -n \
  --arg services "$APPLE_SERVICES_ID" \
  --arg team "${APPLE_TEAM_ID:-95988FTS33}" \
  --arg keyid "$APPLE_KEY_ID" \
  --rawfile key "$APPLE_KEY_FILE" \
  --arg bundle "$BUNDLE_ID" \
  --arg gid "$GOOGLE_CLIENT_ID" \
  --arg gsecret "$GOOGLE_CLIENT_SECRET" \
  '{
    external_apple_enabled: true,
    external_apple_client_id: $services,
    # The bundle id belongs here so a future native Sign in with Apple sheet is
    # accepted too. The web flow this app uses presents the Services ID.
    external_apple_additional_client_ids: $bundle,
    external_apple_secret: ($team + "\n" + $keyid + "\n" + $key),
    external_google_enabled: true,
    external_google_client_id: $gid,
    external_google_secret: $gsecret,
    security_manual_linking_enabled: true
  }')

STATUS=$(curl -s -o /tmp/social-setup.out -w '%{http_code}' \
  -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  --data-binary "$BODY")

if [[ "$STATUS" != "200" ]]; then
  echo "Supabase rejected the update (HTTP $STATUS):" >&2
  head -c 600 /tmp/social-setup.out >&2; echo >&2
  rm -f /tmp/social-setup.out
  exit 1
fi
rm -f /tmp/social-setup.out

echo "Applied. Reading it back:"
curl -s "https://api.supabase.com/v1/projects/$REF/config/auth" -H "Authorization: Bearer $TOKEN" \
  | python3 -c '
import json, sys
c = json.load(sys.stdin)
def show(label, value, secret=False):
    mark = "ok" if value else "MISSING"
    shown = "set" if (secret and value) else (value if value else "")
    print(f"  {label:34} {mark:8} {shown}")
show("apple enabled", c.get("external_apple_enabled"))
show("apple services id", c.get("external_apple_client_id"))
show("apple additional client ids", c.get("external_apple_additional_client_ids"))
show("apple secret", c.get("external_apple_secret"), secret=True)
show("google enabled", c.get("external_google_enabled"))
show("google client id", c.get("external_google_client_id"))
show("google secret", c.get("external_google_secret"), secret=True)
show("manual linking", c.get("security_manual_linking_enabled"))
'
# Only now that the providers are live is it safe to show the buttons.
if grep -q '^EXPO_PUBLIC_AUTH_PROVIDERS=' apps/mobile/.env 2>/dev/null; then
  sed -i '' 's/^EXPO_PUBLIC_AUTH_PROVIDERS=.*/EXPO_PUBLIC_AUTH_PROVIDERS=apple,google/' apps/mobile/.env
else
  echo 'EXPO_PUBLIC_AUTH_PROVIDERS=apple,google' >> apps/mobile/.env
fi
echo
echo "apps/mobile/.env now offers apple,google."

if command -v gh >/dev/null; then
  gh variable set AUTH_PROVIDERS --body 'apple,google' >/dev/null 2>&1 \
    && echo "Repository variable AUTH_PROVIDERS set; the next web deploy shows the buttons." \
    || echo "Could not set the AUTH_PROVIDERS repository variable. Run: gh variable set AUTH_PROVIDERS --body apple,google"
fi
echo
echo "Then verify by signing in on an account that has already finished a ranked"
echo "season, and checking the leaderboard entry is still yours afterwards. That"
echo "is the linking path working; if it silently made a new account, it is not."
