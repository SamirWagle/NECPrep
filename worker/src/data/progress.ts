/**
 * Progress rollups, bookmarks and SRS cards.
 *
 * WHY ROLLUPS AND NOT AN EVENT LOG. D1 Free allows 100,000 row writes per day
 * and index writes count toward it. An append-only `question_attempts` table
 * would double the write cost of every mock submission and add an index write
 * per row on top, which caps the platform at roughly 80 full mocks a day across
 * all users. Three upserted rollups cost 100 + <=10 + 1 rows for a 100-question
 * paper and answer every question the dashboard asks.
 *
 * What is given up: per-answer history. The attempt tables still hold that for
 * mock and practice answers, so nothing a user can see is lost - only arbitrary
 * ad-hoc analytics over individual events, which is not what this product needs
 * from its hot path.
 *
 * Every statement builder here takes `userId` and puts it in the row. D1 has no
 * row-level security, so there is no safety net below this line.
 */

import { Db, sql } from './d1.ts';
import type { PendingStatement } from './d1.ts';
import { T } from './tables.ts';
import { dayKey } from '../lib/time.ts';
import { newCard, review as reviewCard } from '../domain/srs.ts';
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

/**
 * Per-question mastery. ONE statement for the whole paper.
 *
 * The 100-row payload travels as a single JSON bound parameter and is expanded
 * by `json_each`, because D1 caps a statement at 100 bound parameters and four
 * columns times a hundred questions is 400. This is the statement the task
 * brief is about: a 100-question submission is one INSERT, not a hundred.
 *
 * `guardAttemptId` makes it conditional on the attempt still being in progress,
 * so a duplicate submission that loses the race increments nothing.
 */
export function upsertQuestionStatsStatement(args: {
  userId: string;
  answers: readonly RollupAnswer[];
  now: number;
  guard: SubmissionGuard;
}): PendingStatement {
  // Own binds: ?1 payload, ?2 userId, ?3 now. The guard continues from ?4.
  return sql(
    `INSERT INTO ${T.userQuestionStats}
       (user_id, question_id, chapter_id, attempts, correct, last_correct, last_answered_at)
     SELECT ?2,
            json_extract(j.value, '$.q'),
            json_extract(j.value, '$.c'),
            1,
            json_extract(j.value, '$.k'),
            json_extract(j.value, '$.k'),
            ?3
       FROM json_each(?1) j
      WHERE ${args.guard.fragment(4)}
     ON CONFLICT (user_id, question_id) DO UPDATE SET
       attempts = ${T.userQuestionStats}.attempts + 1,
       correct = ${T.userQuestionStats}.correct + excluded.correct,
       last_correct = excluded.last_correct,
       last_answered_at = excluded.last_answered_at`,
    rollupPayload(args.answers),
    args.userId,
    args.now,
    ...args.guard.binds,
  );
}

/** Per-chapter totals. ONE statement; the GROUP BY happens in SQLite. */
export function upsertChapterStatsStatement(args: {
  userId: string;
  answers: readonly RollupAnswer[];
  now: number;
  guard: SubmissionGuard;
}): PendingStatement {
  return sql(
    `INSERT INTO ${T.userChapterStats}
       (user_id, chapter_id, attempted, correct, updated_at)
     SELECT ?2,
            json_extract(j.value, '$.c'),
            COUNT(*),
            SUM(json_extract(j.value, '$.k')),
            ?3
       FROM json_each(?1) j
      WHERE ${args.guard.fragment(4)}
      GROUP BY json_extract(j.value, '$.c')
     ON CONFLICT (user_id, chapter_id) DO UPDATE SET
       attempted = ${T.userChapterStats}.attempted + excluded.attempted,
       correct = ${T.userChapterStats}.correct + excluded.correct,
       updated_at = excluded.updated_at`,
    rollupPayload(args.answers),
    args.userId,
    args.now,
    ...args.guard.binds,
  );
}

/** One row per user per active day. Powers streaks. ONE statement. */
export function upsertDailyActivityStatement(args: {
  userId: string;
  answers: readonly RollupAnswer[];
  now: number;
  guard: SubmissionGuard;
}): PendingStatement {
  const answered = args.answers.filter((a) => a.answered);
  const correct = answered.filter((a) => a.isCorrect).length;
  return sql(
    `INSERT INTO ${T.userDailyActivity} (user_id, day, answered, correct, updated_at)
     SELECT ?1, ?2, ?3, ?4, ?5
      WHERE ${args.guard.fragment(6)}
     ON CONFLICT (user_id, day) DO UPDATE SET
       answered = ${T.userDailyActivity}.answered + excluded.answered,
       correct = ${T.userDailyActivity}.correct + excluded.correct,
       updated_at = excluded.updated_at`,
    args.userId,
    dayKey(args.now),
    answered.length,
    correct,
    args.now,
    ...args.guard.binds,
  );
}

