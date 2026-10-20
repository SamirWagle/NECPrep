/**
 * Quiz engine — the state machine.
 *
 * Pure: no React, no clock, no storage. Everything time-dependent arrives on
 * the action as `at`. Everything score-dependent is derived in selectors.ts,
 * never accumulated here.
 *
 * Three bugs in the hand-rolled page copies this replaces, and how the shape
 * prevents each one:
 *
 *  1. Navigation erased the answer. Fixed by `selections` being one slot per
 *     question that nothing resets on navigation. There is no scalar
 *     "selectedAnswer" to lose.
 *  2. A revisited question showed the wrong verdict. Fixed by the verdict being
 *     computed from `selections[i]` and `submitted`, so it is restored with the
 *     choice rather than tracked separately.
 *  3. Score double-counted. The pages did `setScore(s => s + 1)` inside submit,
 *     so any re-entry (double click, re-submit, StrictMode replay) inflated it.
 *     There is no score field here at all; `selectScore` counts the committed
 *     answers. Re-submitting is also an explicit no-op below.
 */

import type { QuizAction, HydratePayload } from './actions';
import { markGuesses } from './guess';
import type {
  FeedbackMode,
  QuizMode,
  QuizState,
  QuizTiming,
  ResponseRecord,
} from './types';

export interface InitialQuizConfig {
  mode: QuizMode;
  feedback: FeedbackMode;
  attemptKey?: string | null;
}

/** The default feedback behaviour for a surface: exams defer, practice does not. */
export function defaultFeedbackFor(mode: QuizMode): FeedbackMode {
  return mode === 'mock' ? 'deferred' : 'immediate';
}

export function createInitialState(config: InitialQuizConfig): QuizState {
  return {
    attemptKey: config.attemptKey ?? null,
    mode: config.mode,
    feedback: config.feedback,
    phase: 'loading',
    questions: [],
    selections: [],
    submitted: new Set<number>(),
    flagged: new Set<number>(),
    bookmarked: new Set<string>(),
    currentIndex: 0,
    revealAll: false,
    responses: [],
    timing: {
      startedAt: null,
      endsAt: null,
      viewStartedAt: null,
      accumulatedMs: [],
      paused: false,
    },
    resumed: false,
  };
}

// ─── Timing helpers ──────────────────────────────────────────────────────────

/**
 * Folds the running slice into `accumulatedMs[index]` and restarts the slice.
 *
 * `restartAt` of null leaves the clock stopped (pause, or attempt finished).
 * A negative slice (clock skew, or a stale `at`) is clamped to zero so timing
 * can never run backwards.
 */
function bankSlice(
  timing: QuizTiming,
  index: number,
  at: number,
  restartAt: number | null
): QuizTiming {
  const accumulatedMs = [...timing.accumulatedMs];
  if (timing.viewStartedAt !== null && index >= 0 && index < accumulatedMs.length) {
    accumulatedMs[index] += Math.max(0, at - timing.viewStartedAt);
  }
  return { ...timing, accumulatedMs, viewStartedAt: restartAt, paused: restartAt === null };
}

/** Visible time on a question, including the slice still running at `at`. */
export function timeSpentAt(state: QuizState, index: number, at: number): number {
  const banked = state.timing.accumulatedMs[index] ?? 0;
  const running =
    index === state.currentIndex && state.timing.viewStartedAt !== null
      ? Math.max(0, at - state.timing.viewStartedAt)
      : 0;
  return banked + running;
}

// ─── Commit helpers ──────────────────────────────────────────────────────────

function buildRecord(
  state: QuizState,
  index: number,
  timeSpentMs: number,
  at: number
): ResponseRecord {
  const q = state.questions[index];
  const chosenIndex = state.selections[index] ?? null;
  // `correctIndex === -1` is the no-answer-key sentinel from localData. Such a
  // question is never scored as correct, which is why selectors report a
  // separate gradable total instead of pretending it was wrong.
  const hasKey = q.correctIndex >= 0;
  return {
    questionId: q.id,
    topicId: q.topicId,
    chosenIndex,
    correct: hasKey && chosenIndex !== null && chosenIndex === q.correctIndex,
    timeSpentMs,
    mode: state.mode,
    // Recomputed across the whole set by markGuesses once the record is in.
    flaggedGuess: false,
    timestamp: at,
  };
}

/**
 * Commits every question not already committed and ends the attempt.
 *
 * Blanks get a record too (`chosenIndex: null`): a skipped question with 40
 * seconds on it is a different signal from one the student never reached, and
 * only a record carries that.
 */
function finish(state: QuizState, at: number): QuizState {
  if (state.phase === 'done' || state.questions.length === 0) return state;

  const timing = bankSlice(state.timing, state.currentIndex, at, null);
  const pending: ResponseRecord[] = [];
  const submitted = new Set(state.submitted);

  for (let i = 0; i < state.questions.length; i++) {
    if (submitted.has(i)) continue;
    submitted.add(i);
    pending.push(buildRecord(state, i, timing.accumulatedMs[i] ?? 0, at));
  }

  return {
    ...state,
    phase: 'done',
    submitted,
    revealAll: true,
    responses: markGuesses([...state.responses, ...pending]),
    timing,
  };
}

// ─── Hydrate ─────────────────────────────────────────────────────────────────

