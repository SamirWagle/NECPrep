/**
 * Quiz engine — action types and pure action creators.
 *
 * Every action that moves time forward carries `at` (epoch ms) instead of
 * letting the reducer read the clock. That is the whole reason the reducer can
 * be unit-tested without fake timers, and the reason per-question latency is
 * reproducible from a recorded action log.
 */

import type { Question } from './types';

/**
 * Payload for starting (or restoring) an attempt.
 *
 * The optional arrays are the restore path. They are accepted only when their
 * length matches `questions`; a mismatch means the draft describes a paper we
 * cannot faithfully rebuild, so the reducer starts clean rather than scoring
 * against the wrong questions.
 */
export interface HydratePayload {
  /** Identity of the attempt being started or restored. */
  attemptKey: string | null;
  questions: Question[];
  /** Now, epoch ms. */
  at: number;
  /** When the attempt began — the original start time when resuming. */
  startedAt: number;
  /** Absolute deadline, epoch ms, or null for untimed modes. */
  endsAt: number | null;
  /** Question ids already bookmarked, read from storage by the caller. */
  bookmarked?: readonly string[];
  resumed?: boolean;
  selections?: readonly (number | null)[];
  submitted?: readonly number[];
  flagged?: readonly number[];
  accumulatedMs?: readonly number[];
  currentIndex?: number;
}

export type QuizAction =
  | { type: 'quiz/hydrate'; payload: HydratePayload }
  | { type: 'quiz/select'; index: number; option: number; at: number }
  | { type: 'quiz/submitQuestion'; index: number; at: number }
  | { type: 'quiz/submitAll'; at: number }
  | { type: 'quiz/navigate'; index: number; at: number }
  | { type: 'quiz/toggleFlag'; index: number }
  | { type: 'quiz/setBookmarks'; ids: readonly string[] }
  | { type: 'quiz/toggleBookmark'; questionId: string }
  | { type: 'quiz/enterReview'; at: number }
  | { type: 'quiz/exitReview'; at: number }
  | { type: 'quiz/pause'; at: number }
  | { type: 'quiz/resume'; at: number }
  | { type: 'quiz/reset' };

export const hydrate = (payload: HydratePayload): QuizAction => ({
  type: 'quiz/hydrate',
  payload,
});

export const select = (index: number, option: number, at: number): QuizAction => ({
  type: 'quiz/select',
  index,
  option,
  at,
});

/** Commit one question. In `immediate` feedback this is what reveals the verdict. */
export const submitQuestion = (index: number, at: number): QuizAction => ({
  type: 'quiz/submitQuestion',
  index,
  at,
});

/** Submit the paper. Terminal: emits a record for every question not yet committed. */
export const submitAll = (at: number): QuizAction => ({ type: 'quiz/submitAll', at });

/** Move the viewport. Banks the running time slice against the question being left. */
export const navigate = (index: number, at: number): QuizAction => ({
  type: 'quiz/navigate',
  index,
  at,
});

export const toggleFlag = (index: number): QuizAction => ({ type: 'quiz/toggleFlag', index });

export const setBookmarks = (ids: readonly string[]): QuizAction => ({
  type: 'quiz/setBookmarks',
  ids,
});

export const toggleBookmark = (questionId: string): QuizAction => ({
  type: 'quiz/toggleBookmark',
  questionId,
});

export const enterReview = (at: number): QuizAction => ({ type: 'quiz/enterReview', at });

export const exitReview = (at: number): QuizAction => ({ type: 'quiz/exitReview', at });

/** Tab hidden, or otherwise off-task: stop accruing time for the current question. */
export const pause = (at: number): QuizAction => ({ type: 'quiz/pause', at });

export const resume = (at: number): QuizAction => ({ type: 'quiz/resume', at });

export const reset = (): QuizAction => ({ type: 'quiz/reset' });
