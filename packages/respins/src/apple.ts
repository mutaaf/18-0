/**
 * Is this StoreKit 2 transaction really from Apple, for this app, for a pack
 * we sell, and still standing?
 *
 * StoreKit 2 hands the app every transaction as a JWS (`signedTransaction`):
 * an ES256 signature over a JSON payload, with the signing certificate and
 * its chain in the header's `x5c`. Checking it needs no App Store Server API
 * key and no network: the chain has to end at Apple Root CA - G3, which is
 * embedded in this package, and Apple's two certificate-policy OIDs have to
 * be where Apple puts them. That is the same check Apple's own
 * app-store-server-library performs offline (its `SignedDataVerifier` with
 * online checks off), done in Web Crypto so it runs in the Edge Function.
 *
 * Why it matters: the respin balance is server-held and spent on ranked
 * seasons. A server that granted on the app's word -- "I bought twelve" --
 * would be granting to anyone with a proxy. A server that granted on a JWS it
 * did not verify would be granting to anyone who can base64.
 */
import { APPLE_ROOT_CA_G3 } from './apple-root.js';
import { packFor } from './rules.js';
import { CURVES, buf, importKey, isCa, parseCertificate, signedBy, type Certificate } from './x509.js';

/** Apple's marker on the leaf that signs App Store receipts and transactions. */
export const OID_APPLE_RECEIPT_SIGNER = '1.2.840.113635.100.6.11.1';
/** Apple's marker on the WWDR intermediate. */
export const OID_APPLE_WWDR_INTERMEDIATE = '1.2.840.113635.100.6.2.1';

export type Environment = 'Production' | 'Sandbox' | 'Xcode' | 'LocalTesting';

/** The fields of a JWSTransactionDecodedPayload this server reads. */
export interface AppleTransaction {
  readonly transactionId: string;
  readonly originalTransactionId?: string;
  readonly bundleId: string;
  readonly productId: string;
  readonly type: string;
  readonly quantity?: number;
  readonly environment: Environment;
  readonly signedDate: number;
  readonly purchaseDate?: number;
  readonly revocationDate?: number;
  readonly revocationReason?: number;
  readonly appAccountToken?: string;
  readonly storefront?: string;
  readonly price?: number;
  readonly currency?: string;
}

export class PurchaseRejected extends Error {
  constructor(readonly reason: string, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'PurchaseRejected';
  }
}

const b64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64url = (s: string): Uint8Array => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  return b64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
};
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export interface VerifyOptions {
  /**
   * Base64 DER roots to trust. Defaults to Apple Root CA - G3 alone. The tests
   * pass their own; the Edge Function passes Apple's, plus Xcode's local
   * StoreKit certificate only when an environment variable says this is a
   * development server.
   */
  readonly roots?: readonly string[];
  /** For the validity check. Defaults to the transaction's own `signedDate`. */
  readonly at?: number;
}

/**
 * Verify the JWS and return its payload. Throws `PurchaseRejected` for any
 * failure; never returns an unverified payload.
 *
 * Certificates are checked for validity at the moment the transaction was
 * signed, as Apple's library does when it is not making online revocation
 * checks: the app re-sends an unfinished transaction on every launch, and one
 * signed under a leaf that has since rotated out is still a real purchase.
 */
