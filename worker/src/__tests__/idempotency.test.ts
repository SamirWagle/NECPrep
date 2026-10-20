/**
 * Idempotency, which is the contract the offline outbox depends on.
 *
 * The scenarios are the ones a flaky mobile connection in Nepal actually
 * produces: the request committed but the response never arrived; the queue
 * replayed an entry it had already sent; two tabs submitted at once.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, expectFailure, measure } from './harness.ts';
import { startMock, submitMock } from '../handlers/mock.ts';
import { answerPractice, finishPractice, startPractice } from '../handlers/practice.ts';
import { putBookmark } from '../handlers/progress.ts';
import { submitErrataReport } from '../handlers/moderation.ts';
import { reserveIdempotency } from '../data/infra.ts';
import { canonicalJson } from '../lib/canonical.ts';
import { MINUTE } from '../lib/time.ts';

test('canonical JSON ignores key order and the idempotency key itself', () => {
  assert.equal(
    canonicalJson({ b: 1, a: 2, idempotencyKey: 'one' }),
    canonicalJson({ a: 2, b: 1, idempotencyKey: 'two' }),
  );
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
  // A missing key and an explicit undefined must fingerprint identically.
  assert.equal(canonicalJson({ a: 1 }), canonicalJson({ a: 1, b: undefined }));
  // Nested objects are canonicalised too.
  assert.equal(
    canonicalJson({ answers: { q2: 'b', q1: 'a' } }),
    canonicalJson({ answers: { q1: 'a', q2: 'b' } }),
  );
});

test('replaying mock/start with the same key returns the SAME paper', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const idempotencyKey = 'start-key-aaaaaaaa';

  const first = await measure(world, user, (ctx) =>
    startMock(ctx, { templateId: world.templateId, idempotencyKey }),
  );
  const second = await measure(world, user, (ctx) =>
    startMock(ctx, { templateId: world.templateId, idempotencyKey }),
  );

  assert.equal(first.result.replayed ?? false, false);
  assert.equal(second.result.replayed, true);
  assert.equal(second.result.body.attemptId, first.result.body.attemptId);
  assert.deepEqual(
    second.result.body.questions.map((q) => q.options.map((o) => o.ref)),
    first.result.body.questions.map((q) => q.options.map((o) => o.ref)),
    'the replayed paper must carry the identical refs, or the client would submit refs the server never minted',
  );

  world.close();
});

test('replaying mock/submit with the same key returns the SAME score', async () => {
  const world = createWorld();
  const user = world.makeUser();

  const start = await measure(world, user, (ctx) =>
    startMock(ctx, { templateId: world.templateId, idempotencyKey: 'sk-aaaaaaaa' }),
  );
  const paper = start.result.body;

  const answers: Record<string, string> = {};
  for (const question of paper.questions.slice(0, 4)) {
    answers[question.questionId] = question.options[0].ref;
  }

  world.clock.advance(MINUTE);
  const idempotencyKey = 'submit-key-bbbbbbbb';

  const first = await measure(world, user, (ctx) =>
    submitMock(ctx, { attemptId: paper.attemptId, idempotencyKey, answers }),
  );
  const second = await measure(world, user, (ctx) =>
    submitMock(ctx, { attemptId: paper.attemptId, idempotencyKey, answers }),
  );

  assert.equal(second.result.replayed, true);
  assert.equal(second.result.body.score, first.result.body.score);
  assert.deepEqual(second.result.body.review, first.result.body.review);

  // Critically, the replay does NOT re-score the attempt or double-count the
  // user's stats - it never reaches the write path at all.
  assert.ok(
    second.queries < first.queries,
    `a replay should be cheaper than the original (${second.queries} vs ${first.queries})`,
  );

  world.close();
});

test('a resubmit with a DIFFERENT key is refused, not scored twice', async () => {
  const world = createWorld();
  const user = world.makeUser();

  const start = await measure(world, user, (ctx) =>
    startMock(ctx, { templateId: world.templateId, idempotencyKey: 'sk2-aaaaaaaa' }),
  );
  const paper = start.result.body;

  world.clock.advance(MINUTE);
  await measure(world, user, (ctx) =>
    submitMock(ctx, {
      attemptId: paper.attemptId,
      idempotencyKey: 'first-key-cccccccc',
      answers: { [paper.questions[0].questionId]: paper.questions[0].options[0].ref },
    }),
  );

  const failure = await expectFailure(() =>
    measure(world, user, (ctx) =>
      submitMock(ctx, {
        attemptId: paper.attemptId,
        idempotencyKey: 'second-key-dddddddd',
        answers: { [paper.questions[0].questionId]: paper.questions[0].options[1].ref },
      }),
    ),
  );

  assert.equal(failure.code, 'ATTEMPT_NOT_IN_PROGRESS');
  assert.equal(failure.status, 409);

  world.close();
});

test('the same key with a different body is a conflict, never a wrong replay', async () => {
  const world = createWorld();
  const user = world.makeUser();

  const start = await measure(world, user, (ctx) =>
    startMock(ctx, { templateId: world.templateId, idempotencyKey: 'sk3-aaaaaaaa' }),
  );
  const paper = start.result.body;
  const sharedKey = 'shared-key-eeeeeeee';

  world.clock.advance(MINUTE);
  await measure(world, user, (ctx) =>
    submitMock(ctx, {
      attemptId: paper.attemptId,
      idempotencyKey: sharedKey,
      answers: { [paper.questions[0].questionId]: paper.questions[0].options[0].ref },
    }),
  );

  const failure = await expectFailure(() =>
    measure(world, user, (ctx) =>
      submitMock(ctx, {
        attemptId: paper.attemptId,
        idempotencyKey: sharedKey,
        // Same key, different answers. Replaying the stored response would be
        // a lie; scoring it would be a double submission.
        answers: { [paper.questions[1].questionId]: paper.questions[1].options[0].ref },
      }),
    ),
  );

  assert.equal(failure.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(failure.status, 409);

  world.close();
});

test('an in-flight reservation is reported, not silently duplicated', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const db = world.invocation();

  const args = {
    userId: user.id,
    key: 'inflight-key-ffffffff',
    endpoint: 'POST /api/mock/submit',
    requestHash: 'hash-1',
    now: world.clock.now(),
  };

  assert.deepEqual(await reserveIdempotency(db, args), { kind: 'proceed' });
  assert.deepEqual(await reserveIdempotency(db, args), { kind: 'in_flight' });
  assert.deepEqual(
    await reserveIdempotency(db, { ...args, requestHash: 'hash-2' }),
    { kind: 'reused' },
  );

  world.close();
});

test('one user\'s idempotency key cannot collide with another\'s', async () => {
  const world = createWorld();
  const alice = world.makeUser();
  const bob = world.makeUser();
  const db = world.invocation();

  const shared = {
    key: 'collide-key-gggggggg',
    endpoint: 'POST /api/mock/start',
    requestHash: 'hash-x',
    now: world.clock.now(),
  };

  assert.deepEqual(
    await reserveIdempotency(db, { ...shared, userId: alice.id }),
    { kind: 'proceed' },
  );
  assert.deepEqual(
    await reserveIdempotency(db, { ...shared, userId: bob.id }),
    { kind: 'proceed' },
    'Bob must get his own reservation, not Alice\'s in-flight marker',
  );

  world.close();
});

test('practice/answer is idempotent on (session, question) with NO key', async () => {
  const world = createWorld();
  const user = world.makeUser();

  const session = await measure(world, user, (ctx) =>
    startPractice(ctx, {
      mode: 'chapter',
      chapterIds: [world.chapterIds[0]],
      questionCount: 5,
      idempotencyKey: 'practice-start-hhhhhhhh',
    }),
  );
  const paper = session.result.body;
  const question = paper.questions[0];

  const first = await measure(world, user, (ctx) =>
    answerPractice(ctx, {
      sessionId: paper.sessionId,
      questionId: question.questionId,
      optionRef: question.options[0].ref,
    }),
  );

  // Replay the identical mutation, exactly as a drained outbox would.
  const second = await measure(world, user, (ctx) =>
    answerPractice(ctx, {
      sessionId: paper.sessionId,
      questionId: question.questionId,
      optionRef: question.options[0].ref,
    }),
  );

  assert.equal(first.result.body.answeredCount, 1);
  assert.equal(
    second.result.body.answeredCount,
    1,
    'a replayed answer must not inflate the counters',
  );
  assert.equal(second.result.body.correctRef, first.result.body.correctRef);
  assert.equal(second.result.body.isCorrect, first.result.body.isCorrect);

  world.close();
});

test('practice/finish replays its totals rather than conflicting', async () => {
  const world = createWorld();
  const user = world.makeUser();

  const session = await measure(world, user, (ctx) =>
    startPractice(ctx, {
      mode: 'chapter',
      chapterIds: [world.chapterIds[0]],
      questionCount: 3,
      idempotencyKey: 'practice-start-iiiiiiii',
    }),
  );
  const sessionId = session.result.body.sessionId;
  const finishKey = 'practice-finish-jjjjjjjj';

  const first = await measure(world, user, (ctx) =>
    finishPractice(ctx, { sessionId, idempotencyKey: finishKey }),
  );
  const second = await measure(world, user, (ctx) =>
    finishPractice(ctx, { sessionId, idempotencyKey: finishKey }),
  );

  assert.equal(second.result.replayed, true);
  assert.deepEqual(second.result.body, first.result.body);

  world.close();
});

test('bookmarks converge on replay because they express a desired state', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const questionId = world.questions[0].id;

  const add1 = await measure(world, user, (ctx) =>
    putBookmark(ctx, { questionId, desired: true }),
  );
  const add2 = await measure(world, user, (ctx) =>
    putBookmark(ctx, { questionId, desired: true }),
  );

  assert.equal(add1.result.body.bookmarked, true);
  assert.equal(add1.result.body.total, 1);
  assert.equal(add2.result.body.bookmarked, true);
  assert.equal(add2.result.body.total, 1, 'replaying an add must not create a second row');

  const remove1 = await measure(world, user, (ctx) =>
    putBookmark(ctx, { questionId, desired: false }),
  );
  const remove2 = await measure(world, user, (ctx) =>
    putBookmark(ctx, { questionId, desired: false }),
  );

  assert.equal(remove1.result.body.bookmarked, false);
  assert.equal(remove2.result.body.bookmarked, false);
  assert.equal(remove2.result.body.total, 0);

  world.close();
});

test('errata reports converge on replay without an idempotency key', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const questionId = world.questions[3].id;

  const first = await measure(world, user, (ctx) =>
    submitErrataReport(ctx, { questionId, reason: 'wrong_answer', detail: 'Key looks wrong.' }),
  );
  const second = await measure(world, user, (ctx) =>
    submitErrataReport(ctx, { questionId, reason: 'wrong_answer', detail: 'Key looks wrong.' }),
  );

  assert.equal(first.result.body.created, true);
  assert.equal(second.result.body.created, false);
  assert.equal(
    second.result.body.reportId,
    first.result.body.reportId,
    'the second call must update the existing report, not file a duplicate',
  );

  world.close();
});
