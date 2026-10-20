-- 0004_assessment.sql
-- Mock test templates, attempts, the per-attempt delivered paper, and answers.
--
-- ===========================================================================
-- PER-ATTEMPT OPTION PERMUTATION
-- ===========================================================================
--
-- The question bank shipped as public JSON under frontend/public/data/books/
-- and is in git history permanently. Anyone can reconstruct "question X's
-- answer is the second option". Hiding the key in a server-only table (0002)
-- therefore only solves half the problem: if the API delivers options in their
-- authored order, a captured paper can be joined against that JSON by
-- position and graded without ever asking the server.
--
-- So the paper is permuted per attempt, and the permutation is recorded:
--
--   * `attempt_questions.option_order` is a JSON array of option ids in the
--     order this attempt's paper showed them. Option ids, not indices --
--     joining an index against the public JSON is the attack being closed.
--   * `attempts.option_seed` is the PRNG seed, so the exact paper can be
--     reproduced for a dispute without trusting the client's copy.
--   * `attempt_answers` records the option the student chose as a stable
--     ordinal (exposed as an option id by a VIRTUAL generated column), plus
--     the screen position it occupied. The position is analytics only; grading
--     resolves the client's handle through `option_order` and compares ids.
--
-- The authored bank has a severe answer-position bias. Measured over the 2,190
-- published questions after import, the authored correct option sits at slot
-- 1/2/3/4 in 634/721/496/339 of them -- 32.9% at slot 2 against the 25% a fair
-- bank would show, and considerably worse per chapter. So permutation is also
-- the only thing that stops a student scoring well above chance without
-- learning anything. Options flagged `question_options.is_pinned` ('All of the
-- above' and friends, 450 of them, every single one authored in slot 4) must
-- stay last: shuffling one into the middle makes the question nonsense.
--
-- Note what this costs. The existing client permutes with a seed derived from
-- the question id, so the order is stable per question forever; that is weaker
-- (one captured paper reveals the order for everyone) and the reason it was
-- done that way was to stop saved drafts re-pointing. Storing `option_order`
-- per attempt gets the stronger property and keeps drafts stable, at the price
-- of one extra row per delivered question -- see the ceiling arithmetic below.
--
-- WHAT PERMUTATION DOES NOT BUY, STATED PLAINLY.
--
-- Option ids are `question_id || '#' || ordinal`, so an id leaks the slot the
-- option was authored in. If the API hands raw option ids to the browser, a
-- client that matches a delivered stem against the public JSON in git history
-- can grade the paper offline whatever order the options arrived in.
--
-- That is worth being exact about rather than papering over:
--
--   * For the 2,290 questions already published as public JSON, the answer key
--     is irrecoverably public. Any client that can read a stem can look the
--     answer up by stem text. No server-side measure restores secrecy for
--     those, and a schema that pretends otherwise is lying to its reader.
--   * What IS defensible, and what this design actually protects, is: (a) no
--     question authored FROM NOW ON ever has its key exposed, because the key
--     lives only in `question_answer_keys`; and (b) a delivered paper cannot
--     be graded by POSITION alone, so the attack requires text matching per
--     question rather than one join.
--
-- To close (c) -- "the authored slot is readable from the delivered payload" --
-- the delivery layer must not ship raw option ids. `option_order` is the
-- server-side mapping that makes this free: deliver each option as its INDEX
-- into this attempt's `option_order` (or an HMAC of the option id under
-- `option_seed`), accept that handle back, and resolve it to an ordinal
-- server-side through this column. The client then holds nothing that reveals
-- authored position, and `attempt_answers` still stores the stable ordinal.
--
-- The ordinal-bearing id is deliberately kept as the INTERNAL identity, rather
-- than swapped for a random ULID, because it buys three things a random id
-- does not: an option's identity survives an edit to its text (so historical
-- answers never re-point), the `question_id || '#'` prefix CHECK structurally
-- prevents an answer key pointing at another question's option, and
-- `attempt_answers` stores one integer instead of a 26-byte string -- which is
-- a measurable fraction of the 132.4 bytes/row ceiling computed below.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- mock_test_templates: a named exam shape.
--
-- `blueprint` is TEXT holding JSON. SQLite has no jsonb; TEXT plus
-- json_valid() plus the json1 functions is the real equivalent, and json_each()
-- makes a blueprint queryable where it matters (see NQ-19b below).
--
-- Blueprint schema, version 1:
--
--   {
--     "version": 1,
--     "shuffle_options": true,
--     "negative_marking": 0,          -- marks deducted per wrong answer
--     "pass_mark_bp": 5000,           -- basis points, 5000 = 50%
--     "rules": [
--       { "chapter_id": "book-ch1",
--         "subchapter_codes": null,   -- or ["1.1","1.2"] to narrow
--         "count": 10,
--         "difficulty": null,         -- or "easy" | "medium" | "hard"
--         "tag_ids": null }           -- or ["karnaugh-map"]
--     ]
--   }
--
-- The three templates the current app hardcodes in
-- frontend/src/data/topics.ts (two 10-per-chapter full mocks and a
-- 5-per-chapter quick assessment) are exactly this shape with ten rules each,
-- which is why the shape is a list of per-chapter rules rather than a flat
-- question count. 0007 seeds them.
--
-- `total_questions` is stored, not generated. It is derivable from the
-- blueprint with a json_each sum, but a STORED generated column may only use
-- deterministic scalar expressions -- no subqueries, which json_each requires.
-- A CHECK keeps it non-negative; the API asserts the sum on write.
-- ---------------------------------------------------------------------------
CREATE TABLE mock_test_templates (
  id               TEXT    NOT NULL PRIMARY KEY,           -- 'full-mock-1'
  subject_id       TEXT    NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT,
  slug             TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  description      TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 600),
  total_questions  INTEGER NOT NULL CHECK (total_questions BETWEEN 1 AND 500),
  blueprint        TEXT    NOT NULL CHECK (json_valid(blueprint)),
  -- 'static' draws the same questions every time (a published past paper);
  -- 'random' redraws per attempt, which is what every current template does.
  selection        TEXT    NOT NULL DEFAULT 'random'
                           CHECK (selection IN ('random', 'static')),
  status           TEXT    NOT NULL DEFAULT 'published'
                           CHECK (status IN ('draft', 'published', 'retired')),
  ordinal          INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT    REFERENCES users (id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (json_type(blueprint, '$.rules') = 'array'),
  CHECK (json_extract(blueprint, '$.version') = 1)
) STRICT;