/**
 * Feeds the spaced-repetition schedule from the answers themselves. ONE
 * statement.
 *
 * Correct doubles the interval (capped at a year), wrong resets it to tomorrow
 * and counts a lapse. The arithmetic is deliberately cruder than the SM-2 in
 * `domain/srs.ts`, which runs on an explicit graded review: doing it properly
 * for 100 questions at once would mean reading 100 cards first to get each
 * card's ease, and the query budget does not allow a hundred reads.
 *
 * `excluded.lapses` carries the correctness bit into the conflict branch - 0
 * for a correct answer, 1 for a wrong one - which is the only way to branch on
 * the new row's values inside an upsert.
 */
export function upsertSrsFromAnswersStatement(args: {
  userId: string;
  answers: readonly RollupAnswer[];
  now: number;
  guard: SubmissionGuard;
}): PendingStatement {
  const oneDay = 24 * 60 * 60 * 1000;
  const nextInterval =
    `CASE WHEN excluded.lapses = 0
          THEN MIN(MAX(${T.srsCards}.interval_days, 1) * 2, 365)
          ELSE 1 END`;

  return sql(
    `INSERT INTO ${T.srsCards}
       (user_id, question_id, chapter_id, due_at, interval_days, ease,
        reps, lapses, state, revision, last_reviewed_at)
     SELECT ?2,
            json_extract(j.value, '$.q'),
            json_extract(j.value, '$.c'),
            ?3 + (CASE WHEN json_extract(j.value, '$.k') = 1 THEN 3 ELSE 1 END) * ?4,
            CASE WHEN json_extract(j.value, '$.k') = 1 THEN 3 ELSE 1 END,
            2.5,
            1,
            CASE WHEN json_extract(j.value, '$.k') = 1 THEN 0 ELSE 1 END,
            CASE WHEN json_extract(j.value, '$.k') = 1 THEN 'learning' ELSE 'relearning' END,
            1,
            ?3
       FROM json_each(?1) j
      WHERE ${args.guard.fragment(5)}
     ON CONFLICT (user_id, question_id) DO UPDATE SET
       interval_days = ${nextInterval},
       due_at = ?3 + (${nextInterval}) * ?4,
       lapses = ${T.srsCards}.lapses + excluded.lapses,
       reps = ${T.srsCards}.reps + 1,
       state = CASE WHEN excluded.lapses = 0 THEN 'review' ELSE 'relearning' END,
       revision = ${T.srsCards}.revision + 1,
       last_reviewed_at = ?3`,
    rollupPayload(args.answers),
    args.userId,
    args.now,
    oneDay,
    ...args.guard.binds,
  );
}

// --- Submission guard -------------------------------------------------------

/**
 * A SQL predicate that is true only while a given attempt is still in progress.
 *
 * Every rollup statement in a submission batch carries it, and the statement
 * that flips the attempt to `submitted` runs LAST. A duplicate submission that
 * arrives after the first one committed therefore finds the predicate false,
 * writes nothing, and reports zero changes on its final UPDATE - which the
 * handler turns into a replay of the stored result rather than a second score.
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
  binds: readonly string[];
}

function attemptGuard(table: string, alias: string, id: string, userId: string): SubmissionGuard {
  return {
    fragment: (start) =>
      `EXISTS (SELECT 1 FROM ${table} ${alias}
                WHERE ${alias}.id = ?${start}
                  AND ${alias}.user_id = ?${start + 1}
                  AND ${alias}.status = 'in_progress')`,
    binds: [id, userId],
  };
}

export function mockSubmissionGuard(attemptId: string, userId: string): SubmissionGuard {
  return attemptGuard(T.mockAttempts, 'a', attemptId, userId);
}

export function practiceSessionGuard(sessionId: string, userId: string): SubmissionGuard {
  return attemptGuard(T.practiceSessions, 's', sessionId, userId);
}

/** No guard, for call sites where the caller has already serialised the write. */
export const UNGUARDED: SubmissionGuard = { fragment: () => '1 = 1', binds: [] };

// --- Reads ------------------------------------------------------------------

