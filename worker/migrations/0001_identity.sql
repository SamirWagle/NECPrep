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
--   * TIMESTAMPS ARE INTEGER EPOCH MILLISECONDS (UTC). Every column that
--     carries one says so in a trailing comment, because the unit is the one
--     property of this schema that cannot be inferred by looking at a value:
--     1792484350457 and 1792484350 are both plausible integers, and mistaking
--     one for the other makes a 45-minute deadline expire in 45 milliseconds.
--     Milliseconds and not seconds because every consumer is JavaScript:
--     `Date.now()` is milliseconds, the API's wire contract (`EpochMs` in
--     worker/src/shared/types.ts) is milliseconds, and the client's response
--     log, quiz drafts and mock `endsAt` are all already milliseconds. One
--     conversion boundary is one place to get it wrong, so there is none.
--     The server-side default is
--     `(CAST(unixepoch('subsec') * 1000 AS INTEGER))`: `unixepoch('subsec')`
--     returns REAL seconds with millisecond resolution, and the CAST is
--     explicit so a STRICT INTEGER column can never be handed a REAL whose
--     conversion is lossy. The cost against seconds is about 3 bytes per
--     column on SQLite's varint encoding. On the one unbounded table
--     (attempt_answers, 0004) that is measurable: `answered_at` is both a
--     column and an index key, so the re-measured row cost went from 132.4 to
--     ~138 bytes on this change alone. That is the price of not having two
--     incompatible time units in one system, and it is paid deliberately.
--     Durations are named for their unit (`time_ms`, `elapsed_ms`,
--     `duration_s`). Calendar days, where a day is the unit of meaning
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
--
-- ANONYMOUS GUESTS ARE REAL ROWS. `email` is NULLABLE and `is_anonymous`
-- distinguishes a guest from a claimed account. This is not a convenience: the
-- product's entire first-run experience is "type a name and start practising",
-- and a server-scored mock test with a server-authored deadline is only
-- possible if the sitting belongs to a real `users` row from the first
-- question. Requiring an email here would force the alternative -- let the
-- browser own the attempt -- which is precisely the hole worker/src exists to
-- close. An upgrade (worker/src/handlers/auth.ts) fills in `email` and
-- `password_hash` and flips the flag IN PLACE, so `id` never changes and every
-- attempt, bookmark and SRS card written as a guest stays attached.
--
-- Three identity shapes share this row:
--   anonymous guest   is_anonymous = 1, email NULL,  password_hash NULL
--   email + password  is_anonymous = 0, email set,   password_hash set
--   OAuth only        is_anonymous = 0, email set,   password_hash NULL
--
-- ROLES. Four, and each one exists because something refuses to work without
-- it: `student` is everyone; `contributor` authors content but cannot publish
-- it; `moderator` works the errata triage queue (NQ-15) but cannot change what
-- candidates sit; `admin` publishes and retires questions. Folding moderator
-- into admin would mean every volunteer who triages a typo report can also
-- retire a question out of every future paper.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                TEXT    NOT NULL PRIMARY KEY,          -- ULID, 26 chars
  -- NULL for an anonymous guest. See the note above.
  email             TEXT,
  -- Generated + uniquely indexed, so case/whitespace variants of one address
  -- cannot both register. Doing this in application code is how duplicate
  -- accounts happen. NULL propagates, so guests do not collide with each other.
  email_normalized  TEXT    GENERATED ALWAYS AS (lower(trim(email))) STORED,
  email_verified_at INTEGER,                                      -- epoch ms (UTC)
  -- NULL for an account that only ever signs in through an OAuth provider, and
  -- for a guest. A NULL here must fail closed in the password path, never match.
  password_hash     TEXT,
  password_algo     TEXT    CHECK (password_algo IS NULL OR password_algo IN ('pbkdf2-sha256', 'scrypt', 'argon2id')),
  role              TEXT    NOT NULL DEFAULT 'student'
                            CHECK (role IN ('student', 'contributor', 'moderator', 'admin')),
  -- 1 = guest. Never serialised as a credential; the API reads it to decide
  -- which features need a claimed account (`requireRealAccount`).
  is_anonymous      INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  status            TEXT    NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'suspended', 'deleted')),
  -- Soft delete: the row survives so attempt history and leaderboard snapshots
  -- keep referential integrity, but every auth path must treat it as absent.
  deleted_at        INTEGER,                                      -- epoch ms (UTC)
  created_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  updated_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  last_seen_at      INTEGER,                                      -- epoch ms (UTC)
  CHECK (email IS NULL OR length(email) BETWEEN 3 AND 254),
  -- A guest has no address, and an account with an address is not a guest. The
  -- upgrade sets both halves in one UPDATE, so this never blocks it.
  CHECK (is_anonymous = 0 OR email IS NULL),
  -- A guest cannot hold a credential either, which is what makes "log in as a
  -- guest" structurally impossible rather than merely unimplemented.
  CHECK (is_anonymous = 0 OR password_hash IS NULL),
  CHECK ((status = 'deleted') = (deleted_at IS NOT NULL)),
  CHECK (password_hash IS NULL OR password_algo IS NOT NULL)
) STRICT;

