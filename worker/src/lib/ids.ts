/**
 * Id and opaque-token generation.
 *
 * Uses the WebCrypto global, which exists in both the Workers runtime and in
 * Node 18+, so the same code runs in production and under `node --test`.
 */

/** Crockford-style base32 without the ambiguous letters I, L, O and U. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * `len` random base32 characters, i.e. 5 * len bits of entropy from the CSPRNG.
 *
 * Rejection-free: 256 is not a multiple of 32 but it is a multiple of 32, so
 * masking the low 5 bits of each byte is uniform.
 */
export function randomToken(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += B32[bytes[i] & 31];
  return out;
}

/** A prefixed, sortable-enough, opaque id. `usr_01H...`. */
export function newId(prefix: string): string {
  return `${prefix}_${randomToken(22)}`;
}

/** 128 bits, for session cookies and OAuth state. */
export function newSecretId(prefix: string): string {
  return `${prefix}_${randomToken(26)}`;
}

/** Constant-time string compare, for session ids and tokens. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
