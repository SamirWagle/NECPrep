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
--   * `attempt_answers` records the option the student chose as its stable
--     `opt_key` (exposed as a full option id by a VIRTUAL generated column),
--     plus the screen position it occupied. The position is analytics only;
--     grading resolves the client's handle through `option_order` and compares
--     ids.
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
-- Option ids no longer leak the authored slot: 0002 mints them as
-- `question_id || '#' || opt_key` with a 60-bit CSPRNG `opt_key`, precisely
-- because the earlier `|| ordinal` form made an option id joinable against the
-- `correct_option_index` published in `frontend/public/data/books/*.json`. Read
-- the block above `question_options` in 0002 for that argument in full.
--
-- What remains true after the fix, and is worth being exact about rather than
-- papering over:
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
-- Defence in depth stays on top of that: the delivery layer still ships no raw
-- option ids. `option_order` is the server-side mapping, and the API hands the
-- client a per-attempt ref derived as a keyed digest of
-- (server secret, option_seed, attempt, option id) -- see
-- `worker/src/handlers/paper.ts` and `lib/permute.ts#attemptOptionRef`. The
-- refs are DERIVED rather than stored: `attempt_questions` is the second table
-- to watch at scale (one row per delivered question, ~3 M rows a year at 1,000
-- MAU), and four stored 12-character tokens per row would add ~60 bytes to
-- every one of them for information the server can recompute in microseconds
-- from two columns it already has.
--
-- The `question_id || '#' || <key>` SHAPE is deliberately kept rather than
-- swapped for a bare random ULID, because the prefix buys two things a free
-- random id does not: the `question_answer_keys` CHECK can prove with a prefix
-- test that a key cannot point at another question's option, and the same test
-- guards `explanations.about_option_id` and
-- `question_reports.suggested_option_id`. `attempt_answers` stores the 12-char
-- `opt_key` rather than the full ~30-char id, which is what keeps the one
-- unbounded table narrow -- see the measured arithmetic below.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- mock_test_templates: a named exam shape.
--
-- `blueprint` is TEXT holding JSON. SQLite has no jsonb; TEXT plus
-- json_valid() plus the json1 functions is the real equivalent, and json_each()
-- makes a blueprint queryable where it matters (see NQ-19b below).
--
-- ===========================================================================
-- THE BLUEPRINT IS SUB-CHAPTER LEVEL. Version 2.
-- ===========================================================================
--
-- Version 1 of this shape carried one rule per CHAPTER ("10 from book-ch1"),
-- which is what `frontend/src/data/topics.ts` hardcoded. That is not the exam.
-- The official NEC syllabus for Computer Engineering publishes 10 chapters of
-- exactly 6 sub-chapters each -- 60 syllabus codes, seeded as `subchapters` in
-- 0007 -- and `frontend/src/data/examBlueprint.ts` already models the paper at
-- that level, with a documented weighting rule:
--
--   equal-chapter-weight-largest-remainder
--     1. each of the 10 chapters contributes 100/10 = 10 questions. This is the
--        only split the syllabus supports: it lists ten chapters of identical
--        structure and publishes no weights, so any uneven chapter weighting
--        would be invented.
--     2. within a chapter, 10 questions over 6 sub-chapters by largest
--        remainder (Hare quota) on equal shares: floor(10/6) = 1 each (6 seats)
--        with a remainder of 0.667 each and 4 seats left.
--     3. all six remainders tie, so the spare seats go in ascending
--        sub-chapter index -- the standard deterministic tie-break, documented
--        as arbitrary in content terms because it is.
--   Per chapter: 2+2+2+2+1+1 = 10. Across ten chapters: exactly 100.
--
-- So a blueprint is 60 rules, not 10, and the frontend and the database now
-- describe the same paper. `generate-reference-sql.mjs` derives 0007's rules
-- from that same file, so the two cannot drift.
--
-- Blueprint schema, version 2:
--
--   {
--     "version": 2,
--     "weighting_rule": "equal-chapter-weight-largest-remainder",
--     "shuffle_options": true,
--     "negative_marking": 0,          -- marks deducted per wrong answer
--     "pass_mark_bp": 5000,           -- basis points, 5000 = 50%
--     -- false: a sub-chapter with too few TAGGED questions is topped up from
--     -- its chapter's pool and the shortfall is reported. true: it is a hard
--     -- failure. Ships false, and must, because `questions.subchapter_id` is
--     -- NULL for all 2,290 imported questions -- the source JSON has no
--     -- syllabus field and the importer does not guess. A strict run today
--     -- would fail on all 60 rules. Flip it when tagging coverage is real;
--     -- it is a data change in this column, not a code change anywhere.
--     "strict_subchapter": false,
--     "rules": [
--       { "chapter_id": "book-ch1",
--         "subchapter_code": "1.1",   -- NULL for a chapter-wide rule
--         "count": 2,
--         "difficulty": null,         -- or "easy" | "medium" | "hard"
--         "tag_ids": null }           -- or ["karnaugh-map"]
--       -- ... 60 of them
--     ]
--   }
--
-- 0007 seeds the three templates the app currently hardcodes, reshaped:
-- the two 100-question full mocks get the 2/2/2/2/1/1 split per chapter, and
-- the 50-question quick assessment gets largest-remainder on 5 per chapter
-- (floor(5/6) = 0 each, five spare seats to indexes 1..5), i.e. 1/1/1/1/1/0.
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
  created_at       INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  updated_at       INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  CHECK (json_type(blueprint, '$.rules') = 'array'),
  -- Version 2 is the sub-chapter-level shape. The CHECK is an equality rather
  -- than a range so a version-1 chapter-level blueprint cannot be inserted by
  -- accident and then silently drawn at the wrong granularity.
  CHECK (json_extract(blueprint, '$.version') = 2),
  CHECK (json_type(blueprint, '$.strict_subchapter') IN ('true', 'false'))
) STRICT;