-- NQ-04 login-by-email, NQ-04b registration collision check.
-- PARTIAL, because every anonymous guest carries a NULL email. SQLite treats
-- NULLs as distinct in a unique index, so a plain index would also work -- but
-- the predicate keeps the index to claimed accounts only, which is both smaller
-- and the thing the upsert in `data/auth.ts#createUser` names as its conflict
-- target. A bare `ON CONFLICT (email)` against a partial index fails at
-- prepare() time, so the predicate has to be restated there; see that comment.
CREATE UNIQUE INDEX uq_users_email_normalized ON users (email_normalized)
  WHERE email_normalized IS NOT NULL;

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
  created_at     INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  updated_at     INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
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
  created_at          INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  last_used_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  expires_at          INTEGER NOT NULL,                    -- idle expiry, slid forward on use
  absolute_expires_at INTEGER NOT NULL,                    -- hard ceiling, never slid
  revoked_at          INTEGER,                                    -- epoch ms (UTC)
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
  actor_role     TEXT    NOT NULL CHECK (actor_role IN ('student', 'contributor', 'moderator', 'admin', 'system')),
  action         TEXT    NOT NULL,                         -- 'question.publish', 'user.suspend', ...
  entity_type    TEXT    NOT NULL,
  entity_id      TEXT,
  -- Redacted JSON snapshots. Never a password hash, never a session id.
  before_json    TEXT    CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json     TEXT    CHECK (after_json  IS NULL OR json_valid(after_json)),
  reason         TEXT,
  ip_hash        TEXT,
  user_agent     TEXT,
  created_at     INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) -- epoch ms (UTC)
) STRICT;

-- NQ-37a audit-by-actor: SELECT ... WHERE actor_user_id = ? ORDER BY id DESC.
CREATE INDEX idx_admin_audit_log_actor ON admin_audit_log (actor_user_id, id DESC);

-- NQ-37b audit-by-entity: SELECT ... WHERE entity_type = ? AND entity_id = ?
--       ORDER BY id DESC -- "who touched this question".
CREATE INDEX idx_admin_audit_log_entity ON admin_audit_log (entity_type, entity_id, id DESC);

-- NQ-37c audit-recent: SELECT ... WHERE created_at >= ? ORDER BY created_at DESC.
CREATE INDEX idx_admin_audit_log_created_at ON admin_audit_log (created_at DESC);

-- ---------------------------------------------------------------------------
-- oauth_accounts: the link between a `users` row and a provider identity.
--
-- A separate table rather than two columns on `users`, because one account may
-- legitimately carry several providers and because the provider's subject id is
-- the only stable identifier it gives us -- an email address can be reassigned
-- by the provider, so resolving a sign-in by email alone is an account-takeover
-- path. `(provider, provider_account_id)` is therefore UNIQUE and is the first
-- thing the callback looks up.
-- ---------------------------------------------------------------------------
CREATE TABLE oauth_accounts (
  id                  TEXT    NOT NULL PRIMARY KEY,         -- 'oac_...'
  user_id             TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider            TEXT    NOT NULL CHECK (provider IN ('google')),
  -- The provider's immutable subject id ('sub' for Google). NOT the email.
  provider_account_id TEXT    NOT NULL,
  created_at          INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  CHECK (length(trim(provider_account_id)) > 0)
) STRICT;

-- NQ-41 oauth-identity: SELECT u.* FROM oauth_accounts oa JOIN users u
--       ON u.id = oa.user_id WHERE oa.provider = ?1 AND oa.provider_account_id = ?2.
-- Unique, so a repeat sign-in links once and a second row is a write error
-- rather than two accounts for one Google identity.
CREATE UNIQUE INDEX uq_oauth_accounts_provider_account
  ON oauth_accounts (provider, provider_account_id);

-- NQ-41b oauth-accounts-for-user: "which providers is this account linked to",
--        and the index that makes deleting a departing user's links cheap.
CREATE INDEX idx_oauth_accounts_user ON oauth_accounts (user_id, provider);

-- ---------------------------------------------------------------------------
-- oauth_states: the CSRF/PKCE parking space for one in-flight round trip.
--
-- Short-lived (10 minutes) and SINGLE USE: the callback consumes the row with
-- `DELETE ... RETURNING`, so a replayed `?code=` finds nothing and is rejected.
-- The code verifier lives here and never reaches the browser, which is what
-- makes PKCE worth doing even for a confidential client with a secret.
-- ---------------------------------------------------------------------------
CREATE TABLE oauth_states (
  state         TEXT    NOT NULL PRIMARY KEY,               -- 'oas_...', 130 bits
  code_verifier TEXT    NOT NULL,
  -- A PATH on our own origin, or NULL. Never an absolute URL: the state must
  -- not be usable to bounce a freshly signed-in user to someone else's site.
  redirect_to   TEXT    CHECK (redirect_to IS NULL OR redirect_to GLOB '/*'),
  created_at    INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  expires_at    INTEGER NOT NULL,                                 -- epoch ms (UTC)
  CHECK (expires_at > created_at),
  CHECK (length(code_verifier) BETWEEN 43 AND 128)          -- RFC 7636 section 4.1
) STRICT;

-- NQ-42 oauth-state-sweep (cron): DELETE FROM oauth_states WHERE expires_at < ?1
--       LIMIT ?2. The consume path is a primary-key hit and needs no index.
CREATE INDEX idx_oauth_states_expires_at ON oauth_states (expires_at);
