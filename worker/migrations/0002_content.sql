-- 0002_content.sql
-- The question bank: syllabus tree, questions, options, the answer key,
-- explanations, tags, errata reports, and the content audit trail.
--
-- ===========================================================================
-- TWO DESIGN DECISIONS THAT THE REST OF THE PLATFORM DEPENDS ON
-- ===========================================================================
--
-- (1) QUESTION IDENTITY IS CONTENT, NOT POSITION.
--
-- The app being replaced identifies a question as `{topicId}_{arrayIndex}` --
-- 'book-ch1_238' is "the 239th element of ch1.json". That id is a pointer into
-- an array, so any edit that changes array length silently re-points every
-- stored reference to it. This is not hypothetical. While this schema was
-- being written, a de-duplication pass shrank the bank from 2,801 rows to
-- 2,312, and the 23-entry quarantine list in
-- frontend/src/data/quarantine.json immediately went wrong in both directions:
-- 20 of its 23 ids now name a perfectly healthy question (so a good question
-- is hidden), and 18 genuinely mis-graded questions are no longer excluded (so
-- a student is marked wrong for being right). Every bookmark, progress record
-- and saved mock draft in every user's localStorage has the same defect.
--
-- So `questions.id` is derived from the question's content:
--
--     content_hash = sha256(
--         'necprep-question-v1' || RS ||
--         chapter_code          || RS ||
--         norm(stem)            || RS ||
--         norm(option_1) || US || ... || norm(option_n)   -- sorted, so option
--     )                                                  -- reordering is a
--     id = 'q_' || substr(content_hash, 1, 16)            -- no-op
--
--   RS = U+001E, US = U+001F (cannot occur in the source JSON).
--   norm(s) = NFKC, collapse whitespace runs to one space, trim, lowercase.
--
-- Properties this buys:
--   * Inserting, deleting or reordering questions changes nothing about the
--     surviving ones. Stored references stay valid.
--   * Re-running the importer is idempotent: the same source row produces the
--     same id, so it is an upsert, not a duplicate.
--   * Exact duplicates inside one chapter collapse to one row by construction.
--   * `chapter_code` is inside the hash, so a question that legitimately
--     appears in two chapters stays two rows and each chapter keeps its own
--     practice attribution. (Measured on the current bank: 24 exact-text
--     duplicate groups ignoring chapter, 22 of them inside a single chapter.)
--   * Editing a question's stem changes its hash, i.e. its identity. That is
--     correct and deliberate: a changed stem is a different question, and
--     answer history for the old wording should not be credited to the new
--     one. `superseded_by` records the lineage so the editor can show it.
--
-- `content_hash` keeps the full 64-hex digest under a UNIQUE constraint while
-- `id` uses the 16-hex prefix. A 64-bit prefix collision between two different
-- questions would therefore fail the primary-key insert and stop the importer
-- rather than silently merge two questions.
--
-- `legacy_id` holds the old `{topicId}_{arrayIndex}` string. It exists so the
-- one-time localStorage migration can translate a user's saved bookmarks and
-- progress, and so the quarantine list can be cross-checked. It is nullable,
-- it is never used for delivery, and it is expected to be dropped once the
-- migration window closes.
--
--
-- (2) THE ANSWER KEY LIVES IN ITS OWN TABLE.
--
-- D1 has no row-level security -- SQLite has none to expose -- so there is no
-- database rule that can stop a query returning the answer. The protection has
-- to be structural: the answer cannot be in a column that the delivery query
-- selects, because the delivery query selects every column of the tables it
-- touches sooner or later.
--
--   * `questions`        -- no correct-answer column of any kind.
--   * `question_options` -- no `is_correct` column.
--   * `question_answer_keys` -- one row per question, holding
--     `correct_option_id`. This is the ONLY place the key exists.
--
-- So `SELECT * FROM questions JOIN question_options ...`, the shape every
-- delivery handler actually writes, cannot leak the key even if it is written
-- carelessly, even if a `SELECT *` sneaks past review, even if a future
-- endpoint forgets. Leaking requires naming `question_answer_keys` in a FROM
-- clause, which is a grep-able, review-able, test-able event. `v_question_delivery`
-- below is the view the delivery path reads from, so the safe query is also
-- the shortest one to write.
--
-- Per-attempt option permutation (0004_assessment.sql) closes the second half
-- of the hole: the public JSON bank is in git history forever, so anyone can
-- reconstruct "the answer to this question is option 2". Delivering options in
-- a per-attempt permuted order, and recording answers by stable option id
-- rather than by screen position, means a captured paper cannot be joined
-- against that JSON by position.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- subjects: an exam. One row today (NEC Computer Engineering registration).
-- Modelled because NEC runs the same platform shape for Civil, Electrical and
-- the rest, and a second subject must not need a migration.
-- ---------------------------------------------------------------------------
CREATE TABLE subjects (
  id          TEXT    NOT NULL PRIMARY KEY,                -- 'nec-computer'
  code        TEXT    NOT NULL,                            -- 'NEC-CE'
  name        TEXT    NOT NULL,
  description TEXT,
  exam_board  TEXT    NOT NULL DEFAULT 'Nepal Engineering Council',
  ordinal     INTEGER NOT NULL DEFAULT 1,
  status      TEXT    NOT NULL DEFAULT 'published'
                      CHECK (status IN ('draft', 'published', 'retired')),
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) -- epoch ms (UTC)
) STRICT;

