-- 0001_identity.sql
-- Users, public profiles, cookie sessions, admin audit log.
--
-- Conventions used by every migration in this directory:
--
--   * Real SQLite, not Postgres with renamed types. No native enums (CHECK
--     constraints instead), no jsonb (TEXT + json_valid() + the json1
--     functions), no materialised views (precomputed snapshot tables instead),
--     no sequences (INTEGER PRIMARY KEY is the rowid alias).
--   * Every table is STRICT. SQLite's default type affinity would happily
--     store 'yes' in an INTEGER column; STRICT makes that an error. Verified
--     on SQLite 3.54 and on Miniflare's D1 (see worker/README.md).
--   * Timestamps are INTEGER unix seconds (UTC). SQLite has no timestamp type
--     and TEXT ISO-8601 costs 20 bytes a column in a database whose free tier
--     ceiling is 500 MB. Calendar days, where a day is the unit of meaning
--     (streaks, leaderboard periods), are TEXT 'YYYY-MM-DD'.
--   * Booleans are INTEGER 0/1 with a CHECK.
--   * No BEGIN/COMMIT: `wrangler d1 migrations apply` wraps each file itself.
--   * No PRAGMA: D1 rejects all but a handful. Foreign keys are enforced by
--     default on D1; the local verification harness turns them on explicitly.
--   * Surrogate keys are TEXT ULIDs for anything a URL or another service may
--     name, and INTEGER rowid aliases for high-volume internal rows. See
--     0004_assessment.sql for why attempt_answers pays this much attention to
--     8 bytes.
--   * Every index carries the named query (NQ-nn) it exists to serve. An index
--     with no named query is a write-amplifier with no reader; worker/README.md
--     lists the queries and the API handler expected to issue each one.

-- ---------------------------------------------------------------------------
-- users: the authentication record. Nothing here is safe to return to a
-- client.
--
-- `users` and `user_profiles` are deliberately two tables rather than one with
-- a careful SELECT list. D1 has no row-level security and no column-level
-- grants, so "don't leak password_hash" cannot be a database rule; it can only
-- be a property of the query. Splitting the table makes the leaderboard and
-- the contributor byline join `user_profiles`, a table that physically does not
-- contain a credential. The safe query becomes the short one.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                TEXT    NOT NULL PRIMARY KEY,          -- ULID, 26 chars
  email             TEXT    NOT NULL,
  -- Generated + uniquely indexed, so case/whitespace variants of one address
  -- cannot both register. Doing this in application code is how duplicate
  -- accounts happen.
  email_normalized  TEXT    GENERATED ALWAYS AS (lower(trim(email))) STORED,
  email_verified_at INTEGER,
  -- NULL for an account that only ever signs in through an OAuth provider.
  -- A NULL here must fail closed in the password path, never match.
  password_hash     TEXT,
  password_algo     TEXT    CHECK (password_algo IS NULL OR password_algo IN ('pbkdf2-sha256', 'scrypt', 'argon2id')),
  role              TEXT    NOT NULL DEFAULT 'student'
                            CHECK (role IN ('student', 'contributor', 'admin')),
  status            TEXT    NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'suspended', 'deleted')),
  -- Soft delete: the row survives so attempt history and leaderboard snapshots
  -- keep referential integrity, but every auth path must treat it as absent.
  deleted_at        INTEGER,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at      INTEGER,
  CHECK (length(email) BETWEEN 3 AND 254),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK (password_hash IS NULL OR password_algo IS NOT NULL)
) STRICT;

-- NQ-04 login-by-email, NQ-04b registration collision check.
CREATE UNIQUE INDEX uq_users_email_normalized ON users (email_normalized);

