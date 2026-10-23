/**
 * Idempotency and rate limiting - the two cross-cutting pieces of D1 state.
 */

import { Db, sql } from './d1.ts';
import type { PendingStatement } from './d1.ts';
import { T } from './tables.ts';
import { HOUR, MINUTE } from '../lib/time.ts';

// --- Idempotency ------------------------------------------------------------

export type IdempotencyCheck =
  | { kind: 'proceed' }
  | { kind: 'replay'; statusCode: number; body: unknown }
  /** Same key, different body. The client has a bug; do not guess. */
  | { kind: 'reused' }
  /** Key reserved but not yet finalised: a concurrent duplicate is in flight. */
  | { kind: 'in_flight' };

/**
 * Reserves an idempotency key, or reports what happened last time.
 *
 * Costs 1 D1 query on the common first-attempt path and 2 when a key is being
 * replayed. The reservation is a real row with a NULL `response_json`, so two
 * concurrent copies of the same request cannot both proceed: the second gets
 * `in_flight` and retries, rather than both of them scoring the same attempt.
 *
 * Keyed by `(user_id, key)`. One user's key can neither collide with nor read
 * another's, which matters because clients mint these keys themselves.
 */
export async function reserveIdempotency(
  db: Db,
  args: {
    userId: string;
    key: string;
    endpoint: string;
    requestHash: string;
    now: number;
  },
): Promise<IdempotencyCheck> {
  const inserted = await db.run(
    `INSERT INTO ${T.idempotencyKeys}
       (user_id, key, endpoint, request_hash, status_code, response_json, created_at)
     VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5)
     ON CONFLICT (user_id, key) DO NOTHING`,
    args.userId,
    args.key,
    args.endpoint,
    args.requestHash,
    args.now,
  );

  if (inserted.changes === 1) return { kind: 'proceed' };

  const existing = await db.first<{
    endpoint: string;
    request_hash: string;
    status_code: number | null;
    response_json: string | null;
  }>(
    `SELECT endpoint, request_hash, status_code, response_json
       FROM ${T.idempotencyKeys}
      WHERE user_id = ?1 AND key = ?2`,
    args.userId,
    args.key,
  );

  // Lost the row between the two statements (a concurrent sweep). Safest
  // reading is that nothing has been recorded, so let the caller proceed.
  if (!existing) return { kind: 'proceed' };

  if (existing.request_hash !== args.requestHash || existing.endpoint !== args.endpoint) {
    return { kind: 'reused' };
  }

  if (existing.response_json === null || existing.status_code === null) {
    return { kind: 'in_flight' };
  }

  try {
    return {
      kind: 'replay',
      statusCode: existing.status_code,
      body: JSON.parse(existing.response_json) as unknown,
    };
  } catch {
    // A corrupt stored response must not become a permanent 500 for this key.
    return { kind: 'proceed' };
  }
}

/**
 * The statement that records the response.
 *
 * Returned rather than executed so it joins the handler's own write batch: the
 * result and its idempotency record commit together, and it costs no extra
 * round trip. A crash between the two would otherwise leave a key reserved
 * forever with the work already done.
 */
export function finalizeIdempotencyStatement(args: {
  userId: string;
  key: string;
  statusCode: number;
  body: unknown;
}): PendingStatement {
  return sql(
    `UPDATE ${T.idempotencyKeys}
        SET status_code = ?3, response_json = ?4
      WHERE user_id = ?1 AND key = ?2`,
    args.userId,
    args.key,
    args.statusCode,
    JSON.stringify(args.body),
  );
}

/**
 * Releases a reservation whose handler failed, so a retry is not stuck on
 * `in_flight` until the sweep runs. Best-effort: a failure here is swallowed by
 * the caller, because the original error is the one worth reporting.
 */
export async function releaseIdempotency(
  db: Db,
  args: { userId: string; key: string },
): Promise<void> {
  await db.run(
    `DELETE FROM ${T.idempotencyKeys}
      WHERE user_id = ?1 AND key = ?2 AND response_json IS NULL`,
    args.userId,
    args.key,
  );
}

/** Retention for replay records. Longer than any plausible offline window. */
export const IDEMPOTENCY_TTL_MS = 7 * 24 * HOUR;

/** For a scheduled sweep. Not called on the request path. */
export function sweepIdempotencyStatement(now: number): PendingStatement {
  return sql(
    `DELETE FROM ${T.idempotencyKeys} WHERE created_at < ?1`,
    now - IDEMPOTENCY_TTL_MS,
  );
}

// --- Rate limiting ----------------------------------------------------------

export interface RateLimitRule {
  /** Namespace, e.g. `auth:login`. */
  name: string;
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  login: { name: 'auth:login', limit: 10, windowMs: 10 * MINUTE },
  signup: { name: 'auth:signup', limit: 5, windowMs: HOUR },
  anonymous: { name: 'auth:anonymous', limit: 10, windowMs: HOUR },
  upgrade: { name: 'auth:upgrade', limit: 5, windowMs: HOUR },
  // Deliberately tight. Each allowed request sends an email to a third
  // party, so the quota is a spam budget as much as a security control,
  // and it is consumed per ADDRESS as well as per IP.
  passwordReset: { name: 'auth:password-reset', limit: 5, windowMs: HOUR },
  mockStart: { name: 'mock:start', limit: 20, windowMs: HOUR },
  mockSubmit: { name: 'mock:submit', limit: 40, windowMs: HOUR },
  mockSync: { name: 'mock:sync', limit: 240, windowMs: HOUR },
  practiceAnswer: { name: 'practice:answer', limit: 600, windowMs: HOUR },
  report: { name: 'report:submit', limit: 30, windowMs: HOUR },
  search: { name: 'content:search', limit: 120, windowMs: HOUR },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterMs: number;
}

/**
 * Fixed-window counter, one D1 query.
 *
 * BEST-EFFORT BY CONSTRUCTION, and the honest reason is worth writing down: D1
 * replicates asynchronously, so two requests served by different Cloudflare
 * locations can both read a stale counter and both be allowed. The effective
 * limit is therefore "roughly `limit` per window per region". That is adequate
 * for what this defends against - credential stuffing, mock-submit hammering
 * and search abuse - and it is not a substitute for a Durable Object or for
 * Cloudflare's own WAF rate limiting, neither of which is on the free plan.
 *
 * The whole operation is one upsert with RETURNING so there is no read-then-
 * write race within a single region.
 */
export async function consumeRateLimit(
  db: Db,
  rule: RateLimitRule,
  subject: string,
  now: number,
): Promise<RateLimitResult> {
  const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
  const bucket = `${rule.name}:${subject}`;

  const row = await db.first<{ count: number; window_start: number }>(
    `INSERT INTO ${T.rateLimits} (bucket, window_start, count)
     VALUES (?1, ?2, 1)
     ON CONFLICT (bucket) DO UPDATE SET
       count = CASE WHEN ${T.rateLimits}.window_start < ?2 THEN 1
                    ELSE ${T.rateLimits}.count + 1 END,
       window_start = CASE WHEN ${T.rateLimits}.window_start < ?2 THEN ?2
                          ELSE ${T.rateLimits}.window_start END
     RETURNING count, window_start`,
    bucket,
    windowStart,
  );

  const count = row?.count ?? 1;
  const start = row?.window_start ?? windowStart;

  return {
    allowed: count <= rule.limit,
    count,
    limit: rule.limit,
    retryAfterMs: Math.max(0, start + rule.windowMs - now),
  };
}
