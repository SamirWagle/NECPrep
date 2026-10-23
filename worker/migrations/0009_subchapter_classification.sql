-- ===========================================================================
-- 0009_subchapter_classification.sql
--
-- Make `questions.subchapter_id` fillable without losing the fact that most
-- of it was DERIVED rather than decided by a person.
--
-- THE PROBLEM THIS SOLVES
-- -----------------------
-- 0002 set out the honest position: "NULL until a contributor classifies it.
-- The importer never guesses." Nobody ever classified anything, so the column
-- is NULL for all 2,312 rows, and the consequences are not cosmetic:
--
--   * All 60 sub-chapter blueprint rules in `domain/blueprint.ts` fall back to
--     chapter-level sampling, so a "Transport Layer" practice set is really a
--     "chapter 5" practice set.
--   * `user_question_stats.subchapter_id` is NULL on every rollup row, so
--     per-sub-chapter mastery cannot be computed at all.
--
-- A deterministic classifier now exists (`frontend/src/services/
-- subchapterClassifier.ts`): it matches discriminating vocabulary within the
-- question's already-known chapter, and declines when two sub-chapters tie.
-- It labels about two thirds of the bank and refuses the rest.
--
-- WHY PROVENANCE COLUMNS AND NOT JUST THE ID
-- ------------------------------------------
-- A classifier label is a good guess, not a fact, and writing it into
-- `subchapter_id` alone would make it indistinguishable from a librarian's
-- decision a year from now. That is the same mistake `explanations.origin`
-- exists to prevent, so this follows the same shape: the label carries its
-- source, its confidence and the classifier version that produced it.
--
-- What that buys:
--   * A reviewer can list the weakest labels first and fix those.
--   * Re-running a better classifier can overwrite `heuristic` rows while
--     leaving every `human` row untouched.
--   * The delivery path can require `human` for anything high-stakes and
--     accept `heuristic` for practice, as a policy decision rather than an
--     accident.
--
-- SQLite's ALTER TABLE ADD COLUMN cannot add table-level CHECKs, and
-- rebuilding `questions` would mean recreating every dependent index, trigger
-- and foreign key for the sake of three columns. So the single-column
-- constraints are CHECKs and the cross-column invariants are triggers, which
-- 0003 and 0005 already use.
-- ===========================================================================

-- How the label was arrived at.
--   human     -- a person classified this question. Authoritative.
--   heuristic -- derived by the term-matching classifier. A hint.
ALTER TABLE questions ADD COLUMN subchapter_source TEXT
  CONSTRAINT questions_subchapter_source
  CHECK (subchapter_source IS NULL OR subchapter_source IN ('human', 'heuristic'));

-- Classifier confidence in basis points, 0-10000. NULL for human labels,
-- where confidence is not a meaningful quantity. Basis points rather than a
-- float, matching `explanations.generator_confidence_bp`.
ALTER TABLE questions ADD COLUMN subchapter_confidence_bp INTEGER
  CONSTRAINT questions_subchapter_confidence_bp
  CHECK (subchapter_confidence_bp IS NULL
         OR subchapter_confidence_bp BETWEEN 0 AND 10000);

-- Which classifier produced a heuristic label, so a change in the term lists
-- or the thresholds is visible as a version bump and the affected rows can be
-- found and re-run. Term lists are a maintained artefact, not a constant.
ALTER TABLE questions ADD COLUMN subchapter_classifier_version TEXT;

-- ---------------------------------------------------------------------------
-- Invariants.
--
-- Three rules, each enforced on INSERT and on UPDATE because a row can reach
-- an invalid state either way:
--
--   1. No provenance without a label. If `subchapter_id` is NULL, all three
--      new columns must be NULL -- otherwise a cleared label leaves orphaned
--      confidence behind, which reads as though the row were still classified.
--   2. A labelled row must say where the label came from.
--   3. `heuristic` requires a confidence and a version; `human` must carry
--      neither. A human label with a confidence number is the tell that some
--      code path wrote a guess and called it a decision.
-- ---------------------------------------------------------------------------

CREATE TRIGGER questions_subchapter_provenance_bi
BEFORE INSERT ON questions
WHEN
  (NEW.subchapter_id IS NULL AND (NEW.subchapter_source IS NOT NULL
                                  OR NEW.subchapter_confidence_bp IS NOT NULL
                                  OR NEW.subchapter_classifier_version IS NOT NULL))
  OR (NEW.subchapter_id IS NOT NULL AND NEW.subchapter_source IS NULL)
  OR (NEW.subchapter_source = 'heuristic' AND (NEW.subchapter_confidence_bp IS NULL
                                               OR NEW.subchapter_classifier_version IS NULL))
  OR (NEW.subchapter_source = 'human' AND (NEW.subchapter_confidence_bp IS NOT NULL
                                           OR NEW.subchapter_classifier_version IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'questions: subchapter label and its provenance disagree');
END;

CREATE TRIGGER questions_subchapter_provenance_bu
BEFORE UPDATE ON questions
WHEN
  (NEW.subchapter_id IS NULL AND (NEW.subchapter_source IS NOT NULL
                                  OR NEW.subchapter_confidence_bp IS NOT NULL
                                  OR NEW.subchapter_classifier_version IS NOT NULL))
  OR (NEW.subchapter_id IS NOT NULL AND NEW.subchapter_source IS NULL)
  OR (NEW.subchapter_source = 'heuristic' AND (NEW.subchapter_confidence_bp IS NULL
                                               OR NEW.subchapter_classifier_version IS NULL))
  OR (NEW.subchapter_source = 'human' AND (NEW.subchapter_confidence_bp IS NOT NULL
                                           OR NEW.subchapter_classifier_version IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'questions: subchapter label and its provenance disagree');
END;

-- A human decision must never be silently replaced by a later classifier run.
-- The importer is written to respect this, but the importer is not the only
-- thing that will ever touch these rows.
CREATE TRIGGER questions_subchapter_human_label_is_final
BEFORE UPDATE OF subchapter_id, subchapter_source ON questions
WHEN OLD.subchapter_source = 'human' AND NEW.subchapter_source = 'heuristic'
BEGIN
  SELECT RAISE(ABORT, 'questions: a heuristic label may not overwrite a human one');
END;

-- ---------------------------------------------------------------------------
-- The review queue: weakest heuristic labels first.
--
-- Partial, because the rows worth reviewing are a minority and will shrink as
-- they are confirmed -- there is no reason to carry the whole bank in this
-- index.
-- ---------------------------------------------------------------------------
-- Blueprint sampling needs no new index: `idx_questions_published_subchapter`
-- from 0002 already covers (subchapter_id, id) WHERE published AND NOT NULL,
-- and it has been waiting for a non-NULL column to be useful.
-- Ascending is SQLite's default and is what the review queue wants (weakest
-- label first); it is left implicit because Drizzle cannot emit an explicit
-- ASC and `db:verify` compares the two key lists literally.
CREATE INDEX idx_questions_subchapter_review
  ON questions (subchapter_confidence_bp, chapter_id)
  WHERE subchapter_source = 'heuristic';
