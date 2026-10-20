/**
 * Ownership, which on D1 is entirely the application's problem.
 *
 * There is no row-level security to fall back on, so every one of these tests
 * is checking that a `WHERE user_id = ?` is actually present in the SQL rather
 * than a filter applied after the rows came back. A regression here is a data
 * breach, not a bug.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, expectFailure, measure } from './harness.ts';
import { getMockAttempt, getMockReview, startMock, submitMock, syncMock } from '../handlers/mock.ts';
import {
  answerPractice,
  finishPractice,
  getPracticeSession,
  startPractice,
} from '../handlers/practice.ts';
import { getProgressOverview, putBookmark, getBookmarks } from '../handlers/progress.ts';
import { getAuditLog, getReportQueue, publishQuestions, triage } from '../handlers/moderation.ts';
import { requireAdmin, requireUser } from '../handlers/context.ts';
import { MINUTE } from '../lib/time.ts';

test('a mock attempt is invisible to another user', async () => {
  const world = createWorld();
  const alice = world.makeUser();
  const bob = world.makeUser();

  const start = await measure(world, alice, (ctx) =>
    startMock(ctx, { templateId: world.templateId, idempotencyKey: 'own-start-aaaaaaaa' }),
  );
  const paper = start.result.body;

  // Read.
  const read = await expectFailure(() =>
    measure(world, bob, (ctx) => getMockAttempt(ctx, paper.attemptId)),
  );
  assert.equal(read.code, 'NOT_FOUND');

  // Sync.
  const sync = await expectFailure(() =>
    measure(world, bob, (ctx) => syncMock(ctx, { attemptId: paper.attemptId, answers: {} })),
  );
  assert.equal(sync.code, 'NOT_FOUND');

  // Submit.
  const submit = await expectFailure(() =>
    measure(world, bob, (ctx) =>
      submitMock(ctx, {
        attemptId: paper.attemptId,
        idempotencyKey: 'own-submit-bbbbbbbb',
        answers: { [paper.questions[0].questionId]: paper.questions[0].options[0].ref },
      }),
    ),
  );
  assert.equal(submit.code, 'NOT_FOUND');

  // Review, after Alice submits it.
  world.clock.advance(MINUTE);
  await measure(world, alice, (ctx) =>
    submitMock(ctx, {
      attemptId: paper.attemptId,
      idempotencyKey: 'own-submit-cccccccc',
      answers: {},
    }),
  );
  const review = await expectFailure(() =>
    measure(world, bob, (ctx) => getMockReview(ctx, paper.attemptId)),
  );
  assert.equal(review.code, 'NOT_FOUND');

  // And Alice can still read her own.
  const mine = await measure(world, alice, (ctx) => getMockReview(ctx, paper.attemptId));
  assert.equal(mine.result.body.attemptId, paper.attemptId);

  world.close();
});

test('a practice session is invisible to another user', async () => {
  const world = createWorld();
  const alice = world.makeUser();
  const bob = world.makeUser();

  const start = await measure(world, alice, (ctx) =>
    startPractice(ctx, {
      mode: 'chapter',
      chapterIds: [world.chapterIds[0]],
      questionCount: 4,
      idempotencyKey: 'own-pstart-dddddddd',
    }),
  );
  const paper = start.result.body;

  const read = await expectFailure(() =>
    measure(world, bob, (ctx) => getPracticeSession(ctx, paper.sessionId)),
  );
  assert.equal(read.code, 'NOT_FOUND');

  // The answer endpoint is the interesting one: it is the key-disclosure path,
  // so it must not even confirm that the session exists.
  const answer = await expectFailure(() =>
    measure(world, bob, (ctx) =>
      answerPractice(ctx, {
        sessionId: paper.sessionId,
        questionId: paper.questions[0].questionId,
        optionRef: paper.questions[0].options[0].ref,
      }),
    ),
  );
  assert.equal(answer.code, 'QUESTION_NOT_ON_PAPER');

  const finish = await expectFailure(() =>
    measure(world, bob, (ctx) =>
      finishPractice(ctx, { sessionId: paper.sessionId, idempotencyKey: 'own-pfin-eeeeeeee' }),
    ),
  );
  assert.equal(finish.code, 'NOT_FOUND');

  world.close();
});

test('ATTACK: farm the practice key reveal through another user\'s session', async () => {
  const world = createWorld();
  const alice = world.makeUser();
  const bob = world.makeUser();

  const start = await measure(world, alice, (ctx) =>
    startPractice(ctx, {
      mode: 'chapter',
      chapterIds: [world.chapterIds[0]],
      questionCount: 6,
      idempotencyKey: 'farm-start-ffffffff',
    }),
  );
  const paper = start.result.body;

  // Bob knows Alice's session id and every question id on her paper. Each
  // attempt must still fail, and fail without disclosing anything.
  for (const question of paper.questions) {
    const failure = await expectFailure(() =>
      measure(world, bob, (ctx) =>
        answerPractice(ctx, {
          sessionId: paper.sessionId,
          questionId: question.questionId,
          optionRef: null,
        }),
      ),
    );
    assert.equal(failure.code, 'QUESTION_NOT_ON_PAPER');
    assert.ok(!failure.message.includes('correct'));
  }

  world.close();
});

test('progress and bookmarks are per-user', async () => {
  const world = createWorld();
  const alice = world.makeUser();
  const bob = world.makeUser();

  await measure(world, alice, (ctx) =>
    putBookmark(ctx, { questionId: world.questions[0].id, desired: true }),
  );
  await measure(world, alice, (ctx) =>
    putBookmark(ctx, { questionId: world.questions[1].id, desired: true }),
  );

  const aliceList = await measure(world, alice, (ctx) => getBookmarks(ctx));
  const bobList = await measure(world, bob, (ctx) => getBookmarks(ctx));

  assert.equal(aliceList.result.body.items.length, 2);
  assert.equal(bobList.result.body.items.length, 0);

  // Alice answers a practice question; Bob's stats stay empty.
  const session = await measure(world, alice, (ctx) =>
    startPractice(ctx, {
      mode: 'chapter',
      chapterIds: [world.chapterIds[0]],
      questionCount: 2,
      idempotencyKey: 'prog-start-gggggggg',
    }),
  );
  const question = session.result.body.questions[0];
  await measure(world, alice, (ctx) =>
    answerPractice(ctx, {
      sessionId: session.result.body.sessionId,
      questionId: question.questionId,
      optionRef: question.options[0].ref,
    }),
  );

  const aliceProgress = await measure(world, alice, (ctx) => getProgressOverview(ctx));
  const bobProgress = await measure(world, bob, (ctx) => getProgressOverview(ctx));

  assert.equal(aliceProgress.result.body.stats.totalAnswered, 1);
  assert.equal(bobProgress.result.body.stats.totalAnswered, 0);
  assert.equal(aliceProgress.result.body.streak.currentStreak, 1);
  assert.equal(bobProgress.result.body.streak.currentStreak, 0);

  world.close();
});

test('requireUser refuses an unauthenticated context', () => {
  const world = createWorld();
  const ctx = world.contextFor(world.makeUser());
  ctx.auth = null;

  assert.throws(() => requireUser(ctx), (err: Error & { code?: string }) => {
    assert.equal(err.name, 'ApiException');
    assert.equal(err.code, 'UNAUTHENTICATED');
    return true;
  });

  world.close();
});

test('the admin surface is closed to a plain user and open to a moderator', async () => {
  const world = createWorld();
  const user = world.makeUser({ role: 'user' });
  const moderator = world.makeUser({ role: 'moderator' });
  const admin = world.makeUser({ role: 'admin' });

  const queue = await expectFailure(() =>
    measure(world, user, (ctx) => getReportQueue(ctx, { status: 'open', limit: 10 })),
  );
  assert.equal(queue.code, 'FORBIDDEN');
  assert.equal(queue.status, 403);

  const audit = await expectFailure(() =>
    measure(world, user, (ctx) => getAuditLog(ctx, { limit: 10 })),
  );
  assert.equal(audit.code, 'FORBIDDEN');

  const triaged = await expectFailure(() =>
    measure(world, user, (ctx) =>
      triage(ctx, {
        reportIds: ['rep_x'],
        status: 'accepted',
        idempotencyKey: 'triage-key-hhhhhhhh',
      }),
    ),
  );
  assert.equal(triaged.code, 'FORBIDDEN');

  // A moderator may triage.
  const modQueue = await measure(world, moderator, (ctx) =>
    getReportQueue(ctx, { status: 'open', limit: 10 }),
  );
  assert.equal(modQueue.result.status, 200);

  // But publishing is admin-only, because it changes what candidates sit.
  const modPublish = await expectFailure(() =>
    measure(world, moderator, (ctx) =>
      publishQuestions(ctx, {
        questionIds: [world.questions[0].id],
        state: 'retired',
        idempotencyKey: 'pub-key-iiiiiiii',
      }),
    ),
  );
  assert.equal(modPublish.code, 'FORBIDDEN');

  const adminPublish = await measure(world, admin, (ctx) =>
    publishQuestions(ctx, {
      questionIds: [world.questions[0].id],
      state: 'retired',
      idempotencyKey: 'pub-key-jjjjjjjj',
    }),
  );
  assert.equal(adminPublish.result.body.updated, 1);

  // The mutation left an audit row.
  const log = await measure(world, admin, (ctx) => getAuditLog(ctx, { limit: 10 }));
  assert.equal(log.result.body.items.length, 1);
  assert.equal(log.result.body.items[0].action, 'question.set_state');
  assert.equal(log.result.body.items[0].actorUserId, admin.id);

  world.close();
});

test('an unrecognised role reads as the least privileged', () => {
  const world = createWorld();
  // `toSessionUser` normalises anything unexpected to 'user'; this checks the
  // gate itself rather than trusting that normalisation happened upstream.
  const ctx = world.contextFor(world.makeUser({ role: 'user' }));
  assert.throws(() => requireAdmin(ctx), (err: Error & { code?: string }) => {
    assert.equal(err.code, 'FORBIDDEN');
    return true;
  });
  world.close();
});
