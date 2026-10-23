/**
 * Progress, streaks, bookmarks and spaced repetition.
 *
 * ===========================================================================
 * THE ROLLUPS ARE MAINTAINED BY TRIGGERS, NOT BY THIS FILE
 * ===========================================================================
 *
 * `user_question_stats` and `attempts.answered_count`/`correct_count` are
 * maintained by the triggers in `migrations/0005_learning.sql`, which fire on
 * `attempt_answers`. This file used to hand-write three upsert statements for
 * the same job. The triggers are better for a reason specific to this platform:
 * D1 allows 50 queries per Worker invocation, and work done inside a trigger
 * belongs to the statement that fired it and does NOT count against that
 * budget. Three statements per submission became zero, and -- more
 * importantly -- the rollup can no longer drift from the answer log, because
 * there is no code path that writes one without the other.
 *
 * WHAT IS LEFT HERE is the state a trigger cannot maintain, and in each case
 * the reason is the same: it needs something SQLite does not know.
 *
 *   `streaks`         needs the user's LOCAL calendar day. Nepal is UTC+05:45,
 *                     so a UTC-keyed day boundary breaks the streak of anyone
 *                     studying after 18:15 local -- which is most of them.
 *                     SQLite's date functions know UTC and fixed offsets, not
 *                     timezones, so the API resolves the day and passes it in.
 *   `study_sessions`  same reason, plus a session is wall-clock engagement and
 *                     spans several attempts or none.
 *   `srs_state`       needs the scheduler, and FSRS needs `pow`/`exp`, which
 *                     are a compile-time option SQLite and D1 do not guarantee.
 *
 * THERE IS NO DELETE TRIGGER ON `attempt_answers` AND THERE MUST NEVER BE.
 * Archival deletes millions of answer rows; a delete trigger that decremented
 * these counters would erase every student's entire progress history the first
 * night the retention job ran. `db/smoke.mjs` asserts the trigger's absence.
 *
 * Every statement builder here takes `userId` and puts it in the row. D1 has no
 * row-level security, so there is no safety net below this line.
 */

import { Db, sql } from './d1.ts';
import type { PendingStatement } from './d1.ts';
import { T } from './tables.ts';
import { dayKey, DAY } from '../lib/time.ts';
import { newId } from '../lib/ids.ts';
import { newCard, review as reviewCard, RATING_BY_GRADE, STATE_CODE, stateFromCode } from '../domain/srs.ts';
import type { CardState } from '../domain/srs.ts';
import type {
  BookmarkItem,
  ChapterProgress,
  ProgressStats,
  SrsCardState,
  SrsGrade,
} from '../shared/types.ts';
import type { ActivityDay } from '../domain/streaks.ts';

/** One scored answer, as fed to the rollup statements. */
export interface RollupAnswer {
  questionId: string;
  chapterId: string;
  isCorrect: boolean;
  /** `false` for a skipped question; skips do not count as attempts. */
  answered: boolean;
}

function rollupPayload(answers: readonly RollupAnswer[]): string {
  return JSON.stringify(
    answers
      .filter((a) => a.answered)
      .map((a) => ({
        q: a.questionId,
        c: a.chapterId,
        k: a.isCorrect ? 1 : 0,
      })),
  );
}

// --- Submission guard -------------------------------------------------------

/**
 * A SQL predicate that is true only while a given attempt is still in progress
 * (or, for practice, only while a question is still unanswered).
 *
 * Every conditional statement in a write batch carries it, and the statement
 * whose `changes` is the decision runs LAST. A duplicate submission that
 * arrives after the first one committed therefore finds the predicate false,
 * writes nothing, and reports zero changes -- which the handler turns into a
 * replay of the stored result rather than a second score.
 *
 * This is the whole concurrency story for submit, and it needs no transaction,
 * which matters because D1 has none.
 *
 * `fragment(startIndex)` renders the predicate with explicitly numbered
 * placeholders starting at `startIndex`, because D1 binds `?n` positionally and
 * a hardcoded high number like `?90` would demand ninety bound values.
 */
export interface SubmissionGuard {
  fragment(startIndex: number): string;
  binds: readonly (string | number)[];
}

