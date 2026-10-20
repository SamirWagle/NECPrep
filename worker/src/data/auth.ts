/**
 * Identity: users, sessions, OAuth links.
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
 */

import { Db, sql } from './d1.ts';
import type { PendingStatement } from './d1.ts';
import { T } from './tables.ts';
import { newId, newSecretId } from '../lib/ids.ts';
import { DAY, MINUTE } from '../lib/time.ts';
import type { SessionUser, UserRole } from '../shared/types.ts';

export const SESSION_TTL_MS = 30 * DAY;
export const OAUTH_STATE_TTL_MS = 10 * MINUTE;
/** A session is only re-stamped once an hour, to avoid a write per request. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * MINUTE;

export interface UserRow {
  id: string;
  email: string | null;
  email_verified: number;
  password_hash: string | null;
  display_name: string | null;
  role: string;
  is_anonymous: number;
  created_at: number;
  updated_at: number;
}

export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    // Fail closed on an unrecognised role: an unexpected value must read as the
    // least privileged, never as admin.
    role: row.role === 'admin' || row.role === 'moderator' ? (row.role as UserRole) : 'user',
    isAnonymous: row.is_anonymous === 1,
    hasPassword: row.password_hash !== null,
    createdAt: row.created_at,
  };
}

// --- Users ------------------------------------------------------------------

/** 1 query. */
export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  return await db.first<UserRow>(
    `SELECT * FROM ${T.users} WHERE email = ?1`,
    email,
  );
}

/** 1 query. */
export async function getUserById(db: Db, userId: string): Promise<UserRow | null> {
  return await db.first<UserRow>(`SELECT * FROM ${T.users} WHERE id = ?1`, userId);
}

export interface CreateUserArgs {
  email: string | null;
  passwordHash: string | null;
  displayName: string | null;
  isAnonymous: boolean;
  emailVerified?: boolean;
  now: number;
}

/**
 * Creates a user. 1 query.
 *
 * Returns `null` when the email is already claimed, which is detected by the
 * partial unique index rather than by a preceding SELECT: a read-then-write
 * would race two concurrent signups for the same address into two rows.
 */
export async function createUser(db: Db, args: CreateUserArgs): Promise<UserRow | null> {
  const id = newId('usr');

  // The conflict target below repeats the index predicate on purpose. The
  // unique index on `email` is PARTIAL - anonymous guests all carry a NULL
  // email - and SQLite only matches a partial index when the upsert restates
  // its WHERE clause. A bare "ON CONFLICT (email)" raises "does not match any
  // PRIMARY KEY or UNIQUE constraint" at runtime, on every signup.
  //
  // The target is named rather than left bare so that an id collision, which
  // would be a genuine bug, still throws instead of being quietly reported to
  // the caller as a taken email address.
  const meta = await db.run(
    `INSERT INTO ${T.users}
       (id, email, email_verified, password_hash, display_name, role,
        is_anonymous, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'user', ?6, ?7, ?7)
     ON CONFLICT (email) WHERE email IS NOT NULL DO NOTHING`,
    id,
    args.email,
    args.emailVerified ? 1 : 0,
    args.passwordHash,
    args.displayName,
    args.isAnonymous ? 1 : 0,
    args.now,
  );

  if (meta.changes !== 1) return null;

  return {
    id,
    email: args.email,
    email_verified: args.emailVerified ? 1 : 0,
    password_hash: args.passwordHash,
    display_name: args.displayName,
    role: 'user',
    is_anonymous: args.isAnonymous ? 1 : 0,
    created_at: args.now,
    updated_at: args.now,
  };
}

export type UpgradeOutcome = 'upgraded' | 'email_taken' | 'not_anonymous';

/**
 * Turns the current anonymous user into a real account, in place. 1 query.
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
    `SELECT id FROM ${T.users} WHERE email = ?1 AND id <> ?2`,
    args.email,
    args.userId,
  );
  if (taken) return 'email_taken';

  const meta = await db.run(
    `UPDATE ${T.users}
        SET email = ?2, password_hash = ?3,
            display_name = COALESCE(?4, display_name),
            is_anonymous = 0, updated_at = ?5
      WHERE id = ?1 AND is_anonymous = 1`,
    args.userId,
    args.email,
    args.passwordHash,
    args.displayName,
    args.now,
  );

  return meta.changes === 1 ? 'upgraded' : 'not_anonymous';
}

/** Transparent iteration-count upgrade after a successful login. */
export function rehashStatement(args: {
  userId: string;
  passwordHash: string;
  now: number;
}): PendingStatement {
  return sql(
    `UPDATE ${T.users} SET password_hash = ?2, updated_at = ?3 WHERE id = ?1`,
    args.userId,
    args.passwordHash,
    args.now,
  );
}

// --- Sessions ---------------------------------------------------------------

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
}

