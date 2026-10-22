-- ===========================================================================
-- 0010_exam_duration.sql
--
-- Correct the mock-test durations to the exam format the project owner
-- confirmed: 100 questions x 1 mark, 120 MINUTES, pass mark 50.
--
-- WHAT WENT WRONG
-- ---------------
-- `db/seed/generate-reference-sql.mjs` carried the durations as literals --
-- 45 and 20 -- copied from `frontend/src/data/topics.ts` back when that file
-- also held literals. `examBlueprint.ts` later became the single source of
-- truth and was confirmed at 120 minutes; `topics.ts` was changed to derive
-- from it and the generator was not.
--
-- So 0007 seeded, and this database served, templates claiming 100 questions
-- in 45 minutes while the client's own clock said 120. That is not a cosmetic
-- disagreement: `attempts.deadline_at` is computed server-side from
-- `duration_minutes` and the submit path clamps against it
-- (`src/domain/expiry.ts`). The server owns the deadline, so the server would
-- have won, and every candidate would have been cut off 75 minutes early in
-- what is meant to be a full-length rehearsal of a licence exam.
--
-- `pass_mark_bp` was already 5000 and `total_questions` already 100; only the
-- duration was wrong.
--
-- THE FIX IS IN TWO PLACES, DELIBERATELY
-- --------------------------------------
--   * The generator now DERIVES the duration via `readConfirmed(
--     examFormat.durationMinutes)`, so a fresh database gets 120 from 0007 and
--     a future change that un-confirms the value fails the generator instead
--     of silently seeding a guess.
--   * This migration repairs databases where 0007 has already been applied.
--     Editing 0007 alone would fix new deployments and leave the live one
--     wrong, which is the worse half of the problem.
--
-- Running it on a database that already has the right values is a no-op, which
-- is why it is written as a plain UPDATE with no guard.
--
-- The quick test is pro-rata on question count -- 50 questions, so half the
-- time -- matching the arithmetic in `topics.ts` and in the generator.
-- ===========================================================================

UPDATE mock_test_templates
   SET duration_minutes = 120,
       updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
 WHERE id IN ('full-mock-1', 'full-mock-2')
   AND duration_minutes <> 120;

UPDATE mock_test_templates
   SET duration_minutes = 60,
       updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
 WHERE id = 'quick-test'
   AND duration_minutes <> 60;