/** True while this attempt is in progress and owned by this user. */
export function attemptGuard(attemptId: number, userId: string): SubmissionGuard {
  return {
    fragment: (start) =>
      `EXISTS (SELECT 1 FROM ${T.attempts} a
                WHERE a.id = ?${start}
                  AND a.user_id = ?${start + 1}
                  AND a.status = 'in_progress')`,
    binds: [attemptId, userId],
  };
}

/** True while this question has no answer recorded in this attempt. */
export function unansweredGuard(attemptId: number, questionId: string): SubmissionGuard {
  return {
    fragment: (start) =>
      `NOT EXISTS (SELECT 1 FROM ${T.attemptAnswers}
                    WHERE attempt_id = ?${start} AND question_id = ?${start + 1})`,
    binds: [attemptId, questionId],
  };
}

/** No guard, for call sites where the caller has already serialised the write. */
export const UNGUARDED: SubmissionGuard = { fragment: () => '1 = 1', binds: [] };

// --- Streaks ----------------------------------------------------------------

/**
 * NQ-32a streak-touch. ONE statement, idempotent per local day.
 *
 * Called on every answer, so it must move the streak AT MOST ONCE per calendar
 * day or a double-submit would inflate it. `localDate` is 'YYYY-MM-DD' in the
 * candidate's timezone, resolved by the API -- see the note at the top of this
 * file for why SQLite cannot do it.
 *
 * `longest_length` is deliberately NOT set here. The obvious hand-written
 * version is wrong: inside an UPDATE, `longest_length = max(longest_length,
 * current_length)` reads the OLD `current_length` and so lags a day behind the
 * streak it is supposed to record. The `streaks_longest_ratchet` trigger owns
 * it instead.
 *
 * The trailing `WHERE last_active_date IS NULL OR last_active_date <= ?2` stops
 * a stale request -- a drained offline outbox entry from yesterday -- from
 * moving the streak backwards.
 */
export function touchStreakStatement(args: {
  userId: string;
  now: number;
  guard: SubmissionGuard;
}): PendingStatement {
  return sql(
    `INSERT INTO ${T.streaks} (user_id, current_length, last_active_date,
                               total_active_days, updated_at)
     SELECT ?1, 1, ?2, 1, ?3
      WHERE ${args.guard.fragment(4)}
     ON CONFLICT (user_id) DO UPDATE SET
       current_length = CASE
         WHEN last_active_date = ?2                     THEN current_length
         WHEN last_active_date = date(?2, '-1 day')     THEN current_length + 1
         WHEN freezes_available > 0
              AND last_active_date = date(?2, '-2 day') THEN current_length + 1
         ELSE 1 END,
       freezes_available = CASE
         WHEN last_active_date = date(?2, '-2 day') AND freezes_available > 0
              THEN freezes_available - 1 ELSE freezes_available END,
       total_active_days = total_active_days
         + CASE WHEN last_active_date IS NULL OR last_active_date <> ?2
                THEN 1 ELSE 0 END,
       last_active_date  = ?2,
       updated_at        = ?3
      WHERE last_active_date IS NULL OR last_active_date <= ?2`,
    args.userId,
    dayKey(args.now),
    args.now,
    ...args.guard.binds,
  );
}

export interface StreakRow {
  current_length: number;
  longest_length: number;
  last_active_date: string | null;
  total_active_days: number;
}

/** 1 query. `null` for a user who has never answered anything. */
export async function readStreak(db: Db, userId: string): Promise<StreakRow | null> {
  return await db.first<StreakRow>(
    `SELECT current_length, longest_length, last_active_date, total_active_days
       FROM ${T.streaks} WHERE user_id = ?1`,
    userId,
  );
}

// --- Study sessions ---------------------------------------------------------

/**
 * Attempt mode -> `study_sessions.kind`. The two enums are not the same shape
 * and should not be: an attempt has five modes, a session has five kinds, and
 * 'bookmark_review' and 'weak_areas' are both 'review' as far as wall-clock
 * engagement is concerned.
 */
export function studyKindForMode(mode: string): string {
  switch (mode) {
    case 'mock':
      return 'mock';
    case 'srs':
      return 'srs';
    case 'practice':
      return 'practice';
    default:
      return 'review';
  }
}

