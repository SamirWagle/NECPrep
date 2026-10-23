/**
 * Mock test handlers - the centre of the anti-cheat work.
 *
 * WHAT THIS REPLACES. `frontend/src/pages/app/MockTestQuiz.tsx` fetches
 * the chapter JSON including `correct_option_index`, scores in the browser
 * against `q.correctIndex`, and runs the clock as a `setInterval`. Opening
 * devtools reveals the whole key; stopping the interval or editing the
 * localStorage draft grants unlimited time.
 *
 * WHAT MAKES THAT IMPOSSIBLE HERE, structurally rather than by politeness:
 *
 * 1. The key is a SEPARATE TABLE (`question_answer_keys`, one row per
 *    question). `questions` has no answer column and `question_options` has
 *    none either, so no amount of forgetting to narrow a SELECT list can leak
 *    it -- it takes naming a third table in a FROM clause, which `loadAnswerKey`
 *    is the only function in the codebase to do, and which is called once,
 *    during scoring, after the submission has arrived.
 * 2. Option identity on the wire is a per-attempt ref derived from the server's
 *    secret and the attempt's `option_seed`. The client submits a ref, so there
 *    is no index and no id to correlate with the public JSON, and a ref
 *    harvested from a finished attempt is meaningless in a new one.
 * 3. The paper is permuted per attempt, so even position-to-position
 *    correlation against the authored order fails.
 * 4. `deadline_at` is written by the server at start and never accepted from a
 *    client. Scoring uses the server clock, and the "what was submitted in
 *    time" question is answered by what the server actually received before the
 *    deadline - see `domain/expiry.ts` and `attempts.synced_answers`.
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
  drawBlueprintPools,
  getActiveMockTemplate,
  getBlueprint,
  loadAnswerKey,
  loadOptionsForQuestions,
} from '../data/content.ts';
import {
  attemptDurationSeconds,
  attemptScoredAt,
  attemptStatus,
  attemptTiming,
  createAttemptBatch,
  loadAttempt,
  loadPaper,
  loadRecordedAnswers,
  parseSyncedAnswers,
  submitAttempt,
  syncAnswers,
} from '../data/attempts.ts';
import type { AttemptRow, SubmissionAnswer } from '../data/attempts.ts';
import { consumeRateLimit, RATE_LIMITS } from '../data/infra.ts';
import { attachRefs, bodyIndex, buildAttemptPaper, publicOptionsFor, toAttemptQuestions } from './paper.ts';
import type { DeliverablePaperRow, RefContext } from './paper.ts';
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

function refContextFor(ctx: HandlerContext, attempt: AttemptRow): RefContext {
  return {
    secret: ctx.config.permutationSecret,
    optionSeed: attempt.option_seed,
    attemptPublicId: attempt.public_id,
  };
}

/** A CSPRNG seed for the per-attempt option permutation. */
function newOptionSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Kept inside 2^31 so it is a plain positive INTEGER in SQLite and in JSON.
  return buf[0] & 0x7fffffff;
}

