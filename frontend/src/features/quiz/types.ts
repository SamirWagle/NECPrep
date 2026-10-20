/**
 * Quiz engine — shared types.
 *
 * One state machine backs all four quiz surfaces (topic practice, quick
 * practice, custom practice, mock test). The shapes here are deliberately
 * serialisable: `QuizState` minus the question list is close to what gets
 * written to the resume draft, and `ResponseRecord` is the analytics row.
 */

import type { Question } from '../../services/localData';

export type { Question };

/** Which surface the attempt came from. Travels into every response record. */
export type QuizMode = 'topic' | 'quick' | 'custom' | 'mock' | 'bookmarks';

/**
 * When the verdict is allowed to be shown.
 *
 * - `immediate` — practice. Submitting one question reveals its verdict.
 * - `deferred`  — exam. Nothing is revealed until the whole paper is submitted.
 */
export type FeedbackMode = 'immediate' | 'deferred';

/**
 * `loading` — no questions yet (fetching, or resolving a saved draft).
 * `active`  — the student is working.
 * `review`  — pre-submit confirmation screen; answers are still editable.
 * `done`    — submitted and scored. Terminal.
 */
export type QuizPhase = 'loading' | 'active' | 'review' | 'done';

/**
 * One answered question, as handed to analytics.
 *
 * Fields are fixed by the analytics contract — do not add to this shape
 * without a migration, because records are appended to durable storage.
 */
export interface ResponseRecord {
  questionId: string;
  topicId: string;
  /** Chosen option index, or null when the question was left blank. */
  chosenIndex: number | null;
  /** False for blanks and for questions with no answer key (`correctIndex === -1`). */
  correct: boolean;
  /** Visible wall-clock milliseconds between first view and submit. */
  timeSpentMs: number;
  mode: QuizMode;
  /** Answered suspiciously fast relative to this session — see guess.ts. */
  flaggedGuess: boolean;
  /** Submit time, epoch ms. */
  timestamp: number;
}

/**
 * Per-question timing.
 *
 * `accumulatedMs[i]` is time already banked for question i. The question
 * currently being viewed also accrues `now - viewStartedAt`, which is only
 * folded into `accumulatedMs` when the view changes, the clock pauses, or the
 * answer is submitted. That split is what makes pausing on tab-hide cheap: we
 * stop the running slice instead of reconciling a ticking counter.
 */
export interface QuizTiming {
  /** Epoch ms the attempt began. Null while loading. */
  startedAt: number | null;
  /**
   * Absolute wall-clock deadline, epoch ms. Null for untimed modes.
   *
   * Never a remaining-seconds counter: a decrementing counter pauses when the
   * tab closes and resets on reload, which hands a student unlimited time.
   */
  endsAt: number | null;
  /** Epoch ms the current question current running slice started. Null when paused. */
  viewStartedAt: number | null;
  /** Banked visible ms per question index. */
  accumulatedMs: number[];
  /** True while the tab is hidden (Page Visibility) or the attempt is finished. */
  paused: boolean;
}

export interface QuizState {
  /**
   * Identity of the attempt this state belongs to, e.g. `topic:book-ch1:30`.
   *
   * Held in state so a host whose parameters changed can tell a stale attempt
   * from the new one by comparison, instead of resetting from an effect.
   */
  attemptKey: string | null;
  mode: QuizMode;
  feedback: FeedbackMode;
  phase: QuizPhase;
  questions: Question[];
  /** One slot per question: the chosen option index, or null if untouched. */
  selections: (number | null)[];
  /** Indices whose answer has been committed. */
  submitted: ReadonlySet<number>;
  /** Indices the student marked for review. */
  flagged: ReadonlySet<number>;
  /** Bookmarked question ids (ids, not indices — bookmarks outlive the attempt). */
  bookmarked: ReadonlySet<string>;
  currentIndex: number;
  /**
   * True once every verdict is public. Flips on the first submit in
   * `immediate` mode; in `deferred` mode only when the paper is submitted.
   */
  revealAll: boolean;
  /** Append-only, except that `flaggedGuess` is recomputed as the median moves. */
  responses: ResponseRecord[];
  timing: QuizTiming;
  /** True when this attempt was rebuilt from a saved draft. */
  resumed: boolean;
}

/** Everything a result screen needs. All of it derived, none of it accumulated. */
export interface QuizSummary {
  mode: QuizMode;
  score: number;
  /** Questions in the paper. */
  total: number;
  /** Questions that actually have an answer key — the honest denominator. */
  gradableTotal: number;
  answered: number;
  skipped: number;
  incorrect: number;
  /** Percentage of `gradableTotal`, 0 when nothing is gradable. */
  accuracyPct: number;
  elapsedMs: number;
  responses: ResponseRecord[];
}

/** One cell of the question palette. A question can be several of these at once. */
export interface PaletteEntry {
  index: number;
  questionId: string;
  answered: boolean;
  submitted: boolean;
  flagged: boolean;
  current: boolean;
}

export type Verdict =
  /** No selection yet. */
  | 'unanswered'
  /** Selected but not yet revealed (deferred mode, or not submitted). */
  | 'pending'
  | 'correct'
  | 'incorrect'
  /** Answered and revealed, but the bank has no key for this question. */
  | 'unkeyed';
