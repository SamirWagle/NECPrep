/** Test helpers for the quiz engine. Not a test file. */

import { hydrate } from '../actions';
import { createInitialState, quizReducer } from '../reducer';
import type { FeedbackMode, Question, QuizMode, QuizState } from '../types';

/** `correctIndex: -1` reproduces the no-answer-key sentinel from localData. */
export function makeQuestion(i: number, correctIndex = 1, topicId = 'book-ch1'): Question {
  return {
    id: `${topicId}_${i}`,
    topicId,
    question: `Question ${i}?`,
    options: ['A', 'B', 'C', 'D'],
    correctIndex,
  };
}

export function makeQuestions(n: number, correctIndexes?: number[]): Question[] {
  return Array.from({ length: n }, (_, i) => makeQuestion(i, correctIndexes?.[i] ?? 1));
}

export const T0 = 1_700_000_000_000;

export interface StartOptions {
  mode?: QuizMode;
  feedback?: FeedbackMode;
  questions?: Question[];
  at?: number;
  durationMs?: number | null;
  attemptKey?: string | null;
}

/** A hydrated, active attempt. */
export function start(options: StartOptions = {}): QuizState {
  const {
    mode = 'topic',
    feedback = 'immediate',
    questions = makeQuestions(3),
    at = T0,
    durationMs = null,
    attemptKey = 'test:attempt',
  } = options;
  return quizReducer(
    createInitialState({ mode, feedback, attemptKey }),
    hydrate({
      attemptKey,
      questions,
      at,
      startedAt: at,
      endsAt: durationMs === null ? null : at + durationMs,
    })
  );
}

/** Applies a sequence of actions, so a test reads as a story. */
export function run(
  state: QuizState,
  ...actions: Parameters<typeof quizReducer>[1][]
): QuizState {
  return actions.reduce(quizReducer, state);
}
