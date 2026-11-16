import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APPLE_ROOT_CA_G3,
  APPLE_ROOT_CA_G3_SHA256,
  BUNDLE_ID,
  PurchaseRejected,
  acceptTransaction,
  verifySignedTransaction,
  type AppleTransaction,
} from '../src/index.js';
import { parseCertificate, signedBy } from '../src/x509.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const chain = JSON.parse(readFileSync(join(HERE, 'fixtures/chain.json'), 'utf8')) as Record<string, string>;

const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// After the fixtures were minted, well inside their validity.
const SIGNED = Date.UTC(2027, 5, 1, 12, 0, 0);

const transaction = (over: Partial<AppleTransaction> = {}): AppleTransaction => ({
  transactionId: '2000000812345678',
  originalTransactionId: '2000000812345678',
  bundleId: BUNDLE_ID,
  productId: `${BUNDLE_ID}.respins.3`,
  type: 'Consumable',
  quantity: 1,
  environment: 'Production',
  signedDate: SIGNED,
  purchaseDate: SIGNED,
  appAccountToken: '7d02cfba-af51-4ed9-9f84-1f2688d21150',
  ...over,
});

/** A JWS exactly as StoreKit 2 builds one: ES256, x5c of leaf, intermediate, root. */
async function sign(
  payload: unknown,
  { x5c = [chain.leaf!, chain.intermediate!, chain.root!], key = chain.leafKeyPkcs8!, alg = 'ES256' } = {},
): Promise<string> {
  const header = b64url(JSON.stringify({ alg, x5c }));
  const body = b64url(JSON.stringify(payload));
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    Buffer.from(key, 'base64'),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(`${header}.${body}`)),
  );
  return `${header}.${body}.${b64url(signature)}`;
}

const roots = [chain.root!];

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PurchaseRejected) return error.reason;
    throw error;
  }
  return 'accepted';
}

describe('the embedded root is Apple Root CA - G3', () => {
  it('has the fingerprint Apple publishes', () => {
    const der = Buffer.from(APPLE_ROOT_CA_G3, 'base64');
    expect(createHash('sha256').update(der).digest('hex').toUpperCase()).toBe(APPLE_ROOT_CA_G3_SHA256);
  });

  it("verifies Apple's real WWDR G6 intermediate, P-384 and SHA-384 end to end", async () => {
    // A real Apple signature through the same code path a purchase takes: if
    // the DER reader or the signature conversion were wrong, this is where it
    // would show, against bytes nobody here generated.
    const root = parseCertificate(new Uint8Array(Buffer.from(APPLE_ROOT_CA_G3, 'base64')));
    const wwdr = parseCertificate(new Uint8Array(readFileSync(join(HERE, 'fixtures/AppleWWDRCAG6.cer'))));
    expect(await signedBy(wwdr, root)).toBe(true);
    expect(wwdr.extensions.has('1.2.840.113635.100.6.2.1')).toBe(true);
    // And the converse: the root did not sign itself with the intermediate's key.
    expect(await signedBy(root, wwdr)).toBe(false);
  });
});