CREATE UNIQUE INDEX uq_subjects_code ON subjects (code);   -- NQ-05a subject-by-code

-- ---------------------------------------------------------------------------
-- chapters: the 10 official NEC papers (AExE01 .. AALL10).
--
-- `id` keeps the existing frontend identifiers ('book-ch1' .. 'book-ch10') so
-- the client's routes, saved drafts and progress keys survive the cutover
-- without a translation table. `nec_code` is the official code; `title` is the
-- official syllabus title; `display_name` is the shorter string the practice
-- cards already show. Both are kept because they genuinely differ and the UI
-- uses each in a different place.
-- ---------------------------------------------------------------------------
CREATE TABLE chapters (
  id               TEXT    NOT NULL PRIMARY KEY,           -- 'book-ch1'
  subject_id       TEXT    NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT,
  nec_code         TEXT    NOT NULL,                       -- 'AExE01'
  ordinal          INTEGER NOT NULL,                       -- 1..10
  slug             TEXT    NOT NULL,                       -- 'basic-electrical-and-electronics'
  title            TEXT    NOT NULL,                       -- official NEC title
  display_name     TEXT    NOT NULL,                       -- practice-card title
  short_name       TEXT    NOT NULL,
  description      TEXT,
  color            TEXT    NOT NULL DEFAULT '#6366f1' CHECK (color GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  icon             TEXT    NOT NULL DEFAULT 'book',
  -- Which file the importer read this chapter from. Audit only.
  legacy_data_file TEXT,
  status           TEXT    NOT NULL DEFAULT 'published'
                           CHECK (status IN ('draft', 'published', 'retired')),
  created_at       INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  updated_at       INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  CHECK (ordinal > 0)
) STRICT;

-- NQ-05 chapter-list: SELECT ... FROM chapters WHERE subject_id = ?
--       AND status = 'published' ORDER BY ordinal. One index scan, no sort.
CREATE INDEX idx_chapters_subject_ordinal ON chapters (subject_id, ordinal);

CREATE UNIQUE INDEX uq_chapters_nec_code ON chapters (nec_code);   -- NQ-05b chapter-by-nec-code
CREATE UNIQUE INDEX uq_chapters_slug ON chapters (subject_id, slug); -- NQ-05c chapter-by-slug (routing)

-- ---------------------------------------------------------------------------
-- subchapters: the 60 official NEC syllabus codes, 1.1 .. 10.6.
--
-- Six per chapter, exactly as published. These are the unit the syllabus is
-- written in, so they are the unit a student wants to practise and the unit a
-- mock-test blueprint should be able to name. Questions carry a nullable
-- subchapter_id: the imported bank has no subchapter metadata (the source JSON
-- has no such field), so the import leaves it NULL and classification is a
-- separate contributor workflow. Nullable-and-honest beats guessed-and-wrong.
-- ---------------------------------------------------------------------------
CREATE TABLE subchapters (
  id          TEXT    NOT NULL PRIMARY KEY,                -- 'nec-1.1'
  chapter_id  TEXT    NOT NULL REFERENCES chapters (id) ON DELETE CASCADE,
  code        TEXT    NOT NULL,                            -- '1.1'
  ordinal     INTEGER NOT NULL,                            -- 1..6
  title       TEXT    NOT NULL,
  description TEXT,                                        -- the syllabus paragraph verbatim
  status      TEXT    NOT NULL DEFAULT 'published'
                      CHECK (status IN ('draft', 'published', 'retired')),
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  CHECK (ordinal > 0),
  CHECK (code GLOB '[0-9]*.[0-9]*')
) STRICT;

-- NQ-06 subchapter-list: SELECT ... FROM subchapters WHERE chapter_id = ?
--       ORDER BY ordinal -- the syllabus accordion on the practice page.
CREATE INDEX idx_subchapters_chapter_ordinal ON subchapters (chapter_id, ordinal);

CREATE UNIQUE INDEX uq_subchapters_code ON subchapters (code);  -- NQ-06b subchapter-by-code

-- ---------------------------------------------------------------------------
-- questions: the stem and its metadata. NO ANSWER COLUMN. See header note (2).
-- ---------------------------------------------------------------------------
CREATE TABLE questions (
  id              TEXT    NOT NULL PRIMARY KEY,            -- 'q_' || substr(content_hash,1,16)
  content_hash    TEXT    NOT NULL,                        -- full sha256 hex, 64 chars
  subject_id      TEXT    NOT NULL REFERENCES subjects (id) ON DELETE RESTRICT,
  chapter_id      TEXT    NOT NULL REFERENCES chapters (id) ON DELETE RESTRICT,
  -- NULL until a contributor classifies it. The importer never guesses.
  subchapter_id   TEXT    REFERENCES subchapters (id) ON DELETE SET NULL,
  stem            TEXT    NOT NULL,
  stem_format     TEXT    NOT NULL DEFAULT 'plain'
                          CHECK (stem_format IN ('plain', 'markdown', 'latex')),

  -- Lifecycle. The reason the 23 mis-grading questions are excluded rather
  -- than deleted: a quarantined question is evidence of an authoring defect
  -- and the raw row is what an adjudicator needs to fix it.
  --   draft     -- authored or imported, not yet releasable
  --   published -- the ONLY status the delivery path may select
  --   flagged   -- known or suspected defect, withheld pending adjudication
  --   retired   -- deliberately removed from circulation, history preserved
  status          TEXT    NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'published', 'flagged', 'retired')),
  -- Machine-readable reason a question is not published. Mirrors the validator
  -- codes in scripts/validate-questions.mjs so the importer and the human
  -- reviewer speak the same vocabulary.
  status_reason   TEXT    CHECK (status_reason IS NULL OR status_reason IN (
                            'KEY_CONFLICT',      -- correct_option text and index disagree
                            'INDEX_RANGE',       -- correct_option_index past the last option
                            'OPTION_DUPLICATE',  -- two options carry identical text
                            -- More than one option is a true answer to the
                            -- stem. Not derivable by rule -- deciding it needs
                            -- subject knowledge -- so it arrives from a human
                            -- adjudication recorded in quarantine.json.
                            'OPTION_MULTIPLE_TRUE',
                            'OPTION_COUNT',      -- fewer than two usable options
                            'EMPTY_STEM',
                            -- Two questions share a stem but disagree on the
                            -- answer. Cross-row, so it cannot be a CHECK: the
                            -- importer derives it and the editor resolves it.
                            'DUPLICATE_ANSWER_CONFLICT',
                            'USER_REPORT',       -- a question_reports row was accepted
                            'DUPLICATE',         -- superseded by another question
                            'OUT_OF_SYLLABUS',
                            'EDITORIAL'
                          )),
  status_changed_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)

  difficulty      TEXT    CHECK (difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard')),
  -- Observed difficulty in basis points (0..10000) of correct answers, filled
  -- by the nightly job from user_question_stats. Separate from `difficulty`,
  -- which is an editorial judgement.
  p_value_bp      INTEGER CHECK (p_value_bp IS NULL OR p_value_bp BETWEEN 0 AND 10000),
  p_value_n       INTEGER NOT NULL DEFAULT 0,

  -- Positional-meaning guard. 'All of the above' and friends are nonsense
  -- anywhere but last; all 450 such options in the current bank sit in slot 4
  -- (measured after import). The delivery permuter must pin options flagged
  -- here. Computed by the importer, overridable by an editor.
  has_pinned_options INTEGER NOT NULL DEFAULT 0 CHECK (has_pinned_options IN (0, 1)),

  source          TEXT    NOT NULL DEFAULT 'book-import'
                          CHECK (source IN ('book-import', 'contributor', 'past-paper', 'generated')),
  source_ref      TEXT,                                    -- e.g. 'books/ch1.json#238'
  -- Old `{topicId}_{arrayIndex}` id. Import + one-time client migration only.
  -- Never read by the delivery path. Expected to be dropped after cutover.
  legacy_id       TEXT,
  -- Set when this question is replaced by an edited version, so the editor can
  -- show lineage and the SRS can retire the old card.
  superseded_by   TEXT    REFERENCES questions (id) ON DELETE SET NULL,
  created_by      TEXT    REFERENCES users (id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  updated_at      INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  CHECK (length(content_hash) = 64 AND content_hash GLOB '[0-9a-f]*'),
  CHECK (id = 'q_' || substr(content_hash, 1, 16)),
  CHECK (length(trim(stem)) > 0),
  -- A withheld question must say why it is withheld, or nobody can ever clear it.
  CHECK (status <> 'flagged' OR status_reason IS NOT NULL),
  CHECK (superseded_by IS NULL OR superseded_by <> id)
) STRICT;

-- NQ-40 import-dedupe: SELECT id FROM questions WHERE content_hash = ?.
-- Also the structural guarantee that two different questions cannot share the
-- 16-hex id prefix without the importer failing loudly.
CREATE UNIQUE INDEX uq_questions_content_hash ON questions (content_hash);

-- NQ-39 legacy-lookup: SELECT id FROM questions WHERE legacy_id = ? -- the
-- one-time localStorage bookmark/progress migration endpoint. Partial, because
-- contributor-authored questions have no legacy id and should not pay for it.
CREATE UNIQUE INDEX uq_questions_legacy_id ON questions (legacy_id)
  WHERE legacy_id IS NOT NULL;

-- NQ-07 practice-draw, the hottest query on the platform:
--   SELECT id FROM questions
--    WHERE chapter_id = ?1 AND status = 'published'
--    ORDER BY ... LIMIT ?2
-- Partial on status so the index holds only deliverable rows: it is both
-- smaller and impossible to use for an unpublished question. `id` is trailing
-- so the index is covering -- the draw never touches the table.
CREATE INDEX idx_questions_published_chapter
  ON questions (chapter_id, id) WHERE status = 'published';

-- NQ-08 practice-draw-subchapter: same query narrowed to one syllabus code.
CREATE INDEX idx_questions_published_subchapter
  ON questions (subchapter_id, id)
  WHERE status = 'published' AND subchapter_id IS NOT NULL;

-- NQ-38 moderation-queue: SELECT ... FROM questions
--        WHERE status IN ('draft','flagged') ORDER BY status_changed_at
--        -- the contributor/admin review list.
CREATE INDEX idx_questions_moderation
  ON questions (status, status_changed_at) WHERE status IN ('draft', 'flagged');

-- NQ-38b unclassified-queue: SELECT ... FROM questions
--        WHERE subchapter_id IS NULL AND chapter_id = ? -- the "assign a
--        syllabus code" workflow, which starts with all 2,290 imported rows.
CREATE INDEX idx_questions_unclassified
  ON questions (chapter_id, id) WHERE subchapter_id IS NULL;

-- ---------------------------------------------------------------------------
-- question_options: one row per option. Its own table, not a JSON array on
-- `questions`, for three reasons that all showed up in the existing data:
--
--   * An answer and an errata report must reference a stable option id. A JSON
--     array can only be referenced by index, which is the same positional bug
--     as `{topicId}_{arrayIndex}` one level down.
--   * Editing one option must not rewrite the others. A JSON blob is a single
--     value: fixing a typo in option 3 rewrites option 1, 2 and 4 too, so the
--     audit trail cannot tell which option actually changed and two editors
--     cannot touch one question without clobbering each other.
--   * 5 questions in the current bank have two options with identical text.
--     A UNIQUE index catches that at write time; a JSON array cannot.
--
-- ===========================================================================
-- OPTION IDENTITY, AND WHY THE ID DOES NOT CARRY THE AUTHORED SLOT
-- ===========================================================================
--
-- Option identity is `question_id || '#' || opt_key`, enforced by a CHECK so a
-- malformed id cannot be inserted. `opt_key` is 12 CSPRNG base32 characters,
-- minted once per option row and never changed.
--
-- IT USED TO BE `question_id || '#' || ordinal`, AND THAT WAS A REAL SECURITY
-- HOLE. The 2,290-question bank shipped as public JSON under
-- `frontend/public/data/books/` and is in git history permanently; each row
-- there publishes `correct_option_index`. With the ordinal readable straight
-- off the id, any option id that reached a client -- in a payload, a log, an
-- error message -- joined against that published index and recovered the
-- entire answer key with no database access at all. Per-attempt option
-- permutation is no defence against it, because the ordinal travels INSIDE the
-- id rather than as a position in the delivered array. Two independent reviews
-- of this backend found the same hole, which is a good sign it was not subtle.
--
-- A random discriminator closes it at the root: there is nothing in
-- `q_ab12cd34#7K3MQW9XZ2VB` to join against. The API still never delivers raw
-- option ids -- `lib/permute.ts#browseOptionRef` and the per-attempt refs in
-- `handlers/paper.ts` stay exactly as they are -- but those are now defence in
-- depth over a sound id scheme rather than the only thing standing between the
-- published JSON and the key.
--
-- WHAT THIS DOES NOT FIX, STATED PLAINLY. For the 2,290 questions already
-- published as JSON the key is IRRECOVERABLY PUBLIC: anyone who can read a
-- stem can look the answer up by its text, and no id scheme, permutation or
-- server-side measure changes that. What is fixed: no question authored from
-- now on has an exposed key, and a delivered paper cannot be graded by
-- position alone.
--
-- `ordinal` SURVIVES, as the authored slot and as the editorial identity:
-- assigned once and NEVER REUSED, so retiring option 3 and adding a
-- replacement gives the new one ordinal 5 and a historical answer that
-- selected option 3 can never be silently re-pointed at different text. It is
-- server-only -- it is in no view, no delivery query and no response body --
-- and `question_answer_keys.authored_index` is the only place the source
-- JSON's index is kept, which is the server-only table by construction.
--
-- Two UNIQUE indexes, because two different things reference an option:
--   (question_id, ordinal)  the authored-slot invariant, and the importer's
--                           upsert target -- a re-import must find the EXISTING
--                           row by its slot and keep its `opt_key`, or every
--                           re-run would mint new ids and orphan every answer.
--   (question_id, opt_key)  the parent side of attempt_answers' composite
--                           foreign key.
--
-- Display order is NOT this table's job. What a student sees is
-- `attempt_questions.option_order` (0004), permuted per attempt.
-- ---------------------------------------------------------------------------
CREATE TABLE question_options (
  id          TEXT    NOT NULL PRIMARY KEY,                -- 'q_abc123#7K3MQW9XZ2VB'
  question_id TEXT    NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  -- The authored slot, 1-based (literally the N in the source JSON's `optN`).
  -- SERVER-ONLY: never delivered, never in a view, never in a response.
  ordinal     INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 26),
  -- The id discriminator. 12 CSPRNG base32 characters (60 bits), carrying no
  -- information about the option at all -- in particular not its position.
  -- Fixed-length and charset-restricted so a bare ordinal ('3') cannot be
  -- smuggled in here and quietly restore the leak.
  opt_key     TEXT    NOT NULL,
  text        TEXT    NOT NULL,
  text_format TEXT    NOT NULL DEFAULT 'plain'
                      CHECK (text_format IN ('plain', 'markdown', 'latex')),
  -- Normalised text, generated. Backs the uniqueness check that catches the
  -- OPTION_DUPLICATE defect at write time instead of at grading time.
  text_norm   TEXT    GENERATED ALWAYS AS (lower(trim(text))) STORED,
  -- 1 for options whose meaning depends on being last ('All of the above',
  -- 'None of these', 'Both of the above'). The permuter must not move these.
  is_pinned   INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  -- Set instead of deleting, so no ordinal is ever freed for reuse.
  retired_at  INTEGER,                                            -- epoch ms (UTC)
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  updated_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  CHECK (length(opt_key) = 12 AND opt_key GLOB '[0-9A-Z]*'),
  CHECK (id = question_id || '#' || opt_key),
  CHECK (length(trim(text)) > 0)
) STRICT;

-- NQ-09 deliver-options: SELECT id, ordinal, text, is_pinned
--       FROM question_options WHERE question_id IN (...) AND retired_at IS NULL
--       ORDER BY question_id, ordinal.
-- Also the authored-slot invariant and the importer's upsert conflict target.
CREATE UNIQUE INDEX uq_question_options_question_ordinal
  ON question_options (question_id, ordinal);

-- The parent side of attempt_answers' composite foreign key (0004), which
-- requires a UNIQUE index on exactly these columns. It is also what proves the
-- `opt_key` space is collision-free within a question, so `id` and
-- `(question_id, opt_key)` are two spellings of the same identity.
CREATE UNIQUE INDEX uq_question_options_question_opt_key
  ON question_options (question_id, opt_key);

-- Catches OPTION_DUPLICATE at write time. Retired options are excluded so a
-- corrected option may reuse the text of the one it replaced.
CREATE UNIQUE INDEX uq_question_options_question_text
  ON question_options (question_id, text_norm) WHERE retired_at IS NULL;

-- ---------------------------------------------------------------------------
-- question_answer_keys  *** SERVER-ONLY. NEVER NAME THIS TABLE IN A HANDLER
-- ***                   *** THAT RESPONDS BEFORE AN ATTEMPT IS SUBMITTED. ***
--
-- The single source of truth for which option is correct. One row per
-- question, so the key is a 1:1 fact about the question rather than a property
-- smuggled inside the option rows.
--
-- The three queries allowed to read this table, and nothing else:
--
--   NQ-10 grade-one (answer submitted during an attempt; the response carries
--         only a boolean, never the key):
--           SELECT correct_option_id
--             FROM question_answer_keys
--            WHERE question_id = ?1;
--
--   NQ-10b grade-batch (attempt submit; one statement for the whole paper,
--          because D1 allows 50 queries per Worker invocation and a 100-question
--          mock graded one question at a time would need 100):
--           SELECT question_id, correct_option_id
--             FROM question_answer_keys
--            WHERE question_id IN (SELECT value FROM json_each(?1));
--
--   NQ-10c review-after-submit (the only client-visible path, and only for an
--          attempt that belongs to the caller and is already submitted):
--           SELECT aa.question_id, aa.selected_option_id, k.correct_option_id
--             FROM attempt_answers aa
--             JOIN question_answer_keys k ON k.question_id = aa.question_id
--            WHERE aa.attempt_id = ?1
--              AND EXISTS (SELECT 1 FROM attempts a
--                           WHERE a.id = ?1 AND a.user_id = ?2
--                             AND a.status = 'submitted');
--
-- The EXISTS clause is the authorisation. On a database with row-level
-- security that predicate would live in a policy; here it must be in the
-- query, every time, which is why it is written out above rather than left to
-- each handler to remember. worker/README.md carries the same text, and the
-- API's test suite should assert that no response body on a pre-submit route
-- ever contains an option id that is not in the delivered paper.
--
-- `authored_index` keeps the source JSON's 1-based `correct_option_index` so
-- an import can be re-verified against the file it came from without
-- re-deriving the mapping.
-- ---------------------------------------------------------------------------
CREATE TABLE question_answer_keys (
  question_id       TEXT    NOT NULL PRIMARY KEY REFERENCES questions (id) ON DELETE CASCADE,
  correct_option_id TEXT    NOT NULL REFERENCES question_options (id) ON DELETE CASCADE,
  -- 'import'       -- derived from the source JSON's correct_option_index
  -- 'adjudication' -- a human resolved a reported defect
  -- 'editor'       -- authored directly in the contributor tool
  source            TEXT    NOT NULL DEFAULT 'import'
                            CHECK (source IN ('import', 'editor', 'adjudication')),
  authored_index    INTEGER,                               -- source 1-based index, audit only
  authored_text     TEXT,                                  -- source `correct_option` string, audit only
  verified_by       TEXT    REFERENCES users (id) ON DELETE SET NULL,
  verified_at       INTEGER,                                      -- epoch ms (UTC)
  created_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  updated_at        INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  -- Structural proof that a key cannot point at another question's option.
  -- Option ids are `question_id || '#' || opt_key`, so same-question-ness is
  -- checkable with a prefix test and needs no composite foreign key. Without
  -- it, one bad UPDATE could make question A's key an option of question B and
  -- every grade for A would be silently wrong, with no error raised anywhere.
  CHECK (substr(correct_option_id, 1, length(question_id) + 1) = question_id || '#'),
  CHECK (verified_at IS NULL OR verified_by IS NOT NULL)
) STRICT;

-- ---------------------------------------------------------------------------
-- v_question_delivery: the shape the delivery path reads.
--
-- A view in SQLite is a macro, not a security boundary -- it grants nothing and
-- revokes nothing. Its value is that it is the shortest correct thing to
-- write, so the handler that reaches for the convenient option is reaching for
-- the safe one. It cannot reference question_answer_keys, so a `SELECT *` over
-- it is safe by construction.
-- ---------------------------------------------------------------------------
CREATE VIEW v_question_delivery AS
SELECT
  q.id            AS question_id,
  q.chapter_id    AS chapter_id,
  q.subchapter_id AS subchapter_id,
  q.stem          AS stem,
  q.stem_format   AS stem_format,
  q.difficulty    AS difficulty,
  o.id            AS option_id,
  o.ordinal       AS option_ordinal,
  o.text          AS option_text,
  o.text_format   AS option_text_format,
  o.is_pinned     AS option_is_pinned
FROM questions q
JOIN question_options o ON o.question_id = q.id AND o.retired_at IS NULL
WHERE q.status = 'published';

-- ---------------------------------------------------------------------------
-- explanations: why the answer is the answer. Separate from `questions`
-- because an explanation is long, is edited on a different cadence, has its
-- own author and review state, and must never be shipped with the question
-- before the student has answered.
-- ---------------------------------------------------------------------------
CREATE TABLE explanations (
  id             INTEGER NOT NULL PRIMARY KEY,
  question_id    TEXT    NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  body           TEXT    NOT NULL,
  body_format    TEXT    NOT NULL DEFAULT 'markdown'
                         CHECK (body_format IN ('plain', 'markdown', 'latex')),
  -- Optional pointer at the option this paragraph explains, so a distractor
  -- rationale ("why option 2 is tempting but wrong") can be attached.
  about_option_id TEXT    REFERENCES question_options (id) ON DELETE SET NULL,
  kind           TEXT    NOT NULL DEFAULT 'solution'
                         CHECK (kind IN ('solution', 'distractor', 'hint', 'reference')),
  is_primary     INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  status         TEXT    NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'published', 'rejected')),
  -- WHO WROTE IT, which is a different question from whether it is published.
  --
  -- `status` is the delivery gate; `origin` is the provenance, and the UI keys
  -- its "AI draft, unreviewed" badge off this column. The two are independent
  -- on purpose: a published ai_draft is shown to students *with* the badge,
  -- because an explanation that merely says "the correct answer is B" teaches
  -- nothing and a flagged draft is better than that. What is not acceptable is
  -- showing an unreviewed draft without saying so, or showing one mid-exam
  -- where a wrong explanation is worse than none at all -- see the delivery
  -- rule below the table.
  --
  --   ai_draft    generated, passed automated validation, no human has read it
  --   ai_reviewed generated, then read and accepted by a human
  --   human       written or substantially rewritten by a human
  origin         TEXT    NOT NULL DEFAULT 'human'
                         CHECK (origin IN ('ai_draft', 'ai_reviewed', 'human')),
  -- Generator provenance. Required for an AI origin and forbidden otherwise, so
  -- a draft can never lose the record of what produced it, and a human-written
  -- explanation can never carry a misleading model attribution. Needed to
  -- re-generate or invalidate a cohort when a prompt or model turns out bad.
  generator_model          TEXT,
  generator_prompt_version TEXT,
  generated_at             INTEGER,                               -- epoch ms (UTC)
  -- Model-reported confidence, 0..10000 basis points. Advisory only: it informs
  -- review order, and nothing gates delivery on it, because a model's own
  -- confidence is not evidence about a licensing exam answer.
  generator_confidence_bp  INTEGER CHECK (generator_confidence_bp IS NULL
                                          OR generator_confidence_bp BETWEEN 0 AND 10000),
  author_user_id TEXT    REFERENCES users (id) ON DELETE SET NULL,
  reviewed_by    TEXT    REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at    INTEGER,                                         -- epoch ms (UTC)
  created_at     INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  updated_at     INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  CHECK (about_option_id IS NULL
         OR substr(about_option_id, 1, length(question_id) + 1) = question_id || '#'),
  CHECK (length(trim(body)) > 0),
  CHECK (kind <> 'distractor' OR about_option_id IS NOT NULL),
  -- An AI origin must carry its generator record; a human one must not.
  CHECK (
    CASE WHEN origin IN ('ai_draft', 'ai_reviewed')
         THEN generator_model IS NOT NULL
              AND generator_prompt_version IS NOT NULL
              AND generated_at IS NOT NULL
         ELSE generator_model IS NULL
              AND generator_prompt_version IS NULL
              AND generated_at IS NULL
              AND generator_confidence_bp IS NULL
    END
  ),
  -- Accepting a draft is one transition, and it must be complete: an
  -- ai_reviewed row names its reviewer and when. Conversely nothing may claim a
  -- review it did not have.
  CHECK (
    CASE WHEN origin = 'ai_reviewed'
         THEN reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
         ELSE 1
    END
  ),
  CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
) STRICT;

