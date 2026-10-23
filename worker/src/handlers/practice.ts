/**
 * Practice handlers - untimed, with the key revealed one question at a time
 * AFTER the answer is committed.
 *
 * This is the one place the API discloses an answer key during a session, and
 * it is a deliberate, bounded concession to what practice is actually for.
 * The ordering is what makes it safe:
 *
 *   1. resolve the submitted ref against the paper stored for this attempt
 *   2. join the key, compute correctness
 *   3. WRITE the answer and the rollups - guarded so a replay cannot re-write
 *   4. only then put `correctRef` and the explanation in the response
 *
 * So the key for question 7 becomes visible only once question 7 has been
 * answered on the record. There is no endpoint that reveals question 8's key,
 * and nothing in the paper payload hints at it.
 *
 * A practice session IS an attempt (`attempts.mode` in
 * 'practice'|'srs'|'bookmark_review'|'weak_areas'). It used to be a separate
 * `practice_sessions` table with its own questions and answers alongside the
 * mock ones; one table means the rollup triggers, the history query and the
 * archival job exist once instead of twice.
 */

import { fail } from '../shared/errors.ts';
import { newId } from '../lib/ids.ts';
import { resolveOptionRef } from '../domain/scoring.ts';
import {
  drawPracticeQuestions,
  loadAnswerKey,
  loadOptionsForQuestions,
} from '../data/content.ts';
import {
  readBookmarkedQuestionIds,
  readDueQuestionIds,
  readWeakQuestionIds,
} from '../data/progress.ts';
import {
  attemptStatus,
  commitPracticeAnswer,
  createAttemptBatch,
  finishAttempt,
  loadAttempt,
  loadPaper,
  loadPaperQuestionWithKey,
  loadRecordedAnswers,
  modeForPractice,
  practiceModeFor,
} from '../data/attempts.ts';
import type { AttemptRow } from '../data/attempts.ts';
import { consumeRateLimit, RATE_LIMITS } from '../data/infra.ts';
import { attachRefs, attachRefsToOne, buildAttemptPaper, toAttemptQuestions } from './paper.ts';
import type { RefContext } from './paper.ts';
import { ok, requireUser, withIdempotency } from './context.ts';
import type { HandlerContext, HandlerResult } from './context.ts';
import type {
  PracticeAnswerResponse,
  PracticeAnswerResult,
  PracticeFinishResponse,
  PracticeSessionPaper,
} from '../shared/types.ts';
import type {
  PracticeAnswerInput,
  PracticeFinishInput,
  PracticeStartInput,
} from '../validation/schemas.ts';

function refContextFor(ctx: HandlerContext, attempt: AttemptRow): RefContext {
  return {
    secret: ctx.config.permutationSecret,
    optionSeed: attempt.option_seed,
    attemptPublicId: attempt.public_id,
  };
}

function newOptionSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] & 0x7fffffff;
}

/**
 * Chooses the question set for a practice mode. 1 D1 query in every case.
 *
 * The SOURCE of the questions is server-decided. A client asking for `wrong`
 * mode gets the questions the server's own stats say it got wrong; it cannot
 * hand over a list of question ids, which would otherwise be a way to farm the
 * per-question reveal for a chosen set.
 */
async function pickPracticeQuestions(
  ctx: HandlerContext,
  userId: string,
  input: PracticeStartInput,
): Promise<Array<{ questionId: string; chapterId: string }>> {
  switch (input.mode) {
    case 'bookmarks':
      return await readBookmarkedQuestionIds(ctx.db, userId, input.questionCount);
    case 'wrong':
      return await readWeakQuestionIds(ctx.db, userId, input.questionCount);
    case 'srs':
      return await readDueQuestionIds(ctx.db, {
        userId,
        now: ctx.clock.now(),
        limit: input.questionCount,
      });
    case 'chapter':
    case 'custom':
    default:
      return await drawPracticeQuestions(ctx.db, {
        chapterIds: input.chapterIds ?? null,
        limit: input.questionCount,
      });
  }
}

/**
 * POST /api/practice/start - 8 D1 queries, constant in session size.
 *
 * idempotency 2, question pick 1, option bodies 1, attempt + paper + study
 * session 3 (ONE batch), attempt read-back 1, paper read-back 1 -- the last
 * two share the budget with the idempotency finalise.
 */