-- NQ-19 template-by-slug: SELECT ... FROM mock_test_templates WHERE slug = ?.
CREATE UNIQUE INDEX uq_mock_test_templates_slug ON mock_test_templates (slug);

-- NQ-19a template-list: SELECT ... WHERE subject_id = ? AND status = 'published'
--       ORDER BY ordinal.
CREATE INDEX idx_mock_test_templates_subject_ordinal
  ON mock_test_templates (subject_id, ordinal) WHERE status = 'published';

-- NQ-19b blueprint-expand, issued once when an attempt starts. ONE query for
-- all 60 rules, because D1 allows 50 queries per invocation and a blueprint
-- that looped per rule would exceed the whole budget before drawing a question:
--   SELECT json_extract(r.value, '$.chapter_id')      AS chapter_id,
--          json_extract(r.value, '$.subchapter_code') AS subchapter_code,
--          json_extract(r.value, '$.count')           AS want
--     FROM mock_test_templates t, json_each(t.blueprint, '$.rules') r
--    WHERE t.id = ?1;
--
-- NQ-19c blueprint-draw, the sub-chapter-level selection, also ONE query. It
-- returns two pools and lets the pure allocator in
-- `worker/src/domain/blueprint.ts` spend them, which is what keeps the
-- largest-remainder and fallback policy testable without a database:
--
--   WITH rules AS (
--     SELECT json_extract(r.value, '$.chapter_id')      AS chapter_id,
--            json_extract(r.value, '$.subchapter_code') AS subchapter_code,
--            json_extract(r.value, '$.count')           AS want
--       FROM mock_test_templates t, json_each(t.blueprint, '$.rules') r
--      WHERE t.id = ?1),
--   chapter_want AS (
--     SELECT chapter_id, SUM(want) AS want FROM rules GROUP BY chapter_id),
--   tagged AS (                        -- questions carrying a syllabus code
--     SELECT q.id, q.chapter_id, s.code AS subchapter_code, r.want,
--            ROW_NUMBER() OVER (PARTITION BY s.code ORDER BY RANDOM()) AS rn
--       FROM rules r
--       JOIN subchapters s ON s.code = r.subchapter_code
--       JOIN questions q ON q.subchapter_id = s.id AND q.status = 'published'),
--   pool AS (                          -- the chapter-level fallback pool
--     SELECT q.id, q.chapter_id, cw.want,
--            ROW_NUMBER() OVER (PARTITION BY q.chapter_id ORDER BY RANDOM()) AS rn
--       FROM chapter_want cw
--       JOIN questions q ON q.chapter_id = cw.chapter_id
--                       AND q.status = 'published')
--   SELECT 'subchapter' AS src, id, chapter_id, subchapter_code
--     FROM tagged WHERE rn <= want
--   UNION ALL
--   SELECT 'chapter' AS src, id, chapter_id, NULL
--     FROM pool WHERE rn <= want;
--
-- `tagged` is empty today -- `questions.subchapter_id` is NULL for every
-- imported question -- so every rule is satisfied from `pool` and the allocator
-- reports all 60 sub-chapters as approximated. That is the honest behaviour and
-- it matches `selectionBlueprint.strictBlueprint = false` in the frontend
-- exactly. The query does not change when tagging arrives; only its output mix
-- does. `pool` draws a chapter's whole quota, so the two arms can overlap and
-- the allocator de-duplicates -- bounded at 2 x total_questions rows.

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
  started_at       INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  -- Server-side clock for a timed mock. The client's countdown is a
  -- convenience; this is the authority.
  deadline_at      INTEGER,                                       -- epoch ms (UTC)
  submitted_at     INTEGER,                                       -- epoch ms (UTC)
  -- Wall time the student actually spent, which is not deadline minus start:
  -- they can submit early, and a resumed attempt has gaps.
  elapsed_ms       INTEGER,                                       -- duration, milliseconds
  -- ========================================================================
  -- THE PRE-DEADLINE SNAPSHOT. These two columns are what make the expiry
  -- clamp honest, and without them a late submission can only be scored as
  -- zero or trusted wholesale -- and both of those are wrong.
  --
  -- A mock client pushes its whole answer map to POST /api/mock/sync every
  -- ten to fifteen seconds. The UPDATE that writes it carries
  -- `AND ?now <= deadline_at` (see worker/src/data/attempts.ts#syncAnswers),
  -- so whatever is stored here is BY CONSTRUCTION a state that existed before
  -- the deadline. On a submission after the grace window the submitted payload
  -- is discarded and THIS is scored instead, so freezing the client timer and
  -- working for another hour cannot gain a single mark -- it can only lose the
  -- answers that were never synced.
  --
  -- The map REPLACES rather than merges, which is what makes the endpoint
  -- idempotent and safe for the offline outbox to replay: the last write to
  -- arrive before the deadline wins, and that is the honest answer.
  --
  -- JSON, `{ "<question_id>": "<option_ref>" }` -- per-attempt opaque refs,
  -- never option ids and never positions. Bounded by MAX_MOCK_ANSWERS (250) in
  -- the request schema, so one row cannot grow without limit.
  -- ========================================================================
  synced_answers   TEXT    CHECK (synced_answers IS NULL
                                  OR (json_valid(synced_answers)
                                      AND json_type(synced_answers) = 'object')),
  last_sync_at     INTEGER,                                       -- epoch ms (UTC)
  -- Small JSON bag for user-agent class, screen size, 'resumed' flags.
  -- Diagnostics, never read by business logic.
  client_meta      TEXT    CHECK (client_meta IS NULL OR json_valid(client_meta)),
  CHECK (correct_count <= answered_count),
  CHECK (answered_count <= question_count),
  CHECK ((status = 'submitted') = (submitted_at IS NOT NULL)),
  CHECK (mode <> 'mock' OR template_id IS NOT NULL),
  CHECK (subchapter_id IS NULL OR chapter_id IS NOT NULL),
  CHECK ((synced_answers IS NULL) = (last_sync_at IS NULL)),
  -- The pre-deadline property, enforced by the database and not only by the
  -- WHERE clause that writes it. If a future handler forgets the clamp, the
  -- write fails instead of quietly accepting post-deadline work.
  CHECK (last_sync_at IS NULL OR deadline_at IS NULL OR last_sync_at <= deadline_at)
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
--   * `selected_opt_key TEXT(12)` rather than `selected_option_id TEXT(~30)`.
--     Option ids are `question_id || '#' || opt_key` by construction (0002),
--     and `question_id` is already in this row, so the key is the only part
--     that is not. The full id is exposed as a VIRTUAL generated column: zero
--     bytes on disk, fully joinable, and the requirement that an answer
--     reference a stable option id is met literally rather than by convention.
--     This column used to be `selected_ordinal INTEGER` and was 4 bytes
--     narrower; the change is the cost of the id scheme in 0002 no longer
--     encoding the authored slot, and 12 bytes against a measured 132.4
--     bytes/row is the price of not publishing the answer key in every option
--     id. It is also why the key is 12 characters and not 26.
--   * NULL `selected_opt_key` means skipped. SQLite skips a foreign-key check
--     when any child column is NULL, so a skipped answer costs no parent
--     lookup and needs no sentinel value.
--   * No `user_id`. It is one join away through `attempt_id`, and the only
--     per-user read of this table is scoped to one attempt. Denormalising it
--     would add 26 bytes per row to save a join that nothing performs.
--   * No authored ordinal. It is one join away through
--     `question_options (question_id, opt_key)` and nothing on a request path
--     needs it; the position-bias analytics read `delivered_position`.
--
-- Integrity: the composite foreign key proves the chosen key is a real option
-- of that question. It costs one index probe per insert, paid
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
  -- NULL = skipped / unanswered. `question_options.opt_key`, 12 base32 chars.
  selected_opt_key   TEXT,
  -- Virtual: costs nothing to store, everything to clarity.
  selected_option_id TEXT    GENERATED ALWAYS AS (
                               CASE WHEN selected_opt_key IS NULL THEN NULL
                                    ELSE question_id || '#' || selected_opt_key END
                             ) VIRTUAL,
  is_correct         INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  -- Where the chosen option sat on screen, 1-based, under this attempt's
  -- permutation. Analytics only (position-bias measurement). Never grading.
  delivered_position INTEGER,
  -- Milliseconds on this question. Feeds the FSRS rating heuristic in 0005.
  time_ms            INTEGER CHECK (time_ms IS NULL OR time_ms >= 0), -- duration, milliseconds
  -- 1 if the student changed their answer at least once. Cheap signal for
  -- "guessed" versus "knew it", stored as a flag rather than as a revision log
  -- precisely because this table may not grow a second row per answer.
  revised            INTEGER NOT NULL DEFAULT 0 CHECK (revised IN (0, 1)),
  answered_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  FOREIGN KEY (question_id, selected_opt_key)
    REFERENCES question_options (question_id, opt_key),
  CHECK (selected_opt_key IS NULL
         OR (length(selected_opt_key) = 12 AND selected_opt_key GLOB '[0-9A-Z]*')),
  CHECK (selected_opt_key IS NOT NULL OR is_correct = 0)
) STRICT;

