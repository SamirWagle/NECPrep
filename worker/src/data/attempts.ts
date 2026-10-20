/**
 * Attempts: one table for every sitting.
 *
 * ===========================================================================
 * ONE TABLE, NOT TWO
 * ===========================================================================
 *
 * This file replaces `data/mock.ts` and `data/practice.ts`, which assumed
 * `mock_attempts` + `practice_sessions` with parallel question and answer
 * tables on each side -- six tables for one concept. `attempts` with a `mode`
 * column is the shape in `migrations/0004_assessment.sql` and it is better for
 * reasons that showed up immediately: `readAttemptHistory` stops being a
 * UNION ALL, the rollup triggers exist once instead of twice, and the archival
 * job has one table to page through instead of two.
 *
 * TWO IDS, DELIBERATELY. `attempts.id` is an INTEGER rowid and `public_id` is
 * the ULID that appears in URLs. The reason is one table down: `attempt_answers`
 * is the only unbounded table on the platform and every row carries an attempt
 * reference, so a 26-character ULID there costs 26 bytes against 8 across
 * millions of rows. Everything above `data/` speaks `public_id`; this file
 * resolves it to the numeric id ONCE per request and never emits the integer,
 * which is enumerable.
 *
 * THE QUERY COST of every function is in its doc comment, because D1 Free
 * allows 50 queries per Worker invocation and `submitAttempt` is the endpoint
 * that would blow that budget if it were written the obvious way. It costs a
 * fixed 5 statements in one batch whether the paper has 10 questions or 250.
 */

import { Db, sql } from './d1.ts';
import type { PendingStatement } from './d1.ts';
import { T } from './tables.ts';
import { SUBMIT_GRACE_MS } from '../domain/expiry.ts';
import type { AnswerMap, SubmissionTiming } from '../domain/expiry.ts';
import type { AttemptStatus, PracticeMode } from '../shared/types.ts';
import {
  attemptGuard,
  bumpStudySessionStatement,
  closeStudySessionStatement,
  createStudySessionStatement,
  touchStreakStatement,
  unansweredGuard,
  upsertSrsFromAnswersStatement,
} from './progress.ts';
import type { RollupAnswer } from './progress.ts';

/** The `attempts.mode` CHECK. The database's vocabulary, so it wins. */
export type AttemptMode = 'practice' | 'mock' | 'srs' | 'bookmark_review' | 'weak_areas';

export interface AttemptRow {
  /** Internal rowid. NEVER serialised. */
  id: number;
  public_id: string;
  user_id: string;
  mode: string;
  template_id: string | null;
  chapter_id: string | null;
  status: string;
  option_seed: number;
  question_count: number;
  answered_count: number;
  correct_count: number;
  started_at: number;
  deadline_at: number | null;
  submitted_at: number | null;
  elapsed_ms: number | null;
  synced_answers: string | null;
  last_sync_at: number | null;
  /** Joined from `mock_test_templates`, for the history label. */
  template_name?: string | null;
}

const ATTEMPT_SELECT = `a.id, a.public_id, a.user_id, a.mode, a.template_id, a.chapter_id,
                        a.status, a.option_seed, a.question_count, a.answered_count,
                        a.correct_count, a.started_at, a.deadline_at, a.submitted_at,
                        a.elapsed_ms, a.synced_answers, a.last_sync_at`;

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

/**
 * The wire vocabulary for a practice mode -> the `attempts.mode` CHECK.
 *
 * Four vocabularies describe this concept across the repository
 * (`shared/types.ts`, `attempts.mode`, `responseLog.PRACTICE_MODES`,
 * `features/quiz/types.ts`). `attempts.mode` is the one with a constraint
 * behind it, so it is canonical, and this is the ONE place that maps.
 */
export function modeForPractice(mode: PracticeMode): AttemptMode {
  switch (mode) {
    case 'srs':
      return 'srs';
    case 'bookmarks':
      return 'bookmark_review';
    case 'wrong':
      return 'weak_areas';
    case 'chapter':
    case 'custom':
    default:
      return 'practice';
  }
}

/** The reverse map, for reading an attempt back as a practice session. */
export function practiceModeFor(mode: string): PracticeMode {
  switch (mode) {
    case 'srs':
      return 'srs';
    case 'bookmark_review':
      return 'bookmarks';
    case 'weak_areas':
      return 'wrong';
    default:
      return 'custom';
  }
}