-- NQ-12 explanation-for-question: SELECT ... FROM explanations
--       WHERE question_id = ? AND status = 'published'
--       ORDER BY is_primary DESC, id. Partial: drafts are never delivered.
CREATE INDEX idx_explanations_question_published
  ON explanations (question_id, is_primary DESC, id) WHERE status = 'published';

-- Exactly one primary published explanation per question, so the review screen
-- never has to pick between two.
CREATE UNIQUE INDEX uq_explanations_primary
  ON explanations (question_id) WHERE is_primary = 1 AND status = 'published';

-- NQ-12b explanation-review-queue: SELECT ... WHERE status = 'draft' ORDER BY id.
CREATE INDEX idx_explanations_draft ON explanations (id) WHERE status = 'draft';

-- NQ-12c unreviewed-published: the queue that actually matters. These rows ARE
-- being served to students, badged, with no human having read them -- so this
-- is the backlog to drain, ordered by the model's own least-confident first.
--   SELECT ... FROM explanations
--    WHERE origin = 'ai_draft' AND status = 'published'
--    ORDER BY generator_confidence_bp
CREATE INDEX idx_explanations_ai_draft_published
  ON explanations (generator_confidence_bp, question_id)
  WHERE origin = 'ai_draft' AND status = 'published';

-- ---------------------------------------------------------------------------
-- DELIVERY RULE for explanations, which the API must enforce rather than
-- leaving to each caller:
--
--   practice / post-exam review -> status = 'published', any origin.
--                                  Send `origin` on the wire so the client can
--                                  badge an ai_draft. A client that drops the
--                                  field shows an unlabelled draft, so the
--                                  field is not optional in the response type.
--
--   during a timed mock test    -> never. Not even a published human one: the
--                                  explanation names the answer. The mock
--                                  delivery view cannot reach this table at
--                                  all, which is why the answer key lives in
--                                  question_answer_keys and not here.
--
--   status = 'draft'            -> never delivered, any origin. This is the
--                                  pre-validation state.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- tags + question_tags: cross-cutting labels (concepts, past-paper years,
-- skills). Orthogonal to the syllabus tree, which is strictly hierarchical and
-- cannot express "this question needs Karnaugh maps AND two's complement".
-- ---------------------------------------------------------------------------
CREATE TABLE tags (
  id          TEXT    NOT NULL PRIMARY KEY,                -- slug: 'karnaugh-map'
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'concept'
                      CHECK (kind IN ('concept', 'skill', 'exam_year', 'source', 'formula')),
  description TEXT,
  question_count INTEGER NOT NULL DEFAULT 0,               -- maintained by trigger in 0005
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  CHECK (id GLOB '[a-z0-9-]*')
) STRICT;

