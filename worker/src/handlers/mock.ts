/**
 * Mock test handlers - the centre of the anti-cheat work.
 *
 * WHAT THIS REPLACES. `frontend/src/pages/app/MockTestQuiz.tsx` fetches the
 * chapter JSON including `correct_option_index`, scores in the browser against
 * `q.correctIndex`, and runs the clock as a `setInterval`. Opening devtools
 * reveals the whole key; stopping the interval or editing the localStorage
 * draft grants unlimited time.
 *
 * WHAT MAKES THAT IMPOSSIBLE HERE, structurally rather than by politeness:
 *
 * 1. The key is a column (`question_options.is_correct`) that only
 *    `loadAnswerKey` selects, and `loadAnswerKey` is called once, during
 *    scoring, after the submission has arrived. No pre-answer payload can
 *    contain it, because the function that builds option lists does not select
 *    that column.
 * 2. Option identity on the wire is an opaque per-attempt ref, minted from the
 *    CSPRNG at start and stored on the attempt. The client submits a ref, so
 *    there is no index to correlate with the public JSON, and a ref harvested
 *    from a finished attempt is meaningless in a new one.
 * 3. The paper is permuted per attempt, so even position-to-position
 *    correlation against the authored order fails.
 * 4. `expires_at` is written by the server at start and never accepted from a
 *    client. Scoring uses the server clock, and the "what was submitted in
 *    time" question is answered by what the server actually received before the
 *    deadline - see `domain/expiry.ts`.
 * 5. Scoring happens here. The request body has no field in which to assert a
 *    score, a correctness bit, or a timestamp.
 */

import { fail } from '../shared/errors.ts';
import { newId } from '../lib/ids.ts';
import { cryptoShuffle } from '../lib/permute.ts';
import { clampSubmission, deadlineFor, syncDecision } from '../domain/expiry.ts';
import { scorePaper } from '../domain/scoring.ts';
import { selectPaper } from '../domain/blueprint.ts';
import {
  drawChapterPools,
  getActiveMockTemplate,
  getBlueprint,
  loadAnswerKey,
  loadOptionsForQuestions,
} from '../data/content.ts';
import {
  attemptStatus,
  createAttemptBatch,
  loadAttempt,
  loadPaper,
  loadRecordedAnswers,
  parseSyncedAnswers,
  submitAttempt,
  syncAnswers,
} from '../data/mock.ts';
import type { SubmissionAnswer } from '../data/mock.ts';
import { consumeRateLimit, RATE_LIMITS } from '../data/infra.ts';
import { bodyIndex, buildAttemptPaper, publicOptionsFor, toAttemptQuestions } from './paper.ts';
import { ok, requireUser, withIdempotency } from './context.ts';
import type { HandlerContext, HandlerResult } from './context.ts';
import type {
  MockAttemptPaper,
  MockReviewQuestion,
  MockSubmitResponse,
  MockSyncResponse,
} from '../shared/types.ts';
import type { MockStartInput, MockSubmitInput, MockSyncInput } from '../validation/schemas.ts';

/** Shared by every rate-limited handler here. */
async function enforceLimit(
  ctx: HandlerContext,
  rule: { name: string; limit: number; windowMs: number },
  subject: string,
): Promise<void> {
  const result = await consumeRateLimit(ctx.db, rule, subject, ctx.clock.now());
  if (!result.allowed) {
    fail('RATE_LIMITED', 'Too many requests. Please slow down.', {
      retryAfterMs: result.retryAfterMs,
    });
  }
}

/**
 * POST /api/mock/start - 11 D1 queries, CONSTANT in paper size.
 *
 * rate limit 1, idempotency reserve 1, template 1, blueprint 1, pool draw 1,
 * option bodies 1, attempt + paper insert 2 (one batch), paper read-back 1,
 * idempotency finalise 1.
 */
