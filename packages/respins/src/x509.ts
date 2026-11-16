/**
 * Just enough DER to check an Apple certificate chain.
 *
 * Written here rather than imported because the Edge Function bundles this
 * package with esbuild for a neutral platform: no Node crypto, no native
 * modules, only Web Crypto -- which can verify an ECDSA signature but cannot
 * read a certificate. So this reads the five things the chain check needs out
 * of the DER (the signed bytes, the signature, its algorithm, the public key,
 * the validity window and the extensions) and nothing else.
 *
 * It is a reader for well-formed certificates from one issuer, not a general
 * X.509 implementation, and it fails closed: anything it does not understand
 * is an exception, and an exception is a refused purchase.
 */

export interface Tlv {
  readonly tag: number;
  /** Offset of the tag byte. */
  readonly start: number;
  /** Offset of the first content byte. */
  readonly contentStart: number;
  /** Offset one past the last content byte. */
  readonly end: number;
}

export function readTlv(der: Uint8Array, offset: number): Tlv {
  if (offset + 2 > der.length) throw new Error('der: truncated');
  const tag = der[offset]!;
  if ((tag & 0x1f) === 0x1f) throw new Error('der: multi-byte tags are not supported');
  let length = der[offset + 1]!;
  let cursor = offset + 2;
  if (length & 0x80) {
    const bytes = length & 0x7f;
    if (bytes === 0 || bytes > 4) throw new Error('der: unsupported length');
    length = 0;
    for (let i = 0; i < bytes; i++) {
      if (cursor >= der.length) throw new Error('der: truncated');
      length = length * 256 + der[cursor++]!;
    }
  }
  const end = cursor + length;
  if (end > der.length) throw new Error('der: length runs past the end');
  return { tag, start: offset, contentStart: cursor, end };
}

/** The TLVs directly inside a constructed one. */
export function children(der: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let cursor = parent.contentStart;
  while (cursor < parent.end) {
    const child = readTlv(der, cursor);
    out.push(child);
    cursor = child.end;
  }
  if (cursor !== parent.end) throw new Error('der: children overrun their parent');
  return out;
}