CREATE INDEX idx_tags_kind_name ON tags (kind, name);      -- NQ-13b tag-picker

CREATE TABLE question_tags (
  question_id TEXT    NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  tag_id      TEXT    NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  -- 0..100. Below 100 means a classifier proposed it and no human confirmed.
  confidence  INTEGER NOT NULL DEFAULT 100 CHECK (confidence BETWEEN 0 AND 100),
  added_by    TEXT    REFERENCES users (id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  PRIMARY KEY (question_id, tag_id)
) STRICT;

-- NQ-14 questions-for-tag: SELECT question_id FROM question_tags
--       WHERE tag_id = ? -- "practise everything tagged Karnaugh maps".
-- The primary key already covers NQ-13 tags-for-question.
CREATE INDEX idx_question_tags_tag ON question_tags (tag_id, question_id);

-- ---------------------------------------------------------------------------
-- question_reports: user-reported errata, and the importer's own findings.
--
-- One table for both, because they are the same object: a claim that a
-- question is defective, awaiting adjudication. The importer files its
-- validator findings here with source='validator', which means the 23
-- quarantined questions arrive with their evidence attached rather than as a
-- hand-maintained JSON list whose ids go stale the moment the bank is
-- reordered -- which is exactly what happened to
-- frontend/src/data/quarantine.json.
-- ---------------------------------------------------------------------------
CREATE TABLE question_reports (
  id                  INTEGER NOT NULL PRIMARY KEY,
  public_id           TEXT    NOT NULL,                    -- ULID, for the URL
  question_id         TEXT    NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  -- NULL for validator/import findings: no human reported them.
  reporter_user_id    TEXT    REFERENCES users (id) ON DELETE SET NULL,
  source              TEXT    NOT NULL DEFAULT 'user'
                              CHECK (source IN ('user', 'validator', 'import', 'admin')),
  category            TEXT    NOT NULL
                              CHECK (category IN ('wrong_answer', 'typo', 'ambiguous',
                                                  'duplicate', 'out_of_syllabus',
                                                  'bad_option', 'other')),
  -- Validator code when source <> 'user'. Same vocabulary as
  -- questions.status_reason.
  code                TEXT    CHECK (code IS NULL OR code IN (
                                'KEY_CONFLICT', 'INDEX_RANGE', 'OPTION_DUPLICATE',
                                'OPTION_COUNT', 'EMPTY_STEM',
                                'DUPLICATE_ANSWER_CONFLICT',
                                'OPTION_MULTIPLE_TRUE')),
  detail              TEXT,
  -- What the reporter thinks the answer should be. Belongs here, not in
  -- question_answer_keys: an unadjudicated claim must not sit in the table the
  -- grader reads.
  suggested_option_id TEXT    REFERENCES question_options (id) ON DELETE SET NULL,
  -- Which attempt the student was in when they reported it. A deliberately
  -- unenforced soft reference to attempts.id: a report must outlive the
  -- attempt rows that archival deletes (0004), so a hard FK would either block
  -- archival or cascade the evidence away.
  attempt_id          INTEGER,
  status              TEXT    NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'triaged', 'accepted', 'rejected', 'duplicate')),
  resolution          TEXT,
  resolved_by         TEXT    REFERENCES users (id) ON DELETE SET NULL,
  resolved_at         INTEGER,                                    -- epoch ms (UTC)
  created_at          INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  updated_at          INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)), -- epoch ms (UTC)
  CHECK (suggested_option_id IS NULL
         OR substr(suggested_option_id, 1, length(question_id) + 1) = question_id || '#'),
  CHECK (resolved_at IS NULL OR status IN ('accepted', 'rejected', 'duplicate')),
  -- A machine finding has no human reporter. Keeps the triage inbox honest
  -- about which rows a person is waiting on an answer for.
  CHECK (source NOT IN ('validator', 'import') OR reporter_user_id IS NULL)
) STRICT;

