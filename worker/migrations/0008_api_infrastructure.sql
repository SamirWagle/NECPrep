-- 0008_api_infrastructure.sql
-- The two pieces of cross-cutting D1 state the API needs and nothing else in
-- this schema does: idempotency records and fixed-window rate-limit counters.
--
-- They are in their own migration rather than folded into 0001 because they are
-- not identity, not content and not assessment: they are properties of the HTTP
-- layer. Both are swept by cron and neither is ever read by a report, a rollup
-- or a page. (`oauth_accounts` and `oauth_states`, which the API also needs,
-- ARE identity and live in 0001 next to `users` and `sessions`.)
--
-- Same conventions as every other file here: STRICT tables, INTEGER epoch
-- MILLISECONDS, booleans as 0/1 with a CHECK, every index naming the query it
-- serves.

-- ---------------------------------------------------------------------------
-- idempotency_keys: the entire offline-replay contract rests on this table.
--
-- THE PROBLEM IT SOLVES. The client is a browser on a mobile connection in
-- Nepal. The failure that matters is not "the request failed" -- it is "the
-- request committed and the response never arrived". Without a record of what
-- happened, the client's retry either double-submits a mock test or gets a 409
-- for work it cannot see. `frontend/src/services/api.ts` keeps an outbox and
-- mints a key ONCE at enqueue time, never regenerating it on retry, so a
-- replayed entry can be recognised here.
--
-- KEYED BY (user_id, key), not by key alone. Clients mint these themselves, so
-- a global key space would let one user's key collide with -- or read back --
-- another user's stored response. A composite primary key makes that
-- impossible rather than unlikely.
--
-- `request_hash` is sha256 of the endpoint plus a canonicalised body with the
-- idempotency key itself removed (`worker/src/lib/canonical.ts`). Same key,
-- same body -> replay the stored response. Same key, DIFFERENT body -> 409
-- IDEMPOTENCY_KEY_REUSED, never a guess: replaying the stored response would
-- be a lie about what the server did, and executing the new body would be a
-- second write under a key that already named one.
--
-- A row with a NULL `response_json` is a RESERVATION, not a result: the handler
-- claimed the key and is still working. A second copy of the same request
-- arriving in that window gets 409 REQUEST_IN_FLIGHT and retries, which is what
-- stops two concurrent tabs from both scoring one attempt. The reservation and
-- the finalisation are therefore two separate writes, and the second one rides
-- in the handler's own batch so the result and its idempotency record commit
-- together.
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  user_id       TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Client-minted. Bounded and charset-restricted by the request schema
  -- (`v.idempotencyKey()`), because it becomes half of a primary key and is
  -- echoed in logs.
  key           TEXT    NOT NULL,
  -- 'POST /api/mock/submit'. Part of the match: the same key used against a
  -- different endpoint is a client bug, not a replay.
  endpoint      TEXT    NOT NULL,
  request_hash  TEXT    NOT NULL,                           -- sha256 hex, 64 chars
  -- NULL while the request is in flight. Set together, by the finalise
  -- statement, so "has a status" and "has a body" cannot disagree.
  status_code   INTEGER CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  response_json TEXT    CHECK (response_json IS NULL OR json_valid(response_json)),
  created_at    INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  PRIMARY KEY (user_id, key),
  CHECK (length(key) BETWEEN 8 AND 80),
  CHECK (length(request_hash) = 64 AND request_hash GLOB '[0-9a-f]*'),
  CHECK ((status_code IS NULL) = (response_json IS NULL))
) STRICT;

-- NQ-43 idempotency-reserve / NQ-43b idempotency-replay are both primary-key
-- hits and need no index.
--
-- NQ-43c idempotency-sweep (cron): DELETE FROM idempotency_keys
--        WHERE created_at < ?1 LIMIT ?2. Retention is seven days
--        (IDEMPOTENCY_TTL_MS), which is longer than any plausible offline
--        window and short enough that the table stays small -- it is bounded by
--        mutations per user per week, not by anything unbounded.
CREATE INDEX idx_idempotency_keys_created_at ON idempotency_keys (created_at);

-- ---------------------------------------------------------------------------
-- rate_limits: fixed-window counters.
--
-- BEST-EFFORT BY CONSTRUCTION, and the honest reason is worth writing in the
-- schema rather than only in a doc: D1 replicates asynchronously, so two
-- requests served from different Cloudflare locations can both read a stale
-- counter and both be allowed. The effective limit is "roughly `limit` per
-- window PER REGION". That is adequate for what it defends against --
-- credential stuffing, mock-submit hammering, search abuse -- and it is not a
-- substitute for a Durable Object or for Cloudflare's own WAF rate limiting,
-- neither of which is on the free plan.
--
-- One row per bucket, where a bucket is `<rule>:<subject>` and the subject is
-- either a user id or a HASHED client address -- never a raw IP. This table is
-- a counter, not a log, and there is no reason for it to be reversible.
--
-- The whole operation is ONE upsert with RETURNING, so there is no
-- read-then-write race within a region:
--
--   NQ-44 rate-limit-consume:
--     INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
--     ON CONFLICT (bucket) DO UPDATE SET
--       count = CASE WHEN rate_limits.window_start < ?2
--                    THEN 1 ELSE rate_limits.count + 1 END,
--       window_start = CASE WHEN rate_limits.window_start < ?2
--                          THEN ?2 ELSE rate_limits.window_start END
--     RETURNING count, window_start;
--
-- `window_start` is `floor(now / window_ms) * window_ms`, so the window
-- boundary is derived from the clock rather than from the first request -- two
-- Workers computing it independently agree, which a "first request starts the
-- window" scheme would not.
--
-- No foreign key to `users`: a bucket subject may be a hashed address with no
-- account behind it, and a counter must not block or cascade a user deletion.
-- ---------------------------------------------------------------------------
CREATE TABLE rate_limits (
  bucket       TEXT    NOT NULL PRIMARY KEY,                -- '<rule>:<subject>'
  window_start INTEGER NOT NULL,                                 -- epoch ms (UTC)
  count        INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  CHECK (length(bucket) BETWEEN 3 AND 160)
) STRICT;

-- NQ-44b rate-limit-sweep (cron): DELETE FROM rate_limits
--        WHERE window_start < ?1 LIMIT ?2. Without it the table accumulates one
--        row per address that ever hit a limited endpoint; with it, the live set
--        is bounded by the longest window (one hour).
CREATE INDEX idx_rate_limits_window_start ON rate_limits (window_start);
