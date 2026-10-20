/**
 * Mock attempts: the paper, the sync snapshot, the submission.
 *
 * The query cost of every function is in its doc comment, because D1 Free
 * allows 50 queries per Worker invocation and `submitAttempt` is the endpoint
 * that would blow that budget if it were written the obvious way. It costs a
 * fixed 6 statements in one batch regardless of whether the paper has 10
 * questions or 250.
 */

import { Db, sql } from './d1.ts';
import type { PendingStatement } from './d1.ts';
import { T } from './tables.ts';
import { newId } from '../lib/ids.ts';
import type { PaperQuestion } from '../domain/scoring.ts';
import type { AnswerMap } from '../domain/expiry.ts';
import type { AttemptStatus } from '../shared/types.ts';
import {
  mockSubmissionGuard,
  upsertChapterStatsStatement,
  upsertDailyActivityStatement,
  upsertQuestionStatsStatement,
  upsertSrsFromAnswersStatement,
} from './progress.ts';
import type { RollupAnswer } from './progress.ts';

export interface AttemptRow {
  id: string;
  user_id: string;
  template_id: string;
  status: string;
  started_at: number;
  expires_at: number;
  duration_seconds: number;
  question_count: number;
  submitted_at: number | null;
  scored_at: number | null;
  score: number | null;
  timing: string | null;
  synced_answers: string | null;
  last_sync_at: number | null;
}

export function attemptStatus(row: AttemptRow): AttemptStatus {
  switch (row.status) {
    case 'in_progress':
    case 'submitted':
    case 'expired':
    case 'abandoned':
      return row.status;
    default:
      // Fail closed: an unrecognised status must not read as in progress.
      return 'abandoned';
  }
}