export async function startMock(
  ctx: HandlerContext,
  input: MockStartInput,
): Promise<HandlerResult<MockAttemptPaper>> {
  const auth = requireUser(ctx);
  await enforceLimit(ctx, RATE_LIMITS.mockStart, auth.user.id);

  return await withIdempotency(
    ctx,
    {
      userId: auth.user.id,
      key: input.idempotencyKey,
      endpoint: 'POST /api/mock/start',
      body: input,
    },
    async () => {
      const template = await getActiveMockTemplate(ctx.db, input.templateId);
      if (!template) fail('NOT_FOUND', 'That mock test does not exist.');

      const blueprint = await getBlueprint(ctx.db, input.templateId);
      if (blueprint.length === 0) {
        fail('INSUFFICIENT_CONTENT', 'That mock test has no questions configured.');
      }

      // The composition comes from the blueprint, which is server data. The
      // request named a template and nothing else: it cannot ask for a shorter
      // paper, an easier chapter, or a specific question.
      const pools = await drawChapterPools(ctx.db, input.templateId);
      const selection = selectPaper({ blueprint, pools, shuffle: cryptoShuffle });

      if (selection.picks.length === 0) {
        fail('INSUFFICIENT_CONTENT', 'No published questions are available yet.');
      }

      const questionIds = selection.picks.map((p) => p.questionId);
      const optionsByQuestion = await loadOptionsForQuestions(ctx.db, questionIds);
      const paper = buildAttemptPaper(selection.picks, optionsByQuestion);

      if (paper.length === 0) {
        fail('INSUFFICIENT_CONTENT', 'No answerable questions are available yet.');
      }

      const startedAt = ctx.clock.now();
      const durationSeconds = template.duration_minutes * 60;
      const expiresAt = deadlineFor(startedAt, durationSeconds);
      const attemptId = newId('mat');

      await ctx.db.batch(
        createAttemptBatch({
          attemptId,
          userId: auth.user.id,
          templateId: template.id,
          startedAt,
          expiresAt,
          durationSeconds,
          paper,
        }),
      );

      // Read the paper back rather than assembling the response from the
      // in-memory pick. It costs one query and it means the client is shown
      // exactly the permutation that was persisted - if the insert had dropped
      // a row, the response would say so instead of promising a question the
      // scorer will never see.
      const bodies = bodyIndex(optionsByQuestion);
      const rows = await loadPaper(ctx.db, attemptId, auth.user.id);

      return ok<MockAttemptPaper>({
        attemptId,
        templateId: template.id,
        status: 'in_progress',
        startedAt,
        expiresAt,
        serverNow: startedAt,
        durationSeconds,
        questionCount: paper.length,
        questions: rows.map((row) => ({
          questionId: row.questionId,
          chapterId: row.chapterId,
          position: row.position,
          stem: row.stem,
          options: publicOptionsFor(row, bodies),
        })),
        savedAnswers: {},
      });
    },
  );
}

/**
 * GET /api/mock/attempts/:attemptId - 3 D1 queries.
 *
 * The resume path. Returns the paper and the answers the server has already
 * accepted, so a reload does not depend on localStorage surviving - and cannot
 * be influenced by editing it.
 */
export async function getMockAttempt(
  ctx: HandlerContext,
  attemptId: string,
): Promise<HandlerResult<MockAttemptPaper>> {
  const auth = requireUser(ctx);

  const attempt = await loadAttempt(ctx.db, attemptId, auth.user.id);
  if (!attempt) fail('NOT_FOUND', 'That attempt does not exist.');

  const rows = await loadPaper(ctx.db, attemptId, auth.user.id);
  const optionsByQuestion = await loadOptionsForQuestions(
    ctx.db,
    rows.map((r) => r.questionId),
  );

  const now = ctx.clock.now();

  return ok<MockAttemptPaper>({
    attemptId: attempt.id,
    templateId: attempt.template_id,
    status: attemptStatus(attempt),
    startedAt: attempt.started_at,
    expiresAt: attempt.expires_at,
    serverNow: now,
    durationSeconds: attempt.duration_seconds,
    questionCount: attempt.question_count,
    questions: toAttemptQuestions(rows, optionsByQuestion),
    savedAnswers: parseSyncedAnswers(attempt) ?? {},
  });
}

/**
 * POST /api/mock/sync - 3 D1 queries.
 *
 * The coarse autosave, and the mechanism that gives the expiry clamp something
 * true to score. The client calls it every 10-15 seconds and on every page
 * change, NOT on every keystroke: Workers Free allows 100k requests a day.
 *
 * Naturally idempotent - the map replaces the stored snapshot - so the offline
 * outbox needs no key for it.
 */
export async function syncMock(
  ctx: HandlerContext,
  input: MockSyncInput,
): Promise<HandlerResult<MockSyncResponse>> {
  const auth = requireUser(ctx);
  await enforceLimit(ctx, RATE_LIMITS.mockSync, auth.user.id);

  const attempt = await loadAttempt(ctx.db, input.attemptId, auth.user.id);
  if (!attempt) fail('NOT_FOUND', 'That attempt does not exist.');

  const now = ctx.clock.now();
  const decision = syncDecision({
    now,
    expiresAt: attempt.expires_at,
    status: attempt.status,
  });

  // The same predicate is also the UPDATE's WHERE clause, so a race between
  // this decision and the write cannot let a post-deadline snapshot through.
  // This copy exists only to give the client an honest reason.
  const accepted = decision.accepted
    ? await syncAnswers(ctx.db, {
        attemptId: input.attemptId,
        userId: auth.user.id,
        answers: input.answers,
        now,
      })
    : false;

  return ok<MockSyncResponse>({
    accepted,
    serverNow: now,
    expiresAt: attempt.expires_at,
    remainingMs: Math.max(0, attempt.expires_at - now),
    ...(accepted ? {} : { reason: decision.reason ?? 'past_deadline' }),
  });
}