/** 1 query. Chapter totals joined to the chapter list. */
export async function readProgressStats(db: Db, userId: string): Promise<ProgressStats> {
  const rows = await db.all<{
    chapter_id: string;
    question_count: number;
    attempted: number;
    correct: number;
  }>(
    `SELECT c.id AS chapter_id, c.question_count,
            COALESCE(s.attempted, 0) AS attempted,
            COALESCE(s.correct, 0) AS correct
       FROM ${T.chapters} c
       LEFT JOIN ${T.userChapterStats} s
              ON s.chapter_id = c.id AND s.user_id = ?1
      ORDER BY c.order_index, c.slug`,
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

/** 1 query. Newest first, which is what `computeStreaks` expects. */
export async function readActivityDays(
  db: Db,
  userId: string,
  limit = 400,
): Promise<ActivityDay[]> {
  const rows = await db.all<{ day: string; answered: number }>(
    `SELECT day, answered FROM ${T.userDailyActivity}
      WHERE user_id = ?1 ORDER BY day DESC LIMIT ?2`,
    userId,
    limit,
  );
  return rows.map((r) => ({ day: r.day, answered: r.answered }));
}

/** Questions this user has got wrong most recently. 1 query. */
export async function readWeakQuestionIds(
  db: Db,
  userId: string,
  limit: number,
): Promise<Array<{ questionId: string; chapterId: string }>> {
  const rows = await db.all<{ question_id: string; chapter_id: string }>(
    `SELECT question_id, chapter_id FROM ${T.userQuestionStats}
      WHERE user_id = ?1 AND last_correct = 0
      ORDER BY last_answered_at DESC LIMIT ?2`,
    userId,
    limit,
  );
  return rows.map((r) => ({ questionId: r.question_id, chapterId: r.chapter_id }));
}

// --- Bookmarks --------------------------------------------------------------

/** 1 query. */
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

// --- SRS --------------------------------------------------------------------

interface SrsRow {
  question_id: string;
  chapter_id: string;
  due_at: number;
  interval_days: number;
  ease: number;
  reps: number;
  lapses: number;
  state: string;
  revision: number;
}

function toCardState(row: SrsRow): SrsCardState {
  return {
    questionId: row.question_id,
    dueAt: row.due_at,
    intervalDays: row.interval_days,
    ease: row.ease,
    reps: row.reps,
    lapses: row.lapses,
    state:
      row.state === 'learning' || row.state === 'review' || row.state === 'relearning'
        ? row.state
        : 'new',
    revision: row.revision,
  };
}

/** 1 query. Cards due now, oldest first. */
export async function readDueCards(
  db: Db,
  args: { userId: string; now: number; limit: number },
): Promise<SrsCardState[]> {
  const rows = await db.all<SrsRow>(
    `SELECT c.question_id, c.chapter_id, c.due_at, c.interval_days, c.ease,
            c.reps, c.lapses, c.state, c.revision
       FROM ${T.srsCards} c
       JOIN ${T.questions} q ON q.id = c.question_id AND q.status = 'published'
      WHERE c.user_id = ?1 AND c.due_at <= ?2
      ORDER BY c.due_at
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
 * Separate from `readDueCards` because the practice-session writer needs the
 * chapter id to attribute the rollups, and a card state object with an empty
 * `chapterId` would silently write rollup rows against a nonexistent chapter.
 */
export async function readDueQuestionIds(
  db: Db,
  args: { userId: string; now: number; limit: number },
): Promise<Array<{ questionId: string; chapterId: string }>> {
  const rows = await db.all<{ question_id: string; chapter_id: string }>(
    `SELECT c.question_id, c.chapter_id
       FROM ${T.srsCards} c
       JOIN ${T.questions} q ON q.id = c.question_id AND q.status = 'published'
      WHERE c.user_id = ?1 AND c.due_at <= ?2
      ORDER BY c.due_at
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
    `SELECT question_id, chapter_id, due_at, interval_days, ease, reps,
            lapses, state, revision
       FROM ${T.srsCards} WHERE user_id = ?1 AND question_id = ?2`,
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
 * The write carries `AND revision = ?expected`, so a replayed outbox entry
 * whose `revision` the server has already moved past changes nothing and is
 * reported as `applied: false` with the current card. That is what makes the
 * endpoint safe to replay without an idempotency key - though it accepts one
 * too, for uniformity with the rest of the outbox.
 */
export async function applySrsReview(
  db: Db,
  args: {
    userId: string;
    questionId: string;
    chapterId: string;
    grade: SrsGrade;
    expectedRevision: number;
    now: number;
  },
): Promise<SrsReviewOutcome | null> {
  const existing = await readCard(db, args.userId, args.questionId);

  const current: CardState = existing
    ? {
        dueAt: existing.dueAt,
        intervalDays: existing.intervalDays,
        ease: existing.ease,
        reps: existing.reps,
        lapses: existing.lapses,
        state: existing.state,
        revision: existing.revision,
      }
    : newCard(args.now);

  if (existing && existing.revision !== args.expectedRevision) {
    return { card: existing, applied: false };
  }

  const next = reviewCard(current, args.grade, args.now);

  const meta = await db.run(
    `INSERT INTO ${T.srsCards}
       (user_id, question_id, chapter_id, due_at, interval_days, ease, reps,
        lapses, state, revision, last_reviewed_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
      WHERE EXISTS (SELECT 1 FROM ${T.questions}
                     WHERE id = ?2 AND status = 'published')
     ON CONFLICT (user_id, question_id) DO UPDATE SET
       due_at = excluded.due_at,
       interval_days = excluded.interval_days,
       ease = excluded.ease,
       reps = excluded.reps,
       lapses = excluded.lapses,
       state = excluded.state,
       revision = excluded.revision,
       last_reviewed_at = excluded.last_reviewed_at
      WHERE ${T.srsCards}.revision = ?12`,
    args.userId,
    args.questionId,
    args.chapterId,
    next.dueAt,
    next.intervalDays,
    next.ease,
    next.reps,
    next.lapses,
    next.state,
    next.revision,
    args.now,
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
      intervalDays: next.intervalDays,
      ease: next.ease,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      revision: next.revision,
    },
    applied: true,
  };
}
