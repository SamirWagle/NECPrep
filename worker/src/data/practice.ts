/**
 * Practice sessions - untimed, and the one mode where the answer key is
 * disclosed during the session rather than at the end.
 *
 * That is not a weakening of the anti-cheat model, it is what practice is for:
 * the reveal happens strictly AFTER the answer is committed, and it discloses
 * the key for exactly the question just answered. Everything else on the paper
 * stays closed. A user who wants to see all 50 keys has to answer all 50
 * questions, and every one of those answers is recorded against their stats
 * first - so "cheating" in practice means truthfully recording 50 answers.
 */

import { Db, sql } from './d1.ts';
import type { PendingStatement } from './d1.ts';
import { T } from './tables.ts';
import { newId } from '../lib/ids.ts';
import type { PaperQuestion } from '../domain/scoring.ts';
import type { AttemptStatus, PracticeMode } from '../shared/types.ts';
import {
  practiceSessionGuard,
  upsertChapterStatsStatement,
  upsertDailyActivityStatement,
  upsertQuestionStatsStatement,
  upsertSrsFromAnswersStatement,
} from './progress.ts';
import type { RollupAnswer, SubmissionGuard } from './progress.ts';

export interface SessionRow {
  id: string;
  user_id: string;
  mode: string;
  chapter_ids: string | null;
  status: string;
  started_at: number;
  finished_at: number | null;
  question_count: number;
  answered_count: number;
  correct_count: number;
}

export function sessionStatus(row: SessionRow): AttemptStatus {
  switch (row.status) {
    case 'in_progress':
    case 'submitted':
    case 'expired':
    case 'abandoned':
      return row.status;
    default:
      return 'abandoned';
  }
}

export function sessionMode(row: SessionRow): PracticeMode {
  switch (row.mode) {
    case 'chapter':
    case 'bookmarks':
    case 'srs':
    case 'wrong':
    case 'custom':
      return row.mode;
    default:
      return 'custom';
  }
}

/** 2 statements, 1 batch. Same json_each expansion as the mock paper. */
export function createSessionBatch(args: {
  sessionId: string;
  userId: string;
  mode: PracticeMode;
  chapterIds: readonly string[] | null;
  startedAt: number;
  paper: readonly PaperQuestion[];
}): PendingStatement[] {
  const rows = args.paper.map((q) => ({
    id: newId('psq'),
    qid: q.questionId,
    cid: q.chapterId,
    pos: q.position,
    ord: JSON.stringify(q.optionOrder),
    ref: JSON.stringify(q.optionRefs),
  }));

  return [
    sql(
      `INSERT INTO ${T.practiceSessions}
         (id, user_id, mode, chapter_ids, status, started_at, finished_at,
          question_count, answered_count, correct_count)
       VALUES (?1, ?2, ?3, ?4, 'in_progress', ?5, NULL, ?6, 0, 0)`,
      args.sessionId,
      args.userId,
      args.mode,
      args.chapterIds ? JSON.stringify(args.chapterIds) : null,
      args.startedAt,
      args.paper.length,
    ),
    sql(
      `INSERT INTO ${T.practiceSessionQuestions}
         (id, session_id, question_id, chapter_id, position, option_order, option_refs)
       SELECT json_extract(j.value, '$.id'),
              ?2,
              json_extract(j.value, '$.qid'),
              json_extract(j.value, '$.cid'),
              json_extract(j.value, '$.pos'),
              json_extract(j.value, '$.ord'),
              json_extract(j.value, '$.ref')
         FROM json_each(?1) j`,
      JSON.stringify(rows),
      args.sessionId,
    ),
  ];
}

/** 1 query, ownership in the WHERE clause. */
export async function loadSession(
  db: Db,
  sessionId: string,
  userId: string,
): Promise<SessionRow | null> {
  return await db.first<SessionRow>(
    `SELECT * FROM ${T.practiceSessions} WHERE id = ?1 AND user_id = ?2`,
    sessionId,
    userId,
  );
}

