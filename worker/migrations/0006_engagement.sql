-- 0006_engagement.sql
-- Precomputed leaderboards and notifications.

-- ===========================================================================
-- LEADERBOARDS ARE PRECOMPUTED. NEVER AGGREGATE THE ANSWER LOG LIVE.
--
-- The naive leaderboard is
--
--   SELECT user_id, SUM(is_correct) FROM attempt_answers GROUP BY user_id
--   ORDER BY 2 DESC LIMIT 50;
--
-- which is a full scan of the largest table on the platform, on a database
-- that is single-threaded per instance (D1 serialises writes and runs about
-- 1,000 queries/second at 1 ms each). At 3 million answer rows that scan is
-- seconds long, it blocks every write behind it, it bills 3 million of the
-- free plan's 5 million daily row reads per page view, and it gets slower
-- every day. One student refreshing a leaderboard would be a platform-wide
-- outage. It also stops being correct the moment archival (0004) deletes old
-- answers.
--
-- So: a cron Worker computes a snapshot on a schedule, writes the ranking
-- once, and every request reads the finished rows. SQLite has no materialised
-- views, so the snapshot IS the table.
--
-- Two tables rather than one, because there are two readers with different
-- shapes:
--   * `leaderboard_snapshots` -- metadata plus a `top_json` payload, so
--     rendering the visible top 50 is a single row read: one query, one row,
--     no sort, no join.
--   * `leaderboard_entries` -- one row per ranked user, so "you are 312th of
--     1,480" is a primary-key hit rather than a scan of the payload. Without
--     this table, the only way to answer it is to rank everyone at request
--     time, which is the thing this whole file exists to avoid.
-- ===========================================================================

CREATE TABLE leaderboard_snapshots (
  id            INTEGER NOT NULL PRIMARY KEY,
  -- What is being ranked.
  scope         TEXT    NOT NULL
                        CHECK (scope IN ('global', 'chapter', 'subchapter', 'template')),
  -- The chapter/subchapter/template id for a narrowed board; '' for global.
  -- Empty string rather than NULL so the unique index below works without
  -- SQLite's NULL-distinctness rules letting duplicates in.
  scope_ref     TEXT    NOT NULL DEFAULT '',
  period        TEXT    NOT NULL
                        CHECK (period IN ('daily', 'weekly', 'monthly', 'all_time')),
  -- First calendar day of the period, in the platform timezone. 'all_time'
  -- uses '0001-01-01' so the column is never NULL and ordering still works.
  period_start  TEXT    NOT NULL
                        CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- What the ranking sorts on. Recorded because changing it silently would
  -- make two snapshots incomparable.
  metric        TEXT    NOT NULL DEFAULT 'correct_answers'
                        CHECK (metric IN ('correct_answers', 'accuracy_bp',
                                          'questions_answered', 'streak_length',
                                          'mock_score_bp')),
  -- Rendered top-N, in rank order:
  --   [{"rank":1,"user_id":"...","display_name":"...","avatar_url":null,
  --     "score":4821,"accuracy_bp":7340}, ...]
  -- Denormalised display fields on purpose: the leaderboard must render
  -- without joining `user_profiles`, so one query serves the whole page, and
  -- a user who later opts out of leaderboards is removed at the next snapshot
  -- rather than leaving a hole in a join.
  top_json      TEXT    NOT NULL CHECK (json_valid(top_json)
                                        AND json_type(top_json) = 'array'),
  entrant_count INTEGER NOT NULL DEFAULT 0 CHECK (entrant_count >= 0),
  computed_at   INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  -- How long the computation took. Kept because this job is the one thing on
  -- the platform allowed to scan a large table, and the day it gets slow is
  -- the day the ceiling arithmetic in 0004 needs revisiting.
  compute_ms    INTEGER,                                          -- duration, milliseconds
  CHECK (period = 'all_time' OR period_start <> '0001-01-01'),
  CHECK ((scope = 'global') = (scope_ref = ''))
) STRICT;

-- NQ-35 latest-snapshot: SELECT id, top_json, entrant_count, computed_at
--       FROM leaderboard_snapshots
--      WHERE scope = ?1 AND scope_ref = ?2 AND period = ?3
--      ORDER BY period_start DESC LIMIT 1.
-- Unique as well as indexed: the cron is at-least-once, and a retry must
-- overwrite the snapshot (ON CONFLICT DO UPDATE) rather than add a second one
-- that the query above would then pick between arbitrarily.
CREATE UNIQUE INDEX uq_leaderboard_snapshots_scope_period
  ON leaderboard_snapshots (scope, scope_ref, period, period_start);

-- NQ-35c snapshot-prune (cron): DELETE FROM leaderboard_snapshots
--        WHERE computed_at < ? AND period <> 'all_time'.
CREATE INDEX idx_leaderboard_snapshots_computed_at
  ON leaderboard_snapshots (computed_at);