-- NQ-38b admin user list filtered by role, and the "who are my contributors"
-- query behind the contributor dashboard.
CREATE INDEX idx_users_role_created ON users (role, created_at DESC)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- user_profiles: the half of a user that is safe to show another user.
-- ---------------------------------------------------------------------------
CREATE TABLE user_profiles (
  user_id        TEXT    NOT NULL PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  display_name   TEXT    NOT NULL,
  handle         TEXT,                                     -- optional public @handle
  avatar_url     TEXT,
  bio            TEXT,
  institution    TEXT,
  -- Exam the student is sitting, e.g. '2026-chaitra'. Free text on purpose:
  -- NEC publishes sitting names, not a stable enum.
  target_sitting TEXT,
  target_date    TEXT    CHECK (target_date IS NULL OR target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  timezone       TEXT    NOT NULL DEFAULT 'Asia/Kathmandu', -- drives streak day boundaries
  locale         TEXT    NOT NULL DEFAULT 'en',
  -- 1 = appear on public leaderboards. Default 0: opting a student into a
  -- public ranking without asking is not a default we get to choose for them.
  leaderboard_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (leaderboard_opt_in IN (0, 1)),
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (length(display_name) BETWEEN 1 AND 60),
  CHECK (handle IS NULL OR (length(handle) BETWEEN 3 AND 24 AND handle GLOB '[a-z0-9_]*'))
) STRICT;

-- NQ-04c profile-by-handle (public profile URLs).
CREATE UNIQUE INDEX uq_user_profiles_handle ON user_profiles (handle)
  WHERE handle IS NOT NULL;

-- ---------------------------------------------------------------------------
-- sessions: server-side cookie sessions.
--
-- `id` is the SHA-256 hex digest of the cookie value, never the cookie value
-- itself. A dump of this table therefore does not let anyone sign in. Lookup
-- is still a primary-key hit because the Worker hashes the cookie before it
-- queries. Rotation is modelled explicitly: `expires_at` is the idle window
-- the Worker slides forward, `absolute_expires_at` is the hard ceiling that
-- sliding cannot pass, so a stolen cookie cannot be renewed indefinitely.
-- ---------------------------------------------------------------------------
CREATE TABLE sessions (
  id                  TEXT    NOT NULL PRIMARY KEY,        -- sha256 hex of the cookie value, 64 chars
  user_id             TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at          INTEGER NOT NULL,                    -- idle expiry, slid forward on use
  absolute_expires_at INTEGER NOT NULL,                    -- hard ceiling, never slid
  revoked_at          INTEGER,
  revoked_reason      TEXT    CHECK (revoked_reason IS NULL OR revoked_reason IN ('logout', 'logout_all', 'password_change', 'admin', 'rotated', 'suspicious')),
  -- Salted hash, not the address. Enough to spot a session hopping countries;
  -- not a stored identifier for a person.
  ip_hash             TEXT,
  user_agent          TEXT,
  CHECK (length(id) = 64 AND id GLOB '[0-9a-f]*'),
  CHECK (expires_at <= absolute_expires_at),
  CHECK (revoked_at IS NULL OR revoked_reason IS NOT NULL)
) STRICT;

-- NQ-03 session-revoke-all: UPDATE sessions SET revoked_at = ? WHERE user_id = ?
--       AND revoked_at IS NULL. Also serves "list my devices".
CREATE INDEX idx_sessions_user_active ON sessions (user_id, last_used_at DESC)
  WHERE revoked_at IS NULL;

-- NQ-02 session-sweep: DELETE FROM sessions WHERE absolute_expires_at < ?
--       LIMIT ? -- cron, batched to stay inside the free-tier write budget.
CREATE INDEX idx_sessions_absolute_expires_at ON sessions (absolute_expires_at);

-- ---------------------------------------------------------------------------
-- admin_audit_log: every privileged action, append-only.
--
-- Separate from content_versions (0002) on purpose. content_versions answers
-- "what did this question look like last Tuesday"; this answers "who did
-- something they needed a role for". The two have different retention and
-- different readers.
-- ---------------------------------------------------------------------------
CREATE TABLE admin_audit_log (
  id             INTEGER NOT NULL PRIMARY KEY,             -- rowid alias
  actor_user_id  TEXT    REFERENCES users (id) ON DELETE SET NULL,
  actor_role     TEXT    NOT NULL CHECK (actor_role IN ('student', 'contributor', 'admin', 'system')),
  action         TEXT    NOT NULL,                         -- 'question.publish', 'user.suspend', ...
  entity_type    TEXT    NOT NULL,
  entity_id      TEXT,
  -- Redacted JSON snapshots. Never a password hash, never a session id.
  before_json    TEXT    CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json     TEXT    CHECK (after_json  IS NULL OR json_valid(after_json)),
  reason         TEXT,
  ip_hash        TEXT,
  user_agent     TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;

-- NQ-37a audit-by-actor: SELECT ... WHERE actor_user_id = ? ORDER BY id DESC.
CREATE INDEX idx_admin_audit_log_actor ON admin_audit_log (actor_user_id, id DESC);

-- NQ-37b audit-by-entity: SELECT ... WHERE entity_type = ? AND entity_id = ?
--       ORDER BY id DESC -- "who touched this question".
CREATE INDEX idx_admin_audit_log_entity ON admin_audit_log (entity_type, entity_id, id DESC);

-- NQ-37c audit-recent: SELECT ... WHERE created_at >= ? ORDER BY created_at DESC.
CREATE INDEX idx_admin_audit_log_created_at ON admin_audit_log (created_at DESC);
