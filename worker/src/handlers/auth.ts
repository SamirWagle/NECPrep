/**
 * Authentication handlers.
 *
 * Self-hosted, because D1 has no managed auth. Four ways in - anonymous guest,
 * email + password, Google, and an in-place upgrade from guest to either of the
 * other two - and all four land on the same `users` row shape and the same
 * opaque session cookie.
 *
 * THE DESIGN DECISION THAT MATTERS MOST is the anonymous guest. A new visitor
 * gets a real `users` row immediately, so their first mock attempt is written
 * server-side with a server-side deadline from the very first question. Without
 * it, the only way to let someone try the product without signing up is to let
 * the browser own the attempt - which is exactly the hole this whole API exists
 * to close.
 */

import { fail } from '../shared/errors.ts';
import {
  claimAnonymousForOAuth,
  createOAuthState,
  createSession,
  consumeOAuthState,
  createUser,
  findUserByEmail,
  findUserByOAuthAccount,
  getUserById,
  linkOAuthAccount,
  loadSessionByCookie,
  loadSessionById,
  rehashStatement,
  revokeAllSessionsForUser,
  revokeSession,
  SESSION_IDLE_TTL_MS,
  toSessionUser,
  touchSessionStatement,
  upgradeAnonymousUser,
} from '../data/auth.ts';
import { consumeRateLimit, RATE_LIMITS } from '../data/infra.ts';
import { burnPasswordTime, hashPassword, sha256Hex, verifyPassword } from '../lib/password.ts';
import { randomToken } from '../lib/ids.ts';
import { clearSessionCookie, serializeSessionCookie } from '../lib/cookies.ts';
import { ok, requireUser } from './context.ts';
import type { HandlerContext, HandlerResult } from './context.ts';
import type { SessionResponse, SessionUser } from '../shared/types.ts';
import type {
  GoogleCallbackInput,
  LoginInput,
  SignupInput,
  UpgradeAnonymousInput,
} from '../validation/schemas.ts';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/**
 * Canonical email form.
 *
 * The request schemas already lowercase and trim, but normalising again here is
 * defence in depth that matters: this value becomes a UNIQUE key and the lookup
 * key for every future login. If a caller ever reaches a handler without going
 * through the schema, a stray capital letter would create a second account for
 * the same person and make their first one unreachable.
 */
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function emitSessionCookie(ctx: HandlerContext, sessionId: string, maxAgeSeconds: number): void {
  ctx.cookies.push(
    serializeSessionCookie(sessionId, {
      maxAgeSeconds,
      secure: ctx.config.isProduction,
      sameSite: 'Lax',
    }),
  );
}

async function establishSession(
  ctx: HandlerContext,
  userId: string,
): Promise<{ sessionId: string; expiresAt: number }> {
  const now = ctx.clock.now();
  const session = await createSession(ctx.db, {
    userId,
    now,
    userAgent: ctx.meta.userAgent,
    ipHash: ctx.meta.ipHash,
  });
  // THE COOKIE CARRIES `cookieValue`; THE DATABASE HOLDS ITS SHA-256. They are
  // deliberately different strings, so a dump of `sessions` yields nothing
  // anyone can sign in with. `ctx.auth.sessionId` is the STORED id, because
  // that is what revocation and the touch statement address.
  emitSessionCookie(ctx, session.cookieValue, Math.floor(SESSION_IDLE_TTL_MS / 1000));
  return { sessionId: session.id, expiresAt: session.expiresAt };
}

function sessionBody(
  ctx: HandlerContext,
  user: SessionUser | null,
  expiresAt: number | null,
): SessionResponse {
  return { user, sessionExpiresAt: expiresAt, serverNow: ctx.clock.now() };
}

/**
 * Rate-limit subject for an unauthenticated endpoint.
 *
 * Hashed, so the `rate_limits` table never stores a raw IP - it is a bucket
 * key, not a log, and there is no reason for it to be reversible.
 */