/**
 * Derived, not stored. An attempt submitted inside the grace window was scored
 * from its payload; one submitted after it was scored from the pre-deadline
 * snapshot. `attempts` keeps `submitted_at` and `deadline_at`, so a `timing`
 * column would be a third copy of a fact those two already determine -- and
 * the kind of column that goes stale when the grace window changes.
 */
export function attemptTiming(row: AttemptRow): SubmissionTiming {
  if (row.deadline_at === null || row.submitted_at === null) return 'on_time';
  return row.submitted_at > row.deadline_at + SUBMIT_GRACE_MS ? 'expired' : 'on_time';
}

/** `min(submittedAt, deadlineAt)` -- the instant the paper was frozen. */
export function attemptScoredAt(row: AttemptRow): number {
  const submitted = row.submitted_at ?? row.started_at;
  return row.deadline_at === null ? submitted : Math.min(submitted, row.deadline_at);
}

/** Server-authored duration, recovered from the two timestamps. */
export function attemptDurationSeconds(row: AttemptRow): number {
  if (row.deadline_at === null) return 0;
  return Math.max(0, Math.round((row.deadline_at - row.started_at) / 1000));
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

/** A pick as the paper writer receives it, with its stored option order. */
export interface PaperRowInput {
  questionId: string;
  position: number;
  optionOrder: readonly string[];
}

/**
 * Creates the attempt, its paper and its study session. 3 statements, 1 batch,
 * 1 round trip.
 *
 * THE PAPER ROWS ARE ONE STATEMENT. A hundred questions means a hundred rows,
 * and a hundred separate INSERTs would exceed D1's 50-queries-per-invocation
 * limit before the handler got to the response. A multi-row VALUES list would
 * exceed the 100-bound-parameter limit at four columns per row. So the whole
 * paper travels as a single JSON parameter and is expanded by `json_each`,
 * which keeps the cost at one statement and one parameter for any paper size.
 *
 * `option_order` is pre-stringified by the caller rather than nested as a real
 * JSON array, so the statement never relies on `json_extract` returning a text
 * representation for a nested array.
 *
 * The paper insert resolves the attempt's numeric id with a subselect on
 * `public_id`, which is what lets all three statements share one batch.
 */
export function createAttemptBatch(args: {
  publicId: string;
  userId: string;
  mode: AttemptMode;
  templateId: string | null;
  chapterId: string | null;
  optionSeed: number;
  startedAt: number;
  /** `null` for an untimed practice session. */
  deadlineAt: number | null;
  paper: readonly PaperRowInput[];
}): PendingStatement[] {
  const rows = args.paper.map((q) => ({
    qid: q.questionId,
    pos: q.position,
    ord: JSON.stringify(q.optionOrder),
  }));

  return [
    sql(
      `INSERT INTO ${T.attempts}
         (public_id, user_id, mode, template_id, chapter_id, status, option_seed,
          question_count, answered_count, correct_count, started_at, deadline_at,
          submitted_at, elapsed_ms, synced_answers, last_sync_at, client_meta)
       VALUES (?1, ?2, ?3, ?4, ?5, 'in_progress', ?6, ?7, 0, 0, ?8, ?9,
               NULL, NULL, NULL, NULL, NULL)`,
      args.publicId,
      args.userId,
      args.mode,
      args.templateId,
      args.chapterId,
      args.optionSeed,
      args.paper.length,
      args.startedAt,
      args.deadlineAt,
    ),
    sql(
      `INSERT INTO ${T.attemptQuestions}
         (attempt_id, position, question_id, option_order)
       SELECT (SELECT id FROM ${T.attempts} WHERE public_id = ?2),
              json_extract(j.value, '$.pos'),
              json_extract(j.value, '$.qid'),
              json_extract(j.value, '$.ord')
         FROM json_each(?1) j`,
      JSON.stringify(rows),
      args.publicId,
    ),
    createStudySessionStatement({
      userId: args.userId,
      attemptPublicId: args.publicId,
      mode: args.mode,
      chapterId: args.chapterId,
      now: args.startedAt,
    }),
  ];
}

/**
 * Loads an attempt by its PUBLIC id, scoped to its owner. 1 query.
 *
 * `user_id = ?2` is in the WHERE clause, not checked afterwards, so there is no
 * version of this function that can return another user's attempt. Every
 * handler that touches an attempt starts here.
 */
export async function loadAttempt(
  db: Db,
  publicId: string,
  userId: string,
): Promise<AttemptRow | null> {
  return await db.first<AttemptRow>(
    `SELECT ${ATTEMPT_SELECT}
       FROM ${T.attempts} a
      WHERE a.public_id = ?1 AND a.user_id = ?2`,
    publicId,
    userId,
  );
}

/** One delivered question, as stored. Refs are derived, not stored. */
export interface StoredPaperRow {
  questionId: string;
  chapterId: string;
  position: number;
  optionOrder: string[];
  stem: string;
  explanation: string | null;
}

/**
 * NQ-23b render-paper. The paper with stems, scoped to its owner. 1 query.
 *
 * Joins `attempts` purely to carry the `user_id` predicate, so a caller cannot
 * read a paper by guessing an attempt id. Does NOT join `question_options` --
 * option bodies come from `loadOptionsForQuestions`, over a table with no
 * answer column -- and does not join `question_answer_keys`, which it could not
 * reach without naming it.
 *
 * `chapter_id` comes from `questions` rather than from a denormalised column on
 * `attempt_questions`: one join against a primary key, against four bytes per
 * row on the second-largest table.
 */
export async function loadPaper(
  db: Db,
  publicId: string,
  userId: string,
): Promise<StoredPaperRow[]> {
  const rows = await db.all<{
    question_id: string;
    chapter_id: string;
    position: number;
    option_order: string;
    stem: string;
    explanation: string | null;
  }>(
    `SELECT aq.question_id, q.chapter_id, aq.position, aq.option_order, q.stem,
            (SELECT e.body FROM ${T.explanations} e
              WHERE e.question_id = q.id AND e.status = 'published'
              ORDER BY e.is_primary DESC, e.id LIMIT 1) AS explanation
       FROM ${T.attemptQuestions} aq
       JOIN ${T.attempts} a ON a.id = aq.attempt_id
       JOIN ${T.questions} q ON q.id = aq.question_id
      WHERE a.public_id = ?1 AND a.user_id = ?2
      ORDER BY aq.position`,
    publicId,
    userId,
  );

  return rows.map((r) => ({
    questionId: r.question_id,
    chapterId: r.chapter_id,
    position: r.position,
    optionOrder: parseStringArray(r.option_order),
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

/** ONE stored question of a paper, for the practice reveal. */
export interface PaperQuestionRow extends StoredPaperRow {
  attemptId: number;
  optionSeed: number;
  attemptStatus: string;
}

/**
 * ONE question of the paper, with its key. 1 query.
 *
 * This is the practice reveal, and it is the narrowest key disclosure in the
 * API: a single question id, scoped to an attempt the caller owns. There is no
 * variant that takes a list. The correlated subquery over
 * `question_answer_keys` is the one place outside `loadAnswerKey` that reaches
 * the key table, and it is bounded to exactly one question by the outer
 * predicate.
 */
export async function loadPaperQuestionWithKey(
  db: Db,
  args: { publicId: string; userId: string; questionId: string },
): Promise<{ row: PaperQuestionRow; correctOptionId: string | null } | null> {
  const row = await db.first<{
    attempt_id: number;
    option_seed: number;
    attempt_status: string;
    question_id: string;
    chapter_id: string;
    position: number;
    option_order: string;
    stem: string;
    explanation: string | null;
    correct_option_id: string | null;
  }>(
    `SELECT a.id AS attempt_id, a.option_seed, a.status AS attempt_status,
            aq.question_id, q.chapter_id, aq.position, aq.option_order, q.stem,
            (SELECT e.body FROM ${T.explanations} e
              WHERE e.question_id = q.id AND e.status = 'published'
              ORDER BY e.is_primary DESC, e.id LIMIT 1) AS explanation,
            (SELECT k.correct_option_id FROM ${T.questionAnswerKeys} k
              WHERE k.question_id = aq.question_id) AS correct_option_id
       FROM ${T.attemptQuestions} aq
       JOIN ${T.attempts} a ON a.id = aq.attempt_id
       JOIN ${T.questions} q ON q.id = aq.question_id
      WHERE a.public_id = ?1 AND a.user_id = ?2 AND aq.question_id = ?3`,
    args.publicId,
    args.userId,
    args.questionId,
  );

  if (!row) return null;

  return {
    row: {
      attemptId: row.attempt_id,
      optionSeed: row.option_seed,
      attemptStatus: row.attempt_status,
      questionId: row.question_id,
      chapterId: row.chapter_id,
      position: row.position,
      optionOrder: parseStringArray(row.option_order),
      stem: row.stem,
      explanation: row.explanation,
    },
    correctOptionId: row.correct_option_id,
  };
}

/**
 * Stores an answer snapshot. 1 query.
 *
 * THE CLAMP LIVES IN THIS WHERE CLAUSE. `?4 <= deadline_at` uses the server's
 * clock against the deadline the server wrote at start, so the stored snapshot
 * is by construction a state that existed before the deadline. A client that
 * keeps working past the buzzer can keep calling this endpoint; the UPDATE
 * matches zero rows and the stored snapshot does not move. The same property is
 * ALSO a CHECK on the table (`last_sync_at <= deadline_at`), so a future
 * handler that forgets this predicate fails the write rather than quietly
 * accepting post-deadline work.
 *
 * The map REPLACES the previous snapshot rather than merging into it, which is
 * what makes the endpoint idempotent and safe for the offline outbox to replay
 * out of order within a window - the last write to arrive before the deadline
 * wins, and that is the honest answer.
 */
export async function syncAnswers(
  db: Db,
  args: {
    publicId: string;
    userId: string;
    answers: AnswerMap;
    now: number;
  },
): Promise<boolean> {
  const meta = await db.run(
    `UPDATE ${T.attempts}
        SET synced_answers = ?3, last_sync_at = ?4
      WHERE public_id = ?1 AND user_id = ?2
        AND status = 'in_progress'
        AND deadline_at IS NOT NULL
        AND ?4 <= deadline_at`,
    args.publicId,
    args.userId,
    JSON.stringify(args.answers),
    args.now,
  );
  return meta.changes === 1;
}

/** One scored answer row, as written to `attempt_answers`. */
export interface SubmissionAnswer extends RollupAnswer {
  selectedOptionId: string | null;
  /** 1-based screen position under this attempt's permutation. Analytics only. */
  deliveredPosition: number | null;
}

export interface SubmitArgs {
  attemptId: number;
  publicId: string;
  userId: string;
  answers: readonly SubmissionAnswer[];
  submittedAt: number;
  scoredAt: number;
  elapsedMs: number;
}

/** `question_options.opt_key` out of a full option id. */
export function optKeyOf(optionId: string): string | null {
  const hash = optionId.indexOf('#');
  return hash < 0 ? null : optionId.slice(hash + 1);
}

/**
 * Commits a submission. 5 statements, ONE batch, ONE round trip.
 *
 * Returns `applied: false` when the attempt was no longer in progress, in which
 * case nothing at all was written and the caller should replay the stored
 * result instead of scoring again.
 *
 * ORDERING IS LOAD-BEARING. Each of the first four statements carries
 * `WHERE EXISTS (... status = 'in_progress')` and the status flip runs LAST, so
 * a duplicate submission arriving after the first one committed finds the guard
 * false, writes nothing, and reports zero changes on the final UPDATE. That is
 * what makes the endpoint safe without a transaction, which D1 does not offer.
 *
 * NOTE WHAT IS NOT HERE. There is no statement updating `attempts.correct_count`
 * or `user_question_stats`: the triggers in 0005 do both, inside the answer
 * INSERT, and so cost nothing against the 50-query budget. Three statements
 * that used to be in this batch are gone with them, and the rollup can no
 * longer drift from the answer log because nothing can write one without the
 * other.
 */
export async function submitAttempt(
  db: Db,
  args: SubmitArgs,
): Promise<{ applied: boolean }> {
  const guard = attemptGuard(args.attemptId, args.userId);
  const answered = args.answers.filter((a) => a.answered);
  const correct = answered.filter((a) => a.isCorrect).length;

  const answerRows = answered.map((a) => ({
    q: a.questionId,
    o: a.selectedOptionId === null ? null : optKeyOf(a.selectedOptionId),
    k: a.isCorrect ? 1 : 0,
    p: a.deliveredPosition,
  }));

  const statements: PendingStatement[] = [
    // 1. The answers. ONE statement for the whole paper, and the triggers on
    //    this INSERT are what maintain every counter below it.
    sql(
      `INSERT INTO ${T.attemptAnswers}
         (attempt_id, question_id, selected_opt_key, is_correct,
          delivered_position, time_ms, revised, answered_at)
       SELECT ?2,
              json_extract(j.value, '$.q'),
              json_extract(j.value, '$.o'),
              json_extract(j.value, '$.k'),
              json_extract(j.value, '$.p'),
              NULL, 0, ?3
         FROM json_each(?1) j
        WHERE ${guard.fragment(4)}
       ON CONFLICT (attempt_id, question_id) DO NOTHING`,
      JSON.stringify(answerRows),
      args.attemptId,
      args.scoredAt,
      ...guard.binds,
    ),

    // 2. The revision schedule.
    upsertSrsFromAnswersStatement({
      userId: args.userId,
      answers: args.answers,
      now: args.scoredAt,
      guard,
    }),

    // 3. The streak, in the candidate's own calendar day.
    touchStreakStatement({ userId: args.userId, now: args.scoredAt, guard }),

    // 4. Close the wall-clock session.
    closeStudySessionStatement({
      userId: args.userId,
      attemptId: args.attemptId,
      answered: answered.length,
      correct,
      now: args.submittedAt,
    }),

    // 5. The status flip. LAST, and the only statement whose `changes` matters.
    sql(
      `UPDATE ${T.attempts}
          SET status = 'submitted', submitted_at = ?3, elapsed_ms = ?4
        WHERE id = ?1 AND user_id = ?2 AND status = 'in_progress'`,
      args.attemptId,
      args.userId,
      args.submittedAt,
      args.elapsedMs,
    ),
  ];

  const results = await db.batch(statements);
  const flip = results[results.length - 1];
  return { applied: (flip?.meta.changes ?? 0) === 1 };
}

/**
 * NQ-24 attempt-answers-load. The answers already recorded. 1 query.
 *
 * `selected_option_id` is the VIRTUAL generated column -- zero bytes on disk,
 * and the reason this read does not have to re-concatenate an id the database
 * can express itself.
 */
export async function loadRecordedAnswers(
  db: Db,
  publicId: string,
  userId: string,
): Promise<Map<string, { optionId: string | null; isCorrect: boolean }>> {
  const rows = await db.all<{
    question_id: string;
    selected_option_id: string | null;
    is_correct: number;
  }>(
    `SELECT aa.question_id, aa.selected_option_id, aa.is_correct
       FROM ${T.attemptAnswers} aa
       JOIN ${T.attempts} a ON a.id = aa.attempt_id
      WHERE a.public_id = ?1 AND a.user_id = ?2`,
    publicId,
    userId,
  );

  const out = new Map<string, { optionId: string | null; isCorrect: boolean }>();
  for (const row of rows) {
    out.set(row.question_id, {
      optionId: row.selected_option_id,
      isCorrect: row.is_correct === 1,
    });
  }
  return out;
}

/** NQ-20 resume-attempt. The caller's most recent live attempt. 1 query. */
export async function findResumableAttempt(
  db: Db,
  userId: string,
  now: number,
): Promise<AttemptRow | null> {
  return await db.first<AttemptRow>(
    `SELECT ${ATTEMPT_SELECT}
       FROM ${T.attempts} a
      WHERE a.user_id = ?1 AND a.status = 'in_progress'
        AND (a.deadline_at IS NULL OR a.deadline_at > ?2)
      ORDER BY a.started_at DESC LIMIT 1`,
    userId,
    now,
  );
}

/**
 * NQ-22 attempt-history. 1 query, newest first, cursor-paged.
 *
 * ONE table, so no UNION ALL -- which is the clearest single payoff of
 * unifying mock and practice attempts. `correct_count` is the
 * trigger-maintained score, so this read works unchanged after archival has
 * deleted the raw answers the score was computed from.
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
    mode: string;
    public_id: string;
    label: string;
    score: number;
    total: number;
    at: number;
    status: string;
  }>(
    `SELECT a.mode, a.public_id,
            COALESCE(t.name, a.mode) AS label,
            a.correct_count AS score, a.question_count AS total,
            a.started_at AS at, a.status
       FROM ${T.attempts} a
       LEFT JOIN ${T.mockTestTemplates} t ON t.id = a.template_id
      WHERE a.user_id = ?1 AND a.started_at < ?2
      ORDER BY a.started_at DESC
      LIMIT ?3`,
    args.userId,
    args.beforeStartedAt ?? Number.MAX_SAFE_INTEGER,
    args.limit,
  );

  return rows.map((r) => ({
    kind: r.mode === 'mock' ? 'mock' : 'practice',
    id: r.public_id,
    label: r.label,
    score: r.score,
    total: r.total,
    at: r.at,
    status: r.status,
  }));
}

/**
 * Commits one practice answer. 4 statements, ONE batch, ONE round trip.
 *
 * Returns `applied: false` if the question was already answered in this
 * attempt, in which case nothing was written. That makes the endpoint
 * idempotent on `(attemptId, questionId)` WITHOUT an idempotency key, which is
 * exactly what the offline outbox wants: replaying a queued answer converges
 * instead of inflating the user's stats.
 *
 * The answer INSERT runs LAST and its `changes` is the decision, for the same
 * ordering reason as `submitAttempt` -- and because the trigger on that INSERT
 * is what moves `attempts.answered_count` and `user_question_stats`, so the
 * counters the handler reads back afterwards are already correct.
 *
 * A SKIP (`selectedOptionId === null`) is recorded as a row with a NULL
 * `selected_opt_key`, which is an exposure but not an attempt: it must not
 * count toward accuracy, must not feed the revision schedule, and must not
 * touch the streak. Doing a paper by pressing skip fifty times is not a day's
 * study.
 */
export async function commitPracticeAnswer(
  db: Db,
  args: {
    attemptId: number;
    userId: string;
    questionId: string;
    chapterId: string;
    selectedOptionId: string | null;
    isCorrect: boolean;
    deliveredPosition: number | null;
    now: number;
    /** Telemetry. Influences the revision schedule only, never the score. */
    latencyMs?: number;
    flaggedGuess?: boolean;
  },
): Promise<{ applied: boolean }> {
  const guard = unansweredGuard(args.attemptId, args.questionId);
  const answered = args.selectedOptionId !== null;

  const rollup: RollupAnswer[] = [
    {
      questionId: args.questionId,
      chapterId: args.chapterId,
      isCorrect: args.isCorrect,
      answered,
    },
  ];

  const statements: PendingStatement[] = [];

  if (answered) {
    statements.push(
      upsertSrsFromAnswersStatement({
        userId: args.userId,
        answers: rollup,
        now: args.now,
        guard,
      }),
      touchStreakStatement({ userId: args.userId, now: args.now, guard }),
      bumpStudySessionStatement({
        userId: args.userId,
        attemptId: args.attemptId,
        isCorrect: args.isCorrect,
        guard,
      }),
    );
  }

  statements.push(
    sql(
      `INSERT INTO ${T.attemptAnswers}
         (attempt_id, question_id, selected_opt_key, is_correct,
          delivered_position, time_ms, revised, answered_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?9, ?7
        WHERE EXISTS (SELECT 1 FROM ${T.attempts}
                       WHERE id = ?1 AND user_id = ?8 AND status = 'in_progress')
       ON CONFLICT (attempt_id, question_id) DO NOTHING`,
      args.attemptId,
      args.questionId,
      args.selectedOptionId === null ? null : optKeyOf(args.selectedOptionId),
      args.isCorrect ? 1 : 0,
      args.deliveredPosition,
      args.latencyMs ?? null,
      args.now,
      args.userId,
      // `revised` is the "changed their mind" flag. A first answer has not.
      // The flagged-guess telemetry rides here rather than in a column of its
      // own, because this table may not grow one: it is the only unbounded
      // table on the platform and a flag is a bit, not a row.
      args.flaggedGuess === true ? 1 : 0,
    ),
  );

  const results = await db.batch(statements);
  const insert = results[results.length - 1];
  return { applied: (insert?.meta.changes ?? 0) === 1 };
}

/**
 * Finishes an untimed attempt. 2 statements, ONE batch.
 *
 * Idempotent: finishing a finished attempt changes nothing and reports false.
 */
export async function finishAttempt(
  db: Db,
  args: { attemptId: number; userId: string; answered: number; correct: number; now: number },
): Promise<boolean> {
  const results = await db.batch([
    sql(
      `UPDATE ${T.attempts}
          SET status = 'submitted', submitted_at = ?3,
              elapsed_ms = ?3 - started_at
        WHERE id = ?1 AND user_id = ?2 AND status = 'in_progress'`,
      args.attemptId,
      args.userId,
      args.now,
    ),
    closeStudySessionStatement({
      userId: args.userId,
      attemptId: args.attemptId,
      answered: args.answered,
      correct: args.correct,
      now: args.now,
    }),
  ]);
  return (results[0]?.meta.changes ?? 0) === 1;
}