/**
 * Opens the wall-clock session for an attempt. One statement, in the attempt's
 * own start batch.
 *
 * `local_date` is the calendar day in the candidate's timezone and is what the
 * activity heatmap groups by (NQ-31b, a covering index-only scan). It is
 * written here rather than generated because a generated column would have to
 * assume UTC and would misattribute every late-night session in Kathmandu to
 * the wrong day -- which is exactly the bug that breaks a streak.
 */
export function createStudySessionStatement(args: {
  userId: string;
  /** The attempt's ULID. The numeric id does not exist until it is inserted. */
  attemptPublicId: string;
  mode: string;
  chapterId: string | null;
  now: number;
}): PendingStatement {
  return sql(
    // `SELECT ... FROM attempts` rather than `VALUES`, so this can ride in the
    // same batch as the attempt's own INSERT: the numeric rowid is not known
    // until that statement runs, and resolving it here keeps the whole start
    // path to one round trip. The `user_id` predicate is not decoration -- it
    // is what stops a public_id collision from attaching a session to someone
    // else's attempt.
    `INSERT INTO ${T.studySessions}
       (public_id, user_id, kind, chapter_id, subchapter_id, attempt_id,
        started_at, ended_at, questions_seen, questions_correct, local_date)
     SELECT ?1, ?2, ?3, ?4, NULL, a.id, ?5, NULL, 0, 0, ?6
       FROM ${T.attempts} a
      WHERE a.public_id = ?7 AND a.user_id = ?2`,
    newId('stu'),
    args.userId,
    studyKindForMode(args.mode),
    args.chapterId,
    args.now,
    dayKey(args.now),
    args.attemptPublicId,
  );
}

/**
 * Credits one answered question to the open session. Guarded, so a replayed
 * answer does not inflate the heatmap.
 *
 * Scoped by `user_id` as well as `attempt_id` -- `study_sessions` has no index
 * on `attempt_id` on purpose (it is written in bulk and read by user and day),
 * so this is a short range scan over one user's sessions rather than a table
 * scan. One user accumulates a few hundred a year, which is bounded by human
 * stamina rather than by anything unbounded.
 */
export function bumpStudySessionStatement(args: {
  userId: string;
  attemptId: number;
  isCorrect: boolean;
  guard: SubmissionGuard;
}): PendingStatement {
  return sql(
    `UPDATE ${T.studySessions}
        SET questions_seen = questions_seen + 1,
            questions_correct = questions_correct + ?3
      WHERE attempt_id = ?1 AND user_id = ?2 AND ended_at IS NULL
        AND ${args.guard.fragment(4)}`,
    args.attemptId,
    args.userId,
    args.isCorrect ? 1 : 0,
    ...args.guard.binds,
  );
}

/** Closes the session, stamping the totals the attempt actually reached. */
export function closeStudySessionStatement(args: {
  userId: string;
  attemptId: number;
  answered: number;
  correct: number;
  now: number;
}): PendingStatement {
  return sql(
    `UPDATE ${T.studySessions}
        SET ended_at = ?3,
            questions_seen = MAX(questions_seen, ?4),
            questions_correct = MAX(questions_correct, ?5)
      WHERE attempt_id = ?1 AND user_id = ?2 AND ended_at IS NULL`,
    args.attemptId,
    args.userId,
    args.now,
    args.answered,
    args.correct,
  );
}

// --- Spaced repetition, from answers ---------------------------------------

/**
 * Feeds the schedule from the answers themselves. ONE statement for the whole
 * paper.
 *
 * The arithmetic is deliberately cruder than `domain/srs.ts`, which runs on an
 * explicitly graded review: doing it properly for 100 questions at once would
 * mean reading 100 cards first to get each card's difficulty, and the query
 * budget does not allow a hundred reads. Correct doubles the interval (capped
 * at a year) and nudges difficulty down; wrong resets it to tomorrow, counts a
 * lapse and nudges difficulty up.
 *
 * `excluded.lapses` carries the correctness bit into the conflict branch -- 0
 * for a correct answer, 1 for a wrong one -- which is the only way to branch on
 * the new row's values inside an upsert. `stability` tracks `scheduled_days`
 * because an SM-2 interval IS its stability estimate; a real FSRS fit would
 * separate them and that is a change to this statement and `domain/srs.ts`,
 * not to the schema.
 *
 * Every CHECK on `srs_state` is respected by construction: `reps` starts at 1
 * with `last_review` set (so `reps = 0 OR last_review IS NOT NULL` holds),
 * `lapses` rises by at most 1 per review alongside `reps` (so
 * `lapses <= reps` holds), and `difficulty` is clamped to 1..10 in SQL.
 */