function ipSubject(ctx: HandlerContext): string {
  return ctx.meta.ipHash ?? 'unknown';
}

/**
 * GET /api/auth/session - 0 or 1 D1 queries.
 *
 * Zero when there is no cookie, since the session middleware does the lookup.
 * This is the cheapest endpoint in the API on purpose: the client calls it on
 * every cold start.
 */
export async function readSession(
  ctx: HandlerContext,
): Promise<HandlerResult<SessionResponse>> {
  if (!ctx.auth) return ok(sessionBody(ctx, null, null));
  const session = await loadSessionById(ctx.db, ctx.auth.sessionId, ctx.clock.now());
  return ok(
    session
      ? sessionBody(ctx, toSessionUser(session.user), session.session.expires_at)
      : sessionBody(ctx, null, null),
  );
}

/**
 * POST /api/auth/anonymous - 3 D1 queries.
 *
 * Idempotent in the way that matters: if the caller already has a live session,
 * it is returned untouched rather than minting a second guest and orphaning the
 * first one's progress. That makes the endpoint safe to call on every cold
 * start, which is how the client uses it.
 */
export async function startAnonymousSession(
  ctx: HandlerContext,
): Promise<HandlerResult<SessionResponse>> {
  if (ctx.auth) {
    return ok(sessionBody(ctx, ctx.auth.user, null));
  }

  const limit = await consumeRateLimit(
    ctx.db,
    RATE_LIMITS.anonymous,
    ipSubject(ctx),
    ctx.clock.now(),
  );
  if (!limit.allowed) {
    fail('RATE_LIMITED', 'Too many new sessions from this address.', {
      retryAfterMs: limit.retryAfterMs,
    });
  }

  const now = ctx.clock.now();
  const user = await createUser(ctx.db, {
    email: null,
    passwordHash: null,
    displayName: null,
    isAnonymous: true,
    now,
  });
  if (!user) fail('INTERNAL', 'Could not create a guest session.');

  const session = await establishSession(ctx, user.id);
  return ok(sessionBody(ctx, toSessionUser(user), session.expiresAt));
}

/**
 * POST /api/auth/signup - 4 D1 queries.
 *
 * The email uniqueness check is the partial unique index, not a preceding
 * SELECT, so two simultaneous signups for the same address cannot both win.
 */
export async function signup(
  ctx: HandlerContext,
  input: SignupInput,
): Promise<HandlerResult<SessionResponse>> {
  const limit = await consumeRateLimit(
    ctx.db,
    RATE_LIMITS.signup,
    ipSubject(ctx),
    ctx.clock.now(),
  );
  if (!limit.allowed) {
    fail('RATE_LIMITED', 'Too many sign-up attempts. Try again later.', {
      retryAfterMs: limit.retryAfterMs,
    });
  }

  const now = ctx.clock.now();
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password, ctx.config.passwordIterations);

  const user = await createUser(ctx.db, {
    email,
    passwordHash,
    displayName: input.displayName ?? null,
    isAnonymous: false,
    now,
  });

  if (!user) fail('EMAIL_IN_USE', 'An account with that email already exists.');

  const session = await establishSession(ctx, user.id);
  return { status: 201, body: sessionBody(ctx, toSessionUser(user), session.expiresAt) };
}

/**
 * POST /api/auth/login - 3 to 5 D1 queries.
 *
 * A wrong email runs `burnPasswordTime` before answering. Without that, "no
 * such user" returns in a fraction of the time a real PBKDF2 verification
 * takes, and the response latency becomes a user-enumeration oracle - the error
 * message being deliberately vague would not help.
 */
