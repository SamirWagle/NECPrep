/**
 * The anti-cheat guarantees, end to end against a real SQLite database through
 * the real handlers.
 *
 * Every test here is phrased as the attack it defeats, because that is what the
 * code is for. The baseline it is measured against is
 * `frontend/src/pages/app/MockTestQuiz.tsx`, which fetches
 * `correct_option_index` to the browser and scores there.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, expectFailure, measure, T0 } from './harness.ts';
import { getMockAttempt, getMockReview, startMock, submitMock, syncMock } from '../handlers/mock.ts';
import { MINUTE } from '../lib/time.ts';
import type { MockAttemptPaper } from '../shared/types.ts';
import type { SessionUser } from '../shared/types.ts';
import type { TestWorld } from './harness.ts';

let keyCounter = 0;
function key(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-idem-key-${keyCounter}`;
}

async function start(world: TestWorld, user: SessionUser): Promise<MockAttemptPaper> {
  const { result } = await measure(world, user, (ctx) =>
    startMock(ctx, { templateId: world.templateId, idempotencyKey: key('start') }),
  );
  return result.body;
}

/** Picks the ref the key says is correct, by looking at the seeded fixture. */
function correctRefFor(world: TestWorld, paper: MockAttemptPaper, questionId: string): string {
  const seeded = world.questionById.get(questionId);
  assert.ok(seeded, `unknown question ${questionId}`);
  const question = paper.questions.find((q) => q.questionId === questionId);
  assert.ok(question);

  // The client cannot do this - it is reaching into the fixture's record of
  // which option id is correct and then finding the ref whose BODY matches.
  const correctBody = seeded.bodies.get(seeded.correctOptionId);
  const option = question.options.find((o) => o.body === correctBody);
  assert.ok(option, 'the correct option body must be on the paper');
  return option.ref;
}

test('ATTACK: read the answer key out of the start payload', async () => {
  const world = createWorld();
  const user = world.makeUser();

  const paper = await start(world, user);
  const serialised = JSON.stringify(paper);

  // Nothing resembling a key is anywhere in the payload.
  assert.ok(!serialised.includes('is_correct'));
  assert.ok(!serialised.includes('isCorrect'));
  assert.ok(!serialised.includes('correct_option_index'));
  assert.ok(!serialised.includes('correctRef'));
  assert.ok(!serialised.includes('correctIndex'));

  // And no option id leaks either, which is what stops a ref from being joined
  // to anything durable.
  for (const seeded of world.questions) {
    for (const optionId of seeded.optionIds) {
      assert.ok(
        !serialised.includes(optionId),
        `option id ${optionId} must never reach a client`,
      );
    }
  }

  // Each question has its options, labelled only by opaque ref.
  assert.equal(paper.questions.length, 12);
  for (const question of paper.questions) {
    assert.equal(question.options.length, 4);
    for (const option of question.options) {
      assert.match(option.ref, /^[0-9A-Z]{12}$/);
      assert.ok(option.body.length > 0);
    }
  }

  world.close();
});

test('ATTACK: join option position against the public chapter JSON in git', async () => {
  const world = createWorld();
  const user = world.makeUser();

  // The authored order is position 1..4, which is what the public JSON encodes
  // via `correct_option_index`. Across a 12-question paper, the served order
  // must not match the authored order often enough to be useful.
  const paper = await start(world, user);

  let identicalOrders = 0;
  for (const question of paper.questions) {
    const seeded = world.questionById.get(question.questionId);
    assert.ok(seeded);
    const authoredBodies = seeded.optionIds.map((id) => seeded.bodies.get(id));
    const servedBodies = question.options.map((o) => o.body);
    if (JSON.stringify(authoredBodies) === JSON.stringify(servedBodies)) identicalOrders++;
  }

  // 1 in 24 permutations of four options is the identity, so a handful of
  // matches across 12 questions is expected. More than half would mean the
  // permutation is not happening.
  assert.ok(
    identicalOrders < 6,
    `${identicalOrders}/12 questions were served in authored order - the permutation is not working`,
  );

  world.close();
});