export function upsertSrsFromAnswersStatement(args: {
  userId: string;
  answers: readonly RollupAnswer[];
  now: number;
  guard: SubmissionGuard;
}): PendingStatement {
  const nextScheduled =
    `CASE WHEN excluded.lapses = 0
          THEN MIN(MAX(${T.srsState}.scheduled_days, 1.0) * 2.0, 365.0)
          ELSE 1.0 END`;

  return sql(
    `INSERT INTO ${T.srsState}
       (user_id, question_id, stability, difficulty, elapsed_days, scheduled_days,
        reps, lapses, state, due, last_review, last_rating, created_at, updated_at)
     SELECT ?2,
            json_extract(j.value, '$.q'),
            CASE WHEN json_extract(j.value, '$.k') = 1 THEN 3.0 ELSE 1.0 END,
            CASE WHEN json_extract(j.value, '$.k') = 1 THEN 4.8 ELSE 5.8 END,
            0.0,
            CASE WHEN json_extract(j.value, '$.k') = 1 THEN 3.0 ELSE 1.0 END,
            1,
            CASE WHEN json_extract(j.value, '$.k') = 1 THEN 0 ELSE 1 END,
            CASE WHEN json_extract(j.value, '$.k') = 1 THEN 2 ELSE 3 END,
            ?3 + (CASE WHEN json_extract(j.value, '$.k') = 1 THEN 3 ELSE 1 END) * ?4,
            ?3,
            CASE WHEN json_extract(j.value, '$.k') = 1 THEN 3 ELSE 1 END,
            ?3, ?3
       FROM json_each(?1) j
      WHERE ${args.guard.fragment(5)}
     ON CONFLICT (user_id, question_id) DO UPDATE SET
       scheduled_days = ${nextScheduled},
       stability      = ${nextScheduled},
       elapsed_days   = MAX(0.0, (?3 - COALESCE(${T.srsState}.last_review, ?3)) / 86400000.0),
       difficulty     = MIN(10.0, MAX(1.0,
                          ${T.srsState}.difficulty
                          + CASE WHEN excluded.lapses = 0 THEN -0.2 ELSE 0.8 END)),
       due            = ?3 + (${nextScheduled}) * ?4,
       lapses         = ${T.srsState}.lapses + excluded.lapses,
       reps           = ${T.srsState}.reps + 1,
       state          = CASE WHEN excluded.lapses = 0 THEN 2 ELSE 3 END,
       last_review    = ?3,
       last_rating    = CASE WHEN excluded.lapses = 0 THEN 3 ELSE 1 END,
       updated_at     = ?3`,
    rollupPayload(args.answers),
    args.userId,
    args.now,
    DAY,
    ...args.guard.binds,
  );
}

// --- Reads ------------------------------------------------------------------

/**
 * NQ-27 progress-page. 1 query.
 *
 * ONE index range scan over `user_question_stats`, grouped by its DENORMALISED
 * `chapter_id` -- which the rollup trigger stamps precisely so this read needs
 * no join to `questions`. The alternative, aggregating a user's rows in
 * `attempt_answers`, grows without bound and stops working entirely once
 * archival deletes those rows.
 *
 * The chapter list is the outer side so a chapter with no activity still
 * reports its question count, and `question_count` is the same correlated
 * COUNT as `listChapters` for the same reason.
 */