-- NQ-19 template-by-slug: SELECT ... FROM mock_test_templates WHERE slug = ?.
CREATE UNIQUE INDEX uq_mock_test_templates_slug ON mock_test_templates (slug);

-- NQ-19a template-list: SELECT ... WHERE subject_id = ? AND status = 'published'
--       ORDER BY ordinal.
CREATE INDEX idx_mock_test_templates_subject_ordinal
  ON mock_test_templates (subject_id, ordinal) WHERE status = 'published';

-- NQ-19b blueprint-expand, issued once when an attempt starts. One query, not
-- one per rule, because D1 allows 50 queries per invocation and a ten-rule
-- blueprint that looped would spend ten of them before drawing a question:
--   SELECT json_extract(r.value, '$.chapter_id')       AS chapter_id,
--          json_extract(r.value, '$.count')            AS want,
--          json_extract(r.value, '$.subchapter_codes') AS subchapters
--     FROM mock_test_templates t, json_each(t.blueprint, '$.rules') r
--    WHERE t.id = ?1;

-- ---------------------------------------------------------------------------
-- attempts: one sitting of a practice set, mock test or review queue.
--
-- `id` is an INTEGER rowid alias, not a ULID, and `public_id` carries the
-- opaque identifier that appears in URLs. The reason is one table down:
-- `attempt_answers` is the only unbounded table on the platform, and every
-- answer row carries an attempt reference. A 26-character ULID there costs 26
-- bytes plus overhead per row against an 8-byte integer; across the 3 million
-- rows a 180-day retention window holds at 1,000 MAU, that choice alone is
-- most of a percent of the 500 MB free-tier database limit, repeated in the
-- index. Opaque ids in URLs and compact ids in the hot table are not in
-- conflict; they just need two columns.
-- ---------------------------------------------------------------------------
CREATE TABLE attempts (
  id               INTEGER NOT NULL PRIMARY KEY,           -- rowid alias, internal
  public_id        TEXT    NOT NULL,                       -- ULID, appears in URLs
  user_id          TEXT    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mode             TEXT    NOT NULL
                           CHECK (mode IN ('practice', 'mock', 'srs', 'bookmark_review', 'weak_areas')),
  -- Set for mode='mock'. RESTRICT rather than CASCADE: deleting a template
  -- must not delete the attempts students already sat under it.
  template_id      TEXT    REFERENCES mock_test_templates (id) ON DELETE RESTRICT,
  -- Set for a single-chapter or single-subchapter practice set. NULL for a
  -- mock, which spans all ten.
  chapter_id       TEXT    REFERENCES chapters (id) ON DELETE RESTRICT,
  subchapter_id    TEXT    REFERENCES subchapters (id) ON DELETE RESTRICT,
  status           TEXT    NOT NULL DEFAULT 'in_progress'
                           CHECK (status IN ('in_progress', 'submitted', 'abandoned', 'expired')),
  -- Seed for the per-attempt option permutation. Lets the exact paper be
  -- reproduced from the question ids alone, for an errata dispute.
  option_seed      INTEGER NOT NULL,
  question_count   INTEGER NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  -- Maintained by the triggers in 0005 so the history list never has to count
  -- rows in attempt_answers -- which matters because those rows get archived
  -- away while the attempt summary must survive.
  answered_count   INTEGER NOT NULL DEFAULT 0 CHECK (answered_count >= 0),
  correct_count    INTEGER NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  -- Basis points, 0..10000. Generated and STORED so the history list and the
  -- leaderboard job read a number instead of computing one, and so it can be
  -- indexed. Integer basis points rather than REAL: exact, sortable, and
  -- immune to the "99.99999%" rendering bug.
  score_bp         INTEGER GENERATED ALWAYS AS (
                     CASE WHEN question_count = 0 THEN 0
                          ELSE (correct_count * 10000) / question_count END
                   ) STORED,
  started_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Server-side clock for a timed mock. The client's countdown is a
  -- convenience; this is the authority.
  deadline_at      INTEGER,
  submitted_at     INTEGER,
  -- Wall time the student actually spent, which is not deadline minus start:
  -- they can submit early, and a resumed attempt has gaps.
  elapsed_ms       INTEGER,
  -- Small JSON bag for user-agent class, screen size, 'resumed' flags.
  -- Diagnostics, never read by business logic.
  client_meta      TEXT    CHECK (client_meta IS NULL OR json_valid(client_meta)),
  CHECK (correct_count <= answered_count),
  CHECK (answered_count <= question_count),
  CHECK ((status = 'submitted') = (submitted_at IS NOT NULL)),
  CHECK (mode <> 'mock' OR template_id IS NOT NULL),
  CHECK (subchapter_id IS NULL OR chapter_id IS NOT NULL)
) STRICT;