/** 1 query. Returns the opaque id that goes into the cookie. */
export async function createSession(
  db: Db,
  args: {
    userId: string;
    now: number;
    userAgent: string | null;
    ipHash: string | null;
    ttlMs?: number;
  },
): Promise<{ id: string; expiresAt: number }> {
  const id = newSecretId('ses');
  const expiresAt = args.now + (args.ttlMs ?? SESSION_TTL_MS);
  await db.run(
    `INSERT INTO ${T.sessions}
       (id, user_id, created_at, expires_at, last_seen_at, user_agent, ip_hash, revoked_at)
     VALUES (?1, ?2, ?3, ?4, ?3, ?5, ?6, NULL)`,
    id,
    args.userId,
    args.now,
    expiresAt,
    args.userAgent === null ? null : args.userAgent.slice(0, 256),
    args.ipHash,
  );
  return { id, expiresAt };
}

/**
 * Resolves a cookie to a live session and its user. 1 query.
 *
 * Expiry and revocation are in the WHERE clause, so an expired or revoked
 * session is indistinguishable from a nonexistent one and there is no code path
 * where a stale row is loaded and then checked.
 */
export async function loadSession(
  db: Db,
  sessionId: string,
  now: number,
): Promise<{ session: SessionRow; user: UserRow } | null> {
  const row = await db.first<SessionRow & UserRow & { session_id: string }>(
    `SELECT s.id AS session_id, s.user_id, s.created_at AS session_created_at,
            s.expires_at, s.last_seen_at,
            u.*
       FROM ${T.sessions} s
       JOIN ${T.users} u ON u.id = s.user_id
      WHERE s.id = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2`,
    sessionId,
    now,
  );
  if (!row) return null;

  const raw = row as unknown as Record<string, unknown>;
  return {
    session: {
      id: raw.session_id as string,
      user_id: raw.user_id as string,
      created_at: raw.session_created_at as number,
      expires_at: raw.expires_at as number,
      last_seen_at: raw.last_seen_at as number,
    },
    user: {
      id: raw.id as string,
      email: (raw.email as string | null) ?? null,
      email_verified: raw.email_verified as number,
      password_hash: (raw.password_hash as string | null) ?? null,
      display_name: (raw.display_name as string | null) ?? null,
      role: raw.role as string,
      is_anonymous: raw.is_anonymous as number,
      created_at: raw.created_at as number,
      updated_at: raw.updated_at as number,
    },
  };
}

/**
 * Re-stamps `last_seen_at`, at most once per hour.
 *
 * Returned as a statement, and only when it is actually due, because a write on
 * every authenticated request would spend a meaningful slice of the 100k
 * rows/day budget on nothing but liveness tracking.
 */
export function touchSessionStatement(
  session: SessionRow,
  now: number,
): PendingStatement | null {
  if (now - session.last_seen_at < SESSION_TOUCH_INTERVAL_MS) return null;
  return sql(
    `UPDATE ${T.sessions} SET last_seen_at = ?2 WHERE id = ?1`,
    session.id,
    now,
  );
}

/** 1 query. Idempotent: revoking a revoked session is a no-op. */
export async function revokeSession(db: Db, sessionId: string, now: number): Promise<void> {
  await db.run(
    `UPDATE ${T.sessions} SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL`,
    sessionId,
    now,
  );
}

/** Used when a password changes, so other devices are logged out. */
export async function revokeAllSessionsForUser(
  db: Db,
  userId: string,
  now: number,
  exceptSessionId?: string,
): Promise<void> {
  await db.run(
    `UPDATE ${T.sessions}
        SET revoked_at = ?2
      WHERE user_id = ?1 AND revoked_at IS NULL AND id <> COALESCE(?3, '')`,
    userId,
    now,
    exceptSessionId ?? null,
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
    args.redirectTo,
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
    `SELECT u.* FROM ${T.oauthAccounts} oa
       JOIN ${T.users} u ON u.id = oa.user_id
      WHERE oa.provider = ?1 AND oa.provider_account_id = ?2`,
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
 * Claims an anonymous user for a Google identity, in place. 1 query.
 *
 * Same shape as the password upgrade, and for the same reason: a guest who has
 * already done three mock tests and then signs in with Google must keep them.
 */
export async function claimAnonymousForOAuth(
  db: Db,
  args: { userId: string; email: string; displayName: string | null; now: number },
): Promise<boolean> {
  const meta = await db.run(
    `UPDATE ${T.users}
        SET email = ?2, email_verified = 1,
            display_name = COALESCE(display_name, ?3),
            is_anonymous = 0, updated_at = ?4
      WHERE id = ?1 AND is_anonymous = 1
        AND NOT EXISTS (SELECT 1 FROM ${T.users} WHERE email = ?2 AND id <> ?1)`,
    args.userId,
    args.email,
    args.displayName,
    args.now,
  );
  return meta.changes === 1;
}