/**
 * POST /api/mock/submit - 13 D1 queries, CONSTANT in the size of the paper.
 *
 * rate limit 1, idempotency 2, attempt 1, paper 1, key 1, option bodies 1,
 * commit batch 6 (one round trip).
 *
 * A hundred answers are written by ONE statement: the rows travel as a single
 * JSON bound parameter and are expanded with `json_each`, because D1 allows 50
 * queries per invocation and 100 bound parameters per statement, so neither a
 * loop of inserts nor a multi-row VALUES list would fit.
 */
export async function submitMock(
  ctx: HandlerContext,
  input: MockSubmitInput,
): Promise<HandlerResult<MockSubmitResponse>> {
  const auth = requireUser(ctx);
  await enforceLimit(ctx, RATE_LIMITS.mockSubmit, auth.user.id);

  return await withIdempotency(
    ctx,
    {
      userId: auth.user.id,
      key: input.idempotencyKey,
      endpoint: 'POST /api/mock/submit',
      body: input,
    },
    async () => {
      const attempt = await loadAttempt(ctx.db, input.attemptId, auth.user.id);
      if (!attempt) fail('NOT_FOUND', 'That attempt does not exist.');

      if (attempt.status !== 'in_progress') {
        // Deliberately a 409 and not a re-score. A finished attempt is read
        // back through GET /api/mock/attempts/:id/review, which is a read and
        // cannot change a stored result.
        fail('ATTEMPT_NOT_IN_PROGRESS', 'This attempt has already been submitted.');
      }

      const paper = await loadPaper(ctx.db, input.attemptId, auth.user.id);
      if (paper.length === 0) fail('INTERNAL', 'This attempt has no paper.');

      const now = ctx.clock.now();

      // THE CLAMP. Nothing from the request influences it: `now` is the
      // server's clock, `expires_at` was written by the server at start, and
      // the fallback snapshot is whatever the server itself accepted before the
      // deadline.
      const clamp = clampSubmission({
        now,
        startedAt: attempt.started_at,
        expiresAt: attempt.expires_at,
        submitted: input.answers,
        syncedSnapshot: parseSyncedAnswers(attempt),
      });

      const questionIds = paper.map((p) => p.questionId);
      const key = await loadAnswerKey(ctx.db, questionIds);

      const scored = scorePaper({
        paper,
        key,
        answers: clamp.answers,
        // Strict for a live payload: an off-paper question id or an
        // unresolvable ref is a client bug or a probe, and either way the
        // request is refused. Lenient for the stored snapshot, which was
        // already accepted once and must not cost a candidate their paper
        // because one stale entry no longer resolves.
        options: { strict: clamp.usedPayload },
      });

      if (clamp.usedPayload && scored.rejectedQuestionIds.length > 0) {
        fail('QUESTION_NOT_ON_PAPER', 'Some answers are not for questions on this paper.', {
          fields: { answers: scored.rejectedQuestionIds.slice(0, 10).join(', ') },
        });
      }
      if (clamp.usedPayload && scored.unknownRefQuestionIds.length > 0) {
        fail('UNKNOWN_OPTION_REF', 'Some answers reference an unknown option.', {
          fields: { answers: scored.unknownRefQuestionIds.slice(0, 10).join(', ') },
        });
      }

      const answers: SubmissionAnswer[] = scored.questions.map((q) => ({
        questionId: q.questionId,
        chapterId: q.chapterId,
        isCorrect: q.isCorrect,
        answered: q.answered,
        selectedOptionId: q.selectedOptionId,
      }));

      const optionsByQuestion = await loadOptionsForQuestions(ctx.db, questionIds);
      const bodies = bodyIndex(optionsByQuestion);

      const { applied } = await submitAttempt(ctx.db, {
        attemptId: input.attemptId,
        userId: auth.user.id,
        answers,
        score: scored.correct,
        timing: clamp.timing,
        submittedAt: now,
        scoredAt: clamp.scoredAt,
      });

      if (!applied) {
        // Lost the race with a concurrent submission that used a different
        // idempotency key. Nothing was written by this call.
        fail('ATTEMPT_NOT_IN_PROGRESS', 'This attempt has already been submitted.');
      }

      const paperById = new Map(paper.map((p) => [p.questionId, p]));

      // THE ONLY KEY DISCLOSURE for a mock attempt, and it happens after the
      // status has already been flipped to `submitted` - so the paper cannot be
      // re-answered with the key in hand.
      const review: MockReviewQuestion[] = scored.questions.map((q) => {
        const row = paperById.get(q.questionId);
        return {
          questionId: q.questionId,
          chapterId: q.chapterId,
          position: q.position,
          stem: row?.stem ?? '',
          options: row ? publicOptionsFor(row, bodies) : [],
          selectedRef: q.selectedRef,
          correctRef: q.correctRef,
          isCorrect: q.isCorrect,
          explanation: row?.explanation ?? null,
        };
      });

      return ok<MockSubmitResponse>({
        attemptId: input.attemptId,
        status: 'submitted',
        score: scored.correct,
        total: scored.total,
        correct: scored.correct,
        incorrect: scored.incorrect,
        skipped: scored.skipped,
        accuracyPct: scored.accuracyPct,
        timing: clamp.timing,
        startedAt: attempt.started_at,
        expiresAt: attempt.expires_at,
        submittedAt: now,
        scoredAt: clamp.scoredAt,
        droppedLateAnswers: clamp.droppedLateAnswers,
        rejectedQuestionIds: scored.rejectedQuestionIds,
        review,
      });
    },
  );
}