function sameLength<T>(arr: readonly T[] | undefined, n: number): readonly T[] | undefined {
  return arr !== undefined && arr.length === n ? arr : undefined;
}

function hydrateState(state: QuizState, payload: HydratePayload): QuizState {
  const { questions, at, startedAt, endsAt } = payload;
  if (questions.length === 0) return state;

  const n = questions.length;
  // A restored array of the wrong length describes a different paper. Drop it
  // rather than re-point every stored answer at the wrong question.
  const selections = sameLength(payload.selections, n) ?? Array<number | null>(n).fill(null);
  const accumulatedMs = sameLength(payload.accumulatedMs, n) ?? Array<number>(n).fill(0);
  const submitted = new Set((payload.submitted ?? []).filter((i) => i >= 0 && i < n));
  const flagged = new Set((payload.flagged ?? []).filter((i) => i >= 0 && i < n));
  const currentIndex = Math.min(Math.max(payload.currentIndex ?? 0, 0), n - 1);

  const hydrated: QuizState = {
    ...state,
    attemptKey: payload.attemptKey,
    phase: 'active',
    questions,
    selections: [...selections],
    submitted,
    flagged,
    bookmarked: new Set(payload.bookmarked ?? []),
    currentIndex,
    revealAll: false,
    responses: [],
    timing: {
      startedAt,
      endsAt,
      viewStartedAt: at,
      accumulatedMs: [...accumulatedMs],
      paused: false,
    },
    resumed: payload.resumed ?? false,
  };

  // A timed draft whose deadline passed while the tab was shut is over. Score
  // it from what was answered instead of handing back a fresh timer.
  if (endsAt !== null && at >= endsAt) {
    return finish({ ...hydrated, timing: { ...hydrated.timing, viewStartedAt: null } }, at);
  }
  return hydrated;
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case 'quiz/hydrate':
      return hydrateState(state, action.payload);

    case 'quiz/select': {
      const { index, option } = action;
      if (state.phase === 'done') return state;
      if (index < 0 || index >= state.questions.length) return state;
      // Committed answers are frozen. In deferred mode nothing is committed
      // until the paper is submitted, so answers stay editable throughout.
      if (state.submitted.has(index)) return state;
      if (option < 0 || option >= state.questions[index].options.length) return state;
      if (state.selections[index] === option) return state;
      const selections = [...state.selections];
      selections[index] = option;
      return { ...state, selections };
    }

    case 'quiz/submitQuestion': {
      const { index, at } = action;
      if (state.phase === 'done') return state;
      if (index < 0 || index >= state.questions.length) return state;
      // Idempotent by construction: the second submit of a question changes
      // nothing, so no amount of re-entry can inflate the score.
      if (state.submitted.has(index)) return state;
      if (state.selections[index] === null || state.selections[index] === undefined) return state;

      const timing = bankSlice(state.timing, index, at, at);
      const record = buildRecord(state, index, timing.accumulatedMs[index] ?? 0, at);
      return {
        ...state,
        submitted: new Set(state.submitted).add(index),
        responses: markGuesses([...state.responses, record]),
        timing,
      };
    }

    case 'quiz/submitAll':
      return finish(state, action.at);

    case 'quiz/navigate': {
      const { at } = action;
      if (state.questions.length === 0) return state;
      const index = Math.min(Math.max(action.index, 0), state.questions.length - 1);
      if (index === state.currentIndex) return state;
      const timing =
        state.phase === 'done'
          ? state.timing
          : bankSlice(state.timing, state.currentIndex, at, state.timing.paused ? null : at);
      return { ...state, currentIndex: index, timing };
    }

    case 'quiz/toggleFlag': {
      const { index } = action;
      if (index < 0 || index >= state.questions.length) return state;
      const flagged = new Set(state.flagged);
      if (flagged.has(index)) flagged.delete(index);
      else flagged.add(index);
      return { ...state, flagged };
    }

    case 'quiz/setBookmarks':
      return { ...state, bookmarked: new Set(action.ids) };

    case 'quiz/toggleBookmark': {
      const bookmarked = new Set(state.bookmarked);
      if (bookmarked.has(action.questionId)) bookmarked.delete(action.questionId);
      else bookmarked.add(action.questionId);
      return { ...state, bookmarked };
    }

    case 'quiz/enterReview': {
      if (state.phase !== 'active') return state;
      // The clock keeps running on review — in a timed exam the deadline does
      // not care which screen you are looking at — but no question is on
      // screen, so the running slice is banked and left stopped.
      return { ...state, phase: 'review', timing: bankSlice(state.timing, state.currentIndex, action.at, null) };
    }

    case 'quiz/exitReview': {
      if (state.phase !== 'review') return state;
      return {
        ...state,
        phase: 'active',
        timing: { ...state.timing, viewStartedAt: action.at, paused: false },
      };
    }

    case 'quiz/pause': {
      if (state.phase === 'done' || state.timing.viewStartedAt === null) return state;
      return { ...state, timing: bankSlice(state.timing, state.currentIndex, action.at, null) };
    }

    case 'quiz/resume': {
      if (state.phase !== 'active' || state.timing.viewStartedAt !== null) return state;
      return { ...state, timing: { ...state.timing, viewStartedAt: action.at, paused: false } };
    }

    case 'quiz/reset':
      return createInitialState({
        mode: state.mode,
        feedback: state.feedback,
        attemptKey: state.attemptKey,
      });

    default:
      return state;
  }
}
