-- ===========================================================================
-- 0011_password_reset.sql
--
-- Make a forgotten password recoverable.
--
-- Until now there was no reset of any kind and this platform sends no email at
-- all, so losing a password meant losing the account permanently - every
-- attempt, every bookmark, every streak. For a free study tool whose users are
-- students, that is the single most likely way to lose one.
--
-- WHAT A RESET TOKEN HAS TO SURVIVE
-- ---------------------------------
-- A password reset link is a bearer credential that arrives over email, sits
-- in an inbox, and is frequently forwarded or synced to other devices. It is
-- the weakest link in most authentication systems, so the table is shaped
-- around the four ways it goes wrong:
--
--   1. STOLEN FROM THE DATABASE. The column holds a SHA-256 of the token, not
--      the token, exactly as `sessions.id` does. A dump yields nothing anyone
--      can redeem. This is why there is no UNIQUE on a plaintext column: there
--      is no plaintext column.
--   2. USED TWICE. `consumed_at` plus the partial index below make redemption
--      single-use. A link that has already set a password must not set another
--      - that is how a forwarded email becomes an account takeover a week
--      later.
--   3. USED FOREVER. `expires_at` is short by design; the handler sets one
--      hour. Long enough for a slow mail server, short enough that an old
--      inbox is not a standing key.
--   4. REQUESTED IN BULK. `requested_ip_hash` records WHO asked, as a salted
--      hash on the same terms as `sessions.ip_hash` - enough to rate-limit and
--      to spot a spray, never the address itself.
--
-- WHY A TABLE AND NOT A SIGNED TOKEN
-- ----------------------------------
-- A stateless HMAC token needs no storage and cannot be revoked, which fails
-- requirement 2 outright: a signed token stays valid for its whole lifetime no
-- matter how many times it is redeemed, unless a server-side record of its use
-- exists anyway. Once that record exists the statelessness has been spent, so
-- this stores the token from the start.
-- ===========================================================================

CREATE TABLE password_reset_tokens (
  -- sha256 hex of the token that went out in the email. 64 chars, same shape
  -- and same reasoning as `sessions.id`.
  id                TEXT    NOT NULL PRIMARY KEY,
  user_id           TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  expires_at        INTEGER NOT NULL,                             -- epoch ms (UTC)
  -- Set the moment the token is redeemed. A second redemption finds it
  -- non-NULL and is refused.
  consumed_at       INTEGER,                                      -- epoch ms (UTC)
  -- Salted hash of the requester's address, never the address. Same treatment
  -- as sessions.ip_hash.
  requested_ip_hash TEXT,
  CHECK (length(id) = 64 AND id GLOB '[0-9a-f]*'),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
) STRICT;

-- NQ-43 reset-redeem: SELECT user_id FROM password_reset_tokens
--       WHERE id = ?1 AND consumed_at IS NULL AND expires_at > ?2.
-- The lookup is a primary-key hit, so no index is needed for it.

-- NQ-43b reset-live-for-user: how many unredeemed, unexpired tokens one
--        account has. The request path reads this to refuse a flood of links
--        for a single address, and the invalidate-on-use path reads it to
--        retire siblings.
--
-- Partial, because a consumed or expired token is of no interest to either
-- query and the live set is tiny - usually zero, briefly one.
CREATE INDEX idx_password_reset_live
  ON password_reset_tokens (user_id, expires_at)
  WHERE consumed_at IS NULL;

-- NQ-43c reset-sweep (cron): DELETE FROM password_reset_tokens
--        WHERE expires_at < ?1 LIMIT ?2.
CREATE INDEX idx_password_reset_expires_at
  ON password_reset_tokens (expires_at);