test('ATTACK: reuse a ref learned from a previous attempt', async () => {
  const world = createWorld();
  const user = world.makeUser();

  const first = await start(world, user);
  const second = await start(world, user);

  // Find a question that appears on both papers.
  const shared = first.questions.find((a) =>
    second.questions.some((b) => b.questionId === a.questionId),
  );
  assert.ok(shared, 'the two papers should overlap on at least one question');
  const sameInSecond = second.questions.find((q) => q.questionId === shared.questionId);
  assert.ok(sameInSecond);

  const firstRefs = new Set(shared.options.map((o) => o.ref));
  for (const option of sameInSecond.options) {
    assert.ok(
      !firstRefs.has(option.ref),
      'refs must be minted per attempt, so one attempt teaches nothing about another',
    );
  }

  // And submitting the first attempt's ref against the second attempt is a
  // hard error, not a silent miss.
  const failure = await expectFailure(() =>
    measure(world, user, (ctx) =>
      submitMock(ctx, {
        attemptId: second.attemptId,
        idempotencyKey: key('cross'),
        answers: { [shared.questionId]: [...firstRefs][0] },
      }),
    ),
  );
  assert.equal(failure.code, 'UNKNOWN_OPTION_REF');
  assert.equal(failure.status, 422);

  world.close();
});

test('submit scores on the server and discloses the key only in the review', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);

  // Answer the first six correctly, the next three wrongly, skip the rest.
  const answers: Record<string, string> = {};
  paper.questions.forEach((question, index) => {
    const correct = correctRefFor(world, paper, question.questionId);
    if (index < 6) {
      answers[question.questionId] = correct;
    } else if (index < 9) {
      const wrong = question.options.find((o) => o.ref !== correct);
      assert.ok(wrong);
      answers[question.questionId] = wrong.ref;
    }
  });

  world.clock.advance(20 * MINUTE);

  const { result } = await measure(world, user, (ctx) =>
    submitMock(ctx, {
      attemptId: paper.attemptId,
      idempotencyKey: key('submit'),
      answers,
    }),
  );
  const body = result.body;

  assert.equal(body.timing, 'on_time');
  assert.equal(body.total, 12);
  assert.equal(body.correct, 6);
  assert.equal(body.incorrect, 3);
  assert.equal(body.skipped, 3);
  assert.equal(body.score, 6);
  assert.equal(body.accuracyPct, 50);
  assert.equal(body.droppedLateAnswers, 0);
  assert.equal(body.scoredAt, T0 + 20 * MINUTE);

  // The review is the ONLY key disclosure, and it is complete and consistent.
  assert.equal(body.review.length, 12);
  for (const item of body.review) {
    const refs = item.options.map((o) => o.ref);
    assert.ok(refs.includes(item.correctRef), 'the correct ref must be one of the shown options');
    assert.equal(
      item.correctRef,
      correctRefFor(world, paper, item.questionId),
      'the server-disclosed key must match the seeded key',
    );
    if (item.selectedRef !== null) {
      assert.equal(item.isCorrect, item.selectedRef === item.correctRef);
    } else {
      assert.equal(item.isCorrect, false);
    }
  }

  world.close();
});

test('a submission cannot assert its own score', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);

  // Every answer deliberately wrong, plus fields a cheater would wish existed.
  const answers: Record<string, string> = {};
  for (const question of paper.questions) {
    const correct = correctRefFor(world, paper, question.questionId);
    const wrong = question.options.find((o) => o.ref !== correct);
    assert.ok(wrong);
    answers[question.questionId] = wrong.ref;
  }

  const { result } = await measure(world, user, (ctx) =>
    submitMock(ctx, {
      attemptId: paper.attemptId,
      idempotencyKey: key('wrong'),
      answers,
      // Note there is no `score`, `isCorrect` or `answeredAt` field in
      // MockSubmitRequest at all - the schema is strict, so adding one here
      // would be rejected as an unexpected field rather than ignored.
    }),
  );

  assert.equal(result.body.correct, 0);
  assert.equal(result.body.score, 0);
  assert.equal(result.body.incorrect, 12);

  world.close();
});

test('ATTACK: answer a question that is not on this paper', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);

  const onPaper = new Set(paper.questions.map((q) => q.questionId));
  const offPaper = world.questions.find((q) => !onPaper.has(q.id));
  assert.ok(offPaper, 'the seeded bank is larger than one paper');

  const failure = await expectFailure(() =>
    measure(world, user, (ctx) =>
      submitMock(ctx, {
        attemptId: paper.attemptId,
        idempotencyKey: key('offpaper'),
        answers: { [offPaper.id]: 'ABCDEFGHJKMN' },
      }),
    ),
  );

  assert.equal(failure.code, 'QUESTION_NOT_ON_PAPER');
  assert.equal(failure.status, 422);

  world.close();
});