export async function readProgressStats(db: Db, userId: string): Promise<ProgressStats> {
  const rows = await db.all<{
    chapter_id: string;
    question_count: number;
    attempted: number;
    correct: number;
  }>(
    `SELECT c.id AS chapter_id,
            (SELECT COUNT(*) FROM ${T.questions} q
              WHERE q.chapter_id = c.id AND q.status = 'published') AS question_count,
            COALESCE(s.attempted, 0) AS attempted,
            COALESCE(s.correct, 0) AS correct
       FROM ${T.chapters} c
       LEFT JOIN (
         SELECT chapter_id,
                SUM(answer_count)  AS attempted,
                SUM(correct_count) AS correct
           FROM ${T.userQuestionStats}
          WHERE user_id = ?1
          GROUP BY chapter_id
       ) s ON s.chapter_id = c.id
      WHERE c.status = 'published'
      ORDER BY c.ordinal, c.slug`,
    userId,
  );

  const chapters: ChapterProgress[] = rows.map((r) => ({
    chapterId: r.chapter_id,
    attempted: r.attempted,
    correct: r.correct,
    accuracyPct: r.attempted === 0 ? 0 : Math.round((r.correct / r.attempted) * 100),
    questionCount: r.question_count,
  }));

  const totalAnswered = chapters.reduce((sum, c) => sum + c.attempted, 0);
  const totalCorrect = chapters.reduce((sum, c) => sum + c.correct, 0);

  return {
    totalAnswered,
    totalCorrect,
    accuracyPct: totalAnswered === 0 ? 0 : Math.round((totalCorrect / totalAnswered) * 100),
    totalAvailable: chapters.reduce((sum, c) => sum + c.questionCount, 0),
    chapters,
  };
}

/**
 * NQ-31b activity-heatmap. 1 query, newest first, which is what
 * `computeStreaks` expects.
 *
 * Reads `study_sessions.local_date` -- the candidate's own calendar day -- and
 * is covering, so a year of squares is an index-only scan.
 */
export async function readActivityDays(
  db: Db,
  userId: string,
  limit = 400,
): Promise<ActivityDay[]> {
  const rows = await db.all<{ day: string; answered: number }>(
    `SELECT local_date AS day, SUM(questions_seen) AS answered
       FROM ${T.studySessions}
      WHERE user_id = ?1
      GROUP BY local_date
      ORDER BY local_date DESC
      LIMIT ?2`,
    userId,
    limit,
  );
  return rows.map((r) => ({ day: r.day, answered: r.answered }));
}

/**
 * NQ-28 weak-areas. 1 query.
 *
 * Questions this user got wrong most recently. `last_is_correct` is the
 * trigger-maintained "how did it go the last time they saw it", which is the
 * right signal for a revision queue -- a question answered wrong once and then
 * right four times is not a weak area.
 */
export async function readWeakQuestionIds(
  db: Db,
  userId: string,
  limit: number,
): Promise<Array<{ questionId: string; chapterId: string }>> {
  const rows = await db.all<{ question_id: string; chapter_id: string }>(
    `SELECT s.question_id, s.chapter_id
       FROM ${T.userQuestionStats} s
       JOIN ${T.questions} q ON q.id = s.question_id AND q.status = 'published'
      WHERE s.user_id = ?1 AND s.last_is_correct = 0
      ORDER BY s.last_answered_at DESC LIMIT ?2`,
    userId,
    limit,
  );
  return rows.map((r) => ({ questionId: r.question_id, chapterId: r.chapter_id }));
}

// --- Bookmarks --------------------------------------------------------------

/** NQ-30 bookmarks-list. 1 query. */
export async function listBookmarks(db: Db, userId: string): Promise<BookmarkItem[]> {
  const rows = await db.all<{
    question_id: string;
    chapter_id: string;
    stem: string;
    created_at: number;
  }>(
    `SELECT b.question_id, q.chapter_id, q.stem, b.created_at
       FROM ${T.bookmarks} b
       JOIN ${T.questions} q ON q.id = b.question_id
      WHERE b.user_id = ?1
      ORDER BY b.created_at DESC
      LIMIT 500`,
    userId,
  );
  return rows.map((r) => ({
    questionId: r.question_id,
    chapterId: r.chapter_id,
    stem: r.stem,
    createdAt: r.created_at,
  }));
}

/**
 * Sets a bookmark to a desired state. 1 query.
 *
 * Expressed as a desired end state rather than a toggle, which is what makes
 * offline replay safe: `ON CONFLICT DO NOTHING` and a `DELETE` of a missing row
 * both converge, so replaying the same queued mutation any number of times
 * lands in the same place.
 */
