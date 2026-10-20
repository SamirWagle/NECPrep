/**
 * The content-browsing payloads must not leak an option's authored ordinal.
 *
 * THE BUG THIS TEST EXISTS FOR. The real schema mints option ids as
 * `question_id || '#' || ordinal` (`worker/migrations/0002_content.sql`). The
 * first version of `getChapterQuestions` returned that id as the public `ref`,
 * on the reasoning that an id carries no key. Against this id scheme that is
 * false: `frontend/public/data/books/*.json` publishes `correct_option_index`
 * and sits in git history forever, so `ref: "q_ch1_1#3"` next to a published
 * key of 3 is the whole answer. The per-viewer permutation is no defence,
 * because the ordinal travels INSIDE the id instead of as an array position.
 *
 * The fix is `browseOptionRef`, a keyed non-reversible digest. It needs no
 * reversibility because browsing is read-only - a browse ref is never submitted
 * back; answering goes through a practice session, which mints its own refs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, measure } from './harness.ts';
import { getChapterQuestions } from '../handlers/content.ts';
import { getSrsDue } from '../handlers/progress.ts';
import { answerPractice, startPractice } from '../handlers/practice.ts';
import { browseOptionRef } from '../lib/permute.ts';

test('the harness seeds ordinal-encoded option ids, like the real schema', () => {
  const world = createWorld();
  const question = world.questions[0];
  assert.ok(
    question.optionIds.every((id, i) => id === `${question.id}#${i + 1}`),
    'the fixture must reproduce the real id convention, or this suite proves nothing',
  );
  world.close();
});

test('chapter questions never expose an option id or its ordinal', async () => {
  const world = createWorld();
  const user = world.makeUser();

  const result = await measure(world, user, (ctx) =>
    getChapterQuestions(ctx, { chapterId: world.chapterIds[0], offset: 0, limit: 50 }),
  );
  const serialised = JSON.stringify(result.result.body);

  // No option id, in whole or in the `#ordinal` suffix form.
  for (const question of world.questions) {
    for (const optionId of question.optionIds) {
      assert.ok(!serialised.includes(optionId), `leaked option id ${optionId}`);
    }
  }
  assert.ok(!serialised.includes('#'), 'no ref may carry the ordinal separator');

  // And still no key, of course.
  assert.ok(!serialised.includes('is_correct'));
  assert.ok(!serialised.includes('isCorrect'));
  assert.ok(!serialised.includes('correct'));

  for (const question of result.result.body.questions) {
    assert.equal(question.options.length, 4);
    for (const option of question.options) {
      assert.match(option.ref, /^[0-9A-Z]{13}$/);
    }
  }

  world.close();
});

test('a browse ref is stable for one viewer and different for another', () => {
  const world = createWorld();
  const secret = world.config.permutationSecret;
  const question = world.questions[0];
  const optionId = question.optionIds[0];

  const a1 = browseOptionRef(secret, 'usr_a', question.id, optionId);
  const a2 = browseOptionRef(secret, 'usr_a', question.id, optionId);
  const b1 = browseOptionRef(secret, 'usr_b', question.id, optionId);

  // Stable: a reload must not re-point a selection the client stored by ref.
  assert.equal(a1, a2);
  // Per-viewer: two accounts comparing payloads learn nothing from each other.
  assert.notEqual(a1, b1);

  // Rotating the secret reshuffles every ref, which is why rotation is safe
  // but not free.
  assert.notEqual(a1, browseOptionRef(`${secret}-rotated`, 'usr_a', question.id, optionId));

  // The four options of one question get four distinct refs.
  const refs = new Set(
    question.optionIds.map((id) => browseOptionRef(secret, 'usr_a', question.id, id)),
  );
  assert.equal(refs.size, 4);

  world.close();
});

test('browse refs across the whole seeded bank do not collide', () => {
  const world = createWorld({ chapters: 3, questionsPerChapter: 40 });
  const secret = world.config.permutationSecret;

  // Within a question is what matters - a collision there would make two
  // options share a display token. Checked across the bank anyway, as a
  // distribution sanity check on the digest.
  const all = new Set<string>();
  let total = 0;
  for (const question of world.questions) {
    const perQuestion = new Set<string>();
    for (const optionId of question.optionIds) {
      const ref = browseOptionRef(secret, 'usr_a', question.id, optionId);
      perQuestion.add(ref);
      all.add(ref);
      total++;
    }
    assert.equal(perQuestion.size, question.optionIds.length);
  }
  assert.equal(all.size, total, 'no collisions across 480 refs');

  world.close();
});

test('the SRS due payload uses opaque refs too', async () => {
  const world = createWorld();
  const user = world.makeUser();

  // Answer a practice question so a card exists and becomes due.
  const session = await measure(world, user, (ctx) =>
    startPractice(ctx, {
      mode: 'chapter',
      chapterIds: [world.chapterIds[0]],
      questionCount: 3,
      idempotencyKey: 'srs-seed-aaaaaaaa',
    }),
  );
  const question = session.result.body.questions[0];
  await measure(world, user, (ctx) =>
    answerPractice(ctx, {
      sessionId: session.result.body.sessionId,
      questionId: question.questionId,
      optionRef: question.options[0].ref,
    }),
  );

  // Wind past the scheduled interval so the card is due.
  world.clock.advance(10 * 24 * 60 * 60 * 1000);

  const due = await measure(world, user, (ctx) => getSrsDue(ctx, { limit: 20 }));
  assert.ok(due.result.body.dueCount > 0, 'a card should be due after the interval');

  const serialised = JSON.stringify(due.result.body);
  for (const seeded of world.questions) {
    for (const optionId of seeded.optionIds) {
      assert.ok(!serialised.includes(optionId), `leaked option id ${optionId}`);
    }
  }
  assert.ok(!serialised.includes('#'));

  world.close();
});

test('a practice paper ref is per-attempt, not the stable browse ref', async () => {
  const world = createWorld();
  const user = world.makeUser();

  const first = await measure(world, user, (ctx) =>
    startPractice(ctx, {
      mode: 'chapter',
      chapterIds: [world.chapterIds[0]],
      questionCount: 12,
      idempotencyKey: 'pref-one-aaaaaaaa',
    }),
  );
  const second = await measure(world, user, (ctx) =>
    startPractice(ctx, {
      mode: 'chapter',
      chapterIds: [world.chapterIds[0]],
      questionCount: 12,
      idempotencyKey: 'pref-two-bbbbbbbb',
    }),
  );

  const shared = first.result.body.questions.find((a) =>
    second.result.body.questions.some((b) => b.questionId === a.questionId),
  );
  assert.ok(shared, 'two 12-question draws from one chapter should overlap');
  const inSecond = second.result.body.questions.find((q) => q.questionId === shared.questionId);
  assert.ok(inSecond);

  const firstRefs = new Set(shared.options.map((o) => o.ref));
  for (const option of inSecond.options) {
    assert.ok(
      !firstRefs.has(option.ref),
      'practice refs must be per-session, so a revealed key cannot be carried over',
    );
  }

  // And they are not the browse refs either - an attempt ref is CSPRNG, so
  // knowing the browse ref for an option tells you nothing inside an attempt.
  const browse = new Set(
    (world.questionById.get(shared.questionId)?.optionIds ?? []).map((id) =>
      browseOptionRef(world.config.permutationSecret, user.id, shared.questionId, id),
    ),
  );
  for (const option of shared.options) {
    assert.ok(!browse.has(option.ref));
  }

  world.close();
});
