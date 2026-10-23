/**
 * Session cookie handling.
 *
 * The cookie carries nothing but an opaque session id. There is no signed
 * payload, no user id and no role in it, so a forged or tampered cookie simply
 * fails to match a `sessions` row. That costs one indexed lookup per request
 * and removes a whole class of "I edited my JWT claims to admin" bugs - which
 * matters more than usual here, because D1 has no row-level security and the
 * role in the cookie would otherwise be the only thing standing between a user
 * and the admin endpoints.
 */

export const SESSION_COOKIE = 'necprep_session';

export interface CookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
  /** Set for a deployment where the API and the app are on different hosts. */
  sameSite?: 'Strict' | 'Lax' | 'None';
  domain?: string;
}

export function serializeSessionCookie(
  sessionId: string,
  options: CookieOptions,
): string {
  const parts = [
    `${SESSION_COOKIE}=${sessionId}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    `SameSite=${options.sameSite ?? 'Lax'}`,
  ];
  // SameSite=None is only honoured together with Secure, and a cross-site
  // deployment that forgets Secure silently loses its session on every
  // browser, so tie them together here rather than in each caller.
  if (options.secure || options.sameSite === 'None') parts.push('Secure');
  if (options.domain) parts.push(`Domain=${options.domain}`);
  return parts.join('; ');
}

export function clearSessionCookie(options: Pick<CookieOptions, 'secure' | 'sameSite' | 'domain'>): string {
  return serializeSessionCookie('', { ...options, maxAgeSeconds: 0 });
}

/** Reads one cookie out of a raw `Cookie:` header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    const value = pair.slice(eq + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}