export async function setBookmark(
  db: Db,
  args: { userId: string; questionId: string; desired: boolean; now: number },
): Promise<void> {
  if (args.desired) {
    await db.run(
      `INSERT INTO ${T.bookmarks} (user_id, question_id, created_at)
       SELECT ?1, ?2, ?3
        WHERE EXISTS (SELECT 1 FROM ${T.questions}
                       WHERE id = ?2 AND status = 'published')
       ON CONFLICT (user_id, question_id) DO NOTHING`,
      args.userId,
      args.questionId,
      args.now,
    );
  } else {
    await db.run(
      `DELETE FROM ${T.bookmarks} WHERE user_id = ?1 AND question_id = ?2`,
      args.userId,
      args.questionId,
    );
  }
}

/** 1 query. */
export async function countBookmarks(db: Db, userId: string): Promise<number> {
  const row = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${T.bookmarks} WHERE user_id = ?1`,
    userId,
  );
  return row?.n ?? 0;
}

/** 1 query. */
export async function isBookmarked(
  db: Db,
  userId: string,
  questionId: string,
): Promise<boolean> {
  const row = await db.first<{ n: number }>(
    `SELECT 1 AS n FROM ${T.bookmarks} WHERE user_id = ?1 AND question_id = ?2`,
    userId,
    questionId,
  );
  return row !== null;
}

/** 1 query. */
export async function readBookmarkedQuestionIds(
  db: Db,
  userId: string,
  limit: number,
): Promise<Array<{ questionId: string; chapterId: string }>> {
  const rows = await db.all<{ question_id: string; chapter_id: string }>(
    `SELECT b.question_id, q.chapter_id
       FROM ${T.bookmarks} b
       JOIN ${T.questions} q ON q.id = b.question_id
      WHERE b.user_id = ?1 AND q.status = 'published'
      ORDER BY RANDOM() LIMIT ?2`,
    userId,
    limit,
  );
  return rows.map((r) => ({ questionId: r.question_id, chapterId: r.chapter_id }));
}

// --- SRS reads and the graded review ---------------------------------------

interface SrsRow {
  question_id: string;
  due: number;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  elapsed_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
}

const SRS_SELECT = `c.question_id, c.due, c.stability, c.difficulty, c.scheduled_days,
                    c.elapsed_days, c.reps, c.lapses, c.state, c.last_review`;

function toCardState(row: SrsRow): SrsCardState {
  return {
    questionId: row.question_id,
    dueAt: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    scheduledDays: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    state: stateFromCode(row.state),
    // `reps` IS the revision. One column, one meaning, no second counter to
    // keep in step with it.
    revision: row.reps,
  };
}

/**
 * NQ-29 srs-due-queue. 1 query. Cards due now, oldest first.
 *
 * `suspended_at IS NULL` is in the partial index, so suspended cards are not
 * merely filtered out -- they are absent from the structure being scanned.
 */
export async function readDueCards(
  db: Db,
  args: { userId: string; now: number; limit: number },
): Promise<SrsCardState[]> {
  const rows = await db.all<SrsRow>(
    `SELECT ${SRS_SELECT}
       FROM ${T.srsState} c
       JOIN ${T.questions} q ON q.id = c.question_id AND q.status = 'published'
      WHERE c.user_id = ?1 AND c.due <= ?2 AND c.suspended_at IS NULL
      ORDER BY c.due
      LIMIT ?3`,
    args.userId,
    args.now,
    args.limit,
  );
  return rows.map(toCardState);
}

/**
 * Due cards as `(questionId, chapterId)` pairs. 1 query.
 *
 * Separate from `readDueCards` because the attempt writer needs the chapter id
 * to attribute the rollups, and `srs_state` deliberately does not carry one --
 * it would be a second copy of `questions.chapter_id` that an admin moving a
 * question between chapters would have to re-stamp.
 */
export async function readDueQuestionIds(
  db: Db,
  args: { userId: string; now: number; limit: number },
): Promise<Array<{ questionId: string; chapterId: string }>> {
  const rows = await db.all<{ question_id: string; chapter_id: string }>(
    `SELECT c.question_id, q.chapter_id
       FROM ${T.srsState} c
       JOIN ${T.questions} q ON q.id = c.question_id AND q.status = 'published'
      WHERE c.user_id = ?1 AND c.due <= ?2 AND c.suspended_at IS NULL
      ORDER BY c.due
      LIMIT ?3`,
    args.userId,
    args.now,
    args.limit,
  );
  return rows.map((r) => ({ questionId: r.question_id, chapterId: r.chapter_id }));
}

/** 1 query. */
export async function readCard(
  db: Db,
  userId: string,
  questionId: string,
): Promise<SrsCardState | null> {
  const row = await db.first<SrsRow>(
    `SELECT ${SRS_SELECT} FROM ${T.srsState} c
      WHERE c.user_id = ?1 AND c.question_id = ?2`,
    userId,
    questionId,
  );
  return row ? toCardState(row) : null;
}

export interface SrsReviewOutcome {
  card: SrsCardState;
  applied: boolean;
}

/**
 * Applies one graded review. 2 queries (read the card, write it).
 *
 * The write carries `AND reps = ?expected`, so a replayed outbox entry whose
 * revision the server has already moved past changes nothing and is reported as
 * `applied: false` with the current card. That is what makes the endpoint safe
 * to replay without an idempotency key -- and strictly better than a key here,
 * because it also makes a stale review from a second device a no-op instead of
 * a conflict.
 */
export async function applySrsReview(
  db: Db,
  args: {
    userId: string;
    questionId: string;
    grade: SrsGrade;
    expectedRevision: number;
    now: number;
  },
): Promise<SrsReviewOutcome | null> {
  const existingRow = await db.first<SrsRow>(
    `SELECT ${SRS_SELECT} FROM ${T.srsState} c
      WHERE c.user_id = ?1 AND c.question_id = ?2`,
    args.userId,
    args.questionId,
  );
  const existing = existingRow ? toCardState(existingRow) : null;

  if (existing && existing.revision !== args.expectedRevision) {
    return { card: existing, applied: false };
  }

  const current: CardState = existingRow
    ? {
        dueAt: existingRow.due,
        stability: existingRow.stability,
        difficulty: existingRow.difficulty,
        scheduledDays: existingRow.scheduled_days,
        elapsedDays: existingRow.elapsed_days,
        reps: existingRow.reps,
        lapses: existingRow.lapses,
        state: stateFromCode(existingRow.state),
        revision: existingRow.reps,
        lastReviewAt: existingRow.last_review,
      }
    : newCard(args.now);

  const next = reviewCard(current, args.grade, args.now);

  const meta = await db.run(
    `INSERT INTO ${T.srsState}
       (user_id, question_id, stability, difficulty, elapsed_days, scheduled_days,
        reps, lapses, state, due, last_review, last_rating, created_at, updated_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?11, ?11
      WHERE EXISTS (SELECT 1 FROM ${T.questions}
                     WHERE id = ?2 AND status = 'published')
     ON CONFLICT (user_id, question_id) DO UPDATE SET
       stability      = excluded.stability,
       difficulty     = excluded.difficulty,
       elapsed_days   = excluded.elapsed_days,
       scheduled_days = excluded.scheduled_days,
       reps           = excluded.reps,
       lapses         = excluded.lapses,
       state          = excluded.state,
       due            = excluded.due,
       last_review    = excluded.last_review,
       last_rating    = excluded.last_rating,
       updated_at     = excluded.updated_at
      WHERE ${T.srsState}.reps = ?13`,
    args.userId,
    args.questionId,
    next.stability,
    next.difficulty,
    next.elapsedDays,
    next.scheduledDays,
    next.reps,
    next.lapses,
    STATE_CODE[next.state],
    next.dueAt,
    args.now,
    RATING_BY_GRADE[args.grade],
    args.expectedRevision,
  );

  if (meta.changes !== 1) {
    const fresh = await readCard(db, args.userId, args.questionId);
    return fresh ? { card: fresh, applied: false } : null;
  }

  return {
    card: {
      questionId: args.questionId,
      dueAt: next.dueAt,
      stability: next.stability,
      difficulty: next.difficulty,
      scheduledDays: next.scheduledDays,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      revision: next.revision,
    },
    applied: true,
  };
}