export async function startPractice(
  ctx: HandlerContext,
  input: PracticeStartInput,
): Promise<HandlerResult<PracticeSessionPaper>> {
  const auth = requireUser(ctx);

  return await withIdempotency(
    ctx,
    {
      userId: auth.user.id,
      key: input.idempotencyKey,
      endpoint: 'POST /api/practice/start',
      body: input,
    },
    async () => {
      if (input.mode === 'chapter' && (input.chapterIds?.length ?? 0) === 0) {
        fail('BAD_REQUEST', 'Chapter practice needs at least one chapter.', {
          fields: { chapterIds: 'Pick at least one chapter.' },
        });
      }

      const picked = await pickPracticeQuestions(ctx, auth.user.id, input);
      if (picked.length === 0) {
        fail('INSUFFICIENT_CONTENT', 'No questions are available for that selection.');
      }

      const questionIds = picked.map((p) => p.questionId);
      const optionsByQuestion = await loadOptionsForQuestions(ctx.db, questionIds);
      const paper = buildAttemptPaper(
        picked.map((p, index) => ({ ...p, position: index + 1 })),
        optionsByQuestion,
      );

      if (paper.length === 0) {
        fail('INSUFFICIENT_CONTENT', 'No answerable questions are available.');
      }

      const publicId = newId('pse');
      const startedAt = ctx.clock.now();

      // `attempts.chapter_id` is set only for a genuinely single-chapter set.
      // A multi-chapter custom session leaves it NULL rather than naming one of
      // them, because a column that sometimes means "all of these" and
      // sometimes "this one" is worse than a NULL.
      const chapterId =
        input.chapterIds !== undefined && input.chapterIds.length === 1
          ? input.chapterIds[0]
          : null;

      await ctx.db.batch(
        createAttemptBatch({
          publicId,
          userId: auth.user.id,
          mode: modeForPractice(input.mode),
          templateId: null,
          chapterId,
          optionSeed: newOptionSeed(),
          startedAt,
          // Untimed, deliberately: practice is not an exam, and a NULL
          // deadline is what makes `syncAnswers` refuse to clamp one.
          deadlineAt: null,
          paper,
        }),
      );

      const attempt = await loadAttempt(ctx.db, publicId, auth.user.id);
      if (!attempt) fail('INTERNAL', 'The practice session could not be created.');

      const rows = attachRefs(
        await loadPaper(ctx.db, publicId, auth.user.id),
        refContextFor(ctx, attempt),
      );

      return ok<PracticeSessionPaper>({
        sessionId: attempt.public_id,
        mode: input.mode,
        status: 'in_progress',
        startedAt: attempt.started_at,
        serverNow: startedAt,
        questionCount: attempt.question_count,
        questions: toAttemptQuestions(rows, optionsByQuestion),
        answered: {},
      });
    },
  );
}

/**
 * GET /api/practice/sessions/:sessionId - 5 D1 queries.
 *
 * Resume. Replays the keys for questions already answered, and nothing else -
 * so reloading mid-session restores exactly the knowledge the user had earned.
 */
export async function getPracticeSession(
  ctx: HandlerContext,
  sessionId: string,
): Promise<HandlerResult<PracticeSessionPaper>> {
  const auth = requireUser(ctx);

  const attempt = await loadAttempt(ctx.db, sessionId, auth.user.id);
  if (!attempt) fail('NOT_FOUND', 'That practice session does not exist.');

  const rows = attachRefs(
    await loadPaper(ctx.db, sessionId, auth.user.id),
    refContextFor(ctx, attempt),
  );
  const optionsByQuestion = await loadOptionsForQuestions(
    ctx.db,
    rows.map((r) => r.questionId),
  );
  const committed = await loadRecordedAnswers(ctx.db, sessionId, auth.user.id);

  // The key is loaded for the ALREADY ANSWERED questions and for no others.
  // An unanswered question contributes nothing to this map, so resuming a
  // session discloses exactly what the user had already earned - it is not a
  // way to read the whole paper's key by starting a session and reloading.
  const answeredIds = rows
    .map((row) => row.questionId)
    .filter((questionId) => committed.has(questionId));
  const key = await loadAnswerKey(ctx.db, answeredIds);
  const correctByQuestion = new Map(key.map((k) => [k.questionId, k.correctOptionId]));

  const answered: Record<string, PracticeAnswerResult> = {};
  for (const row of rows) {
    const record = committed.get(row.questionId);
    if (!record) continue;

    const selectedIndex =
      record.optionId === null ? -1 : row.optionOrder.indexOf(record.optionId);
    const correctOptionId = correctByQuestion.get(row.questionId);
    const correctIndex =
      correctOptionId === undefined ? -1 : row.optionOrder.indexOf(correctOptionId);

    answered[row.questionId] = {
      questionId: row.questionId,
      selectedRef: selectedIndex >= 0 ? (row.optionRefs[selectedIndex] ?? null) : null,
      correctRef: correctIndex >= 0 ? (row.optionRefs[correctIndex] ?? '') : '',
      isCorrect: record.isCorrect,
      explanation: row.explanation,
    };
  }

  return ok<PracticeSessionPaper>({
    sessionId: attempt.public_id,
    mode: practiceModeFor(attempt.mode),
    status: attemptStatus(attempt),
    startedAt: attempt.started_at,
    serverNow: ctx.clock.now(),
    questionCount: attempt.question_count,
    questions: toAttemptQuestions(rows, optionsByQuestion),
    answered,
  });
}

/**
 * POST /api/practice/answer - 7 D1 queries.
 *
 * rate limit 1, question + key 1, commit batch 4 (counted as 4 statements but
 * one round trip), attempt counters read 1.
 *
 * IDEMPOTENT WITHOUT A KEY, on `(attemptId, questionId)`. The commit batch
 * guards every conditional statement with `NOT EXISTS (an answer for this
 * pair)` and the answer INSERT runs last, so replaying a queued offline answer
 * converges instead of inflating the user's stats. An idempotency key is
 * accepted anyway, for uniformity with the rest of the outbox.
 */
