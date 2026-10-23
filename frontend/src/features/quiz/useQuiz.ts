/**
 * useQuiz — the one quiz state machine, wired to React.
 *
 * Owns loading (fresh paper or resumed draft), the wall-clock timer, the Page
 * Visibility pause, debounced autosave, and the write-through of answers to
 * `recordAttempt`. Pages supply a question loader and render; they hold no
 * quiz state of their own.
 *
 * The reducer and selectors underneath are pure, so the interesting behaviour
 * is tested without React. What is tested here is only the wiring.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  addBookmark,
  getBookmarks,
  recordAttempt,
  removeBookmark,
} from '../../services/localData';
import {
  enterReview as enterReviewAction,
  exitReview as exitReviewAction,
  hydrate,
  navigate as navigateAction,
  pause as pauseAction,
  resume as resumeAction,
  select as selectAction,
  setBookmarks as setBookmarksAction,
  submitAll as submitAllAction,
  submitQuestion as submitQuestionAction,
  toggleBookmark as toggleBookmarkAction,
  toggleFlag as toggleFlagAction,
} from './actions';
import { clearDraft, draftFromState, readDraft, writeDraft } from './draft';
import { createInitialState, defaultFeedbackFor, quizReducer } from './reducer';
import {
  selectAnsweredCount,
  selectCurrentQuestion,
  selectFlaggedCount,
  selectIsBookmarked,
  selectIsRevealed,
  selectIsSubmitted,
  selectPalette,
  selectSelection,
  selectSummary,
  selectTimeLeftMs,
  selectUnansweredCount,
  selectUnansweredIndices,
  selectVerdict,
} from './selectors';
import type {
  FeedbackMode,
  PaletteEntry,
  Question,
  QuizMode,
  QuizState,
  QuizSummary,
  Verdict,
} from './types';

export interface UseQuizOptions {
  mode: QuizMode;
  /** Defaults to `deferred` for mock tests, `immediate` everywhere else. */
  feedback?: FeedbackMode;
  /**
   * Stable identity for this attempt, e.g. `topic:book-ch1:30`. Used as the
   * autosave key; changing it abandons the current attempt and starts a new
   * one. Pass null to run without persistence.
   */
  attemptKey: string | null;
  /** Total time for timed attempts. Null/undefined means untimed. */
  durationMs?: number | null;
  /** Builds a fresh paper. Called only when there is no resumable draft. */
  loadQuestions: () => Promise<Question[]>;
  /** Rebuilds a saved paper from ids. Defaults to `loadQuestionsByIds`. */
  resolveQuestions?: (ids: string[]) => Promise<Question[]>;
  /** Migrates a pre-engine `eng_mock_draft_v1:<testId>` draft on first load. */
  legacyMockTestId?: string;
  /** Hold off loading — e.g. while a custom-practice config screen is open. */
  enabled?: boolean;
  /** Write answers through to the per-topic progress store. Default true. */
  persistAttempts?: boolean;
  autosaveDelayMs?: number;
  /** Fired once, when the attempt reaches `done`. */
  onComplete?: (summary: QuizSummary) => void;
}

export interface QuizCounts {
  total: number;
  answered: number;
  unanswered: number;
  flagged: number;
}

export interface UseQuizResult {
  state: QuizState;
  /** Set when loading failed; the host renders its own error surface. */
  error: string | null;
  current: Question | undefined;
  /** Current question selection, or null. */
  selection: number | null;
  verdict: Verdict;
  isRevealed: boolean;
  isSubmitted: boolean;
  isFlagged: boolean;
  isBookmarked: boolean;
  counts: QuizCounts;
  palette: PaletteEntry[];
  unansweredIndices: number[];
  summary: QuizSummary;
  /** Milliseconds left against the absolute deadline, or null when untimed. */
  timeLeftMs: number | null;
  canSubmitCurrent: boolean;
  isLast: boolean;

  selectOption: (option: number) => void;
  submitCurrent: () => void;
  /** Submit one question, or advance if it is already submitted. The Enter key. */
  submitOrAdvance: () => void;
  submitAll: () => void;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  toggleFlag: (index?: number) => void;
  toggleBookmark: (index?: number) => void;
  enterReview: () => void;
  exitReview: () => void;
  /**
   * Throw away the saved draft. Use before navigating away from a dead
   * attempt. To restart, change `attemptKey` — that is what starts a new
   * attempt, so a restart is a new identity rather than a mutation.
   */
  discardDraft: () => void;
  /** Re-read bookmarks from storage, e.g. after returning from another page. */
  syncBookmarks: () => void;
}

const DEFAULT_AUTOSAVE_DELAY_MS = 500;

