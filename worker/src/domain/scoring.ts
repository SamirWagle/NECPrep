/**
 * Scoring. Pure: paper in, key in, answers in, result out.
 *
 * The answer key reaches this function from a D1 join on
 * `question_options.is_correct` and leaves it only inside the review payload the
 * caller builds afterwards. No part of the key is ever present in a request, so
 * there is nothing for a client to tamper with: a submission consists of
 * question ids and opaque option refs, and both are checked against the paper
 * that the server itself wrote at start.
 */

import type { AnswerMap } from './expiry.ts';

export interface PaperQuestion {
  questionId: string;
  chapterId: string;
  /** 1-based position on this paper. */
  position: number;
  /** `question_options.id`, in the per-attempt permuted order. */
  optionOrder: readonly string[];
  /** Opaque per-attempt tokens, parallel to `optionOrder`. */
  optionRefs: readonly string[];
}

/** One row of the key, as joined from `question_options`. */
export interface KeyEntry {
  questionId: string;
  correctOptionId: string;
}

export interface ScoredQuestion {
  questionId: string;
  chapterId: string;
  position: number;
  selectedOptionId: string | null;
  selectedRef: string | null;
  correctOptionId: string;
  correctRef: string;
  isCorrect: boolean;
  answered: boolean;
}

export interface ScoreResult {
  /** One entry per scorable question on the paper, in paper order. */
  questions: ScoredQuestion[];
  total: number;
  correct: number;
  incorrect: number;
  skipped: number;
  accuracyPct: number;
  /** Submitted ids that are not on this paper. */
  rejectedQuestionIds: string[];
  /** Submitted refs that do not belong to the named question on this paper. */
  unknownRefQuestionIds: string[];
  /**
   * Questions dropped because the bank's key does not point at any option on
   * the paper. The authored bank genuinely contains these - see
   * `frontend/src/data/quarantine.json` - and they are excluded from `total`
   * rather than silently marked wrong, which would punish the candidate for a
   * content bug.
   */
  unscorableQuestionIds: string[];
}

export interface ScoreOptions {
  /**
   * `true` for a live submission: an off-paper question id or an unresolvable
   * option ref is a hard error for the caller to turn into a 422.
   *
   * `false` for the stored pre-deadline snapshot on the expired path: that data
   * was already validated when it was synced, and refusing to score a paper
   * because one stale entry no longer resolves would penalise a candidate who
   * merely ran out of time.
   */
  strict: boolean;
}

/** Resolves one opaque ref to a `question_options.id` on this paper. */
export function resolveOptionRef(
  question: PaperQuestion,
  ref: string,
): string | null {
  const index = question.optionRefs.indexOf(ref);
  if (index < 0) return null;
  return question.optionOrder[index] ?? null;
}

/** The ref a client would have seen for a given option on this paper. */
export function refForOption(
  question: PaperQuestion,
  optionId: string,
): string | null {
  const index = question.optionOrder.indexOf(optionId);
  if (index < 0) return null;
  return question.optionRefs[index] ?? null;
}

export function scorePaper(args: {
  paper: readonly PaperQuestion[];
  key: readonly KeyEntry[];
  answers: AnswerMap;
  options: ScoreOptions;
}): ScoreResult {
  const { paper, key, answers } = args;

  const keyByQuestion = new Map<string, string>();
  for (const entry of key) keyByQuestion.set(entry.questionId, entry.correctOptionId);

  const paperById = new Map<string, PaperQuestion>();
  for (const q of paper) paperById.set(q.questionId, q);

  const rejectedQuestionIds: string[] = [];
  for (const questionId of Object.keys(answers)) {
    if (!paperById.has(questionId)) rejectedQuestionIds.push(questionId);
  }

  const unknownRefQuestionIds: string[] = [];
  const unscorableQuestionIds: string[] = [];
  const questions: ScoredQuestion[] = [];

  let correct = 0;
  let answered = 0;

  for (const q of paper) {
    const correctOptionId = keyByQuestion.get(q.questionId);
    const correctRef =
      correctOptionId === undefined ? null : refForOption(q, correctOptionId);

    // The key is missing, or points at an option that is not on this paper.
    if (correctOptionId === undefined || correctRef === null) {
      unscorableQuestionIds.push(q.questionId);
      continue;
    }

    const submittedRef = Object.prototype.hasOwnProperty.call(answers, q.questionId)
      ? answers[q.questionId]
      : undefined;

    let selectedOptionId: string | null = null;
    let selectedRef: string | null = null;

    if (submittedRef !== undefined) {
      const resolved = resolveOptionRef(q, submittedRef);
      if (resolved === null) {
        // A ref that does not belong to this question on this attempt. Either a
        // stale client, or someone replaying a ref harvested from a different
        // attempt. Neither is scorable.
        unknownRefQuestionIds.push(q.questionId);
      } else {
        selectedOptionId = resolved;
        selectedRef = submittedRef;
        answered++;
      }
    }

    const isCorrect = selectedOptionId !== null && selectedOptionId === correctOptionId;
    if (isCorrect) correct++;

    questions.push({
      questionId: q.questionId,
      chapterId: q.chapterId,
      position: q.position,
      selectedOptionId,
      selectedRef,
      correctOptionId,
      correctRef,
      isCorrect,
      answered: selectedOptionId !== null,
    });
  }

  const total = questions.length;
  const skipped = total - answered;

  return {
    questions,
    total,
    correct,
    incorrect: answered - correct,
    skipped,
    accuracyPct: total === 0 ? 0 : Math.round((correct / total) * 100),
    rejectedQuestionIds,
    unknownRefQuestionIds,
    unscorableQuestionIds,
  };
}