-- ---------------------------------------------------------------------------
-- leaderboard_entries: the full ranking behind one snapshot.
--
-- Bounded, unlike attempt_answers: rows = snapshots retained x opted-in users.
-- With daily/weekly/monthly global boards plus ten chapter boards, pruned to
-- 30 days, that is roughly 13 boards x 30 snapshots x entrants. At 1,000
-- opted-in users that is ~390k rows of about 60 bytes, so ~25 MB -- which is
-- why NQ-35c prunes and why `period = 'all_time'` is exempt from the prune.
-- ---------------------------------------------------------------------------
CREATE TABLE leaderboard_entries (
  -- leaderboard_snapshots.id. NOT a foreign key -- see the note below.
  snapshot_id INTEGER NOT NULL,
  rank        INTEGER NOT NULL CHECK (rank >= 1),
  user_id     TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  accuracy_bp INTEGER CHECK (accuracy_bp IS NULL OR accuracy_bp BETWEEN 0 AND 10000),
  -- Rank in the previous snapshot of the same board, so the UI can show a
  -- movement arrow without reading two snapshots.
  prev_rank   INTEGER CHECK (prev_rank IS NULL OR prev_rank >= 1),
  PRIMARY KEY (snapshot_id, rank)
) STRICT;

-- NQ-33 leaderboard-page: SELECT rank, user_id, score FROM leaderboard_entries
--       WHERE snapshot_id = ?1 AND rank > ?2 ORDER BY rank LIMIT ?3
--       -- paging deeper than the `top_json` payload. Served by the primary
--       key, no sort.
--
-- NQ-34 my-rank: SELECT rank, score, prev_rank FROM leaderboard_entries
--       WHERE snapshot_id = ?1 AND user_id = ?2.
-- Unique, because one user cannot hold two ranks on one board, and making
-- that a constraint means a buggy snapshot job fails rather than ships a
-- leaderboard where somebody appears twice.
CREATE UNIQUE INDEX uq_leaderboard_entries_snapshot_user
  ON leaderboard_entries (snapshot_id, user_id);

-- NQ-34b my-boards: SELECT snapshot_id, rank FROM leaderboard_entries
--        WHERE user_id = ? -- "where do I stand everywhere", and the index
--        that makes deleting a departing user's entries cheap.
CREATE INDEX idx_leaderboard_entries_user ON leaderboard_entries (user_id);

-- `snapshot_id` is deliberately NOT a foreign key. The prune (NQ-35c) deletes
-- snapshots in bulk; an ON DELETE CASCADE would turn each of those deletes
-- into an unbounded child delete inside one statement, which is exactly the
-- shape that blows D1's per-query time limit. Instead the job deletes children
-- first, in bounded batches it controls:
--
--   NQ-35d entries-prune, run BEFORE NQ-35c or the entries are orphaned:
--     DELETE FROM leaderboard_entries
--      WHERE snapshot_id IN (SELECT id FROM leaderboard_snapshots
--                             WHERE computed_at < ?1 AND period <> 'all_time'
--                             LIMIT 50);

-- ---------------------------------------------------------------------------
-- notifications: in-app only. No email, no push -- those are a delivery
-- concern and belong to a queue, not to a table a page reads.
--
-- Bounded by `expires_at` plus the prune below. A notification nobody reads is
-- not evidence of anything, so unlike attempt_answers these rows are deleted
-- outright rather than archived.
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id         INTEGER NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL
                     CHECK (kind IN ('streak_risk', 'streak_milestone',
                                     'srs_due', 'mock_result', 'report_resolved',
                                     'contribution_reviewed', 'leaderboard_move',
                                     'announcement')),
  title      TEXT    NOT NULL,
  body       TEXT,
  -- Route the notification deep-links to, e.g. '/app/attempt/01HX...'.
  link       TEXT,
  -- Small JSON bag of render parameters. Never business state.
  data_json  TEXT    CHECK (data_json IS NULL OR json_valid(data_json)),
  read_at    INTEGER,                                             -- epoch ms (UTC)
  created_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  expires_at INTEGER,                                             -- epoch ms (UTC)
  -- Idempotency key, so the cron that says "your streak is at risk" cannot say
  -- it twice. Format: kind || ':' || natural key, e.g. 'srs_due:2026-10-20'.
  dedupe_key TEXT,
  CHECK (length(trim(title)) > 0),
  CHECK (expires_at IS NULL OR expires_at > created_at)
) STRICT;

-- NQ-36 unread-notifications: SELECT id, kind, title, body, link, created_at
--       FROM notifications WHERE user_id = ?1 AND read_at IS NULL
--       ORDER BY created_at DESC LIMIT ?2.
-- Partial on read_at: the index holds only the rows the bell badge counts, so
-- it stays small no matter how much history a user accumulates.
CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- NQ-36b notification-history: ... WHERE user_id = ? ORDER BY id DESC LIMIT ?.
CREATE INDEX idx_notifications_user ON notifications (user_id, id DESC);

-- NQ-36c notification-dedupe, the insert the cron actually issues. Note the
-- repeated WHERE clause: SQLite matches a conflict target to a PARTIAL unique
-- index only if the index predicate is restated, and omitting it fails at
-- prepare() time with 'ON CONFLICT clause does not match any PRIMARY KEY or
-- UNIQUE constraint' rather than at review time:
--   INSERT INTO notifications (user_id, kind, title, dedupe_key, expires_at)
--   VALUES (?1, ?2, ?3, ?4, ?5)
--   ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
CREATE UNIQUE INDEX uq_notifications_user_dedupe
  ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- NQ-36d notification-prune (cron): DELETE FROM notifications
--        WHERE expires_at < CAST(unixepoch('subsec') * 1000 AS INTEGER) LIMIT ?.
CREATE INDEX idx_notifications_expires_at ON notifications (expires_at)
  WHERE expires_at IS NOT NULL;