CREATE UNIQUE INDEX uq_question_reports_public_id ON question_reports (public_id);

-- NQ-15 report-triage-queue: SELECT ... FROM question_reports
--       WHERE status = 'open' ORDER BY created_at -- the moderation inbox.
CREATE INDEX idx_question_reports_open ON question_reports (created_at)
  WHERE status = 'open';

-- NQ-16 reports-for-question: SELECT ... WHERE question_id = ? ORDER BY id DESC
--       -- shown next to the question in the editor, and used to decide
--       whether an incoming report is the fifth of its kind.
CREATE INDEX idx_question_reports_question ON question_reports (question_id, id DESC);

-- NQ-17 report-dedupe: one open report per user per question, enforced rather
-- than checked, so a frustrated student tapping the button five times does not
-- create five rows in the triage queue.
CREATE UNIQUE INDEX uq_question_reports_open_by_reporter
  ON question_reports (question_id, reporter_user_id)
  WHERE status = 'open' AND reporter_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- content_versions: append-only audit trail for everything in this file.
--
-- A single table rather than one per entity, because the reader is always the
-- same ("show me the history of this thing") and SQLite has no partitioning to
-- gain from splitting it. `snapshot_json` is the full post-change state --
-- storage is cheap relative to the cost of not being able to answer "what did
-- this question say when the student answered it", which is the question an
-- errata dispute always turns into.
-- ---------------------------------------------------------------------------
CREATE TABLE content_versions (
  id             INTEGER NOT NULL PRIMARY KEY,
  entity_type    TEXT    NOT NULL
                         CHECK (entity_type IN ('question', 'question_option',
                                                'question_answer_key', 'explanation',
                                                'chapter', 'subchapter', 'tag',
                                                'mock_test_template')),
  entity_id      TEXT    NOT NULL,
  version        INTEGER NOT NULL CHECK (version > 0),
  op             TEXT    NOT NULL
                         CHECK (op IN ('create', 'update', 'delete', 'status_change')),
  snapshot_json  TEXT    NOT NULL CHECK (json_valid(snapshot_json)),
  -- Null for 'create'. A field-level diff, so the history list can say
  -- "stem changed" without the reader diffing two snapshots.
  diff_json      TEXT    CHECK (diff_json IS NULL OR json_valid(diff_json)),
  actor_user_id  TEXT    REFERENCES users (id) ON DELETE SET NULL,
  actor_kind     TEXT    NOT NULL DEFAULT 'user'
                         CHECK (actor_kind IN ('user', 'importer', 'validator', 'system')),
  reason         TEXT,
  created_at     INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) -- epoch ms (UTC)
) STRICT;

-- NQ-18 content-history: SELECT ... FROM content_versions
--       WHERE entity_type = ? AND entity_id = ? ORDER BY version DESC.
-- Unique, so a concurrent double-write cannot produce two version 7s.
CREATE UNIQUE INDEX uq_content_versions_entity_version
  ON content_versions (entity_type, entity_id, version);

-- NQ-18b content-activity-feed: SELECT ... WHERE actor_user_id = ?
--        ORDER BY id DESC -- the contributor's own contribution list.
CREATE INDEX idx_content_versions_actor ON content_versions (actor_user_id, id DESC);