-- NQ-21 attempt-by-public-id: every attempt route resolves its URL segment
--       here first. SELECT id, user_id, status FROM attempts WHERE public_id = ?.
CREATE UNIQUE INDEX uq_attempts_public_id ON attempts (public_id);

-- NQ-20 resume-attempt: SELECT ... FROM attempts
--       WHERE user_id = ? AND status = 'in_progress'
--       ORDER BY started_at DESC LIMIT 1.
-- Partial, because exactly one row per user is normally in this state and the
-- index should be a few hundred entries platform-wide rather than millions.
-- This replaces the `eng_mock_draft_v1:` localStorage keys.
CREATE INDEX idx_attempts_user_in_progress
  ON attempts (user_id, started_at DESC) WHERE status = 'in_progress';

-- NQ-22 attempt-history: SELECT public_id, mode, chapter_id, question_count,
--       correct_count, score_bp, submitted_at FROM attempts
--       WHERE user_id = ? AND status = 'submitted'
--       ORDER BY submitted_at DESC LIMIT ? OFFSET ?.
CREATE INDEX idx_attempts_user_submitted
  ON attempts (user_id, submitted_at DESC) WHERE status = 'submitted';

-- NQ-22b expire-stale-attempts (cron): SELECT id FROM attempts
--        WHERE status = 'in_progress' AND deadline_at < ? LIMIT ?.
CREATE INDEX idx_attempts_deadline
  ON attempts (deadline_at) WHERE status = 'in_progress' AND deadline_at IS NOT NULL;