/**
 * POST /api/mock/start - 12 D1 queries, CONSTANT in paper size.
 *
 * rate limit 1, idempotency reserve 1, template 1, blueprint 1, pool draw 1,
 * option bodies 1, attempt + paper + study session 3 (ONE batch), attempt
 * read-back 1, paper read-back 1, idempotency finalise 1.
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
      const pools = await drawBlueprintPools(ctx.db, input.templateId);
      const selection = selectPaper({
        blueprint,
        subchapterPools: pools.subchapterPools,
        chapterPools: pools.chapterPools,
        shuffle: cryptoShuffle,
        strictSubchapter: template.strict_subchapter === 1,
      });

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
      const publicId = newId('mat');

      await ctx.db.batch(
        createAttemptBatch({
          publicId,
          userId: auth.user.id,
          mode: 'mock',
          templateId: template.id,
          // NULL: a mock spans all ten chapters, and `attempts.chapter_id` is
          // for a single-chapter practice set.
          chapterId: null,
          optionSeed: newOptionSeed(),
          startedAt,
          deadlineAt: deadlineFor(startedAt, durationSeconds),
          paper,
        }),
      );

      // Read the attempt and the paper back rather than assembling the response
      // from the in-memory pick. It costs two queries and it means the client
      // is shown exactly the permutation that was persisted - if the insert had
      // dropped a row, the response would say so instead of promising a
      // question the scorer will never see. The read-back is also where the
      // attempt's `option_seed` comes from, which the refs are derived under.
      const attempt = await loadAttempt(ctx.db, publicId, auth.user.id);
      if (!attempt) fail('INTERNAL', 'The attempt could not be created.');

      const rows = attachRefs(
        await loadPaper(ctx.db, publicId, auth.user.id),
        refContextFor(ctx, attempt),
      );

      return ok<MockAttemptPaper>({
        attemptId: attempt.public_id,
        templateId: template.id,
        status: 'in_progress',
        startedAt: attempt.started_at,
        expiresAt: attempt.deadline_at ?? startedAt,
        serverNow: startedAt,
        durationSeconds,
        questionCount: attempt.question_count,
        questions: toAttemptQuestions(rows, optionsByQuestion),
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

  const rows = attachRefs(
    await loadPaper(ctx.db, attemptId, auth.user.id),
    refContextFor(ctx, attempt),
  );
  const optionsByQuestion = await loadOptionsForQuestions(
    ctx.db,
    rows.map((r) => r.questionId),
  );

  const now = ctx.clock.now();

  return ok<MockAttemptPaper>({
    attemptId: attempt.public_id,
    templateId: attempt.template_id ?? '',
    status: attemptStatus(attempt),
    startedAt: attempt.started_at,
    expiresAt: attempt.deadline_at ?? attempt.started_at,
    serverNow: now,
    durationSeconds: attemptDurationSeconds(attempt),
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
  const expiresAt = attempt.deadline_at ?? attempt.started_at;
  const decision = syncDecision({
    now,
    expiresAt,
    status: attempt.status,
  });

  // The same predicate is also the UPDATE's WHERE clause - and a CHECK on the
  // table - so a race between this decision and the write cannot let a
  // post-deadline snapshot through. This copy exists only to give the client an
  // honest reason.
  const accepted = decision.accepted
    ? await syncAnswers(ctx.db, {
        publicId: input.attemptId,
        userId: auth.user.id,
        answers: input.answers,
        now,
      })
    : false;

  return ok<MockSyncResponse>({
    accepted,
    serverNow: now,
    expiresAt,
    remainingMs: Math.max(0, expiresAt - now),
    ...(accepted ? {} : { reason: decision.reason ?? 'past_deadline' }),
  });
}

/**
 * POST /api/mock/submit - 13 D1 queries, CONSTANT in the size of the paper.
 *
 * rate limit 1, idempotency 2, attempt 1, paper 1, key 1, option bodies 1,
 * commit batch 5 (one round trip), attempt re-read 1.
 *
 * A hundred answers are written by ONE statement: the rows travel as a single
 * JSON bound parameter and are expanded with `json_each`, because D1 allows 50
 * queries per invocation and 100 bound parameters per statement, so neither a
 * loop of inserts nor a multi-row VALUES list would fit. The rollups that used
 * to be three more statements are now triggers on that INSERT.
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

      const stored = await loadPaper(ctx.db, input.attemptId, auth.user.id);
      if (stored.length === 0) fail('INTERNAL', 'This attempt has no paper.');
      const paper = attachRefs(stored, refContextFor(ctx, attempt));

      const now = ctx.clock.now();
      const expiresAt = attempt.deadline_at ?? attempt.started_at;

      // THE CLAMP. Nothing from the request influences it: `now` is the
      // server's clock, `deadline_at` was written by the server at start, and
      // the fallback snapshot is whatever the server itself accepted before the
      // deadline.
      const clamp = clampSubmission({
        now,
        startedAt: attempt.started_at,
        expiresAt,
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

      const paperById = new Map(paper.map((p) => [p.questionId, p]));

      const answers: SubmissionAnswer[] = scored.questions.map((q) => {
        const row = paperById.get(q.questionId);
        const index =
          row && q.selectedOptionId !== null ? row.optionOrder.indexOf(q.selectedOptionId) : -1;
        return {
          questionId: q.questionId,
          chapterId: q.chapterId,
          isCorrect: q.isCorrect,
          answered: q.answered,
          selectedOptionId: q.selectedOptionId,
          // 1-based screen position under this attempt's permutation.
          // Analytics only -- it is what measures position bias -- and never
          // an input to grading.
          deliveredPosition: index >= 0 ? index + 1 : null,
        };
      });

      const optionsByQuestion = await loadOptionsForQuestions(ctx.db, questionIds);
      const bodies = bodyIndex(optionsByQuestion);

      const { applied } = await submitAttempt(ctx.db, {
        attemptId: attempt.id,
        publicId: attempt.public_id,
        userId: auth.user.id,
        answers,
        submittedAt: now,
        scoredAt: clamp.scoredAt,
        elapsedMs: Math.max(0, clamp.scoredAt - attempt.started_at),
      });

      if (!applied) {
        // Lost the race with a concurrent submission that used a different
        // idempotency key. Nothing was written by this call.
        fail('ATTEMPT_NOT_IN_PROGRESS', 'This attempt has already been submitted.');
      }

      // THE ONLY KEY DISCLOSURE for a mock attempt, and it happens after the
      // status has already been flipped to `submitted` - so the paper cannot be
      // re-answered with the key in hand.
      const review: MockReviewQuestion[] = scored.questions.map((q) =>
        reviewItem(q, paperById.get(q.questionId), bodies),
      );

      return ok<MockSubmitResponse>({
        attemptId: attempt.public_id,
        status: 'submitted',
        score: scored.correct,
        total: scored.total,
        correct: scored.correct,
        incorrect: scored.incorrect,
        skipped: scored.skipped,
        accuracyPct: scored.accuracyPct,
        timing: clamp.timing,
        startedAt: attempt.started_at,
        expiresAt,
        submittedAt: now,
        scoredAt: clamp.scoredAt,
        droppedLateAnswers: clamp.droppedLateAnswers,
        rejectedQuestionIds: scored.rejectedQuestionIds,
        review,
      });
    },
  );
}

function reviewItem(
  q: {
    questionId: string;
    chapterId: string;
    position: number;
    selectedRef: string | null;
    correctRef: string;
    isCorrect: boolean;
  },
  row: DeliverablePaperRow | undefined,
  bodies: ReadonlyMap<string, string>,
): MockReviewQuestion {
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
}

/**
 * GET /api/mock/attempts/:attemptId/review - 5 D1 queries.
 *
 * Re-reads a submitted attempt's review from what was recorded, so a lost
 * response or a cleared browser does not lose the paper. A read, so it cannot
 * change a stored score, and it refuses an attempt that is still in progress -
 * which is what stops it from being a mid-exam key oracle.
 *
 * `score`, `timing` and `scoredAt` come from the attempt row rather than from
 * re-scoring: `correct_count` is trigger-maintained and therefore survives
 * archival deleting the raw answers, and `timing`/`scoredAt` are derived from
 * `submitted_at` and `deadline_at` rather than stored as a third copy.
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

  const paper = attachRefs(
    await loadPaper(ctx.db, attemptId, auth.user.id),
    refContextFor(ctx, attempt),
  );
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
  const expiresAt = attempt.deadline_at ?? attempt.started_at;

  return ok<MockSubmitResponse>({
    attemptId: attempt.public_id,
    status: 'submitted',
    score: attempt.correct_count,
    total: scored.total,
    correct: scored.correct,
    incorrect: scored.incorrect,
    skipped: scored.skipped,
    accuracyPct: scored.accuracyPct,
    timing: attemptTiming(attempt),
    startedAt: attempt.started_at,
    expiresAt,
    submittedAt: attempt.submitted_at ?? expiresAt,
    scoredAt: attemptScoredAt(attempt),
    droppedLateAnswers: 0,
    rejectedQuestionIds: [],
    review: scored.questions.map((q) => reviewItem(q, paperById.get(q.questionId), bodies)),
  });
}