export function decodeOid(der: Uint8Array, tlv: Tlv): string {
  if (tlv.tag !== 0x06) throw new Error('der: expected an OID');
  const bytes = der.subarray(tlv.contentStart, tlv.end);
  if (bytes.length === 0) throw new Error('der: empty OID');
  const first = bytes[0]!;
  const parts: number[] = [Math.min(2, Math.floor(first / 40)), first - Math.min(2, Math.floor(first / 40)) * 40];
  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    const b = bytes[i]!;
    value = value * 128 + (b & 0x7f);
    if (!(b & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

function decodeTime(der: Uint8Array, tlv: Tlv): number {
  const text = new TextDecoder().decode(der.subarray(tlv.contentStart, tlv.end));
  // UTCTime YYMMDDHHMMSSZ, GeneralizedTime YYYYMMDDHHMMSSZ. Both always Z in
  // a certificate (RFC 5280 4.1.2.5).
  let match: RegExpMatchArray | null;
  if (tlv.tag === 0x17 && (match = text.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/))) {
    const yy = Number(match[1]);
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    return Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
  }
  if (tlv.tag === 0x18 && (match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/))) {
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
  }
  throw new Error('der: unsupported time');
}

export interface Certificate {
  readonly der: Uint8Array;
  /** The exact bytes the issuer signed. */
  readonly tbs: Uint8Array;
  readonly signatureAlgorithm: string;
  /** The issuer's signature, still DER (SEQUENCE of r, s). */
  readonly signature: Uint8Array;
  /** SubjectPublicKeyInfo, ready for `crypto.subtle.importKey('spki', …)`. */
  readonly spki: Uint8Array;
  /** The named curve of the subject's key. */
  readonly curve: string;
  readonly notBefore: number;
  readonly notAfter: number;
  /** Extension OID -> its value (the OCTET STRING's contents). */
  readonly extensions: ReadonlyMap<string, Uint8Array>;
}

export const OID = {
  ecPublicKey: '1.2.840.10045.2.1',
  p256: '1.2.840.10045.3.1.7',
  p384: '1.3.132.0.34',
  ecdsaSha256: '1.2.840.10045.4.3.2',
  ecdsaSha384: '1.2.840.10045.4.3.3',
  basicConstraints: '2.5.29.19',
} as const;

export function parseCertificate(der: Uint8Array): Certificate {
  const root = readTlv(der, 0);
  if (root.tag !== 0x30 || root.end !== der.length) throw new Error('x509: not a certificate');
  const [tbsTlv, algTlv, sigTlv] = children(der, root);
  if (!tbsTlv || !algTlv || !sigTlv || tbsTlv.tag !== 0x30 || algTlv.tag !== 0x30 || sigTlv.tag !== 0x03) {
    throw new Error('x509: malformed certificate');
  }
  const signatureAlgorithm = decodeOid(der, children(der, algTlv)[0]!);
  // BIT STRING: the first content byte counts unused bits, always 0 here.
  if (der[sigTlv.contentStart] !== 0) throw new Error('x509: unexpected signature padding');
  const signature = der.subarray(sigTlv.contentStart + 1, sigTlv.end);

  const tbs = children(der, tbsTlv);
  let i = 0;
  if (tbs[i]?.tag === 0xa0) i++; // [0] version
  i++; // serialNumber
  const innerAlg = tbs[i++];
  if (!innerAlg || decodeOid(der, children(der, innerAlg)[0]!) !== signatureAlgorithm) {
    throw new Error('x509: signature algorithm mismatch');
  }
  i++; // issuer
  const validity = tbs[i++];
  i++; // subject
  const spkiTlv = tbs[i++];
  if (!validity || !spkiTlv || validity.tag !== 0x30 || spkiTlv.tag !== 0x30) throw new Error('x509: malformed tbs');
  const [nb, na] = children(der, validity);
  if (!nb || !na) throw new Error('x509: malformed validity');

  const [spkiAlg] = children(der, spkiTlv);
  const spkiAlgParts = children(der, spkiAlg!);
  if (decodeOid(der, spkiAlgParts[0]!) !== OID.ecPublicKey) throw new Error('x509: not an EC key');
  const curve = decodeOid(der, spkiAlgParts[1]!);

  const extensions = new Map<string, Uint8Array>();
  for (; i < tbs.length; i++) {
    const t = tbs[i]!;
    if (t.tag !== 0xa3) continue; // [1] and [2] unique ids are skipped
    const [seq] = children(der, t);
    for (const ext of children(der, seq!)) {
      const parts = children(der, ext);
      const id = decodeOid(der, parts[0]!);
      const value = parts[parts.length - 1]!;
      if (value.tag !== 0x04) throw new Error('x509: malformed extension');
      extensions.set(id, der.subarray(value.contentStart, value.end));
    }
  }

  return {
    der,
    tbs: der.subarray(tbsTlv.start, tbsTlv.end),
    signatureAlgorithm,
    signature,
    spki: der.subarray(spkiTlv.start, spkiTlv.end),
    curve,
    notBefore: decodeTime(der, nb),
    notAfter: decodeTime(der, na),
    extensions,
  };
}

/** Does the certificate say it is a CA (basicConstraints cA = TRUE)? */
export function isCa(cert: Certificate): boolean {
  const value = cert.extensions.get(OID.basicConstraints);
  if (!value) return false;
  const seq = readTlv(value, 0);
  const first = children(value, seq)[0];
  return !!first && first.tag === 0x01 && value[first.contentStart] !== 0;
}

/**
 * An ECDSA signature from DER (SEQUENCE { r, s }) to the fixed-width r || s
 * that Web Crypto verifies. Each integer is left-padded, or stripped of the
 * sign byte DER adds, to the curve's size.
 */
export function ecdsaDerToRaw(sig: Uint8Array, size: number): Uint8Array {
  const seq = readTlv(sig, 0);
  const [r, s] = children(sig, seq);
  if (!r || !s || r.tag !== 0x02 || s.tag !== 0x02) throw new Error('ecdsa: malformed signature');
  const out = new Uint8Array(size * 2);
  for (const [k, part] of [r, s].entries()) {
    let bytes = sig.subarray(part.contentStart, part.end);
    while (bytes.length > size && bytes[0] === 0) bytes = bytes.subarray(1);
    if (bytes.length > size) throw new Error('ecdsa: integer too large for the curve');
    out.set(bytes, k * size + (size - bytes.length));
  }
  return out;
}

export const CURVES: Record<string, { name: 'P-256' | 'P-384'; size: number }> = {
  [OID.p256]: { name: 'P-256', size: 32 },
  [OID.p384]: { name: 'P-384', size: 48 },
};

export const HASHES: Record<string, 'SHA-256' | 'SHA-384'> = {
  [OID.ecdsaSha256]: 'SHA-256',
  [OID.ecdsaSha384]: 'SHA-384',
};

/** Copy into a fresh ArrayBuffer: Web Crypto's types refuse a shared one. */
export const buf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

export async function importKey(cert: Certificate): Promise<CryptoKey> {
  const curve = CURVES[cert.curve];
  if (!curve) throw new Error(`x509: unsupported curve ${cert.curve}`);
  return crypto.subtle.importKey('spki', buf(cert.spki), { name: 'ECDSA', namedCurve: curve.name }, false, ['verify']);
}

/** Did `issuer` sign `subject`? */
export async function signedBy(subject: Certificate, issuer: Certificate): Promise<boolean> {
  const hash = HASHES[subject.signatureAlgorithm];
  const curve = CURVES[issuer.curve];
  if (!hash || !curve) return false;
  const key = await importKey(issuer);
  return crypto.subtle.verify(
    { name: 'ECDSA', hash },
    key,
    buf(ecdsaDerToRaw(subject.signature, curve.size)),
    buf(subject.tbs),
  );
}
