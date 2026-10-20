-- 0005_learning.sql
-- Per-user learning state: bookmarks, spaced repetition, study sessions,
-- streaks, and the trigger-maintained rollup the progress page reads.

-- ---------------------------------------------------------------------------
-- bookmarks: "come back to this one". Replaces the `eng_bookmarks`
-- localStorage array, which stored `{topicId}_{index}` strings and therefore
-- quietly re-pointed at different questions whenever the bank was edited.
-- ---------------------------------------------------------------------------
CREATE TABLE bookmarks (
  user_id     TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question_id TEXT    NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  note        TEXT,
  -- Free-text folder. A separate table would be the textbook answer; it would
  -- also be a join and a second query on a page that exists to show a list,
  -- and nobody has asked to rename a folder.
  folder      TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, question_id)
) STRICT;

-- NQ-30 bookmarks-list: SELECT question_id FROM bookmarks WHERE user_id = ?
--       ORDER BY created_at DESC LIMIT ?. The primary key cannot serve the
--       sort; this index is covering for it.
CREATE INDEX idx_bookmarks_user_created ON bookmarks (user_id, created_at DESC);

-- NQ-30b bookmarks-by-folder: ... WHERE user_id = ? AND folder = ?.
CREATE INDEX idx_bookmarks_user_folder ON bookmarks (user_id, folder)
  WHERE folder IS NOT NULL;

-- ---------------------------------------------------------------------------
-- srs_state: one FSRS card per (user, question).
--
-- Column names and units are FSRS's, deliberately, so the open-source
-- scheduler can be dropped in without a translation layer and so a parameter
-- upgrade does not need a migration:
--
--   stability      -- days until recall probability decays to 90%
--   difficulty     -- 1..10, intrinsic to the item for this user
--   elapsed_days   -- real days since last_review at the moment of review
--   scheduled_days -- the interval the scheduler had asked for
--   reps           -- total reviews
--   lapses         -- reviews rated 'Again'
--   state          -- 0 New, 1 Learning, 2 Review, 3 Relearning
--   due            -- when it next comes up
--   last_review    -- when it was last graded
--
-- REAL, not INTEGER, for the four continuous fields: FSRS's update equations
-- are continuous and rounding stability to whole days compounds into visibly
-- wrong intervals after a dozen reviews. REAL is 8 bytes in SQLite, same as
-- a large INTEGER, so there is nothing to save by rounding.
--
-- Scheduling runs in the Worker, not in SQL. FSRS needs `pow` and `exp`;
-- SQLite's math functions are a compile-time option and D1 does not guarantee
-- them. The Worker computes the new card and writes it back in one statement.
-- ---------------------------------------------------------------------------
CREATE TABLE srs_state (
  user_id        TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question_id    TEXT    NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  stability      REAL    NOT NULL DEFAULT 0.0 CHECK (stability >= 0.0),
  difficulty     REAL    NOT NULL DEFAULT 5.0 CHECK (difficulty BETWEEN 1.0 AND 10.0),
  elapsed_days   REAL    NOT NULL DEFAULT 0.0 CHECK (elapsed_days >= 0.0),
  scheduled_days REAL    NOT NULL DEFAULT 0.0 CHECK (scheduled_days >= 0.0),
  reps           INTEGER NOT NULL DEFAULT 0 CHECK (reps >= 0),
  lapses         INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  state          INTEGER NOT NULL DEFAULT 0 CHECK (state IN (0, 1, 2, 3)),
  due            INTEGER NOT NULL,                        -- unix seconds
  last_review    INTEGER,
  -- 1..4 (Again, Hard, Good, Easy). The last rating, kept so the review screen
  -- can show it and so a scheduler-parameter change can be replayed against
  -- recent history without the raw answer rows, which archival removes.
  last_rating    INTEGER CHECK (last_rating IS NULL OR last_rating BETWEEN 1 AND 4),
  -- Suspended cards stay out of the due queue without losing their history.
  suspended_at   INTEGER,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, question_id),
  CHECK (lapses <= reps),
  CHECK (reps = 0 OR last_review IS NOT NULL)
) STRICT;

-- NQ-29 srs-due-queue, the query the review screen opens with:
--   SELECT question_id FROM srs_state
--    WHERE user_id = ?1 AND due <= ?2 AND suspended_at IS NULL
--    ORDER BY due LIMIT ?3;
-- Partial on suspended_at so suspended cards are not merely filtered out but
-- absent from the index.
CREATE INDEX idx_srs_state_user_due ON srs_state (user_id, due)
  WHERE suspended_at IS NULL;