export async function login(
  ctx: HandlerContext,
  input: LoginInput,
): Promise<HandlerResult<SessionResponse>> {
  const now = ctx.clock.now();
  const email = normalizeEmail(input.email);

  // Limited per address AND per account, so one attacker cannot lock every
  // user out by hammering a single IP, and one account cannot be hammered from
  // a thousand addresses.
  for (const subject of [ipSubject(ctx), `email:${email}`]) {
    const limit = await consumeRateLimit(ctx.db, RATE_LIMITS.login, subject, now);
    if (!limit.allowed) {
      fail('RATE_LIMITED', 'Too many sign-in attempts. Try again later.', {
        retryAfterMs: limit.retryAfterMs,
      });
    }
  }

  const user = await findUserByEmail(ctx.db, email);

  if (!user || user.is_anonymous === 1) {
    await burnPasswordTime(ctx.config.passwordIterations);
    fail('INVALID_CREDENTIALS', 'That email or password is incorrect.');
  }

  const check = await verifyPassword(
    input.password,
    user.password_hash,
    ctx.config.passwordIterations,
  );
  if (!check.valid) {
    fail('INVALID_CREDENTIALS', 'That email or password is incorrect.');
  }

  if (check.needsRehash) {
    const rehashed = await hashPassword(input.password, ctx.config.passwordIterations);
    await ctx.db.batch([
      rehashStatement({ userId: user.id, passwordHash: rehashed, now }),
    ]);
  }

  const session = await establishSession(ctx, user.id);
  return ok(sessionBody(ctx, toSessionUser(user), session.expiresAt));
}

/** POST /api/auth/logout - 1 D1 query. Idempotent. */
export async function logout(ctx: HandlerContext): Promise<HandlerResult<{ ok: true }>> {
  if (ctx.auth) {
    await revokeSession(ctx.db, ctx.auth.sessionId, ctx.clock.now());
  }
  ctx.cookies.push(
    clearSessionCookie({ secure: ctx.config.isProduction, sameSite: 'Lax' }),
  );
  return ok({ ok: true as const });
}

/**
 * POST /api/auth/upgrade - 6 D1 queries.
 *
 * Turns the CURRENT anonymous session's user into a real account WITHOUT
 * changing the user id, so every attempt, bookmark, streak and SRS card the
 * guest accumulated stays attached. That is the whole point of the endpoint:
 * the alternative - create a new user and migrate - means a multi-table copy
 * with no transaction to protect it, on a database that has none.
 *
 * Idempotent through the `is_anonymous = 1` predicate on the UPDATE: a replay
 * matches zero rows and gets `NOT_ANONYMOUS` rather than overwriting the
 * password of an account that has since been claimed.
 */
export async function upgradeAnonymous(
  ctx: HandlerContext,
  input: UpgradeAnonymousInput,
): Promise<HandlerResult<SessionResponse>> {
  const auth = requireUser(ctx);
  const now = ctx.clock.now();

  const limit = await consumeRateLimit(ctx.db, RATE_LIMITS.upgrade, auth.user.id, now);
  if (!limit.allowed) {
    fail('RATE_LIMITED', 'Too many attempts. Try again later.', {
      retryAfterMs: limit.retryAfterMs,
    });
  }

  if (!auth.user.isAnonymous) {
    fail('NOT_ANONYMOUS', 'This account is already registered.');
  }

  const passwordHash = await hashPassword(input.password, ctx.config.passwordIterations);
  const outcome = await upgradeAnonymousUser(ctx.db, {
    userId: auth.user.id,
    email: normalizeEmail(input.email),
    passwordHash,
    displayName: input.displayName ?? null,
    now,
  });

  if (outcome === 'email_taken') {
    fail('EMAIL_IN_USE', 'An account with that email already exists.');
  }
  if (outcome === 'not_anonymous') {
    fail('NOT_ANONYMOUS', 'This account is already registered.');
  }

  // Other devices that were sharing the guest session are logged out, because
  // the identity has changed under them. The current session survives.
  await revokeAllSessionsForUser(
    ctx.db,
    auth.user.id,
    now,
    auth.sessionId,
    'password_change',
  );

  const user = await getUserById(ctx.db, auth.user.id);
  if (!user) fail('INTERNAL', 'Account vanished mid-upgrade.');

  return ok(sessionBody(ctx, toSessionUser(user), null));
}