export interface SessionPaperRow extends PaperQuestion {
  stem: string;
  explanation: string | null;
}

/** 1 query, ownership enforced through the join. */
export async function loadSessionPaper(
  db: Db,
  sessionId: string,
  userId: string,
): Promise<SessionPaperRow[]> {
  const rows = await db.all<{
    question_id: string;
    chapter_id: string;
    position: number;
    option_order: string;
    option_refs: string;
    stem: string;
    explanation: string | null;
  }>(
    `SELECT sq.question_id, sq.chapter_id, sq.position,
            sq.option_order, sq.option_refs, q.stem, q.explanation
       FROM ${T.practiceSessionQuestions} sq
       JOIN ${T.practiceSessions} s ON s.id = sq.session_id
       JOIN ${T.questions} q ON q.id = sq.question_id
      WHERE sq.session_id = ?1 AND s.user_id = ?2
      ORDER BY sq.position`,
    sessionId,
    userId,
  );

  return rows.map((r) => ({
    questionId: r.question_id,
    chapterId: r.chapter_id,
    position: r.position,
    optionOrder: safeArray(r.option_order),
    optionRefs: safeArray(r.option_refs),
    stem: r.stem,
    explanation: r.explanation,
  }));
}

function safeArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * ONE question of the paper, with its key. 1 query.
 *
 * This is the practice reveal, and it is the narrowest key disclosure in the
 * API: a single question id, scoped to a session the caller owns. There is no
 * variant that takes a list.
 */
export async function loadSessionQuestionWithKey(
  db: Db,
  args: { sessionId: string; userId: string; questionId: string },
): Promise<{
  paper: PaperQuestion;
  correctOptionId: string | null;
  explanation: string | null;
  sessionStatus: string;
} | null> {
  const row = await db.first<{
    question_id: string;
    chapter_id: string;
    position: number;
    option_order: string;
    option_refs: string;
    explanation: string | null;
    status: string;
    correct_option_id: string | null;
  }>(
    `SELECT sq.question_id, sq.chapter_id, sq.position,
            sq.option_order, sq.option_refs, q.explanation, s.status,
            (SELECT o.id FROM ${T.questionOptions} o
              WHERE o.question_id = sq.question_id AND o.is_correct = 1
              LIMIT 1) AS correct_option_id
       FROM ${T.practiceSessionQuestions} sq
       JOIN ${T.practiceSessions} s ON s.id = sq.session_id
       JOIN ${T.questions} q ON q.id = sq.question_id
      WHERE sq.session_id = ?1 AND s.user_id = ?2 AND sq.question_id = ?3`,
    args.sessionId,
    args.userId,
    args.questionId,
  );

  if (!row) return null;

  return {
    paper: {
      questionId: row.question_id,
      chapterId: row.chapter_id,
      position: row.position,
      optionOrder: safeArray(row.option_order),
      optionRefs: safeArray(row.option_refs),
    },
    correctOptionId: row.correct_option_id,
    explanation: row.explanation,
    sessionStatus: row.status,
  };
}

/** 1 query. Answers already committed, for resuming a session. */
export async function loadSessionAnswers(
  db: Db,
  sessionId: string,
  userId: string,
): Promise<Map<string, { optionId: string | null; isCorrect: boolean }>> {
  const rows = await db.all<{
    question_id: string;
    option_id: string | null;
    is_correct: number;
  }>(
    `SELECT pa.question_id, pa.option_id, pa.is_correct
       FROM ${T.practiceAnswers} pa
       JOIN ${T.practiceSessions} s ON s.id = pa.session_id
      WHERE pa.session_id = ?1 AND s.user_id = ?2`,
    sessionId,
    userId,
  );

  const out = new Map<string, { optionId: string | null; isCorrect: boolean }>();
  for (const row of rows) {
    out.set(row.question_id, { optionId: row.option_id, isCorrect: row.is_correct === 1 });
  }
  return out;
}

/**
 * A predicate that is true only while this question is still unanswered in this
 * session. Same device as the mock submission guard, for the same reason: it
 * makes the increments conditional so a replay cannot double-count.
 */
