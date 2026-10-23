/**
 * Scoring: the pure function, in isolation.
 *
 * These are the cases a browser-side scorer could not get right, because it had
 * to be handed the key to do its job at all.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { refForOption, resolveOptionRef, scorePaper } from '../domain/scoring.ts';
import type { KeyEntry, PaperQuestion } from '../domain/scoring.ts';

function paperQuestion(
  n: number,
  optionIds: string[],
  refs: string[],
): PaperQuestion {
  return {
    questionId: `q${n}`,
    chapterId: 'ch1',
    position: n,
    optionOrder: optionIds,
    optionRefs: refs,
  };
}

const paper: PaperQuestion[] = [
  paperQuestion(1, ['oA', 'oB', 'oC'], ['r1a', 'r1b', 'r1c']),
  paperQuestion(2, ['oD', 'oE', 'oF'], ['r2a', 'r2b', 'r2c']),
  paperQuestion(3, ['oG', 'oH', 'oI'], ['r3a', 'r3b', 'r3c']),
];

const key: KeyEntry[] = [
  { questionId: 'q1', correctOptionId: 'oB' },
  { questionId: 'q2', correctOptionId: 'oD' },
  { questionId: 'q3', correctOptionId: 'oI' },
];

test('resolveOptionRef maps an opaque ref back to the option it names', () => {
  assert.equal(resolveOptionRef(paper[0], 'r1b'), 'oB');
  assert.equal(resolveOptionRef(paper[0], 'r2a'), null, 'a ref from another question must not resolve');
  assert.equal(resolveOptionRef(paper[0], 'nonsense'), null);
});

test('refForOption is the inverse, and is what the review payload discloses', () => {
  assert.equal(refForOption(paper[2], 'oI'), 'r3c');
  assert.equal(refForOption(paper[2], 'oB'), null);
});

test('scores a fully correct paper', () => {
  const result = scorePaper({
    paper,
    key,
    answers: { q1: 'r1b', q2: 'r2a', q3: 'r3c' },
    options: { strict: true },
  });

  assert.equal(result.total, 3);
  assert.equal(result.correct, 3);
  assert.equal(result.incorrect, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.accuracyPct, 100);
});

test('scores a mixed paper and counts skips separately from wrong answers', () => {
  const result = scorePaper({
    paper,
    key,
    // q1 right, q2 wrong, q3 omitted entirely.
    answers: { q1: 'r1b', q2: 'r2b' },
    options: { strict: true },
  });

  assert.equal(result.correct, 1);
  assert.equal(result.incorrect, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.total, 3);
  assert.equal(result.accuracyPct, 33);

  // A skipped question still appears in the review, with the key, so the
  // candidate can learn from what they ran out of time for.
  const q3 = result.questions.find((q) => q.questionId === 'q3');
  assert.ok(q3);
  assert.equal(q3.selectedRef, null);
  assert.equal(q3.answered, false);
  assert.equal(q3.correctRef, 'r3c');
});

test('an answer for a question not on the paper is rejected, never scored', () => {
  const result = scorePaper({
    paper,
    key,
    answers: { q1: 'r1b', q_not_on_paper: 'whatever' },
    options: { strict: true },
  });

  assert.deepEqual(result.rejectedQuestionIds, ['q_not_on_paper']);
  assert.equal(result.total, 3, 'the paper size is the paper, not the submission');
  assert.equal(result.correct, 1);
});

test('a ref harvested from a different attempt does not score', () => {
  // This is the concrete attack the per-attempt refs defeat: the cheater knows
  // from a previous attempt's review that the correct body was "choice 2", but
  // the ref that named it then is meaningless now.
  const result = scorePaper({
    paper,
    key,
    answers: { q1: 'ref-from-last-week' },
    options: { strict: true },
  });

  assert.deepEqual(result.unknownRefQuestionIds, ['q1']);
  assert.equal(result.correct, 0);
  assert.equal(result.skipped, 3, 'an unresolvable ref counts as unanswered');
});

test('a question whose key points off the paper is excluded, not marked wrong', () => {
  // The authored bank genuinely contains these - see
  // frontend/src/data/quarantine.json. Marking them wrong would punish the
  // candidate for a content bug.
  const result = scorePaper({
    paper,
    key: [
      { questionId: 'q1', correctOptionId: 'oB' },
      { questionId: 'q2', correctOptionId: 'option-that-does-not-exist' },
      // q3 has no key row at all.
    ],
    answers: { q1: 'r1b', q2: 'r2a', q3: 'r3c' },
    options: { strict: true },
  });

  assert.deepEqual(result.unscorableQuestionIds.sort(), ['q2', 'q3']);
  assert.equal(result.total, 1, 'only the scorable question counts toward the total');
  assert.equal(result.correct, 1);
  assert.equal(result.accuracyPct, 100);
});

test('an empty submission scores zero without dividing by zero', () => {
  const result = scorePaper({ paper, key, answers: {}, options: { strict: true } });
  assert.equal(result.correct, 0);
  assert.equal(result.skipped, 3);
  assert.equal(result.accuracyPct, 0);

  const empty = scorePaper({ paper: [], key: [], answers: {}, options: { strict: true } });
  assert.equal(empty.total, 0);
  assert.equal(empty.accuracyPct, 0);
});

test('an inherited object property is not mistaken for an answer', () => {
  // A hostile or buggy client could send a body whose prototype carries a
  // question id. `hasOwnProperty` is why that reads as unanswered.
  const hostile = Object.create({ q1: 'r1b' }) as Record<string, string>;
  const result = scorePaper({ paper, key, answers: hostile, options: { strict: true } });
  assert.equal(result.correct, 0);
  assert.equal(result.skipped, 3);
});