export async function verifySignedTransaction(jws: string, options: VerifyOptions = {}): Promise<AppleTransaction> {
  if (typeof jws !== 'string' || jws.length > 20_000) throw new PurchaseRejected('malformed');
  const parts = jws.split('.');
  if (parts.length !== 3) throw new PurchaseRejected('malformed');
  const [h, p, s] = parts as [string, string, string];

  let header: { alg?: unknown; x5c?: unknown };
  let payload: AppleTransaction;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(h)));
    payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  } catch {
    throw new PurchaseRejected('malformed');
  }
  if (header.alg !== 'ES256') throw new PurchaseRejected('bad_signature', 'alg');
  if (!Array.isArray(header.x5c) || header.x5c.length !== 3 || !header.x5c.every((c) => typeof c === 'string')) {
    throw new PurchaseRejected('bad_signature', 'x5c');
  }

  let leaf: Certificate, intermediate: Certificate, root: Certificate;
  try {
    [leaf, intermediate, root] = (header.x5c as string[]).map((c) => parseCertificate(b64(c))) as [
      Certificate,
      Certificate,
      Certificate,
    ];
  } catch (error) {
    throw new PurchaseRejected('bad_signature', (error as Error).message);
  }

  // The root is compared byte for byte with one we already hold. A chain that
  // merely *ends* in a self-signed certificate proves nothing.
  const trusted = (options.roots ?? [APPLE_ROOT_CA_G3]).map(b64);
  if (!trusted.some((t) => sameBytes(t, root.der))) throw new PurchaseRejected('untrusted_root');

  if (!leaf.extensions.has(OID_APPLE_RECEIPT_SIGNER)) throw new PurchaseRejected('bad_signature', 'leaf oid');
  if (!intermediate.extensions.has(OID_APPLE_WWDR_INTERMEDIATE)) {
    throw new PurchaseRejected('bad_signature', 'intermediate oid');
  }
  if (!isCa(intermediate)) throw new PurchaseRejected('bad_signature', 'intermediate is not a CA');

  const at = options.at ?? payload.signedDate;
  if (typeof at !== 'number' || !Number.isFinite(at)) throw new PurchaseRejected('malformed', 'signedDate');
  for (const cert of [leaf, intermediate, root]) {
    if (at < cert.notBefore || at > cert.notAfter) throw new PurchaseRejected('bad_signature', 'certificate not valid then');
  }

  if (!(await signedBy(intermediate, root)) || !(await signedBy(leaf, intermediate))) {
    throw new PurchaseRejected('bad_signature', 'chain');
  }

  const curve = CURVES[leaf.curve];
  if (!curve || curve.name !== 'P-256') throw new PurchaseRejected('bad_signature', 'leaf curve');
  const raw = b64url(s);
  if (raw.length !== 64) {
    // JOSE signatures are r || s; a DER one here means someone built this by hand.
    throw new PurchaseRejected('bad_signature', 'signature encoding');
  }
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    await importKey(leaf),
    buf(raw),
    buf(new TextEncoder().encode(`${h}.${p}`)),
  );
  if (!ok) throw new PurchaseRejected('bad_signature', 'jws');
  return payload;
}

export interface AcceptOptions {
  readonly bundleId: string;
  /** Which environments to grant for. Production always; the rest by configuration. */
  readonly environments: readonly Environment[];
}

/** A verified transaction we will grant for, and how many respins it is worth. */
export interface Grant {
  readonly transactionId: string;
  readonly productId: string;
  readonly respins: number;
  readonly environment: Environment;
  readonly appAccountToken: string | null;
}

/**
 * The business checks, separate from the cryptography so they can be tested
 * without a certificate: right app, a pack we sell, a consumable, an allowed
 * environment, and not refunded.
 */
export function acceptTransaction(t: AppleTransaction, options: AcceptOptions): Grant {
  if (typeof t.transactionId !== 'string' || !/^\d{1,32}$/.test(t.transactionId)) {
    throw new PurchaseRejected('malformed', 'transactionId');
  }
  if (t.bundleId !== options.bundleId) throw new PurchaseRejected('wrong_app');
  const pack = packFor(t.productId);
  if (!pack) throw new PurchaseRejected('unknown_product');
  if (t.type !== 'Consumable') throw new PurchaseRejected('unknown_product', 'type');
  if (!options.environments.includes(t.environment)) throw new PurchaseRejected('environment_not_accepted', t.environment);
  if (t.revocationDate !== undefined && t.revocationDate !== null) throw new PurchaseRejected('revoked');
  const quantity = t.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new PurchaseRejected('malformed', 'quantity');
  const token = typeof t.appAccountToken === 'string' && t.appAccountToken.length > 0 ? t.appAccountToken.toLowerCase() : null;
  return {
    transactionId: t.transactionId,
    productId: pack.productId,
    respins: pack.respins * quantity,
    environment: t.environment,
    appAccountToken: token,
  };
}