// --- Google OAuth -----------------------------------------------------------

function base64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/**
 * GET /api/auth/google/start - 1 D1 query. Returns a 302.
 *
 * Uses PKCE even though this is a confidential client with a secret. The
 * verifier is stored server-side against the single-use `state`, so an attacker
 * who intercepts the redirect still cannot redeem the code.
 */
export async function googleStart(
  ctx: HandlerContext,
  redirectTo: string | null,
): Promise<HandlerResult<{ location: string }>> {
  const google = ctx.config.google;
  if (!google) fail('NOT_FOUND', 'Google sign-in is not configured.');

  const verifier = randomToken(64);
  const state = await createOAuthState(ctx.db, {
    codeVerifier: verifier,
    // Only a path on our own origin is ever accepted back, so the state cannot
    // be used to bounce a signed-in user to an attacker's site.
    redirectTo: redirectTo && redirectTo.startsWith('/') ? redirectTo : null,
    now: ctx.clock.now(),
  });

  const params = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  });

  return { status: 302, body: { location: `${GOOGLE_AUTH_URL}?${params.toString()}` } };
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Exchanges the authorisation code for an identity.
 *
 * Injectable `fetchImpl` so the callback handler can be tested without
 * reaching Google. Two subrequests, zero D1 queries.
 */
export async function exchangeGoogleCode(
  ctx: HandlerContext,
  args: { code: string; codeVerifier: string },
  fetchImpl: FetchLike,
): Promise<GoogleIdentity> {
  const google = ctx.config.google;
  if (!google) fail('NOT_FOUND', 'Google sign-in is not configured.');

  const tokenRes = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: args.code,
      client_id: google.clientId,
      client_secret: google.clientSecret,
      redirect_uri: google.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: args.codeVerifier,
    }).toString(),
  });

  if (!tokenRes.ok) {
    fail('OAUTH_EXCHANGE_FAILED', 'Google sign-in failed. Please try again.', {
      internal: `Google token endpoint returned ${tokenRes.status}.`,
    });
  }

  const token = (await tokenRes.json()) as { access_token?: unknown };
  if (typeof token.access_token !== 'string') {
    fail('OAUTH_EXCHANGE_FAILED', 'Google sign-in failed. Please try again.', {
      internal: 'Google token response had no access_token.',
    });
  }

  const userRes = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) {
    fail('OAUTH_EXCHANGE_FAILED', 'Google sign-in failed. Please try again.', {
      internal: `Google userinfo endpoint returned ${userRes.status}.`,
    });
  }

  const profile = (await userRes.json()) as {
    sub?: unknown;
    email?: unknown;
    email_verified?: unknown;
    name?: unknown;
  };

  if (typeof profile.sub !== 'string' || typeof profile.email !== 'string') {
    fail('OAUTH_EXCHANGE_FAILED', 'Google did not return an email address.');
  }

  // An unverified Google address must not be allowed to claim an account: it
  // would be an account-takeover path for any email a user has not verified.
  if (profile.email_verified !== true) {
    fail('OAUTH_EXCHANGE_FAILED', 'Your Google email address is not verified.');
  }

  return {
    sub: profile.sub,
    email: profile.email.toLowerCase(),
    emailVerified: true,
    name: typeof profile.name === 'string' ? profile.name : null,
  };
}

/**
 * GET /api/auth/google/callback - 4 to 7 D1 queries. Returns a 302.
 *
 * Resolution order, and each step exists for a reason:
 *
 * 1. An existing `oauth_accounts` link wins. This is the only stable
 *    identifier Google gives us; an email can be reassigned.
 * 2. Otherwise an existing user with that VERIFIED email gets the link added,
 *    so signing up with a password and later using Google does not create a
 *    second account.
 * 3. Otherwise, if the caller is currently an anonymous guest, that guest is
 *    claimed in place and keeps all its progress.
 * 4. Otherwise a new user is created.
 */