-- NQ-24 attempt-answers-load / NQ-25 answer-upsert. One row per question per
-- attempt, enforced, so the client's retry-on-flaky-network does not create
-- two answers:
--   INSERT INTO attempt_answers (attempt_id, question_id, selected_opt_key,
--                                is_correct, delivered_position, time_ms)
--   VALUES (?1, ?2, ?3, ?4, ?5, ?6)
--   ON CONFLICT (attempt_id, question_id) DO UPDATE SET
--     selected_opt_key = excluded.selected_opt_key,
--     is_correct       = excluded.is_correct,
--     time_ms          = excluded.time_ms,
--     revised          = 1,
--     answered_at      = CAST(unixepoch('subsec') * 1000 AS INTEGER);
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
--     attempt_answers (table b-tree)         56.2 bytes/row
--     uq_attempt_answers_attempt_question    33.1
--     idx_attempt_answers_answered_at        29.7
--     idx_attempt_answers_question_correct   30.9
--     ------------------------------------------------
--     TOTAL                                 149.9 bytes/row
--
-- RE-MEASURED after two deliberate changes, and both costs are real:
--   * `answered_at` in MILLISECONDS instead of seconds -- about 3 bytes in the
--     table and the same again in idx_attempt_answers_answered_at, which is
--     keyed on it (25.7 -> 29.7).
--   * `selected_opt_key TEXT(12)` instead of `selected_ordinal INTEGER` -- the
--     table row grows 42.7 -> 56.2.
-- 132.4 -> 149.9 bytes/row, i.e. 13% fewer rows in the same database, is what
-- not publishing the answer key in every option id and not having two
-- incompatible time units actually cost. It is the right trade and it is
-- written down here so nobody has to rediscover the price.
--
-- Note that 63% of the cost is index, not row. That is the price of the three
-- queries above and it is the first thing to revisit if the ceiling gets
-- close: dropping idx_attempt_answers_question_correct alone would buy 21%
-- more rows at the cost of making the nightly difficulty recompute a table
-- scan.
--
-- The rest of the schema -- 2,290 questions, 9,160 options, the 60 syllabus
-- codes, and the FTS5 index -- measures 5.9 MB, of which FTS5 is 1.0 MB. So a
-- 500 MB D1 free database holds 3,455,265 answer rows; a 10 GB paid one holds
-- 71,572,735.
--
-- VOLUME, at ~500 answers per active user per month (generated by
-- `npm run db:measure`, not by hand):
--
--     MAU    rows/month  row-writes/day   90d live      180d live    fits free 500MB@90d
--     ------ ----------  --------------  ------------  ------------  -------------------
--      1,000    500,000          66,667  1.5M  214 MB  3.0M  429 MB  yes
--      2,000  1,000,000         133,333  3.0M  429 MB  6.0M  858 MB  yes
--      5,000  2,500,000         333,333  7.5M  1.05 GB 15.0M 2.09 GB  no
--     10,000  5,000,000         666,667  15.0M 2.09 GB 30.0M 4.19 GB  no
--     25,000 12,500,000       1,666,667  37.5M 5.24 GB 75.0M 10.5 GB  no
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
--   SELECT id, attempt_id, question_id, selected_opt_key, is_correct,
--          delivered_position, time_ms, revised, answered_at
--     FROM attempt_answers
--    WHERE answered_at < CAST(unixepoch('now', '-90 days') * 1000 AS INTEGER)
--      AND id > ?1                                   -- cursor, 0 on first page
--    ORDER BY id
--    LIMIT 5000;
--
--   -- 2. delete exactly what was exported, by the id range just read.
--   DELETE FROM attempt_answers
--    WHERE id BETWEEN ?1 AND ?2                      -- first/last id of the page
--      AND answered_at < CAST(unixepoch('now', '-90 days') * 1000 AS INTEGER);
--
--   -- 3. the short window for attempts nobody finished.
--   DELETE FROM attempt_answers
--    WHERE attempt_id IN (
--            SELECT id FROM attempts
--             WHERE status IN ('abandoned', 'expired')
--               AND started_at < CAST(unixepoch('now', '-7 days') * 1000 AS INTEGER)
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
  selected_opt_key   TEXT,
  is_correct         INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  delivered_position INTEGER,
  time_ms            INTEGER,                                     -- duration, milliseconds
  answered_at        INTEGER NOT NULL,                            -- epoch ms (UTC)
  archived_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  -- Where the NDJSON for this row went, once it is in R2. NULL means this row
  -- is still only in D1 and deleting it would lose data.
  r2_object_key      TEXT
) STRICT;
-- No foreign keys: the point of an archive row is to outlive its parents.
-- One index only, because this table is written in bulk and read almost never.
-- NQ-26d archive-drain: SELECT ... WHERE r2_object_key IS NULL ORDER BY id LIMIT ?.
CREATE INDEX idx_attempt_answers_archive_undrained
  ON attempt_answers_archive (id) WHERE r2_object_key IS NULL;
