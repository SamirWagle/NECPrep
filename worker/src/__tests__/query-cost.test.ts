/**
 * D1 query cost.
 *
 * The tightest constraint on this platform is 50 queries per Worker invocation
 * on the free plan. The failure mode it produces is nasty: an N+1 inside a
 * handler works fine on a 12-question paper in development and breaks on a
 * 100-question mock in production. So the cost is asserted, not estimated, and
 * the key assertion is that submitting a 100-question paper costs the SAME
 * number of queries as submitting a 12-question one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, measure } from './harness.ts';
import { startMock, submitMock, syncMock } from '../handlers/mock.ts';
import { answerPractice, startPractice } from '../handlers/practice.ts';
import { bootstrap } from '../handlers/content.ts';
import { getProgressOverview } from '../handlers/progress.ts';
import { QueryBudgetExceeded, TooManyBoundParams, Db } from '../data/d1.ts';
import { MINUTE } from '../lib/time.ts';

/** The free-plan ceiling this whole design is built around. */
const D1_FREE_QUERY_LIMIT = 50;

async function costOfFullMock(questionsPerChapter: number, quotaPerChapter: number) {
  const world = createWorld({
    chapters: 3,
    questionsPerChapter,
    quotaPerChapter,
  });
  const user = world.makeUser();

  const start = await measure(world, user, (ctx) =>
    startMock(ctx, { templateId: world.templateId, idempotencyKey: 'cost-start-aaaaaaaa' }),
  );
  const paper = start.result.body;

  const answers: Record<string, string> = {};
  for (const question of paper.questions) {
    answers[question.questionId] = question.options[0].ref;
  }

  world.clock.advance(5 * MINUTE);
  const sync = await measure(world, user, (ctx) =>
    syncMock(ctx, { attemptId: paper.attemptId, answers }),
  );

  world.clock.advance(MINUTE);
  const submit = await measure(world, user, (ctx) =>
    submitMock(ctx, {
      attemptId: paper.attemptId,
      idempotencyKey: 'cost-submit-bbbbbbbb',
      answers,
    }),
  );

  const result = {
    questionCount: paper.questions.length,
    start: start.queries,
    sync: sync.queries,
    submit: submit.queries,
    score: submit.result.body.correct,
    total: submit.result.body.total,
  };
  world.close();
  return result;
}

test('mock submit costs the same for 100 questions as for 12', async () => {
  const small = await costOfFullMock(12, 4);
  const large = await costOfFullMock(40, 34);

  assert.equal(small.questionCount, 12);
  assert.equal(large.questionCount, 102);

  assert.equal(
    large.submit,
    small.submit,
    `submit cost must be constant in paper size (12q: ${small.submit}, 102q: ${large.submit})`,
  );
  assert.equal(
    large.start,
    small.start,
    `start cost must be constant in paper size (12q: ${small.start}, 102q: ${large.start})`,
  );
  assert.equal(large.sync, small.sync);

  // And the real numbers, well inside the free-plan ceiling.
  assert.ok(
    large.submit < D1_FREE_QUERY_LIMIT,
    `submit spent ${large.submit} of ${D1_FREE_QUERY_LIMIT}`,
  );
  assert.ok(large.start < D1_FREE_QUERY_LIMIT, `start spent ${large.start}`);

  console.log(
    `  cost: start=${small.start} sync=${small.sync} submit=${small.submit} ` +
      `(identical at 12 and 102 questions)`,
  );
});

test('a 102-question submission scores every question it was given', async () => {
  // Guards against the cost test passing because the batch silently dropped
  // rows: the scored total has to equal the paper size.
  const large = await costOfFullMock(40, 34);
  assert.equal(large.total, 102);
});

test('other endpoints stay well inside the free-plan budget', async () => {
  const world = createWorld();
  const user = world.makeUser();

  const boot = await measure(world, user, (ctx) => bootstrap(ctx));
  assert.ok(boot.queries <= 6, `bootstrap spent ${boot.queries}`);

  const practice = await measure(world, user, (ctx) =>
    startPractice(ctx, {
      mode: 'chapter',
      chapterIds: world.chapterIds,
      questionCount: 50,
      idempotencyKey: 'cost-p-cccccccc',
    }),
  );
  assert.ok(practice.queries <= 10, `practice/start spent ${practice.queries}`);

  const question = practice.result.body.questions[0];
  const answer = await measure(world, user, (ctx) =>
    answerPractice(ctx, {
      sessionId: practice.result.body.sessionId,
      questionId: question.questionId,
      optionRef: question.options[0].ref,
    }),
  );
  assert.ok(answer.queries <= 12, `practice/answer spent ${answer.queries}`);

  const overview = await measure(world, user, (ctx) => getProgressOverview(ctx));
  assert.ok(overview.queries <= 5, `progress/overview spent ${overview.queries}`);

  console.log(
    `  cost: bootstrap=${boot.queries} practice.start=${practice.queries} ` +
      `practice.answer=${answer.queries} progress=${overview.queries}`,
  );

  world.close();
});

test('the budget fails the request rather than letting it run away', async () => {
  const world = createWorld();
  const db = new Db(world.d1, { budget: 3 });

  await db.all('SELECT 1');
  await db.all('SELECT 1');
  await db.all('SELECT 1');

  await assert.rejects(
    () => db.all('SELECT 1'),
    (err: unknown) => {
      assert.ok(err instanceof QueryBudgetExceeded);
      assert.equal(err.spent, 4);
      assert.equal(err.budget, 3);
      return true;
    },
  );

  world.close();
});

test('a statement over D1\'s 100-parameter limit is refused up front', async () => {
  const world = createWorld();
  const db = world.invocation();

  const binds = Array.from({ length: 101 }, (_, i) => String(i));
  const placeholders = binds.map((_, i) => `?${i + 1}`).join(',');

  await assert.rejects(
    () => db.all(`SELECT 1 WHERE 'x' IN (${placeholders})`, ...binds),
    (err: unknown) => {
      assert.ok(err instanceof TooManyBoundParams);
      // The message points at the fix, because this is a mistake that will be
      // made again.
      assert.match(err.message, /json_each/);
      return true;
    },
  );

  world.close();
});
