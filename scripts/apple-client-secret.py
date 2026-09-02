#!/usr/bin/env python3
"""
Generate the Apple "Sign in with Apple" client secret.

    python3 scripts/apple-client-secret.py .local/social.env

Prints the JWT on stdout and nothing else, so a caller can capture it without
it landing in a terminal or a shell history.

This exists because Supabase does not take an Apple .p8. Its Apple provider
wants a client secret, and for Apple a client secret is an ES256 JWT that you
sign yourself with the .p8. Handing it the key file instead produced a secret
Apple rejected, which surfaces in the app as "Unable to exchange external
code" -- a message that says nothing about which of the four values was wrong.

**It expires.** Apple caps the lifetime at six months and refuses anything
longer. Whatever is generated here stops working on the date printed to stderr,
with no warning and the same opaque error, so it is worth a calendar reminder.
"""
from __future__ import annotations

import base64
import json
import sys
import time
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

SIX_MONTHS = 15777000  # Apple's stated maximum, in seconds.


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            out[key.strip()] = value.strip()
    return out


def main(env_path: str) -> None:
    conf = env(Path(env_path))
    team = conf['APPLE_TEAM_ID']
    key_id = conf['APPLE_KEY_ID']
    services_id = conf['APPLE_SERVICES_ID']
    key_pem = Path(conf['APPLE_KEY_FILE']).read_bytes()

    now = int(time.time())
    expires = now + SIX_MONTHS

    header = {'alg': 'ES256', 'kid': key_id}
    claims = {
        'iss': team,
        'iat': now,
        'exp': expires,
        'aud': 'https://appleid.apple.com',
        # The Services ID, not the App ID: this secret authenticates the web
        # OAuth client, which is what the Services ID identifies.
        'sub': services_id,
    }

    signing_input = f'{b64(json.dumps(header, separators=(",", ":")).encode())}.' \
                    f'{b64(json.dumps(claims, separators=(",", ":")).encode())}'

    key = serialization.load_pem_private_key(key_pem, password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey):
        raise SystemExit('That .p8 is not an EC key, so it cannot be a Sign in with Apple key.')

    der = key.sign(signing_input.encode(), ec.ECDSA(hashes.SHA256()))
    # JOSE wants the raw r||s pair, fixed width. DER is what cryptography emits.
    r, s = decode_dss_signature(der)
    raw = r.to_bytes(32, 'big') + s.to_bytes(32, 'big')

    print(f'{signing_input}.{b64(raw)}')
    print(
        f'valid until {time.strftime("%Y-%m-%d", time.gmtime(expires))} '
        f'(Apple caps this at six months)',
        file=sys.stderr,
    )


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.local/social.env')