export async function answerPractice(
  ctx: HandlerContext,
  input: PracticeAnswerInput,
): Promise<HandlerResult<PracticeAnswerResponse>> {
  const auth = requireUser(ctx);

  const limit = await consumeRateLimit(
    ctx.db,
    RATE_LIMITS.practiceAnswer,
    auth.user.id,
    ctx.clock.now(),
  );
  if (!limit.allowed) {
    fail('RATE_LIMITED', 'Too many answers too quickly.', {
      retryAfterMs: limit.retryAfterMs,
    });
  }

  // Ownership is in the query: the join requires `attempts.user_id` to match,
  // so another user's session id resolves to nothing.
  const found = await loadPaperQuestionWithKey(ctx.db, {
    publicId: input.sessionId,
    userId: auth.user.id,
    questionId: input.questionId,
  });
  if (!found) fail('QUESTION_NOT_ON_PAPER', 'That question is not in this session.');

  if (found.row.attemptStatus !== 'in_progress') {
    fail('ATTEMPT_NOT_IN_PROGRESS', 'This practice session is already finished.');
  }
  if (found.correctOptionId === null) {
    fail('INTERNAL', 'That question has no answer key and cannot be scored.');
  }

  const question = attachRefsToOne(found.row, {
    secret: ctx.config.permutationSecret,
    optionSeed: found.row.optionSeed,
    attemptPublicId: input.sessionId,
  });

  let selectedOptionId: string | null = null;
  if (input.optionRef !== null) {
    selectedOptionId = resolveOptionRef(question, input.optionRef);
    if (selectedOptionId === null) {
      fail('UNKNOWN_OPTION_REF', 'That option does not belong to this question.');
    }
  }

  const isCorrect = selectedOptionId !== null && selectedOptionId === found.correctOptionId;
  const now = ctx.clock.now();
  const selectedIndex =
    selectedOptionId === null ? -1 : question.optionOrder.indexOf(selectedOptionId);

  await commitPracticeAnswer(ctx.db, {
    attemptId: found.row.attemptId,
    userId: auth.user.id,
    questionId: input.questionId,
    chapterId: found.row.chapterId,
    selectedOptionId,
    isCorrect,
    deliveredPosition: selectedIndex >= 0 ? selectedIndex + 1 : null,
    now,
    // Recorded, never trusted for scoring. The schema has already bounded
    // these; they exist so the revision schedule can be computed server-side
    // the way `frontend/src/services/scheduler.ts` does it today.
    latencyMs: input.latencyMs,
    flaggedGuess: input.flaggedGuess,
  });

  // Read back rather than counting in memory: `answered_count` and
  // `correct_count` are maintained by the trigger on the INSERT above, so the
  // attempt row is the authority and a replayed answer reports the same totals.
  const attempt = await loadAttempt(ctx.db, input.sessionId, auth.user.id);

  const correctIndex = question.optionOrder.indexOf(found.correctOptionId);
  const correctRef = correctIndex >= 0 ? (question.optionRefs[correctIndex] ?? '') : '';

  // The reveal. Strictly after the write above, and only for this question.
  return ok<PracticeAnswerResponse>({
    questionId: input.questionId,
    selectedRef: input.optionRef,
    correctRef,
    isCorrect,
    explanation: found.row.explanation,
    answeredCount: attempt?.answered_count ?? 0,
    correctCount: attempt?.correct_count ?? 0,
  });
}

/**
 * POST /api/practice/finish - 5 D1 queries.
 *
 * Idempotent twice over: through the idempotency key, and through the
 * `status = 'in_progress'` predicate on the UPDATE, so a replay returns the
 * same totals rather than a 409.
 */
export async function finishPractice(
  ctx: HandlerContext,
  input: PracticeFinishInput,
): Promise<HandlerResult<PracticeFinishResponse>> {
  const auth = requireUser(ctx);

  return await withIdempotency(
    ctx,
    {
      userId: auth.user.id,
      key: input.idempotencyKey,
      endpoint: 'POST /api/practice/finish',
      body: input,
    },
    async () => {
      const now = ctx.clock.now();

      const before = await loadAttempt(ctx.db, input.sessionId, auth.user.id);
      if (!before) fail('NOT_FOUND', 'That practice session does not exist.');

      await finishAttempt(ctx.db, {
        attemptId: before.id,
        userId: auth.user.id,
        answered: before.answered_count,
        correct: before.correct_count,
        now,
      });

      const session = await loadAttempt(ctx.db, input.sessionId, auth.user.id);
      if (!session) fail('NOT_FOUND', 'That practice session does not exist.');

      const answered = session.answered_count;
      const correct = session.correct_count;

      return ok<PracticeFinishResponse>({
        sessionId: session.public_id,
        total: session.question_count,
        correct,
        incorrect: Math.max(0, answered - correct),
        skipped: Math.max(0, session.question_count - answered),
        accuracyPct: answered === 0 ? 0 : Math.round((correct / answered) * 100),
        finishedAt: session.submitted_at ?? now,
      });
    },
  );
}
