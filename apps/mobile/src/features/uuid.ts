/**
 * A v4 UUID that exists on every platform this app runs on.
 *
 * `crypto.randomUUID()` is in every browser and in Node, and is *not* in
 * Hermes. Calling it on a real device threw a TypeError inside the function
 * that opens a ranked game — which, because that function is awaited before
 * navigating, meant the Play button silently did nothing at all. It worked
 * everywhere it was tested (web, simulator, the Node verification harness) and
 * only failed on the one platform that matters most.
 *
 * `crypto.getRandomValues` is used when it exists, which covers the web and any
 * runtime with the polyfill. The fallback is `Math.random`, which is not
 * cryptographic — and does not need to be. The only thing this generates is an
 * idempotency key: a value that has to be unique per player, not unguessable.
 * The server enforces that with a unique index, and nothing is protected by the
 * key being hard to predict.
 */
export function uuid(): string {
  const bytes = new Uint8Array(16);

  const source = (globalThis as { crypto?: Crypto }).crypto;
  if (source?.getRandomValues) {
    source.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }

  // Version 4, variant 1, as the spec requires.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