-- NQ-29b srs-forecast: SELECT date(due,'unixepoch') d, COUNT(*) FROM srs_state
--        WHERE user_id = ? AND due BETWEEN ? AND ? GROUP BY d -- the "how much
--        work is coming" chart. Served by the same index.

-- ---------------------------------------------------------------------------
-- study_sessions: a contiguous block of studying, for the activity heatmap and
-- for time-on-task reporting.
--
-- Distinct from `attempts`: an attempt is a graded artefact with a score, a
-- session is wall-clock engagement. One session can contain several attempts
-- (a student doing three chapters back to back) and a session can contain no
-- attempt at all (reading explanations, browsing bookmarks), which is exactly
-- the activity a study tracker should not throw away.
-- ---------------------------------------------------------------------------
CREATE TABLE study_sessions (
  id                INTEGER NOT NULL PRIMARY KEY,
  public_id         TEXT    NOT NULL,
  user_id           TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind              TEXT    NOT NULL
                            CHECK (kind IN ('practice', 'mock', 'review', 'srs', 'reading')),
  chapter_id        TEXT    REFERENCES chapters (id) ON DELETE SET NULL,
  subchapter_id     TEXT    REFERENCES subchapters (id) ON DELETE SET NULL,
  -- Soft reference to attempts.id. Unenforced on purpose: a session is
  -- activity history and must survive an attempt being deleted.
  attempt_id        INTEGER,
  started_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  ended_at          INTEGER,
  -- Generated so "time studied" is never a client-supplied number.
  duration_s        INTEGER GENERATED ALWAYS AS (
                      CASE WHEN ended_at IS NULL THEN 0 ELSE ended_at - started_at END
                    ) STORED,
  questions_seen    INTEGER NOT NULL DEFAULT 0 CHECK (questions_seen >= 0),
  questions_correct INTEGER NOT NULL DEFAULT 0 CHECK (questions_correct >= 0),
  -- The calendar day this session is credited to, in the USER's timezone, not
  -- UTC. Written by the API, which knows the timezone; a generated column
  -- would have to assume UTC and would misattribute every late-night session
  -- in Kathmandu (UTC+05:45) to the wrong day, which is precisely the bug that
  -- breaks a streak.
  local_date        TEXT    NOT NULL
                            CHECK (local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (questions_correct <= questions_seen),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
) STRICT;

CREATE UNIQUE INDEX uq_study_sessions_public_id ON study_sessions (public_id);

-- NQ-31 study-history: SELECT ... FROM study_sessions WHERE user_id = ?
--       ORDER BY started_at DESC LIMIT ?.
CREATE INDEX idx_study_sessions_user_started
  ON study_sessions (user_id, started_at DESC);

-- NQ-31b activity-heatmap, one query for a year of squares:
--   SELECT local_date, SUM(duration_s), SUM(questions_seen)
--     FROM study_sessions
--    WHERE user_id = ?1 AND local_date >= ?2
--    GROUP BY local_date;
-- Covering, so the heatmap is an index-only scan.
CREATE INDEX idx_study_sessions_user_local_date
  ON study_sessions (user_id, local_date, duration_s, questions_seen);

-- NQ-31c open-session: SELECT id FROM study_sessions
--        WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1.
CREATE INDEX idx_study_sessions_open ON study_sessions (user_id, started_at DESC)
  WHERE ended_at IS NULL;

-- ---------------------------------------------------------------------------
-- streaks: one row per user.
--
-- `last_active_date` is a TEXT calendar day in the user's timezone, not a
-- timestamp, because a streak is a statement about days and UTC midnight is
-- not a day boundary for anyone on this platform (Nepal is UTC+05:45, so a
-- UTC-based streak would break for any student studying after 18:15 local).
--
-- Maintained by the API, not by a trigger, for the same reason: resolving
-- "what day is it for this user" needs the timezone from user_profiles and a
-- real timezone database, and SQLite's date functions only know UTC and
-- fixed offsets. ?2 below is that resolved local date, 'YYYY-MM-DD'.
--
-- NQ-32a streak-touch. Idempotent: called on every answer, it moves the streak
-- at most once per local day, so a double-submit or a retry cannot
-- double-count. `longest_length` is NOT set here -- the trigger below owns it,
-- so the caller cannot get the "ratchet the record" arithmetic wrong:
--
--   INSERT INTO streaks (user_id, current_length, last_active_date,
--                        total_active_days)
--   VALUES (?1, 1, ?2, 1)
--   ON CONFLICT (user_id) DO UPDATE SET
--     current_length = CASE
--       WHEN last_active_date = ?2                     THEN current_length
--       WHEN last_active_date = date(?2, '-1 day')     THEN current_length + 1
--       WHEN freezes_available > 0
--            AND last_active_date = date(?2, '-2 day') THEN current_length + 1
--       ELSE 1 END,
--     freezes_available = CASE
--       WHEN last_active_date = date(?2, '-2 day') AND freezes_available > 0
--            THEN freezes_available - 1 ELSE freezes_available END,
--     total_active_days = total_active_days
--       + CASE WHEN last_active_date IS NULL OR last_active_date <> ?2
--              THEN 1 ELSE 0 END,
--     last_active_date  = ?2,
--     updated_at        = unixepoch()
--   WHERE last_active_date IS NULL OR last_active_date <= ?2;
--                                     -- never let a stale request move it back
-- ---------------------------------------------------------------------------
CREATE TABLE streaks (
  user_id           TEXT    NOT NULL PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  current_length    INTEGER NOT NULL DEFAULT 0 CHECK (current_length >= 0),
  longest_length    INTEGER NOT NULL DEFAULT 0 CHECK (longest_length >= 0),
  last_active_date  TEXT    CHECK (last_active_date IS NULL
                                   OR last_active_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  total_active_days INTEGER NOT NULL DEFAULT 0 CHECK (total_active_days >= 0),
  -- A one-day grace token, so a single missed day does not erase six weeks of
  -- work. Earned, spent by the upsert above.
  freezes_available INTEGER NOT NULL DEFAULT 0 CHECK (freezes_available BETWEEN 0 AND 3),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Note there is deliberately NO `longest_length >= current_length` CHECK.
  -- NQ-32a raises current_length without touching longest_length, so such a
  -- CHECK would reject the very statement that extends a streak. The invariant
  -- is maintained one statement later, by the trigger below.
  CHECK (current_length <= total_active_days)
) STRICT;

-- `longest_length` is a ratchet and this trigger owns it, because the obvious
-- hand-written version is wrong: inside an UPDATE,
-- `longest_length = max(longest_length, current_length)` reads the OLD
-- current_length and so lags a day behind the streak it is supposed to record.
--
-- It is a trigger rather than a CHECK because the two cannot coexist: column
-- CHECKs are evaluated before any AFTER trigger runs, so a
-- `longest_length >= current_length` constraint would reject NQ-32a's row
-- before this trigger ever got the chance to repair it. A BEFORE trigger is no
-- help either -- SQLite cannot rewrite NEW. So the invariant is eventually
-- consistent across two statements of one transaction, which is exactly as
-- consistent as it needs to be for a number shown on a profile page.
CREATE TRIGGER streaks_longest_ratchet
AFTER UPDATE OF current_length ON streaks
WHEN NEW.current_length > NEW.longest_length
BEGIN
  UPDATE streaks SET longest_length = NEW.current_length WHERE user_id = NEW.user_id;
END;

-- NQ-32b streak-leaderboard-source (snapshot cron only):
--   SELECT user_id, current_length FROM streaks ORDER BY current_length DESC LIMIT ?.
CREATE INDEX idx_streaks_current_length ON streaks (current_length DESC)
  WHERE current_length > 0;

-- ===========================================================================
-- user_question_stats: THE ROLLUP THE PROGRESS PAGE READS.
--
-- One row per (user, question) the user has ever been shown. Maintained by the
-- triggers below, which means:
--
--   * the progress page is ONE indexed read, not an aggregate over the answer
--     log. `chapter_id` and `subchapter_id` are denormalised onto this row
--     specifically so that read needs no join:
--
--       NQ-27 progress-page:
--         SELECT chapter_id,
--                COUNT(*)                        AS seen,
--                SUM(correct_count > 0)          AS ever_correct,
--                SUM(answer_count)               AS answers,
--                SUM(correct_count)              AS corrects
--           FROM user_question_stats
--          WHERE user_id = ?1
--          GROUP BY chapter_id;
--
--     Ten groups, one index range scan, covering. The alternative -- scanning
--     a user's rows in attempt_answers -- grows without bound and stops
--     working entirely once archival deletes those rows.
--
--   * the rollup is kept inside the statement that writes the answer. D1
--     allows 50 queries per Worker invocation; a handler that updated this
--     table itself would spend two or three of them on bookkeeping per
--     answer, and would be wrong the first time an error path returned early.
--
-- WHAT IS DELIBERATELY ABSENT: there is NO DELETE trigger on attempt_answers.
-- Archival (0004) deletes millions of answer rows; a delete trigger that
-- decremented these counters would silently erase every student's entire
-- progress history the first night the retention job ran. The rollup is an
-- append-only summary of what happened, not a cache of what is still stored.
-- If you add a delete trigger here, you have deleted the product.
-- ===========================================================================
CREATE TABLE user_question_stats (
  user_id             TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  question_id         TEXT    NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  -- Denormalised from `questions` by the trigger. Makes NQ-27 join-free.
  -- Drifts only if a question is moved between chapters, which is an admin
  -- action that must re-stamp these rows (NQ-27c below).
  chapter_id          TEXT    NOT NULL,
  subchapter_id       TEXT,
  -- Times the question was put in front of the user, including skips.
  exposure_count      INTEGER NOT NULL DEFAULT 0 CHECK (exposure_count >= 0),
  -- Times an option was actually chosen.
  answer_count        INTEGER NOT NULL DEFAULT 0 CHECK (answer_count >= 0),
  correct_count       INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  consecutive_correct INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_correct >= 0),
  -- Basis points so it is exact and indexable. STORED, because it is the sort
  -- key for the weak-areas queue (NQ-28).
  accuracy_bp         INTEGER GENERATED ALWAYS AS (
                        CASE WHEN answer_count = 0 THEN 0
                             ELSE (correct_count * 10000) / answer_count END
                      ) STORED,
  first_answered_at   INTEGER,
  last_answered_at    INTEGER,
  last_is_correct     INTEGER CHECK (last_is_correct IS NULL OR last_is_correct IN (0, 1)),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, question_id),
  CHECK (answer_count <= exposure_count),
  CHECK (correct_count <= answer_count),
  CHECK (consecutive_correct <= correct_count)
) STRICT;

