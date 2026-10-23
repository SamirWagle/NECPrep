/**
 * The handler context, and the two gates every protected endpoint goes through.
 *
 * WHY HANDLERS ARE NOT HONO HANDLERS. Everything in `handlers/` is a plain
 * async function from `(ctx, input)` to `{ status, body }`. The Hono layer in
 * `routes/` does nothing but parse, validate, call one of these, and serialise
 * the result. That keeps the entire real logic path - ownership checks, the
 * expiry clamp, scoring, idempotency, the actual SQL - executable under
 * `node --test` against a local SQLite database, with no framework and no
 * network. The tests exercise production code, not a re-implementation of it.
 */

import type { Db } from '../data/d1.ts';
import type { Clock } from '../lib/time.ts';
import type { Config } from '../env.ts';
import { fail } from '../shared/errors.ts';
import { reserveIdempotency, releaseIdempotency, finalizeIdempotencyStatement } from '../data/infra.ts';
import { canonicalJson } from '../lib/canonical.ts';
import { sha256Hex } from '../lib/password.ts';
import type { SessionUser } from '../shared/types.ts';

export interface AuthContext {
  user: SessionUser;
  sessionId: string;
}

export interface RequestMeta {
  /** `CF-Connecting-IP`, already hashed by the middleware. */
  ipHash: string | null;
  userAgent: string | null;
}

export interface HandlerContext {
  db: Db;
  clock: Clock;
  config: Config;
  /** `null` when the request carried no live session. */
  auth: AuthContext | null;
  meta: RequestMeta;
  /** Set-Cookie values the route layer must attach to the response. */
  cookies: string[];
}

export interface HandlerResult<T> {
  status: number;
  body: T;
  replayed?: boolean;
  /**
   * Overrides the default `Cache-Control: no-store`.
   *
   * Only set this on a response whose body is identical for every visitor,
   * signed in or not. Anything derived from `ctx.auth` is not that, however
   * harmless it looks: a chapter list with a per-user "completed" flag on it
   * is a personalised response wearing public clothes.
   */
  cacheControl?: string;
}

export function ok<T>(body: T): HandlerResult<T> {
  return { status: 200, body };
}

export function created<T>(body: T): HandlerResult<T> {
  return { status: 201, body };
}

/**
 * The single authentication gate.
 *
 * D1 has no row-level security, so this function plus "every data-access
 * function takes a userId" is the entire authorisation story. There is no
 * fallback, no "if no user, use a default", and no handler that reads
 * `ctx.auth` directly without going through here.
 */
export function requireUser(ctx: HandlerContext): AuthContext {
  if (!ctx.auth) {
    fail('UNAUTHENTICATED', 'Sign in to continue.');
  }
  return ctx.auth;
}

/**
 * The role gate for the admin surface.
 *
 * The role comes from the `users` row loaded through the session, never from
 * the cookie or from a request field, so there is nothing a client can edit to
 * reach these endpoints.
 */
export function requireAdmin(ctx: HandlerContext): AuthContext {
  const auth = requireUser(ctx);
  if (auth.user.role !== 'admin' && auth.user.role !== 'moderator') {
    // A deliberate 403 rather than a 404: the caller is authenticated, and
    // pretending the route does not exist makes a legitimate permissions
    // problem undebuggable.
    fail('FORBIDDEN', 'This action requires a moderator role.');
  }
  return auth;
}

/** Anonymous users may do most things, but not everything. */
export function requireRealAccount(ctx: HandlerContext): AuthContext {
  const auth = requireUser(ctx);
  if (auth.user.isAnonymous) {
    fail('FORBIDDEN', 'Create an account to use this feature.');
  }
  return auth;
}

/**
 * Wraps a mutation so it is safe to replay.
 *
 * Costs 2 D1 queries on the first attempt (reserve, finalise) and 2 on a replay
 * (reserve-conflict, read). The stored response is returned verbatim, so a
 * client whose connection dropped after the server committed gets the SAME
 * result rather than a 409 or a second write.
 *
 * Three failure modes, all of them explicit:
 *
 * - same key, same body, finished   -> replay the stored response
 * - same key, same body, in flight  -> 409 REQUEST_IN_FLIGHT, retry later
 * - same key, DIFFERENT body        -> 409 IDEMPOTENCY_KEY_REUSED, never guess
 *
 * If `work` throws, the reservation is released so an immediate retry is not
 * stuck behind a key that will never be finalised.
 */
export async function withIdempotency<T>(
  ctx: HandlerContext,
  args: {
    userId: string;
    key: string;
    endpoint: string;
    body: unknown;
  },
  work: () => Promise<HandlerResult<T>>,
): Promise<HandlerResult<T>> {
  const now = ctx.clock.now();
  const requestHash = await sha256Hex(`${args.endpoint}\n${canonicalJson(args.body)}`);

  const check = await reserveIdempotency(ctx.db, {
    userId: args.userId,
    key: args.key,
    endpoint: args.endpoint,
    requestHash,
    now,
  });

  if (check.kind === 'replay') {
    return { status: check.statusCode, body: check.body as T, replayed: true };
  }
  if (check.kind === 'reused') {
    fail(
      'IDEMPOTENCY_KEY_REUSED',
      'This idempotency key was already used for a different request.',
    );
  }
  if (check.kind === 'in_flight') {
    fail('REQUEST_IN_FLIGHT', 'An identical request is still being processed.', {
      retryAfterMs: 1000,
    });
  }

  let result: HandlerResult<T>;
  try {
    result = await work();
  } catch (err) {
    try {
      await releaseIdempotency(ctx.db, { userId: args.userId, key: args.key });
    } catch {
      // The original error is the one worth reporting; a failed release only
      // means the retry waits for the sweep.
    }
    throw err;
  }

  await ctx.db.batch([
    finalizeIdempotencyStatement({
      userId: args.userId,
      key: args.key,
      statusCode: result.status,
      body: result.body,
    }),
  ]);

  return result;
}