export function useQuiz(options: UseQuizOptions): UseQuizResult {
  const {
    mode,
    attemptKey,
    durationMs = null,
    legacyMockTestId,
    enabled = true,
    persistAttempts = true,
    autosaveDelayMs = DEFAULT_AUTOSAVE_DELAY_MS,
  } = options;
  const feedback = options.feedback ?? defaultFeedbackFor(mode);

  // A fresh loading state whenever the attempt identity changes. Comparing
  // `attemptKey` lets a stale attempt be discarded by derivation instead of by
  // a reset dispatched from an effect.
  const blank = useMemo(
    () => createInitialState({ mode, feedback, attemptKey }),
    [mode, feedback, attemptKey]
  );
  const [raw, dispatch] = useReducer(quizReducer, blank);
  const state = raw.attemptKey === attemptKey ? raw : blank;

  const [error, setError] = useState<string | null>(null);

  // Latest-callback refs so an inline `loadQuestions={() => ...}` on the host
  // does not restart the attempt on every render. Written in an effect, never
  // during render.
  const callbacksRef = useRef(options);
  useEffect(() => {
    callbacksRef.current = options;
  });

  // ── Load: resume a draft, else build a fresh paper ────────────────────────
  useEffect(() => {
    if (!enabled || attemptKey === null) return;
    let cancelled = false;

    const start = async () => {
      const draft = readDraft(attemptKey, { legacyMockTestId });

      if (draft) {
        const resolve = callbacksRef.current.resolveQuestions ?? defaultResolve;
        const restored = await resolve(draft.questionIds);
        if (cancelled) return;
        // A short read means the chapter data changed under us. Discard rather
        // than score against a paper we cannot faithfully rebuild.
        if (restored.length === draft.questionIds.length) {
          dispatch(
            hydrate({
              attemptKey,
              questions: restored,
              at: Date.now(),
              startedAt: draft.startedAt,
              endsAt: draft.endsAt,
              bookmarked: getBookmarks(),
              resumed: true,
              selections: draft.selections,
              submitted: draft.submitted,
              flagged: draft.flagged,
              accumulatedMs: draft.accumulatedMs,
              currentIndex: draft.currentIndex,
            })
          );
          return;
        }
        clearDraft(attemptKey, { legacyMockTestId });
      }

      const questions = await callbacksRef.current.loadQuestions();
      if (cancelled) return;
      if (questions.length === 0) {
        setError('No questions available.');
        return;
      }
      const startedAt = Date.now();
      dispatch(
        hydrate({
          attemptKey,
          questions,
          at: startedAt,
          startedAt,
          endsAt: durationMs === null ? null : startedAt + durationMs,
          bookmarked: getBookmarks(),
        })
      );
    };

    reportFailure(start(), () => cancelled, setError);
    return () => {
      cancelled = true;
    };
  }, [enabled, attemptKey, durationMs, legacyMockTestId]);

  // ── Timer tick: only for timed attempts, and only while they are running ──
  const [now, setNow] = useState(() => Date.now());
  const timed = state.timing.endsAt !== null;
  const running = state.phase === 'active' || state.phase === 'review';

  useEffect(() => {
    if (!timed || !running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timed, running]);

  // ── Auto-submit at the deadline ───────────────────────────────────────────
  // Scheduled against the absolute deadline rather than watched on the tick, so
  // it still fires correctly in a throttled background tab. A deadline already
  // in the past is handled in the reducer at hydrate time.
  const endsAt = state.timing.endsAt;
  useEffect(() => {
    if (endsAt === null || state.phase === 'done' || state.phase === 'loading') return;
    const id = setTimeout(() => dispatch(submitAllAction(Date.now())), Math.max(0, endsAt - Date.now()));
    return () => clearTimeout(id);
  }, [endsAt, state.phase]);

  // ── Pause while the tab is hidden ─────────────────────────────────────────
  useEffect(() => {
    const onVisibility = () => {
      dispatch(document.hidden ? pauseAction(Date.now()) : resumeAction(Date.now()));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // ── Autosave, debounced ───────────────────────────────────────────────────
  useEffect(() => {
    if (attemptKey === null) return;
    const draft = draftFromState(state, attemptKey, Date.now());
    if (draft === null) return;
    const id = setTimeout(() => writeDraft(draft), autosaveDelayMs);
    return () => clearTimeout(id);
  }, [state, attemptKey, autosaveDelayMs]);

  // A finished attempt must not be resumable.
  useEffect(() => {
    if (attemptKey === null || state.phase !== 'done') return;
    clearDraft(attemptKey, { legacyMockTestId });
  }, [state.phase, attemptKey, legacyMockTestId]);

  // ── Write answers through to the progress store ───────────────────────────
  const flushedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    flushedRef.current = new Set();
  }, [attemptKey]);

  const keyedIds = useMemo(
    () => new Set(state.questions.filter((q) => q.correctIndex >= 0).map((q) => q.id)),
    [state.questions]
  );

  useEffect(() => {
    if (!persistAttempts) return;
    for (const record of state.responses) {
      // Blanks are not attempts, and a question with no answer key cannot be
      // graded, so neither belongs in per-topic progress.
      if (record.chosenIndex === null) continue;
      if (!keyedIds.has(record.questionId)) continue;
      if (flushedRef.current.has(record.questionId)) continue;
      flushedRef.current.add(record.questionId);
      recordAttempt(record.questionId, record.topicId, record.correct);
    }
  }, [state.responses, keyedIds, persistAttempts]);

  // ── onComplete, exactly once ──────────────────────────────────────────────
  // `undefined` is the not-yet-fired sentinel, so a null attemptKey still fires.
  const completedRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (state.phase !== 'done') return;
    if (completedRef.current === attemptKey) return;
    completedRef.current = attemptKey;
    callbacksRef.current.onComplete?.(selectSummary(state));
  }, [state, attemptKey]);

  // ── Derived reads ─────────────────────────────────────────────────────────
  const index = state.currentIndex;
  const summary = useMemo(() => selectSummary(state), [state]);
  const palette = useMemo(() => selectPalette(state), [state]);
  const unansweredIndices = useMemo(() => selectUnansweredIndices(state), [state]);
  const current = selectCurrentQuestion(state);
  const selection = selectSelection(state, index);
  const isSubmitted = selectIsSubmitted(state, index);
  const counts: QuizCounts = {
    total: state.questions.length,
    answered: selectAnsweredCount(state),
    unanswered: selectUnansweredCount(state),
    flagged: selectFlaggedCount(state),
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const selectOption = useCallback(
    (option: number) => dispatch(selectAction(index, option, Date.now())),
    [index]
  );

  const submitCurrent = useCallback(
    () => dispatch(submitQuestionAction(index, Date.now())),
    [index]
  );

  const goTo = useCallback((target: number) => dispatch(navigateAction(target, Date.now())), []);
  const next = useCallback(() => dispatch(navigateAction(index + 1, Date.now())), [index]);
  const prev = useCallback(() => dispatch(navigateAction(index - 1, Date.now())), [index]);
  const submitAll = useCallback(() => dispatch(submitAllAction(Date.now())), []);
  const enterReview = useCallback(() => dispatch(enterReviewAction(Date.now())), []);
  const exitReview = useCallback(() => dispatch(exitReviewAction(Date.now())), []);

  const canSubmitCurrent =
    state.phase === 'active' && selection !== null && !isSubmitted;

  const submitOrAdvance = useCallback(() => {
    if (canSubmitCurrent) {
      dispatch(submitQuestionAction(index, Date.now()));
      return;
    }
    if (index < state.questions.length - 1) dispatch(navigateAction(index + 1, Date.now()));
  }, [canSubmitCurrent, index, state.questions.length]);

  const toggleFlag = useCallback(
    (target?: number) => dispatch(toggleFlagAction(target ?? index)),
    [index]
  );

  const toggleBookmark = useCallback(
    (target?: number) => {
      const q = state.questions[target ?? index];
      if (!q) return;
      // Storage first, then state: the set in state mirrors storage, and the
      // old per-index effect that only ever added is how they drifted apart.
      if (state.bookmarked.has(q.id)) removeBookmark(q.id);
      else addBookmark(q.id);
      dispatch(toggleBookmarkAction(q.id));
    },
    [index, state.questions, state.bookmarked]
  );

  const discardDraft = useCallback(() => {
    if (attemptKey === null) return;
    clearDraft(attemptKey, { legacyMockTestId });
  }, [attemptKey, legacyMockTestId]);

  const syncBookmarks = useCallback(() => {
    dispatch(setBookmarksAction(getBookmarks()));
  }, []);

  return {
    state,
    error,
    current,
    selection,
    verdict: selectVerdict(state, index),
    isRevealed: selectIsRevealed(state, index),
    isSubmitted,
    isFlagged: state.flagged.has(index),
    isBookmarked: selectIsBookmarked(state, index),
    counts,
    palette,
    unansweredIndices,
    summary,
    timeLeftMs: selectTimeLeftMs(state, now),
    canSubmitCurrent,
    isLast: index === state.questions.length - 1,
    selectOption,
    submitCurrent,
    submitOrAdvance,
    submitAll,
    next,
    prev,
    goTo,
    toggleFlag,
    toggleBookmark,
    enterReview,
    exitReview,
    discardDraft,
    syncBookmarks,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Lazily imported default so the hook does not force a loader on every host. */
async function defaultResolve(ids: string[]): Promise<Question[]> {
  const { loadQuestionsByIds } = await import('../../services/localData');
  return loadQuestionsByIds(ids);
}

/**
 * Attaches the failure path to the load promise.
 *
 * `isCancelled` is a getter, not a boolean: the flag flips after this call
 * returns, so a captured value would always read false and a cancelled load
 * would still set an error on a torn-down attempt.
 */
function reportFailure(
  promise: Promise<void>,
  isCancelled: () => boolean,
  setError: (message: string) => void
): void {
  promise.catch(() => {
    if (!isCancelled()) setError('Failed to load questions. Please try again.');
  });
}