function unansweredGuard(sessionId: string, questionId: string): SubmissionGuard {
  return {
    fragment: (start) =>
      `NOT EXISTS (SELECT 1 FROM ${T.practiceAnswers}
                    WHERE session_id = ?${start} AND question_id = ?${start + 1})`,
    binds: [sessionId, questionId],
  };
}

/**
 * Commits one practice answer. 6 statements, ONE batch, ONE round trip.
 *
 * Returns `applied: false` if the question was already answered in this
 * session, in which case nothing was written. That makes the endpoint
 * idempotent on `(sessionId, questionId)` WITHOUT an idempotency key, which is
 * exactly what the offline outbox wants: replaying a queued answer converges
 * instead of inflating the user's stats.
 *
 * The answer INSERT runs LAST and its `changes` is the decision, for the same
 * ordering reason as `submitAttempt`.
 */
export async function commitPracticeAnswer(
  db: Db,
  args: {
    sessionId: string;
    userId: string;
    questionId: string;
    chapterId: string;
    selectedOptionId: string | null;
    isCorrect: boolean;
    now: number;
    /** Telemetry. Influences the revision schedule only, never the score. */
    latencyMs?: number;
    flaggedGuess?: boolean;
    confidence?: number;
  },
): Promise<{ applied: boolean }> {
  const guard = unansweredGuard(args.sessionId, args.questionId);

  // A skip is recorded, but it is not an attempt: it must not count toward
  // accuracy or feed the spaced-repetition schedule.
  const answered = args.selectedOptionId !== null;
  const rollup: RollupAnswer[] = [
    {
      questionId: args.questionId,
      chapterId: args.chapterId,
      isCorrect: args.isCorrect,
      answered,
    },
  ];

  const statements: PendingStatement[] = [
    upsertQuestionStatsStatement({ userId: args.userId, answers: rollup, now: args.now, guard }),
    upsertChapterStatsStatement({ userId: args.userId, answers: rollup, now: args.now, guard }),
    upsertDailyActivityStatement({ userId: args.userId, answers: rollup, now: args.now, guard }),
    upsertSrsFromAnswersStatement({ userId: args.userId, answers: rollup, now: args.now, guard }),

    sql(
      `UPDATE ${T.practiceSessions}
          SET answered_count = answered_count + 1,
              correct_count = correct_count + ?3
        WHERE id = ?1 AND user_id = ?2 AND status = 'in_progress'
          AND ${guard.fragment(4)}`,
      args.sessionId,
      args.userId,
      args.isCorrect ? 1 : 0,
      ...guard.binds,
    ),

    sql(
      `INSERT INTO ${T.practiceAnswers}
         (id, session_id, question_id, option_id, is_correct, answered_at,
          latency_ms, flagged_guess, confidence)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?8, ?9, ?10
        WHERE EXISTS (SELECT 1 FROM ${T.practiceSessions}
                       WHERE id = ?2 AND user_id = ?7 AND status = 'in_progress')
       ON CONFLICT (session_id, question_id) DO NOTHING`,
      newId('pan'),
      args.sessionId,
      args.questionId,
      args.selectedOptionId,
      args.isCorrect ? 1 : 0,
      args.now,
      args.userId,
      args.latencyMs ?? null,
      args.flaggedGuess ? 1 : 0,
      args.confidence ?? null,
    ),
  ];

  const results = await db.batch(statements);
  const insert = results[results.length - 1];
  return { applied: (insert?.meta.changes ?? 0) === 1 };
}

/** 1 query. Idempotent: finishing a finished session changes nothing. */
export async function finishSession(
  db: Db,
  args: { sessionId: string; userId: string; now: number },
): Promise<boolean> {
  const meta = await db.run(
    `UPDATE ${T.practiceSessions}
        SET status = 'submitted', finished_at = ?3
      WHERE id = ?1 AND user_id = ?2 AND status = 'in_progress'`,
    args.sessionId,
    args.userId,
    args.now,
  );
  return meta.changes === 1;
}