/**
 * GET /api/mock/attempts/:attemptId/review - 5 D1 queries.
 *
 * Re-reads a submitted attempt's review from what was recorded, so a lost
 * response or a cleared browser does not lose the paper. A read, so it cannot
 * change a stored score, and it refuses an attempt that is still in progress -
 * which is what stops it from being a mid-exam key oracle.
 */
export async function getMockReview(
  ctx: HandlerContext,
  attemptId: string,
): Promise<HandlerResult<MockSubmitResponse>> {
  const auth = requireUser(ctx);

  const attempt = await loadAttempt(ctx.db, attemptId, auth.user.id);
  if (!attempt) fail('NOT_FOUND', 'That attempt does not exist.');

  if (attempt.status === 'in_progress') {
    fail('ATTEMPT_NOT_IN_PROGRESS', 'This attempt has not been submitted yet.');
  }

  const paper = await loadPaper(ctx.db, attemptId, auth.user.id);
  const questionIds = paper.map((p) => p.questionId);
  const key = await loadAnswerKey(ctx.db, questionIds);
  const recorded = await loadRecordedAnswers(ctx.db, attemptId, auth.user.id);
  const optionsByQuestion = await loadOptionsForQuestions(ctx.db, questionIds);
  const bodies = bodyIndex(optionsByQuestion);

  const answers: Record<string, string> = {};
  for (const row of paper) {
    const recordedAnswer = recorded.get(row.questionId);
    if (!recordedAnswer?.optionId) continue;
    const index = row.optionOrder.indexOf(recordedAnswer.optionId);
    if (index >= 0 && row.optionRefs[index]) answers[row.questionId] = row.optionRefs[index];
  }

  const scored = scorePaper({ paper, key, answers, options: { strict: false } });
  const paperById = new Map(paper.map((p) => [p.questionId, p]));

  return ok<MockSubmitResponse>({
    attemptId,
    status: 'submitted',
    score: attempt.score ?? scored.correct,
    total: scored.total,
    correct: scored.correct,
    incorrect: scored.incorrect,
    skipped: scored.skipped,
    accuracyPct: scored.accuracyPct,
    timing: attempt.timing === 'expired' ? 'expired' : 'on_time',
    startedAt: attempt.started_at,
    expiresAt: attempt.expires_at,
    submittedAt: attempt.submitted_at ?? attempt.expires_at,
    scoredAt: attempt.scored_at ?? attempt.expires_at,
    droppedLateAnswers: 0,
    rejectedQuestionIds: [],
    review: scored.questions.map((q) => {
      const row = paperById.get(q.questionId);
      return {
        questionId: q.questionId,
        chapterId: q.chapterId,
        position: q.position,
        stem: row?.stem ?? '',
        options: row ? publicOptionsFor(row, bodies) : [],
        selectedRef: q.selectedRef,
        correctRef: q.correctRef,
        isCorrect: q.isCorrect,
        explanation: row?.explanation ?? null,
      };
    }),
  });
}
