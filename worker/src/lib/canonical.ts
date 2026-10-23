/**
 * Canonical JSON, for idempotency request fingerprints.
 *
 * Two replays of the same logical mutation must produce the same fingerprint
 * even if the client serialised its object keys in a different order (JS object
 * key order is insertion order, and an offline queue rehydrated from storage
 * can easily differ). Two DIFFERENT mutations sent under the same idempotency
 * key must produce different fingerprints, so the server can reject the reuse
 * instead of silently replaying the wrong response.
 *
 * The idempotency key itself is excluded from the fingerprint - it is the
 * lookup key, not part of the request's identity.
 */

const IGNORED_KEYS = new Set(['idempotencyKey']);

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (IGNORED_KEYS.has(key)) continue;
    // `undefined` and a missing key must fingerprint identically, since
    // JSON.stringify drops both.
    if (source[key] === undefined) continue;
    out[key] = canonicalize(source[key]);
  }
  return out;
}

/** Stable string form of a request body. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
