/**
 * Request validation. The point of these tests is that it FAILS CLOSED.
 *
 * A validator that strips unknown fields is worse than useless at this
 * boundary: validated bodies are passed straight into the data layer, so a
 * silently-dropped `attemptID` typo reads as a missing required field, and a
 * silently-KEPT extra field is a way to append columns to a write.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { safeParse } from '../validation/parse.ts';
import {
  adminPublishSchema,
  bookmarkSetSchema,
  chapterQuestionsQuerySchema,
  loginSchema,
  mockStartSchema,
  mockSubmitSchema,
  practiceStartSchema,
  searchQuerySchema,
  signupSchema,
  srsReviewSchema,
  MAX_MOCK_ANSWERS,
} from '../validation/schemas.ts';

test('an unknown field is an error, not something to strip or keep', () => {
  const result = safeParse(mockSubmitSchema, {
    attemptId: 'mat_1',
    idempotencyKey: 'key-aaaaaaaa',
    answers: {},
    // The fields a cheater would wish existed.
    score: 100,
    expiresAt: 9_999_999_999_999,
  });

  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.error.issues.score, 'Unexpected field.');
  assert.equal(result.error.issues.expiresAt, 'Unexpected field.');
});

test('a submission has nowhere to assert a score, a time, or a correctness bit', () => {
  // Enumerated explicitly, so adding one of these to the schema later trips
  // this test and forces the decision to be deliberate.
  for (const field of ['score', 'isCorrect', 'answeredAt', 'clientNow', 'durationSeconds', 'expiresAt']) {
    const result = safeParse(mockSubmitSchema, {
      attemptId: 'mat_1',
      idempotencyKey: 'key-aaaaaaaa',
      answers: {},
      [field]: 1,
    });
    assert.equal(result.success, false, `${field} must be rejected`);
  }
});

test('a prototype-polluting answers map is rejected', () => {
  const raw = JSON.parse('{"attemptId":"mat_1","idempotencyKey":"key-aaaaaaaa","answers":{"__proto__":"x"}}') as unknown;
  const result = safeParse(mockSubmitSchema, raw);
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.error.issues['answers.__proto__'], 'Reserved key.');
});

test('the answers map is bounded, so one statement cannot do unbounded work', () => {
  const answers: Record<string, string> = {};
  for (let i = 0; i < MAX_MOCK_ANSWERS + 1; i++) answers[`q_${i}`] = 'REF123456789';

  const result = safeParse(mockSubmitSchema, {
    attemptId: 'mat_1',
    idempotencyKey: 'key-aaaaaaaa',
    answers,
  });

  assert.equal(result.success, false);
  if (result.success) return;
  assert.match(result.error.issues.answers, /at most 250 entries/);
});

test('an answers map of exactly the limit is accepted', () => {
  const answers: Record<string, string> = {};
  for (let i = 0; i < MAX_MOCK_ANSWERS; i++) answers[`q_${i}`] = 'REF123456789';
  const result = safeParse(mockSubmitSchema, {
    attemptId: 'mat_1',
    idempotencyKey: 'key-aaaaaaaa',
    answers,
  });
  assert.equal(result.success, true);
});

test('ids and refs are charset-restricted, because they reach a primary key', () => {
  for (const bad of ["mat'; DROP TABLE users;--", 'mat 1', 'mat/1', '', 'a'.repeat(65)]) {
    const result = safeParse(mockStartSchema, {
      templateId: bad,
      idempotencyKey: 'key-aaaaaaaa',
    });
    assert.equal(result.success, false, `templateId=${JSON.stringify(bad)} must be rejected`);
  }

  assert.equal(
    safeParse(mockStartSchema, { templateId: 'tpl_main', idempotencyKey: 'key-aaaaaaaa' }).success,
    true,
  );
});

test('an idempotency key has a minimum length, so it cannot be trivially guessed', () => {
  assert.equal(
    safeParse(mockStartSchema, { templateId: 'tpl_main', idempotencyKey: 'short' }).success,
    false,
  );
});

test('numbers are not coerced from strings', () => {
  const result = safeParse(practiceStartSchema, {
    mode: 'chapter',
    chapterIds: ['ch1'],
    questionCount: '10',
    idempotencyKey: 'key-aaaaaaaa',
  });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.equal(result.error.issues.questionCount, 'Expected a finite number.');
});

test('NaN and Infinity are rejected, not silently stored', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -Number.POSITIVE_INFINITY]) {
    const result = safeParse(practiceStartSchema, {
      mode: 'custom',
      questionCount: value,
      idempotencyKey: 'key-aaaaaaaa',
    });
    assert.equal(result.success, false);
  }
});

test('enums reject anything not on the list', () => {
  assert.equal(
    safeParse(practiceStartSchema, {
      mode: 'free-for-all',
      questionCount: 5,
      idempotencyKey: 'key-aaaaaaaa',
    }).success,
    false,
  );

  assert.equal(
    safeParse(srsReviewSchema, { questionId: 'q1', grade: 'perfect', revision: 0 }).success,
    false,
  );
  assert.equal(
    safeParse(srsReviewSchema, { questionId: 'q1', grade: 'good', revision: 0 }).success,
    true,
  );
});

test('emails are normalised and obvious non-addresses are refused', () => {
  const good = safeParse(signupSchema, {
    email: '  Someone@Example.COM ',
    password: 'long-enough-password',
  });
  assert.equal(good.success, true);
  if (!good.success) return;
  assert.equal(good.data.email, 'someone@example.com');

  for (const bad of ['no-at-sign', 'a@b', 'a@@b.com', 'spaces in@x.com', `${'a'.repeat(250)}@x.com`]) {
    assert.equal(
      safeParse(signupSchema, { email: bad, password: 'long-enough-password' }).success,
      false,
      `${bad} must be rejected`,
    );
  }
});

test('passwords have a floor and a ceiling', () => {
  assert.equal(
    safeParse(signupSchema, { email: 'a@b.com', password: 'short' }).success,
    false,
  );
  assert.equal(
    safeParse(signupSchema, { email: 'a@b.com', password: 'x'.repeat(201) }).success,
    false,
    'an unbounded password is a CPU-exhaustion vector against PBKDF2',
  );

  // Login has no minimum, because rejecting a short password at the schema
  // would tell an attacker their guess was too short to be anyone's password.
  assert.equal(
    safeParse(loginSchema, { email: 'a@b.com', password: 'x' }).success,
    true,
  );
});

test('query defaults are applied, and out-of-range values are refused', () => {
  const defaults = safeParse(chapterQuestionsQuerySchema, { chapterId: 'ch1' });
  assert.equal(defaults.success, true);
  if (!defaults.success) return;
  assert.equal(defaults.data.offset, 0);
  assert.equal(defaults.data.limit, 50);

  assert.equal(
    safeParse(chapterQuestionsQuerySchema, { chapterId: 'ch1', limit: 5000 }).success,
    false,
    'an unbounded page size is a bulk-extraction vector',
  );
  assert.equal(
    safeParse(chapterQuestionsQuerySchema, { chapterId: 'ch1', offset: -1 }).success,
    false,
  );
  assert.equal(
    safeParse(chapterQuestionsQuerySchema, { chapterId: 'ch1', limit: 10.5 }).success,
    false,
  );
});

test('a search query has a minimum length and a maximum length', () => {
  assert.equal(safeParse(searchQuerySchema, { q: 'a' }).success, false);
  assert.equal(safeParse(searchQuerySchema, { q: 'ab' }).success, true);
  assert.equal(safeParse(searchQuerySchema, { q: 'x'.repeat(121) }).success, false);
});

test('admin batches are bounded and deduplicated', () => {
  assert.equal(
    safeParse(adminPublishSchema, {
      questionIds: ['q1', 'q1'],
      state: 'retired',
      idempotencyKey: 'key-aaaaaaaa',
    }).success,
    false,
    'a duplicated id in a batch is a client bug worth surfacing',
  );

  assert.equal(
    safeParse(adminPublishSchema, {
      questionIds: Array.from({ length: 101 }, (_, i) => `q${i}`),
      state: 'retired',
      idempotencyKey: 'key-aaaaaaaa',
    }).success,
    false,
  );
});

test('booleans are not coerced', () => {
  assert.equal(
    safeParse(bookmarkSetSchema, { questionId: 'q1', desired: 'true' }).success,
    false,
  );
  assert.equal(
    safeParse(bookmarkSetSchema, { questionId: 'q1', desired: 1 }).success,
    false,
  );
  assert.equal(
    safeParse(bookmarkSetSchema, { questionId: 'q1', desired: true }).success,
    true,
  );
});

test('a non-object body is refused with an issue, never an empty error', () => {
  for (const raw of [null, 'a string', 42, [], true, undefined]) {
    const result = safeParse(mockStartSchema, raw);
    assert.equal(result.success, false);
    if (result.success) continue;
    assert.ok(Object.keys(result.error.issues).length > 0, 'every failure must carry an issue');
  }
});

test('every issue is reported at once, keyed by dotted path', () => {
  const result = safeParse(practiceStartSchema, {
    mode: 'nope',
    questionCount: 0,
    idempotencyKey: 'x',
    extra: 1,
  });

  assert.equal(result.success, false);
  if (result.success) return;
  assert.deepEqual(Object.keys(result.error.issues).sort(), [
    'extra',
    'idempotencyKey',
    'mode',
    'questionCount',
  ]);
});
