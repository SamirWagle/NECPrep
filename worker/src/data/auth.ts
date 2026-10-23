/**
 * Identity: users, profiles, sessions, OAuth links.
 *
 * Self-hosted because D1 has no managed auth. Three identity shapes share one
 * `users` row:
 *
 *   anonymous guest   is_anonymous = 1, email NULL,     password_hash NULL
 *   email + password  is_anonymous = 0, email set,      password_hash set
 *   Google            is_anonymous = 0, email set,      password_hash may be NULL
 *
 * An upgrade mutates the row in place, so the user id NEVER changes and every
 * attempt, bookmark and SRS card written while the user was a guest stays
 * attached. That is the whole reason guests get a real row instead of a
 * client-side identity.
 *
 * TWO TABLES PER USER, not one. `users` holds the credential; `user_profiles`
 * holds `display_name` and everything else another user may see. D1 has no
 * column-level grants, so "don't leak password_hash" cannot be a database rule
 * -- it can only be a property of the query, and splitting the table makes the
 * safe query the short one. The cost is that creating a user is two statements
 * in one batch; the second is guarded by `WHERE EXISTS (the user)` so a
 * rejected signup leaves no orphan profile.
 *
 * SESSIONS ARE STORED HASHED. `sessions.id` is the SHA-256 hex of the cookie
 * value, never the cookie value itself, so a dump of this table does not let
 * anyone sign in. Lookup is still a primary-key hit because the Worker hashes
 * before it queries. Two clocks: `expires_at` is the idle window the Worker
 * slides forward, `absolute_expires_at` is the ceiling sliding cannot pass, so
 * a stolen cookie cannot be renewed indefinitely.
 */

import { Db, sql } from './d1.ts';
import type { PendingStatement } from './d1.ts';
import { T } from './tables.ts';
import { newId, newSecretId } from '../lib/ids.ts';
import { sha256Hex } from '../lib/password.ts';
import { DAY, MINUTE } from '../lib/time.ts';
import type { SessionUser, UserRole } from '../shared/types.ts';

/** Idle window. Slid forward on use, never past the absolute ceiling. */
export const SESSION_IDLE_TTL_MS = 14 * DAY;
/** Hard ceiling. A session older than this must be re-established. */
export const SESSION_ABSOLUTE_TTL_MS = 90 * DAY;
export const OAUTH_STATE_TTL_MS = 10 * MINUTE;
/** A session is only re-stamped once an hour, to avoid a write per request. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * MINUTE;

export const PASSWORD_ALGO = 'pbkdf2-sha256';

/** `users` joined to the display half of `user_profiles`. */
export interface UserRow {
  id: string;
  email: string | null;
  email_verified_at: number | null;
  password_hash: string | null;
  role: string;
  status: string;
  is_anonymous: number;
  created_at: number;
  updated_at: number;
  display_name: string | null;
}

const USER_SELECT = `u.id, u.email, u.email_verified_at, u.password_hash, u.role,
                     u.status, u.is_anonymous, u.created_at, u.updated_at,
                     p.display_name`;

/**
 * Fails closed on an unrecognised role. An unexpected value must read as the
 * LEAST privileged, never as admin, so a typo in a migration or a hand-edited
 * row cannot grant the admin surface.
 */
export function toUserRole(raw: string): UserRole {
  switch (raw) {
    case 'admin':
    case 'moderator':
    case 'contributor':
      return raw;
    default:
      return 'student';
  }
}

export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: toUserRole(row.role),
    isAnonymous: row.is_anonymous === 1,
    hasPassword: row.password_hash !== null,
    createdAt: row.created_at,
  };
}

// --- Users ------------------------------------------------------------------

/**
 * 1 query. Matches on the GENERATED `email_normalized` column, not on `email`,
 * so a login with different casing or stray whitespace resolves to the one
 * account rather than to nothing.
 */