test('ATTACK: freeze the timer, keep working, submit an hour late', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);

  // Ten minutes in, the honest client has synced three correct answers.
  world.clock.advance(10 * MINUTE);
  const synced: Record<string, string> = {};
  for (const question of paper.questions.slice(0, 3)) {
    synced[question.questionId] = correctRefFor(world, paper, question.questionId);
  }

  const syncResult = await measure(world, user, (ctx) =>
    syncMock(ctx, { attemptId: paper.attemptId, answers: synced }),
  );
  assert.equal(syncResult.result.body.accepted, true);

  // Now the cheater freezes the timer and keeps going for an hour past the
  // 45-minute deadline, finishing the whole paper correctly.
  world.clock.advance(100 * MINUTE);

  const everything: Record<string, string> = {};
  for (const question of paper.questions) {
    everything[question.questionId] = correctRefFor(world, paper, question.questionId);
  }

  const { result } = await measure(world, user, (ctx) =>
    submitMock(ctx, {
      attemptId: paper.attemptId,
      idempotencyKey: key('late'),
      answers: everything,
    }),
  );
  const body = result.body;

  assert.equal(body.timing, 'expired');
  assert.equal(
    body.correct,
    3,
    'only the three answers the server received before the deadline are scored',
  );
  assert.equal(body.droppedLateAnswers, 9);
  assert.equal(body.scoredAt, paper.expiresAt, 'the paper was frozen at the server deadline');

  world.close();
});

test('a sync after the deadline cannot overwrite the pre-deadline snapshot', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);

  const early = { [paper.questions[0].questionId]: paper.questions[0].options[0].ref };
  world.clock.advance(5 * MINUTE);
  await measure(world, user, (ctx) =>
    syncMock(ctx, { attemptId: paper.attemptId, answers: early }),
  );

  // Past the deadline, try to replace the snapshot with a full paper.
  world.clock.advance(60 * MINUTE);
  const late: Record<string, string> = {};
  for (const question of paper.questions) {
    late[question.questionId] = correctRefFor(world, paper, question.questionId);
  }

  const { result } = await measure(world, user, (ctx) =>
    syncMock(ctx, { attemptId: paper.attemptId, answers: late }),
  );

  assert.equal(result.body.accepted, false);
  assert.equal(result.body.reason, 'past_deadline');
  assert.equal(result.body.remainingMs, 0);

  // The stored snapshot is untouched: resuming shows only the early answer.
  // Spread before comparing - `parseSyncedAnswers` deliberately returns a
  // null-prototype map so a stored key like `__proto__` cannot be read back as
  // an inherited property, and `deepStrictEqual` compares prototypes.
  const resumed = await measure(world, user, (ctx) => getMockAttempt(ctx, paper.attemptId));
  assert.deepEqual({ ...resumed.result.body.savedAnswers }, early);

  world.close();
});

test('the expiry clamp uses SERVER time, not an attempt-supplied deadline', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);

  // The paper tells the client the deadline, and that value is server-derived.
  assert.equal(paper.expiresAt, paper.startedAt + 45 * MINUTE);
  assert.equal(paper.startedAt, T0);
  assert.equal(paper.serverNow, T0);

  // Resuming reports the server's clock, so a client with a skewed or frozen
  // clock still renders a truthful countdown.
  world.clock.advance(44 * MINUTE);
  const resumed = await measure(world, user, (ctx) => getMockAttempt(ctx, paper.attemptId));
  assert.equal(resumed.result.body.serverNow, T0 + 44 * MINUTE);
  assert.equal(resumed.result.body.expiresAt, paper.expiresAt);

  world.close();
});

test('the review endpoint refuses an attempt that is still in progress', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);

  const failure = await expectFailure(() =>
    measure(world, user, (ctx) => getMockReview(ctx, paper.attemptId)),
  );
  assert.equal(failure.code, 'ATTEMPT_NOT_IN_PROGRESS');

  world.close();
});

test('the review endpoint reproduces a submitted attempt exactly', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);

  const answers: Record<string, string> = {};
  paper.questions.slice(0, 5).forEach((question) => {
    answers[question.questionId] = correctRefFor(world, paper, question.questionId);
  });

  world.clock.advance(MINUTE);
  const submitted = await measure(world, user, (ctx) =>
    submitMock(ctx, { attemptId: paper.attemptId, idempotencyKey: key('sub'), answers }),
  );

  const review = await measure(world, user, (ctx) => getMockReview(ctx, paper.attemptId));

  assert.equal(review.result.body.score, submitted.result.body.score);
  assert.equal(review.result.body.correct, 5);
  assert.equal(review.result.body.total, 12);
  assert.equal(review.result.body.review.length, 12);

  for (const item of review.result.body.review) {
    assert.equal(item.correctRef, correctRefFor(world, paper, item.questionId));
  }

  world.close();
});