-- NQ-27 progress-page (above). Covering: every column the query reads is in
-- the index, so it never touches the table.
CREATE INDEX idx_user_question_stats_user_chapter
  ON user_question_stats (user_id, chapter_id, correct_count, answer_count);

-- NQ-27b progress-page-by-subchapter: same shape, narrowed to one chapter's
--        six syllabus codes.
CREATE INDEX idx_user_question_stats_user_subchapter
  ON user_question_stats (user_id, subchapter_id, correct_count, answer_count)
  WHERE subchapter_id IS NOT NULL;

-- NQ-28 weak-areas: SELECT question_id FROM user_question_stats
--       WHERE user_id = ?1 AND answer_count > 0 AND accuracy_bp <= ?2
--       ORDER BY accuracy_bp, last_answered_at LIMIT ?3
--       -- feeds the 'weak_areas' attempt mode.
CREATE INDEX idx_user_question_stats_user_accuracy
  ON user_question_stats (user_id, accuracy_bp, last_answered_at)
  WHERE answer_count > 0;

-- NQ-27c rechapter-stats, after an admin moves a question between chapters:
--   UPDATE user_question_stats
--      SET chapter_id = ?2, subchapter_id = ?3
--    WHERE question_id = ?1;
-- Served by the index below, which is the only reason it exists -- without it
-- that UPDATE is a full table scan over every user's rows.
CREATE INDEX idx_user_question_stats_question ON user_question_stats (question_id);

