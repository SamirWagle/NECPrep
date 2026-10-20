/**
 * Quiz engine — derived reads.
 *
 * Nothing here is stored in state. Score in particular is counted from the
 * committed answers on every read, so it cannot drift from the answers the way
 * an incremented counter does.
 */

import type {
  PaletteEntry,
  Question,
  QuizState,
  QuizSummary,
  Verdict,
} from './types';

export function selectCurrentQuestion(state: QuizState): Question | undefined {
  return state.questions[state.currentIndex];
}

export function selectSelection(state: QuizState, index: number): number | null {
  return state.selections[index] ?? null;
}

export function selectIsSubmitted(state: QuizState, index: number): boolean {
  return state.submitted.has(index);
}

/**
 * Whether question `index` may show its answer key.
 *
 * `immediate`: as soon as that question is committed.
 * `deferred`: not until the paper is submitted (`revealAll`).
 */
export function selectIsRevealed(state: QuizState, index: number): boolean {
  if (state.revealAll) return true;
  return state.feedback === 'immediate' && state.submitted.has(index);
}

/**
 * The verdict a question should display.
 *
 * `pending` is the deferred-mode answer: the student picked something and the
 * UI must show the pick without leaking whether it was right. Returning
 * `unanswered` for an untouched question is what stops forward navigation from
 * showing a verdict on a question nobody has answered.
 */
export function selectVerdict(state: QuizState, index: number): Verdict {
  const q = state.questions[index];
  const chosen = state.selections[index] ?? null;
  if (!q) return 'unanswered';
  if (chosen === null) return 'unanswered';
  if (!selectIsRevealed(state, index)) return 'pending';
  if (q.correctIndex < 0) return 'unkeyed';
  return chosen === q.correctIndex ? 'correct' : 'incorrect';
}

/** Derived score: committed answers that match a real answer key. */
export function selectScore(state: QuizState): number {
  let score = 0;
  for (const index of state.submitted) {
    const q = state.questions[index];
    if (!q || q.correctIndex < 0) continue;
    if (state.selections[index] === q.correctIndex) score++;
  }
  return score;
}

/** Questions with a usable answer key — the denominator a percentage deserves. */
export function selectGradableTotal(state: QuizState): number {
  return state.questions.reduce((n, q) => (q.correctIndex >= 0 ? n + 1 : n), 0);
}

/** Answered means "has a selection", committed or not. */
export function selectAnsweredCount(state: QuizState): number {
  return state.selections.reduce<number>((n, s) => (s === null ? n : n + 1), 0);
}

export function selectUnansweredCount(state: QuizState): number {
  return state.questions.length - selectAnsweredCount(state);
}

export function selectFlaggedCount(state: QuizState): number {
  return state.flagged.size;
}

/** Indices still unanswered, in paper order — the list the review screen shows. */
export function selectUnansweredIndices(state: QuizState): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.questions.length; i++) {
    if ((state.selections[i] ?? null) === null) out.push(i);
  }
  return out;
}

export function selectFlaggedIndices(state: QuizState): number[] {
  return [...state.flagged].sort((a, b) => a - b);
}

export function selectIsBookmarked(state: QuizState, index: number): boolean {
  const q = state.questions[index];
  return q ? state.bookmarked.has(q.id) : false;
}

/** One entry per question for the numbered palette. States are not exclusive. */
export function selectPalette(state: QuizState): PaletteEntry[] {
  return state.questions.map((q, index) => ({
    index,
    questionId: q.id,
    answered: (state.selections[index] ?? null) !== null,
    submitted: state.submitted.has(index),
    flagged: state.flagged.has(index),
    current: index === state.currentIndex,
  }));
}

/** Milliseconds left against the absolute deadline. Null when untimed. */
export function selectTimeLeftMs(state: QuizState, now: number): number | null {
  if (state.timing.endsAt === null) return null;
  return Math.max(0, state.timing.endsAt - now);
}

export function selectIsExpired(state: QuizState, now: number): boolean {
  return state.timing.endsAt !== null && now >= state.timing.endsAt;
}

export function selectSummary(state: QuizState): QuizSummary {
  const score = selectScore(state);
  const gradableTotal = selectGradableTotal(state);
  const answered = selectAnsweredCount(state);
  const total = state.questions.length;
  return {
    mode: state.mode,
    score,
    total,
    gradableTotal,
    answered,
    skipped: total - answered,
    // Wrong answers only: an unanswered question is skipped, not incorrect, and
    // a question with no answer key is neither.
    incorrect: state.questions.reduce<number>((n, q, i) => {
      if (q.correctIndex < 0) return n;
      if (!state.submitted.has(i)) return n;
      const chosen = state.selections[i] ?? null;
      return chosen !== null && chosen !== q.correctIndex ? n + 1 : n;
    }, 0),
    accuracyPct: gradableTotal === 0 ? 0 : Math.round((score / gradableTotal) * 100),
    // Visible time on task, not wall-clock duration: the tab being hidden for
    // ten minutes is not ten minutes of study.
    elapsedMs: state.timing.accumulatedMs.reduce((a, b) => a + b, 0),
    responses: state.responses,
  };
}