describe('verifySignedTransaction', () => {
  it('accepts a well-formed transaction on a trusted chain', async () => {
    const payload = transaction();
    expect(await verifySignedTransaction(await sign(payload), { roots })).toEqual(payload);
  });

  it("refuses a test chain against Apple's root, which is the production default", async () => {
    expect(await rejection(verifySignedTransaction(await sign(transaction())))).toBe('untrusted_root');
  });

  it('refuses an identical chain under a root it does not hold', async () => {
    const jws = await sign(transaction(), {
      x5c: [chain.rogueLeaf!, chain.rogueIntermediate!, chain.rogueRoot!],
      key: chain.rogueLeafKeyPkcs8!,
    });
    expect(await rejection(verifySignedTransaction(jws, { roots }))).toBe('untrusted_root');
  });

  it('refuses a trusted root grafted onto someone else’s intermediate', async () => {
    const jws = await sign(transaction(), {
      x5c: [chain.rogueLeaf!, chain.rogueIntermediate!, chain.root!],
      key: chain.rogueLeafKeyPkcs8!,
    });
    expect(await rejection(verifySignedTransaction(jws, { roots }))).toBe('bad_signature');
  });

  it('refuses a payload edited after signing', async () => {
    const jws = await sign(transaction());
    const [h, , s] = jws.split('.');
    const forged = b64url(JSON.stringify(transaction({ productId: `${BUNDLE_ID}.respins.12` })));
    expect(await rejection(verifySignedTransaction(`${h}.${forged}.${s}`, { roots }))).toBe('bad_signature');
  });

  it('refuses a JWS signed by a key that is not the leaf', async () => {
    const jws = await sign(transaction(), { key: chain.rogueLeafKeyPkcs8! });
    expect(await rejection(verifySignedTransaction(jws, { roots }))).toBe('bad_signature');
  });

  it('refuses a leaf without the receipt-signer OID', async () => {
    const jws = await sign(transaction(), { x5c: [chain.leafWithoutOid!, chain.intermediate!, chain.root!] });
    expect(await rejection(verifySignedTransaction(jws, { roots }))).toBe('bad_signature');
  });

  it('refuses a chain with the intermediate missing or in the wrong place', async () => {
    const short = await sign(transaction(), { x5c: [chain.leaf!, chain.root!] });
    expect(await rejection(verifySignedTransaction(short, { roots }))).toBe('bad_signature');
    const swapped = await sign(transaction(), { x5c: [chain.intermediate!, chain.leaf!, chain.root!] });
    expect(await rejection(verifySignedTransaction(swapped, { roots }))).toBe('bad_signature');
  });

  it('refuses anything but ES256', async () => {
    const jws = await sign(transaction(), { alg: 'none' });
    expect(await rejection(verifySignedTransaction(jws, { roots }))).toBe('bad_signature');
  });

  it('refuses a transaction signed outside the certificates’ validity', async () => {
    const jws = await sign(transaction({ signedDate: Date.UTC(1999, 0, 1) }));
    expect(await rejection(verifySignedTransaction(jws, { roots }))).toBe('bad_signature');
  });

  it('refuses garbage without throwing anything but a rejection', async () => {
    for (const junk of ['', 'a.b', 'a.b.c', `${b64url('{}')}.${b64url('{}')}.${b64url('x')}`]) {
      expect(await rejection(verifySignedTransaction(junk, { roots }))).not.toBe('accepted');
    }
  });
});

describe('acceptTransaction', () => {
  const accept = (t: AppleTransaction, environments: AppleTransaction['environment'][] = ['Production']) =>
    acceptTransaction(t, { bundleId: BUNDLE_ID, environments });
  const reason = (fn: () => unknown) => {
    try {
      fn();
      return 'accepted';
    } catch (error) {
      return (error as PurchaseRejected).reason;
    }
  };

  it('grants the pack size, times the quantity', () => {
    expect(accept(transaction()).respins).toBe(3);
    expect(accept(transaction({ productId: `${BUNDLE_ID}.respins.12` })).respins).toBe(12);
    expect(accept(transaction({ quantity: 2 })).respins).toBe(6);
  });

  it('refuses another app, another product, a non-consumable', () => {
    expect(reason(() => accept(transaction({ bundleId: 'com.example.other' })))).toBe('wrong_app');
    expect(reason(() => accept(transaction({ productId: `${BUNDLE_ID}.respins.1000` })))).toBe('unknown_product');
    expect(reason(() => accept(transaction({ type: 'Non-Consumable' })))).toBe('unknown_product');
  });

  it('grants Sandbox and Xcode only when configured to', () => {
    expect(reason(() => accept(transaction({ environment: 'Sandbox' })))).toBe('environment_not_accepted');
    expect(reason(() => accept(transaction({ environment: 'Xcode' })))).toBe('environment_not_accepted');
    expect(accept(transaction({ environment: 'Sandbox' }), ['Production', 'Sandbox']).respins).toBe(3);
  });

  it('refuses a refunded transaction', () => {
    expect(reason(() => accept(transaction({ revocationDate: SIGNED + 1000, revocationReason: 0 })))).toBe('revoked');
  });

  it('refuses a malformed id or quantity', () => {
    expect(reason(() => accept(transaction({ transactionId: "1' or 1=1" })))).toBe('malformed');
    expect(reason(() => accept(transaction({ quantity: 0 })))).toBe('malformed');
    expect(reason(() => accept(transaction({ quantity: 1.5 })))).toBe('malformed');
  });

  it('normalises the account token', () => {
    expect(accept(transaction({ appAccountToken: 'ABCDEF00-0000-4000-8000-000000000000' })).appAccountToken).toBe(
      'abcdef00-0000-4000-8000-000000000000',
    );
    expect(accept(transaction({ appAccountToken: undefined as unknown as string })).appAccountToken).toBeNull();
  });
});