-- NQ-26b archival-candidates (see the archival note at the end of this file):
--        SELECT id FROM attempts WHERE submitted_at < ? ORDER BY id LIMIT ?.
CREATE INDEX idx_attempts_submitted_at ON attempts (submitted_at)
  WHERE submitted_at IS NOT NULL;

-- NQ-35b leaderboard-source: SELECT user_id, SUM(correct_count), SUM(question_count)
--        FROM attempts WHERE submitted_at >= ?1 AND submitted_at < ?2
--        GROUP BY user_id -- run by the snapshot cron only, never by a request.
--        Served by idx_attempts_submitted_at above.

-- ---------------------------------------------------------------------------
-- attempt_questions: the delivered paper. One row per question in the attempt,
-- in delivery order, with the option permutation that attempt saw.
--
-- This table is why an attempt can be resumed exactly, why a dispute can be
-- adjudicated against what the student was actually shown, and why the paper
-- does not have to be regenerated (and so cannot come back different) when the
-- page reloads.
--
-- Bounded at question_count rows per attempt: 100 for the largest mock.
-- ---------------------------------------------------------------------------
CREATE TABLE attempt_questions (
  attempt_id   INTEGER NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  position     INTEGER NOT NULL CHECK (position >= 1),
  question_id  TEXT    NOT NULL REFERENCES questions (id) ON DELETE RESTRICT,
  -- JSON array of option ids in the order this attempt showed them, e.g.
  -- ["q_ab12#3","q_ab12#1","q_ab12#4","q_ab12#2"]. Ids, never indices.
  option_order TEXT    NOT NULL CHECK (json_valid(option_order)
                                       AND json_type(option_order) = 'array'),
  PRIMARY KEY (attempt_id, position)
) STRICT;

-- One appearance per question per attempt. A paper that asks the same question
-- twice is a selection bug, and it should fail at the write rather than be
-- discovered by the student.
CREATE UNIQUE INDEX uq_attempt_questions_attempt_question
  ON attempt_questions (attempt_id, question_id);

-- NQ-23 attempt-paper: SELECT position, question_id, option_order
--       FROM attempt_questions WHERE attempt_id = ? ORDER BY position
--       -- served by the primary key, no sort.
--
-- NQ-23b render-paper, the full page in one query. Note that it joins
-- v_question_delivery and so structurally cannot return the key:
--   SELECT aq.position, aq.option_order, d.stem, d.option_id, d.option_text
--     FROM attempt_questions aq
--     JOIN v_question_delivery d ON d.question_id = aq.question_id
--    WHERE aq.attempt_id = ?1
--    ORDER BY aq.position;
--   -- the Worker then sorts each question's options by their index in
--      option_order, which is the permutation this attempt is owed.

