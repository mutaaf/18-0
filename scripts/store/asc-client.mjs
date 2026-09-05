/**
 * A very small App Store Connect API client.
 *
 * Everything the store tooling does goes through here so there is exactly one
 * place that knows how Apple wants to be talked to, and one place to look when
 * it stops working.
 *
 * Authentication is an App Store Connect API key, never an Apple ID. A password
 * means a two-factor prompt, and nothing in CI can answer one. The key is a
 * P-256 private key and the token is an ES256 JWT — which Node can sign
 * natively, so this pulls in no dependencies at all.
 *
 * The one non-obvious bit is `dsaEncoding: 'ieee-p1363'`. Node's default is DER,
 * and a DER signature in a JWT is silently rejected by Apple as a malformed
 * token with no hint that the encoding is the problem.
 *
 * Credentials come from the environment, the same three the release workflow
 * sets and `.local/asc.env` exports:
 *
 *   EXPO_ASC_API_KEY_PATH   the .p8
 *   EXPO_ASC_KEY_ID         its key id
 *   EXPO_ASC_ISSUER_ID      the issuer this key belongs to
 */
import { createSign, sign as signOneShot } from 'node:crypto';
import { readFileSync } from 'node:fs';

const HOST = 'https://api.appstoreconnect.apple.com';

const need = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Source the credentials first: \`set -a; . .local/asc.env; set +a\``,
    );
  }
  return value;
};

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A token good for ten minutes. Apple refuses anything longer than twenty. */
function token() {
  const key = readFileSync(need('EXPO_ASC_API_KEY_PATH'), 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: 'ES256', kid: need('EXPO_ASC_KEY_ID'), typ: 'JWT' });
  const payload = base64url({
    iss: need('EXPO_ASC_ISSUER_ID'),
    iat: now,
    exp: now + 600,
    aud: 'appstoreconnect-v1',
  });
  const signature = signOneShot('sha256', Buffer.from(`${header}.${payload}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * One request.
 *
 * Apple's errors arrive as a JSON array with the useful sentence in `detail`,
 * and a bare status code tells you nothing about which field it disliked — so
 * this surfaces the whole thing rather than the code.
 */
export async function asc(path, init = {}) {
  const res = await fetch(path.startsWith('http') ? path : `${HOST}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token()}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  // 204 on a successful DELETE, and an empty body is not JSON.
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const detail = (body?.errors ?? [])
      .map((e) => `${e.title}: ${e.detail}${e.source?.pointer ? ` (${e.source.pointer})` : ''}`)
      .join('; ');
    throw new Error(`${res.status} ${init.method ?? 'GET'} ${path} — ${detail || text.slice(0, 300)}`);
  }
  return body;
}

/** Follow `links.next` to the end. Apple pages at 50 and the default is 20. */
export async function ascAll(path) {
  const out = [];
  let next = path;
  while (next) {
    const page = await asc(next);
    out.push(...page.data);
    next = page.links?.next ?? null;
  }
  return out;
}

export const patch = (path, type, id, attributes) =>
  asc(path, { method: 'PATCH', body: JSON.stringify({ data: { type, id, attributes } }) });

export const post = (path, data) => asc(path, { method: 'POST', body: JSON.stringify({ data }) });

/** Everything here is about one app; this saves repeating the id. */
export const APP_ID = process.env.ASC_APP_ID ?? '6808414695';

export { token, createSign };