-- ---------------------------------------------------------------------------
-- Rollup triggers.
-- ---------------------------------------------------------------------------

-- A new answer row is a new exposure. `attempt_count` on the attempt and the
-- per-question stats move together, inside the insert.
CREATE TRIGGER attempt_answers_ai_rollup
AFTER INSERT ON attempt_answers
BEGIN
  INSERT INTO user_question_stats (
    user_id, question_id, chapter_id, subchapter_id,
    exposure_count, answer_count, correct_count, consecutive_correct,
    first_answered_at, last_answered_at, last_is_correct, updated_at
  )
  SELECT
    a.user_id, NEW.question_id, q.chapter_id, q.subchapter_id,
    1,
    CASE WHEN NEW.selected_ordinal IS NULL THEN 0 ELSE 1 END,
    NEW.is_correct,
    NEW.is_correct,
    CASE WHEN NEW.selected_ordinal IS NULL THEN NULL ELSE NEW.answered_at END,
    CASE WHEN NEW.selected_ordinal IS NULL THEN NULL ELSE NEW.answered_at END,
    CASE WHEN NEW.selected_ordinal IS NULL THEN NULL ELSE NEW.is_correct END,
    unixepoch()
  FROM attempts a
  JOIN questions q ON q.id = NEW.question_id
  WHERE a.id = NEW.attempt_id
  ON CONFLICT (user_id, question_id) DO UPDATE SET
    exposure_count      = exposure_count + 1,
    answer_count        = answer_count
                          + CASE WHEN NEW.selected_ordinal IS NULL THEN 0 ELSE 1 END,
    correct_count       = correct_count + NEW.is_correct,
    consecutive_correct = CASE WHEN NEW.is_correct = 1
                               THEN consecutive_correct + 1 ELSE 0 END,
    first_answered_at   = COALESCE(first_answered_at,
                                   CASE WHEN NEW.selected_ordinal IS NULL
                                        THEN NULL ELSE NEW.answered_at END),
    last_answered_at    = CASE WHEN NEW.selected_ordinal IS NULL
                               THEN last_answered_at ELSE NEW.answered_at END,
    last_is_correct     = CASE WHEN NEW.selected_ordinal IS NULL
                               THEN last_is_correct ELSE NEW.is_correct END,
    updated_at          = unixepoch();

  UPDATE attempts
     SET answered_count = answered_count
                        + CASE WHEN NEW.selected_ordinal IS NULL THEN 0 ELSE 1 END,
         correct_count  = correct_count + NEW.is_correct
   WHERE id = NEW.attempt_id;