/** Parses the stored snapshot. A corrupt blob reads as "no snapshot". */
export function parseSyncedAnswers(row: AttemptRow): AnswerMap | null {
  if (!row.synced_answers) return null;
  try {
    const parsed = JSON.parse(row.synced_answers) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const out: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Creates the attempt and its paper. 2 statements, 1 batch, 1 round trip.
 *
 * THE PAPER ROWS ARE ONE STATEMENT. A hundred questions means a hundred rows,
 * and a hundred separate INSERTs would exceed D1's 50-queries-per-invocation
 * limit before the handler even got to the response. A multi-row VALUES list
 * would exceed the 100-bound-parameter limit at seven columns per row. So the
 * whole paper travels as a single JSON parameter and is expanded by
 * `json_each`, which keeps the cost at one statement and one parameter for any
 * paper size.
 *
 * `option_order` and `option_refs` are pre-stringified by the caller rather
 * than nested as real JSON arrays, so the statement never relies on
 * `json_extract` returning a text representation for a nested array.
 */
export function createAttemptBatch(args: {
  attemptId: string;
  userId: string;
  templateId: string;
  startedAt: number;
  expiresAt: number;
  durationSeconds: number;
  paper: readonly PaperQuestion[];
}): PendingStatement[] {
  const rows = args.paper.map((q) => ({
    id: newId('maq'),
    qid: q.questionId,
    cid: q.chapterId,
    pos: q.position,
    ord: JSON.stringify(q.optionOrder),
    ref: JSON.stringify(q.optionRefs),
  }));

  return [
    sql(
      `INSERT INTO ${T.mockAttempts}
         (id, user_id, template_id, status, started_at, expires_at,
          duration_seconds, question_count, submitted_at, scored_at, score,
          timing, synced_answers, last_sync_at)
       VALUES (?1, ?2, ?3, 'in_progress', ?4, ?5, ?6, ?7, NULL, NULL, NULL,
               NULL, NULL, NULL)`,
      args.attemptId,
      args.userId,
      args.templateId,
      args.startedAt,
      args.expiresAt,
      args.durationSeconds,
      args.paper.length,
    ),
    sql(
      `INSERT INTO ${T.mockAttemptQuestions}
         (id, attempt_id, question_id, chapter_id, position, option_order, option_refs)
       SELECT json_extract(j.value, '$.id'),
              ?2,
              json_extract(j.value, '$.qid'),
              json_extract(j.value, '$.cid'),
              json_extract(j.value, '$.pos'),
              json_extract(j.value, '$.ord'),
              json_extract(j.value, '$.ref')
         FROM json_each(?1) j`,
      JSON.stringify(rows),
      args.attemptId,
    ),
  ];
}

/**
 * Loads an attempt, scoped to its owner. 1 query.
 *
 * `user_id = ?2` is in the WHERE clause, not checked afterwards, so there is no
 * version of this function that can return another user's attempt. Every
 * handler that touches an attempt starts here.
 */
export async function loadAttempt(
  db: Db,
  attemptId: string,
  userId: string,
): Promise<AttemptRow | null> {
  return await db.first<AttemptRow>(
    `SELECT * FROM ${T.mockAttempts} WHERE id = ?1 AND user_id = ?2`,
    attemptId,
    userId,
  );
}

export interface PaperRow extends PaperQuestion {
  stem: string;
  explanation: string | null;
}

/**
 * The paper with stems, scoped to its owner. 1 query.
 *
 * Joins `mock_attempts` purely to carry the `user_id` predicate, so a caller
 * cannot read a paper by guessing an attempt id. Does NOT join
 * `question_options` - option bodies come from `loadOptionsForQuestions`, which
 * cannot return the key.
 */
export async function loadPaper(
  db: Db,
  attemptId: string,
  userId: string,
): Promise<PaperRow[]> {
  const rows = await db.all<{
    question_id: string;
    chapter_id: string;
    position: number;
    option_order: string;
    option_refs: string;
    stem: string;
    explanation: string | null;
  }>(
    `SELECT aq.question_id, aq.chapter_id, aq.position,
            aq.option_order, aq.option_refs, q.stem, q.explanation
       FROM ${T.mockAttemptQuestions} aq
       JOIN ${T.mockAttempts} a ON a.id = aq.attempt_id
       JOIN ${T.questions} q ON q.id = aq.question_id
      WHERE aq.attempt_id = ?1 AND a.user_id = ?2
      ORDER BY aq.position`,
    attemptId,
    userId,
  );

  return rows.map((r) => ({
    questionId: r.question_id,
    chapterId: r.chapter_id,
    position: r.position,
    optionOrder: parseStringArray(r.option_order),
    optionRefs: parseStringArray(r.option_refs),
    stem: r.stem,
    explanation: r.explanation,
  }));
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Stores an answer snapshot. 1 query.
 *
 * THE CLAMP LIVES IN THIS WHERE CLAUSE. `?4 <= expires_at` uses the server's
 * clock against the deadline the server wrote at start, so the stored snapshot
 * is by construction a state that existed before the deadline. A client that
 * keeps working past the buzzer can keep calling this endpoint; the UPDATE
 * matches zero rows and the stored snapshot does not move.
 *
 * The map REPLACES the previous snapshot rather than merging into it, which is
 * what makes the endpoint idempotent and safe for the offline outbox to replay
 * out of order within a window - the last write to arrive before the deadline
 * wins, and that is the honest answer.
 */
export async function syncAnswers(
  db: Db,
  args: {
    attemptId: string;
    userId: string;
    answers: AnswerMap;
    now: number;
  },
): Promise<boolean> {
  const meta = await db.run(
    `UPDATE ${T.mockAttempts}
        SET synced_answers = ?3, last_sync_at = ?4
      WHERE id = ?1 AND user_id = ?2
        AND status = 'in_progress'
        AND ?4 <= expires_at`,
    args.attemptId,
    args.userId,
    JSON.stringify(args.answers),
    args.now,
  );
  return meta.changes === 1;
}

/** One scored answer row, as written to `mock_answers`. */
export interface SubmissionAnswer extends RollupAnswer {
  selectedOptionId: string | null;
}

export interface SubmitArgs {
  attemptId: string;
  userId: string;
  answers: readonly SubmissionAnswer[];
  score: number;
  timing: string;
  submittedAt: number;
  scoredAt: number;
}

/**
 * Commits a submission. 6 statements, ONE batch, ONE round trip.
 *
 * Returns `applied: false` when the attempt was no longer in progress, in which
 * case nothing at all was written and the caller should replay the stored
 * result instead of scoring again.
 *
 * ORDERING IS LOAD-BEARING. The five write statements each carry
 * `WHERE EXISTS (... status = 'in_progress')` and the status flip runs LAST, so
 * a duplicate submission arriving after the first one committed finds the guard
 * false, writes nothing, and reports zero changes on the final UPDATE. That is
 * what makes the endpoint safe without a transaction, which D1 does not offer.
 */
export async function submitAttempt(
  db: Db,
  args: SubmitArgs,
): Promise<{ applied: boolean }> {
  const guard = mockSubmissionGuard(args.attemptId, args.userId);

  const answerRows = args.answers
    .filter((a) => a.answered)
    .map((a) => ({
      id: newId('man'),
      q: a.questionId,
      o: a.selectedOptionId,
      k: a.isCorrect ? 1 : 0,
    }));

  const statements: PendingStatement[] = [
    // 1. The answers. ONE statement for the whole paper.
    sql(
      `INSERT INTO ${T.mockAnswers}
         (id, attempt_id, question_id, option_id, is_correct, answered_at)
       SELECT json_extract(j.value, '$.id'),
              ?2,
              json_extract(j.value, '$.q'),
              json_extract(j.value, '$.o'),
              json_extract(j.value, '$.k'),
              ?3
         FROM json_each(?1) j
        WHERE ${guard.fragment(4)}
       ON CONFLICT (attempt_id, question_id) DO NOTHING`,
      JSON.stringify(answerRows),
      args.attemptId,
      args.scoredAt,
      ...guard.binds,
    ),

    // 2-5. The rollups.
    upsertQuestionStatsStatement({
      userId: args.userId,
      answers: args.answers,
      now: args.scoredAt,
      guard,
    }),
    upsertChapterStatsStatement({
      userId: args.userId,
      answers: args.answers,
      now: args.scoredAt,
      guard,
    }),
    upsertDailyActivityStatement({
      userId: args.userId,
      answers: args.answers,
      now: args.scoredAt,
      guard,
    }),
    upsertSrsFromAnswersStatement({
      userId: args.userId,
      answers: args.answers,
      now: args.scoredAt,
      guard,
    }),

    // 6. The status flip. LAST, and the only statement whose `changes` matters.
    sql(
      `UPDATE ${T.mockAttempts}
          SET status = 'submitted', submitted_at = ?3, scored_at = ?4,
              score = ?5, timing = ?6
        WHERE id = ?1 AND user_id = ?2 AND status = 'in_progress'`,
      args.attemptId,
      args.userId,
      args.submittedAt,
      args.scoredAt,
      args.score,
      args.timing,
    ),
  ];

  const results = await db.batch(statements);
  const flip = results[results.length - 1];
  return { applied: (flip?.meta.changes ?? 0) === 1 };
}

/**
 * The answers already recorded for a submitted attempt. 1 query.
 *
 * Used to rebuild the review payload for a replayed submission whose stored
 * idempotency record has expired, so a user who comes back a week later still
 * sees their paper rather than a 409.
 */
export async function loadRecordedAnswers(
  db: Db,
  attemptId: string,
  userId: string,
): Promise<Map<string, { optionId: string | null; isCorrect: boolean }>> {
  const rows = await db.all<{
    question_id: string;
    option_id: string | null;
    is_correct: number;
  }>(
    `SELECT ma.question_id, ma.option_id, ma.is_correct
       FROM ${T.mockAnswers} ma
       JOIN ${T.mockAttempts} a ON a.id = ma.attempt_id
      WHERE ma.attempt_id = ?1 AND a.user_id = ?2`,
    attemptId,
    userId,
  );

  const out = new Map<string, { optionId: string | null; isCorrect: boolean }>();
  for (const row of rows) {
    out.set(row.question_id, {
      optionId: row.option_id,
      isCorrect: row.is_correct === 1,
    });
  }
  return out;
}

/** The caller's most recent in-progress attempt, for resume. 1 query. */
export async function findResumableAttempt(
  db: Db,
  userId: string,
  now: number,
): Promise<AttemptRow | null> {
  return await db.first<AttemptRow>(
    `SELECT * FROM ${T.mockAttempts}
      WHERE user_id = ?1 AND status = 'in_progress' AND expires_at > ?2
      ORDER BY started_at DESC LIMIT 1`,
    userId,
    now,
  );
}

/**
 * Attempt history, mock and practice, newest first. 1 query.
 *
 * A UNION ALL over the two attempt tables rather than two round trips, keyed by
 * a `started_at` cursor for paging.
 */
export async function readAttemptHistory(
  db: Db,
  args: { userId: string; limit: number; beforeStartedAt: number | null },
): Promise<
  Array<{
    kind: 'mock' | 'practice';
    id: string;
    label: string;
    score: number;
    total: number;
    at: number;
    status: string;
  }>
> {
  const rows = await db.all<{
    kind: string;
    id: string;
    label: string;
    score: number;
    total: number;
    at: number;
    status: string;
  }>(
    `SELECT 'mock' AS kind, a.id, t.name AS label,
            COALESCE(a.score, 0) AS score, a.question_count AS total,
            a.started_at AS at, a.status
       FROM ${T.mockAttempts} a
       JOIN ${T.mockTemplates} t ON t.id = a.template_id
      WHERE a.user_id = ?1 AND a.started_at < ?2
     UNION ALL
     SELECT 'practice' AS kind, p.id, p.mode AS label,
            p.correct_count AS score, p.question_count AS total,
            p.started_at AS at, p.status
       FROM ${T.practiceSessions} p
      WHERE p.user_id = ?1 AND p.started_at < ?2
      ORDER BY at DESC
      LIMIT ?3`,
    args.userId,
    args.beforeStartedAt ?? Number.MAX_SAFE_INTEGER,
    args.limit,
  );

  return rows.map((r) => ({
    kind: r.kind === 'mock' ? 'mock' : 'practice',
    id: r.id,
    label: r.label,
    score: r.score,
    total: r.total,
    at: r.at,
    status: r.status,
  }));
}