export async function googleCallback(
  ctx: HandlerContext,
  input: GoogleCallbackInput,
  fetchImpl: FetchLike,
): Promise<HandlerResult<{ location: string }>> {
  const google = ctx.config.google;
  if (!google) fail('NOT_FOUND', 'Google sign-in is not configured.');

  const now = ctx.clock.now();

  const stored = await consumeOAuthState(ctx.db, input.state, now);
  if (!stored) {
    fail('OAUTH_STATE_INVALID', 'That sign-in link has expired. Please try again.');
  }

  const identity = await exchangeGoogleCode(
    ctx,
    { code: input.code, codeVerifier: stored.codeVerifier },
    fetchImpl,
  );

  let userId: string | null = null;

  const linked = await findUserByOAuthAccount(ctx.db, 'google', identity.sub);
  if (linked) {
    userId = linked.id;
  } else {
    const byEmail = await findUserByEmail(ctx.db, identity.email);
    if (byEmail) {
      userId = byEmail.id;
      await linkOAuthAccount(ctx.db, {
        userId,
        provider: 'google',
        providerAccountId: identity.sub,
        now,
      });
    } else if (ctx.auth?.user.isAnonymous) {
      const claimed = await claimAnonymousForOAuth(ctx.db, {
        userId: ctx.auth.user.id,
        email: identity.email,
        displayName: identity.name,
        now,
      });
      if (claimed) {
        userId = ctx.auth.user.id;
        await linkOAuthAccount(ctx.db, {
          userId,
          provider: 'google',
          providerAccountId: identity.sub,
          now,
        });
      }
    }

    if (!userId) {
      const created = await createUser(ctx.db, {
        email: identity.email,
        passwordHash: null,
        displayName: identity.name,
        isAnonymous: false,
        emailVerified: true,
        now,
      });
      if (!created) fail('EMAIL_IN_USE', 'An account with that email already exists.');
      userId = created.id;
      await linkOAuthAccount(ctx.db, {
        userId,
        provider: 'google',
        providerAccountId: identity.sub,
        now,
      });
    }
  }

  await establishSession(ctx, userId);

  const path = stored.redirectTo ?? '/app';
  return { status: 302, body: { location: `${ctx.config.appOrigin}${path}` } };
}

// --- Session middleware support ---------------------------------------------

export interface ResolvedSession {
  auth: { user: SessionUser; sessionId: string } | null;
  /** A `last_seen_at` refresh, if one is due. Applied by the middleware. */
  touch: ReturnType<typeof touchSessionStatement>;
}

/**
 * Resolves a cookie into an auth context. 1 D1 query, or 0 without a cookie.
 *
 * Called once per request by the middleware. The cookie is HASHED before it is
 * used as a key, so the stored id and the cookie are never the same string. The
 * role on the returned user comes from the `users` row, never from the cookie,
 * so there is nothing a client can edit to escalate -- and `users.status` is in
 * the lookup's WHERE clause, so a suspended account's existing sessions stop
 * resolving the moment it is suspended.
 */
export async function resolveSession(
  ctx: Pick<HandlerContext, 'db' | 'clock'>,
  cookieValue: string | null,
): Promise<ResolvedSession> {
  if (!cookieValue) return { auth: null, touch: null };

  const now = ctx.clock.now();
  const found = await loadSessionByCookie(ctx.db, cookieValue, now);
  if (!found) return { auth: null, touch: null };

  return {
    auth: { user: toSessionUser(found.user), sessionId: found.session.id },
    touch: touchSessionStatement(found.session, now),
  };
}

/** Hashes a client IP for use as a rate-limit bucket key. */
export async function hashIp(ip: string | null, salt: string): Promise<string | null> {
  if (!ip) return null;
  return (await sha256Hex(`${salt}:${ip}`)).slice(0, 32);
}