END;

-- A revision (the ON CONFLICT DO UPDATE arm of NQ-25) is not a new exposure.
-- Only the correctness facts move, and they move by delta so the counters stay
-- consistent however many times a student changes their mind.
CREATE TRIGGER attempt_answers_au_rollup
AFTER UPDATE OF selected_ordinal, is_correct ON attempt_answers
BEGIN
  UPDATE attempts
     SET answered_count = answered_count
                        + CASE WHEN NEW.selected_ordinal IS NULL THEN 0 ELSE 1 END
                        - CASE WHEN OLD.selected_ordinal IS NULL THEN 0 ELSE 1 END,
         correct_count  = correct_count + NEW.is_correct - OLD.is_correct
   WHERE id = NEW.attempt_id;

  UPDATE user_question_stats
     SET answer_count        = answer_count
                             + CASE WHEN NEW.selected_ordinal IS NULL THEN 0 ELSE 1 END
                             - CASE WHEN OLD.selected_ordinal IS NULL THEN 0 ELSE 1 END,
         correct_count       = correct_count + NEW.is_correct - OLD.is_correct,
         consecutive_correct = CASE
                                 WHEN NEW.is_correct = OLD.is_correct THEN consecutive_correct
                                 WHEN NEW.is_correct = 1              THEN consecutive_correct + 1
                                 ELSE 0
                               END,
         first_answered_at   = COALESCE(first_answered_at,
                                        CASE WHEN NEW.selected_ordinal IS NULL
                                             THEN NULL ELSE NEW.answered_at END),
         last_answered_at    = CASE WHEN NEW.selected_ordinal IS NULL
                                    THEN last_answered_at ELSE NEW.answered_at END,
         last_is_correct     = CASE WHEN NEW.selected_ordinal IS NULL
                                    THEN last_is_correct ELSE NEW.is_correct END,
         updated_at          = unixepoch()
   WHERE question_id = NEW.question_id
     AND user_id = (SELECT user_id FROM attempts WHERE id = NEW.attempt_id);
END;

-- tags.question_count is a display counter on the tag picker. Kept by trigger
-- for the same reason as everything else in this file: it is one more query
-- the handler does not have to spend from its budget of 50.
CREATE TRIGGER question_tags_ai_count AFTER INSERT ON question_tags BEGIN
  UPDATE tags SET question_count = question_count + 1 WHERE id = NEW.tag_id;
END;

CREATE TRIGGER question_tags_ad_count AFTER DELETE ON question_tags BEGIN
  UPDATE tags SET question_count = max(0, question_count - 1) WHERE id = OLD.tag_id;
END;