export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  return await db.first<UserRow>(
    `SELECT ${USER_SELECT}
       FROM ${T.users} u
       LEFT JOIN ${T.userProfiles} p ON p.user_id = u.id
      WHERE u.email_normalized = lower(trim(?1)) AND u.status = 'active'`,
    email,
  );
}

/** 1 query. */
export async function getUserById(db: Db, userId: string): Promise<UserRow | null> {
  return await db.first<UserRow>(
    `SELECT ${USER_SELECT}
       FROM ${T.users} u
       LEFT JOIN ${T.userProfiles} p ON p.user_id = u.id
      WHERE u.id = ?1`,
    userId,
  );
}

export interface CreateUserArgs {
  email: string | null;
  passwordHash: string | null;
  displayName: string | null;
  isAnonymous: boolean;
  emailVerified?: boolean;
  now: number;
}

/** What a guest's profile is called until they say otherwise. */
export const GUEST_DISPLAY_NAME = 'Guest';

/**
 * Creates a user and its profile. 2 statements, ONE batch.
 *
 * Returns `null` when the email is already claimed, which is detected by the
 * partial unique index rather than by a preceding SELECT: a read-then-write
 * would race two concurrent signups for the same address into two rows.
 *
 * The profile insert carries `WHERE EXISTS (the user)` rather than relying on
 * the batch being atomic, because a foreign-key violation would throw and the
 * caller could not then distinguish "email taken" from "something broke".
 */
