/**
 * Password hashing with PBKDF2-HMAC-SHA256 via WebCrypto.
 *
 * Workers has no native argon2/bcrypt and cannot load a WASM one on the free
 * plan's CPU budget, so PBKDF2 through `crypto.subtle` is the only credible
 * option. The iteration count is a deliberate, documented compromise: OWASP
 * asks for 600,000 for PBKDF2-SHA256, but Workers Free allows ~10ms of CPU per
 * invocation and 600k iterations will not fit. The default is therefore
 * 100,000, overridable with `PASSWORD_HASH_ITERATIONS`, and the deployment note
 * in docs/api.md says to raise it to 600,000 on the paid plan where the CPU
 * limit is 30s.
 *
 * Stored format - self-describing, so the iteration count can be raised later
 * and old hashes still verify and get rehashed on next login:
 *
 *     pbkdf2$sha256$<iterations>$<salt-b64url>$<derived-b64url>
 */

export const DEFAULT_PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_BITS = 256;

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations },
    key,
    DERIVED_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const derived = await derive(password, salt, iterations);
  return `pbkdf2$sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns `needsRehash` when the stored hash used fewer iterations than the
 * current setting, so callers can transparently upgrade on a successful login.
 * Never throws on a malformed stored hash - a corrupt row must read as "wrong
 * password", not as a 500 that tells an attacker the account exists.
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
  currentIterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!stored) return { valid: false, needsRehash: false };

  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') {
    return { valid: false, needsRehash: false };
  }

  const iterations = Number.parseInt(parts[2], 10);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 2_000_000) {
    return { valid: false, needsRehash: false };
  }

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64Url(parts[3]);
    expected = fromBase64Url(parts[4]);
  } catch {
    return { valid: false, needsRehash: false };
  }

  const actual = await derive(password, salt, iterations);
  if (actual.length !== expected.length) return { valid: false, needsRehash: false };

  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];

  return { valid: diff === 0, needsRehash: diff === 0 && iterations < currentIterations };
}

/**
 * A dummy verification, run on a login for an address with no account.
 *
 * Without it, "no such user" returns in a fraction of the time a real password
 * check takes and the response latency becomes a user-enumeration oracle.
 */
export async function burnPasswordTime(
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<void> {
  const salt = new Uint8Array(SALT_BYTES);
  await derive('timing-equalisation', salt, iterations);
}

/** SHA-256 hex, used for request fingerprints and IP hashing. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