-- ---------------------------------------------------------------------------
-- attempt_answers: THE ONLY UNBOUNDED TABLE ON THE PLATFORM.
--
-- Everything about this table's shape is a consequence of that. Read the
-- archival note at the bottom of this file before changing any column here.
--
-- Width discipline, and what each choice buys:
--
--   * `id INTEGER PRIMARY KEY` -- the rowid alias. No ULID, no UUID. Also the
--     archival cursor, because rowid order is insertion order.
--   * `attempt_id INTEGER` -- 8 bytes against a 26-byte ULID. Resolved from
--     `attempts.public_id` once per request, not stored per answer.
--   * `selected_ordinal INTEGER` rather than `selected_option_id TEXT`. Option
--     ids are `question_id || '#' || ordinal` by construction (0002), so the
--     ordinal is the only part that is not already in this row. The id is
--     exposed as a VIRTUAL generated column: zero bytes on disk, fully
--     joinable, and the requirement that an answer reference a stable option
--     id is met literally rather than by convention.
--   * NULL `selected_ordinal` means skipped. SQLite skips a foreign-key check
--     when any child column is NULL, so a skipped answer costs no parent
--     lookup and needs no sentinel value.
--   * No `user_id`. It is one join away through `attempt_id`, and the only
--     per-user read of this table is scoped to one attempt. Denormalising it
--     would add 26 bytes per row to save a join that nothing performs.
--
-- Integrity: the composite foreign key proves the chosen ordinal is a real
-- option of that question. It costs one index probe per insert, paid
-- deliberately -- an answer pointing at a nonexistent option is an
-- unfixable silent mis-grade, and the existing bank already contains two
-- questions whose authored key points past the last option.
--
-- `is_correct` is graded by the server at write time against
-- question_answer_keys (NQ-10) and stored, so review, scoring, rollups and
-- the leaderboard never re-derive it and never need the key table.
-- ---------------------------------------------------------------------------
CREATE TABLE attempt_answers (
  id                 INTEGER NOT NULL PRIMARY KEY,         -- rowid alias, archival cursor
  attempt_id         INTEGER NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  question_id        TEXT    NOT NULL REFERENCES questions (id) ON DELETE RESTRICT,
  -- NULL = skipped / unanswered.
  selected_ordinal   INTEGER,
  -- Virtual: costs nothing to store, everything to clarity.
  selected_option_id TEXT    GENERATED ALWAYS AS (
                               CASE WHEN selected_ordinal IS NULL THEN NULL
                                    ELSE question_id || '#' || selected_ordinal END
                             ) VIRTUAL,
  is_correct         INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  -- Where the chosen option sat on screen, 1-based, under this attempt's
  -- permutation. Analytics only (position-bias measurement). Never grading.
  delivered_position INTEGER,
  -- Milliseconds on this question. Feeds the FSRS rating heuristic in 0005.
  time_ms            INTEGER CHECK (time_ms IS NULL OR time_ms >= 0),
  -- 1 if the student changed their answer at least once. Cheap signal for
  -- "guessed" versus "knew it", stored as a flag rather than as a revision log
  -- precisely because this table may not grow a second row per answer.
  revised            INTEGER NOT NULL DEFAULT 0 CHECK (revised IN (0, 1)),
  answered_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (question_id, selected_ordinal)
    REFERENCES question_options (question_id, ordinal),
  CHECK (selected_ordinal IS NOT NULL OR is_correct = 0)
) STRICT;

-- NQ-24 attempt-answers-load / NQ-25 answer-upsert. One row per question per
-- attempt, enforced, so the client's retry-on-flaky-network does not create
-- two answers:
--   INSERT INTO attempt_answers (attempt_id, question_id, selected_ordinal,
--                                is_correct, delivered_position, time_ms)
--   VALUES (?1, ?2, ?3, ?4, ?5, ?6)
--   ON CONFLICT (attempt_id, question_id) DO UPDATE SET
--     selected_ordinal = excluded.selected_ordinal,
--     is_correct       = excluded.is_correct,
--     time_ms          = excluded.time_ms,
--     revised          = 1,
--     answered_at      = unixepoch();
-- This is also the index that serves loading an attempt for review.
CREATE UNIQUE INDEX uq_attempt_answers_attempt_question
  ON attempt_answers (attempt_id, question_id);

-- NQ-26 archival-scan: SELECT id FROM attempt_answers WHERE answered_at < ?
--       ORDER BY id LIMIT ?. The only reason this index exists; it is also the
--       index that makes the retention job cheap enough to run inside the free
--       tier's write budget. See the archival note below.
CREATE INDEX idx_attempt_answers_answered_at ON attempt_answers (answered_at);