export async function createUser(db: Db, args: CreateUserArgs): Promise<UserRow | null> {
  const id = newId('usr');
  const displayName = args.displayName ?? (args.isAnonymous ? GUEST_DISPLAY_NAME : null);
  // `user_profiles.display_name` is NOT NULL, and a nameless signup is a real
  // case (email + password with no display name). The local part of the address
  // is a better placeholder than an empty string.
  const profileName =
    displayName ?? (args.email !== null ? args.email.split('@')[0] : GUEST_DISPLAY_NAME);

  const results = await db.batch([
    // The conflict target repeats the index predicate on purpose. The unique
    // index on `email_normalized` is PARTIAL -- anonymous guests all carry a
    // NULL email -- and SQLite only matches a partial index when the upsert
    // restates its WHERE clause. A bare `ON CONFLICT (email_normalized)`
    // raises "does not match any PRIMARY KEY or UNIQUE constraint" at runtime,
    // on every signup.
    //
    // The target is named rather than left bare so that an id collision, which
    // would be a genuine bug, still throws instead of being quietly reported
    // to the caller as a taken email address.
    sql(
      `INSERT INTO ${T.users}
         (id, email, email_verified_at, password_hash, password_algo, role,
          is_anonymous, status, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'student', ?6, 'active', ?7, ?7)
       ON CONFLICT (email_normalized) WHERE email_normalized IS NOT NULL DO NOTHING`,
      id,
      args.email,
      args.emailVerified ? args.now : null,
      args.passwordHash,
      args.passwordHash === null ? null : PASSWORD_ALGO,
      args.isAnonymous ? 1 : 0,
      args.now,
    ),
    sql(
      `INSERT INTO ${T.userProfiles} (user_id, display_name, created_at, updated_at)
       SELECT ?1, ?2, ?3, ?3
        WHERE EXISTS (SELECT 1 FROM ${T.users} WHERE id = ?1)
       ON CONFLICT (user_id) DO NOTHING`,
      id,
      profileName,
      args.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) !== 1) return null;

  return {
    id,
    email: args.email,
    email_verified_at: args.emailVerified ? args.now : null,
    password_hash: args.passwordHash,
    role: 'student',
    status: 'active',
    is_anonymous: args.isAnonymous ? 1 : 0,
    created_at: args.now,
    updated_at: args.now,
    display_name: displayName ?? profileName,
  };
}

export type UpgradeOutcome = 'upgraded' | 'email_taken' | 'not_anonymous';

/**
 * Turns the current anonymous user into a real account, in place. 3 queries.
 *
 * The `is_anonymous = 1` predicate is in the WHERE clause, not in a preceding
 * read, so a replayed upgrade cannot overwrite an already-claimed account's
 * email and password - the second call matches zero rows and the caller reports
 * `not_anonymous`. Combined with the unique email index, this is the entire
 * safety argument for the endpoint.
 */
export async function upgradeAnonymousUser(
  db: Db,
  args: {
    userId: string;
    email: string;
    passwordHash: string;
    displayName: string | null;
    now: number;
  },
): Promise<UpgradeOutcome> {
  // The email check has to come first, because SQLite surfaces a unique-index
  // violation as a thrown error rather than as zero changes, and the thrown
  // error cannot be distinguished from a genuine failure.
  const taken = await db.first<{ id: string }>(
    `SELECT id FROM ${T.users}
      WHERE email_normalized = lower(trim(?1)) AND id <> ?2`,
    args.email,
    args.userId,
  );
  if (taken) return 'email_taken';

  // Both halves of the identity move in ONE statement, which is what the
  // `is_anonymous = 0 OR email IS NULL` CHECK requires: setting the flag and
  // the address in two statements would leave an invalid row in between.
  const results = await db.batch([
    sql(
      `UPDATE ${T.users}
          SET email = ?2, password_hash = ?3, password_algo = ?4,
              is_anonymous = 0, updated_at = ?5
        WHERE id = ?1 AND is_anonymous = 1`,
      args.userId,
      args.email,
      args.passwordHash,
      PASSWORD_ALGO,
      args.now,
    ),
    sql(
      `UPDATE ${T.userProfiles}
          SET display_name = COALESCE(?2, display_name), updated_at = ?3
        WHERE user_id = ?1`,
      args.userId,
      args.displayName,
      args.now,
    ),
  ]);

  return (results[0]?.meta.changes ?? 0) === 1 ? 'upgraded' : 'not_anonymous';
}

/** Transparent iteration-count upgrade after a successful login. */
export function rehashStatement(args: {
  userId: string;
  passwordHash: string;
  now: number;
}): PendingStatement {
  return sql(
    `UPDATE ${T.users}
        SET password_hash = ?2, password_algo = ?3, updated_at = ?4
      WHERE id = ?1`,
    args.userId,
    args.passwordHash,
    PASSWORD_ALGO,
    args.now,
  );
}

// --- Sessions ---------------------------------------------------------------

export interface SessionRow {
  /** sha256 hex of the cookie value. NEVER the cookie value. */
  id: string;
  user_id: string;
  created_at: number;
  last_used_at: number;
  expires_at: number;
  absolute_expires_at: number;
}

/** The stored id for a cookie value. The only way to turn one into the other. */
export async function hashSessionCookie(cookieValue: string): Promise<string> {
  return await sha256Hex(cookieValue);
}

/**
 * 1 query. Returns the opaque value that goes into the cookie AND the id that
 * went into the database, which are deliberately different.
 */
export async function createSession(
  db: Db,
  args: {
    userId: string;
    now: number;
    userAgent: string | null;
    ipHash: string | null;
    idleTtlMs?: number;
    absoluteTtlMs?: number;
  },
): Promise<{ cookieValue: string; id: string; expiresAt: number }> {
  const cookieValue = newSecretId('ses');
  const id = await hashSessionCookie(cookieValue);
  const absoluteExpiresAt = args.now + (args.absoluteTtlMs ?? SESSION_ABSOLUTE_TTL_MS);
  const expiresAt = Math.min(args.now + (args.idleTtlMs ?? SESSION_IDLE_TTL_MS), absoluteExpiresAt);

  await db.run(
    `INSERT INTO ${T.sessions}
       (id, user_id, created_at, last_used_at, expires_at, absolute_expires_at,
        revoked_at, revoked_reason, ip_hash, user_agent)
     VALUES (?1, ?2, ?3, ?3, ?4, ?5, NULL, NULL, ?6, ?7)`,
    id,
    args.userId,
    args.now,
    expiresAt,
    absoluteExpiresAt,
    args.ipHash,
    args.userAgent === null ? null : args.userAgent.slice(0, 256),
  );
  return { cookieValue, id, expiresAt };
}

/**
 * Resolves a STORED session id to a live session and its user. 1 query.
 *
 * Expiry, revocation and account status are all in the WHERE clause, so an
 * expired, revoked or suspended session is indistinguishable from a nonexistent
 * one and there is no code path where a stale row is loaded and then checked.
 * `u.status = 'active'` is the part that is easy to forget: without it a
 * suspended user keeps every session they had when they were suspended.
 */
export async function loadSessionById(
  db: Db,
  sessionId: string,
  now: number,
): Promise<{ session: SessionRow; user: UserRow } | null> {
  const raw = await db.first<Record<string, unknown>>(
    `SELECT s.id AS session_id, s.user_id, s.created_at AS session_created_at,
            s.last_used_at, s.expires_at, s.absolute_expires_at,
            ${USER_SELECT}
       FROM ${T.sessions} s
       JOIN ${T.users} u ON u.id = s.user_id
       LEFT JOIN ${T.userProfiles} p ON p.user_id = u.id
      WHERE s.id = ?1
        AND s.revoked_at IS NULL
        AND s.expires_at > ?2
        AND s.absolute_expires_at > ?2
        AND u.status = 'active'`,
    sessionId,
    now,
  );
  if (!raw) return null;

  return {
    session: {
      id: raw.session_id as string,
      user_id: raw.user_id as string,
      created_at: raw.session_created_at as number,
      last_used_at: raw.last_used_at as number,
      expires_at: raw.expires_at as number,
      absolute_expires_at: raw.absolute_expires_at as number,
    },
    user: {
      id: raw.id as string,
      email: (raw.email as string | null) ?? null,
      email_verified_at: (raw.email_verified_at as number | null) ?? null,
      password_hash: (raw.password_hash as string | null) ?? null,
      role: raw.role as string,
      status: raw.status as string,
      is_anonymous: raw.is_anonymous as number,
      created_at: raw.created_at as number,
      updated_at: raw.updated_at as number,
      display_name: (raw.display_name as string | null) ?? null,
    },
  };
}

/** Resolves a raw COOKIE value. Hashes first, so the cookie is never a key. */
export async function loadSessionByCookie(
  db: Db,
  cookieValue: string,
  now: number,
): Promise<{ session: SessionRow; user: UserRow } | null> {
  return await loadSessionById(db, await hashSessionCookie(cookieValue), now);
}

/**
 * Slides the idle window forward, at most once an hour.
 *
 * Returned as a statement, and only when it is actually due, because a write on
 * every authenticated request would spend a meaningful slice of the 100k
 * rows/day budget on nothing but liveness tracking. `min(..., absolute)` is the
 * clamp that makes the second clock mean something: without it, sliding would
 * renew a stolen cookie forever.
 */
export function touchSessionStatement(
  session: SessionRow,
  now: number,
  idleTtlMs = SESSION_IDLE_TTL_MS,
): PendingStatement | null {
  if (now - session.last_used_at < SESSION_TOUCH_INTERVAL_MS) return null;
  return sql(
    `UPDATE ${T.sessions}
        SET last_used_at = ?2,
            expires_at = MIN(?3, absolute_expires_at)
      WHERE id = ?1 AND revoked_at IS NULL`,
    session.id,
    now,
    now + idleTtlMs,
  );
}

export type RevokeReason =
  | 'logout'
  | 'logout_all'
  | 'password_change'
  | 'admin'
  | 'rotated'
  | 'suspicious';

/** 1 query. Idempotent: revoking a revoked session is a no-op. */
export async function revokeSession(
  db: Db,
  sessionId: string,
  now: number,
  reason: RevokeReason = 'logout',
): Promise<void> {
  await db.run(
    `UPDATE ${T.sessions}
        SET revoked_at = ?2, revoked_reason = ?3
      WHERE id = ?1 AND revoked_at IS NULL`,
    sessionId,
    now,
    reason,
  );
}

/** Used when a password changes, so other devices are logged out. */
export async function revokeAllSessionsForUser(
  db: Db,
  userId: string,
  now: number,
  exceptSessionId?: string,
  reason: RevokeReason = 'logout_all',
): Promise<void> {
  await db.run(
    `UPDATE ${T.sessions}
        SET revoked_at = ?2, revoked_reason = ?4
      WHERE user_id = ?1 AND revoked_at IS NULL AND id <> COALESCE(?3, '')`,
    userId,
    now,
    exceptSessionId ?? null,
    reason,
  );
}

// --- OAuth ------------------------------------------------------------------

/** 1 query. */
export async function createOAuthState(
  db: Db,
  args: { codeVerifier: string; redirectTo: string | null; now: number },
): Promise<string> {
  const state = newSecretId('oas');
  await db.run(
    `INSERT INTO ${T.oauthStates} (state, code_verifier, redirect_to, created_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
    state,
    args.codeVerifier,
    // The column has a `GLOB '/*'` CHECK, so a non-path slips through as NULL
    // rather than failing the request: the redirect is a convenience, and an
    // absolute URL here would be an open-redirect primitive.
    args.redirectTo !== null && args.redirectTo.startsWith('/') ? args.redirectTo : null,
    args.now,
    args.now + OAUTH_STATE_TTL_MS,
  );
  return state;
}

/**
 * Single-use state consumption. 1 query.
 *
 * `DELETE ... RETURNING` makes it atomic: a replayed callback finds nothing and
 * is rejected, which is what stops an intercepted `?code=` from being redeemed
 * twice.
 */
export async function consumeOAuthState(
  db: Db,
  state: string,
  now: number,
): Promise<{ codeVerifier: string; redirectTo: string | null } | null> {
  const row = await db.first<{ code_verifier: string; redirect_to: string | null }>(
    `DELETE FROM ${T.oauthStates}
      WHERE state = ?1 AND expires_at > ?2
      RETURNING code_verifier, redirect_to`,
    state,
    now,
  );
  return row ? { codeVerifier: row.code_verifier, redirectTo: row.redirect_to } : null;
}

/** 1 query. */
export async function findUserByOAuthAccount(
  db: Db,
  provider: string,
  providerAccountId: string,
): Promise<UserRow | null> {
  return await db.first<UserRow>(
    `SELECT ${USER_SELECT}
       FROM ${T.oauthAccounts} oa
       JOIN ${T.users} u ON u.id = oa.user_id
       LEFT JOIN ${T.userProfiles} p ON p.user_id = u.id
      WHERE oa.provider = ?1 AND oa.provider_account_id = ?2 AND u.status = 'active'`,
    provider,
    providerAccountId,
  );
}

/** 1 query. Idempotent, so a repeat sign-in does not create a second link. */
export async function linkOAuthAccount(
  db: Db,
  args: {
    userId: string;
    provider: string;
    providerAccountId: string;
    now: number;
  },
): Promise<void> {
  await db.run(
    `INSERT INTO ${T.oauthAccounts}
       (id, user_id, provider, provider_account_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (provider, provider_account_id) DO NOTHING`,
    newId('oac'),
    args.userId,
    args.provider,
    args.providerAccountId,
    args.now,
  );
}

/**
 * Claims an anonymous user for a Google identity, in place. 2 statements.
 *
 * Same shape as the password upgrade, and for the same reason: a guest who has
 * already done three mock tests and then signs in with Google must keep them.
 */
export async function claimAnonymousForOAuth(
  db: Db,
  args: { userId: string; email: string; displayName: string | null; now: number },
): Promise<boolean> {
  const results = await db.batch([
    sql(
      `UPDATE ${T.users}
          SET email = ?2, email_verified_at = ?3,
              is_anonymous = 0, updated_at = ?3
        WHERE id = ?1 AND is_anonymous = 1
          AND NOT EXISTS (
            SELECT 1 FROM ${T.users}
             WHERE email_normalized = lower(trim(?2)) AND id <> ?1)`,
      args.userId,
      args.email,
      args.now,
    ),
    sql(
      `UPDATE ${T.userProfiles}
          SET display_name = COALESCE(?2, display_name), updated_at = ?3
        WHERE user_id = ?1 AND EXISTS (
          SELECT 1 FROM ${T.users} WHERE id = ?1 AND is_anonymous = 0)`,
      args.userId,
      args.displayName,
      args.now,
    ),
  ]);
  return (results[0]?.meta.changes ?? 0) === 1;
}

/* ------------------------------------------------------------------ *
 * Password reset tokens (0011).
 *
 * The same discipline as sessions: what goes in the email is the token, what
 * goes in the database is its SHA-256. A dump of this table yields nothing
 * anyone can redeem.
 * ------------------------------------------------------------------ */

/** One hour. Long enough for a slow mail server, short enough that an old inbox is not a standing key. */
export const RESET_TOKEN_TTL_MS = 60 * MINUTE;

/** The token hash. Same construction as `hashSessionCookie`, for the same reason. */
export async function hashResetToken(token: string): Promise<string> {
  return await sha256Hex(token);
}

/**
 * Mint a reset token and retire any the account already had.
 *
 * Retiring siblings is what stops a request flood becoming a pile of live
 * keys: a student who clicks "forgot password" five times should end up with
 * one usable link, not five. The newest wins because it is the one in the
 * inbox they are looking at.
 */
export async function createPasswordResetToken(
  db: Db,
  args: { userId: string; now: number; ipHash: string | null; ttlMs?: number },
): Promise<{ token: string; expiresAt: number }> {
  const token = newSecretId('prt');
  const id = await hashResetToken(token);
  const expiresAt = args.now + (args.ttlMs ?? RESET_TOKEN_TTL_MS);

  await db.batch([
    sql(
      `UPDATE ${T.passwordResetTokens}
          SET consumed_at = ?2
        WHERE user_id = ?1 AND consumed_at IS NULL`,
      args.userId,
      args.now,
    ),
    sql(
      `INSERT INTO ${T.passwordResetTokens}
         (id, user_id, created_at, expires_at, consumed_at, requested_ip_hash)
       VALUES (?1, ?2, ?3, ?4, NULL, ?5)`,
      id,
      args.userId,
      args.now,
      expiresAt,
      args.ipHash,
    ),
  ]);

  return { token, expiresAt };
}

/**
 * Redeem a token, once.
 *
 * The UPDATE carries the whole predicate - unconsumed AND unexpired - so the
 * check and the claim are one statement. Reading first and writing second
 * would leave a window in which two requests both see an unconsumed row, and
 * D1 has no interactive transaction to close it with.
 *
 * Returns the user id when this call is the one that claimed it, and null for
 * everything else: unknown token, already used, expired. The caller cannot
 * tell those apart, and should not - each of them means the same thing to the
 * person holding the link.
 */
export async function consumePasswordResetToken(
  db: Db,
  token: string,
  now: number,
): Promise<string | null> {
  const id = await hashResetToken(token);
  const row = await db.first<{ user_id: string }>(
    `UPDATE ${T.passwordResetTokens}
        SET consumed_at = ?2
      WHERE id = ?1
        AND consumed_at IS NULL
        AND expires_at > ?2
      RETURNING user_id`,
    id,
    now,
  );
  return row?.user_id ?? null;
}