-- NQ-26c question-difficulty-recompute (nightly, bounded by the retention
--        window): SELECT question_id, COUNT(*) n, SUM(is_correct) k
--        FROM attempt_answers WHERE answered_at >= ?1 GROUP BY question_id
--        -- writes questions.p_value_bp. Served by the index below, which is
--        covering for this query so the nightly job never touches the table.
CREATE INDEX idx_attempt_answers_question_correct
  ON attempt_answers (question_id, is_correct);

-- ===========================================================================
-- ARCHIVAL: THE CEILING, MEASURED, AND THE JOB THAT KEEPS US UNDER IT
-- ===========================================================================
--
-- MEASURED ROW COST. Not estimated. 200,000 synthetic answer rows were
-- inserted into this exact schema, with these exact indexes and the rollup
-- triggers from 0005 live, and the allocated page bytes read back out of
-- `dbstat` (SQLite 3.54, 4 KB pages). Reproduce with `npm run db:measure`:
--
--     attempt_answers (table b-tree)         42.7 bytes/row
--     uq_attempt_answers_attempt_question    33.1
--     idx_attempt_answers_answered_at        25.7
--     idx_attempt_answers_question_correct   30.9
--     ------------------------------------------------
--     TOTAL                                 132.4 bytes/row
--
-- Note that 68% of the cost is index, not row. That is the price of the three
-- queries above and it is the first thing to revisit if the ceiling gets
-- close: dropping idx_attempt_answers_question_correct alone would buy 23%
-- more rows at the cost of making the nightly difficulty recompute a table
-- scan.
--
-- The rest of the schema -- 2,290 questions, 9,160 options, the 60 syllabus
-- codes, and the FTS5 index -- measures 5.1 MB, of which FTS5 is 1.0 MB. So a
-- 500 MB D1 free database holds 3,918,960 answer rows; a 10 GB paid one holds
-- 81,043,612.
--
-- VOLUME, at ~500 answers per active user per month (generated by
-- `npm run db:measure`, not by hand):
--
--     MAU    rows/month  row-writes/day   90d live      180d live    fits free 500MB@90d
--     ------ ----------  --------------  ------------  ------------  -------------------
--      1,000    500,000          66,667  1.5M  189 MB  3.0M  379 MB  yes
--      2,000  1,000,000         133,333  3.0M  379 MB  6.0M  758 MB  yes
--      5,000  2,500,000         333,333  7.5M  947 MB  15.0M 1.85 GB  no
--     10,000  5,000,000         666,667  15.0M 1.85 GB 30.0M 3.70 GB  no
--     25,000 12,500,000       1,666,667  37.5M 4.62 GB 75.0M 9.25 GB  no
--
-- Conclusions, stated now rather than discovered later:
--   * The free plan's 100,000 row-writes-per-DAY cap binds long before its
--     500 MB storage cap. D1 counts index rows as writes, so one answer is
--     FOUR row writes here (table + three indexes). 1,500 MAU is about
--     100,000 row writes a day. Storage would tolerate 2,500 MAU at 90-day
--     retention; writes will not.
--   * Workers Paid ($5/mo, 10 GB/db, 50 M row writes/mo) covers 10,000 MAU at
--     90-day retention with room to spare, and 10,000 MAU is 20 M answer row
--     writes a month against the 50 M allowance.
--   * Beyond ~25,000 MAU the next step is sharding answers across D1
--     databases by user id, or moving this one table to Durable Object SQL
--     storage. Both are schema-compatible with what is written here, because
--     nothing joins attempt_answers across users -- which is itself a design
--     constraint worth keeping.
--
-- WHY DELETING IS ENOUGH. D1 exposes no VACUUM, so a deleted row does not
-- shrink the database file. It does free the page for reuse by subsequent
-- inserts. That is the property that matters: with a fixed retention window
-- the live set is bounded, the file grows to roughly that size and then stays
-- there, reusing its own free pages. Without the retention job the file grows
-- forever and the first symptom is writes failing at the 500 MB wall.
--
-- WHAT IS SAFE TO DELETE. Nothing user-visible depends on a raw answer row
-- older than the review window:
--   * per-attempt score and counts -- `attempts.answered_count`,
--     `correct_count`, `score_bp`, maintained by trigger (0005).
--   * per-question history -- `user_question_stats` (0005), also by trigger.
--   * scheduling -- `srs_state` (0005).
--   * leaderboards -- `leaderboard_snapshots` (0006), precomputed.
-- Deleting raw answers loses the question-by-question review of an old
-- attempt, and nothing else. That is the trade, and it is the right one.
--
-- RETENTION POLICY.
--   * answers belonging to a submitted attempt: 90 days (free) / 180 (paid).
--   * answers belonging to an abandoned or expired attempt: 7 days.
--   * the `attempts` summary row itself: kept indefinitely. It is one row per
--     sitting, ~120 bytes, bounded by human stamina rather than by anything
--     unbounded.
--
-- THE JOB. A scheduled Worker, run nightly, three statements per batch. The
-- LIMIT exists because D1 allows 50 queries per invocation and because a
-- single unbounded DELETE would blow the per-query time limit and the daily
-- write budget at once:
--
--   -- 1. export, so the raw rows are not simply destroyed. NDJSON to R2.
--   --    Paged by rowid, 5,000 rows a batch to stay under D1's 1 MB
--   --    response and 2 MB row limits.
--   SELECT id, attempt_id, question_id, selected_ordinal, is_correct,
--          delivered_position, time_ms, revised, answered_at
--     FROM attempt_answers
--    WHERE answered_at < unixepoch('now', '-90 days')
--      AND id > ?1                                   -- cursor, 0 on first page
--    ORDER BY id
--    LIMIT 5000;
--
--   -- 2. delete exactly what was exported, by the id range just read.
--   DELETE FROM attempt_answers
--    WHERE id BETWEEN ?1 AND ?2                      -- first/last id of the page
--      AND answered_at < unixepoch('now', '-90 days');
--
--   -- 3. the short window for attempts nobody finished.
--   DELETE FROM attempt_answers
--    WHERE attempt_id IN (
--            SELECT id FROM attempts
--             WHERE status IN ('abandoned', 'expired')
--               AND started_at < unixepoch('now', '-7 days')
--             LIMIT 200);
--
-- After a large purge, compact the FTS index (NQ-11d) -- it is the only
-- compaction D1 offers and it is cheap.
--
-- `attempt_answers_archive` below exists for the case where R2 is not wired up
-- yet, or where a purge needs to be reversible for a few days. It is in the
-- SAME database, so moving rows into it frees NO space -- it is a staging
-- area, not the archive. Step 2 above is the thing that reclaims pages. Do not
-- let this table become the permanent home for old answers; the job that
-- drains it to R2 is what makes the ceiling arithmetic above true.
-- ===========================================================================
CREATE TABLE attempt_answers_archive (
  id                 INTEGER NOT NULL PRIMARY KEY,         -- the original attempt_answers.id
  attempt_id         INTEGER NOT NULL,                     -- soft reference, deliberately unenforced
  user_id            TEXT    NOT NULL,                     -- denormalised: the attempt may be gone
  question_id        TEXT    NOT NULL,
  selected_ordinal   INTEGER,
  is_correct         INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  delivered_position INTEGER,
  time_ms            INTEGER,
  answered_at        INTEGER NOT NULL,
  archived_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Where the NDJSON for this row went, once it is in R2. NULL means this row
  -- is still only in D1 and deleting it would lose data.
  r2_object_key      TEXT
) STRICT;
-- No foreign keys: the point of an archive row is to outlive its parents.
-- One index only, because this table is written in bulk and read almost never.
-- NQ-26d archive-drain: SELECT ... WHERE r2_object_key IS NULL ORDER BY id LIMIT ?.
CREATE INDEX idx_attempt_answers_archive_undrained
  ON attempt_answers_archive (id) WHERE r2_object_key IS NULL;
