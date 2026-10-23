/**
 * usePracticeSurface — the quiz engine and one server practice session, wired
 * together, for the three practice pages to host.
 *
 * WHY THIS EXISTS AND MockTestQuiz HAS NO EQUIVALENT
 * --------------------------------------------------
 * There is one mock page and three practice pages. The remote wiring is about
 * eighty lines of branching — which paper to load, which attempt key to use,
 * what the current card may reveal, when to post the answer, what the score
 * screen reads — and copying it three times is how the four hand-rolled quiz
 * state machines this engine replaced got out of step in the first place.
 * TopicPractice, QuickPractice and CustomPractice differ in how they CHOOSE a
 * paper and in how they lay a page out. Neither of those is in here.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not score anything, on either path. On the local path the engine's
 * selectors score, exactly as before. On the remote path every question in
 * engine state carries `KEY_HELD_BY_SERVER`, so those same selectors return
 * zero, and every verdict and every total rendered comes from the Worker.
 *
 * THE REMOTE PATH IS NOT A FALLBACK TARGET
 * ----------------------------------------
 * With `isBackendConfigured()` false — a supported deployment, and the one
 * live today — `remote.active` is false, no request is issued, questions come
 * from the static chapter JSON through `localData`, and the engine scores in
 * the browser. With a backend configured and the session failing to start, the
 * host reports that rather than quietly dropping to local scoring: a practice
 * set scored from a file the student can open in devtools is a different
 * product, and silently substituting it would make the progress figures mean
 * two different things depending on the weather.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { timeSpentAt, useQuiz } from '../features/quiz';
import type { Question, QuizMode, QuizSummary, UseQuizResult, Verdict } from '../features/quiz';
import { useRemotePractice } from './useRemotePractice';
import type { RemotePractice } from './useRemotePractice';
import { summaryFromPracticeResult, verdictToneFor } from '../services/practiceSession';
import type { PracticeMode } from '../services/api';

export interface PracticeSurfaceOptions {
  /** The engine's own mode, which travels into every analytics record. */
  mode: QuizMode;
  /** The server's practice mode. `chapter` needs at least one chapter id. */
  remoteMode: PracticeMode;
  /**
   * Stable identity for this run, e.g. `topic:book-ch1:30`. It is the engine's
   * attempt key on the local path and the session handoff key on the remote
   * one. Null holds everything back — what a config screen that has not been
   * submitted wants.
   */
  practiceKey: string | null;
  /** Chapters to draw from. Omit for "anywhere in the bank". */
  chapterIds?: readonly string[];
  questionCount: number;
  /** Builds the paper from static JSON. Never called on the remote path. */
  loadLocalQuestions: () => Promise<Question[]>;
  /** Extra gate for the local path, e.g. "the chapter manifest is non-empty". */
  localEnabled?: boolean;
  /**
   * Fired once per run, with the score as whoever computed it reports it: the
   * engine locally, the Worker remotely. Hosts write it to local history and
   * do not need to know which.
   */
  onComplete?: (summary: QuizSummary) => void;
}

/** The four props a `QuestionCard` needs that differ between the two paths. */
export interface PracticeCardProps {
  /**
   * The right answer's position, or a sentinel. On the remote path this is
   * `KEY_HELD_BY_SERVER` until the server has marked this question and the
   * real position afterwards — which is the only moment it is known, and only
   * for a question already on the record.
   */
  correctIndex: number;
  revealed: boolean;
  verdict: Verdict;
  locked: boolean;
}

export interface PracticeSurface {
  quiz: UseQuizResult;
  remote: RemotePractice;
  /** True when this run is server-scored. */
  isRemote: boolean;
  /** Card props for the current question, already branched. */
  card: PracticeCardProps;
  /** True while the current question's answer is being marked by the server. */
  awaiting: boolean;
  /** Message for the current question when its answer could not be marked. */
  answerError: string | null;
  /** Ask the server again about the current question. Same idempotency key. */
  retryAnswer: () => void;
  /** The server's explanation for the current question, when there is one. */
  explanation: string | null;
  /** Commit the current question. Posts to the server on the remote path. */
  commitCurrent: () => void;
  /** Enter-key behaviour: commit if possible, otherwise advance. */
  submitOrAdvance: () => void;
  /** What the result screen should show. The server's totals when remote. */
  summary: QuizSummary;
  /** True once there is a result to render. */
  complete: boolean;
  /** True while the remote finish is in flight. */
  finishing: boolean;
  /** Set when starting, resuming or finishing the remote session failed. */
  error: string | null;
  /** Retry the remote finish. Safe on the local path, where it does nothing. */
  retryFinish: () => void;
  /** Throw away this run's local draft and its server handoff. */
  discard: () => void;
}

export function usePracticeSurface(options: PracticeSurfaceOptions): PracticeSurface {
  const {
    mode,
    remoteMode,
    practiceKey,
    chapterIds,
    questionCount,
    loadLocalQuestions,
    localEnabled = true,
  } = options;

  const remote = useRemotePractice({
    practiceKey,
    mode: remoteMode,
    chapterIds,
    questionCount,
  });

  const isRemote = remote.active;
  const session = remote.session;
  const remoteQuestions = session?.questions;

  // The paper is already in hand by the time the engine is enabled; this just
  // hands it over. The composition was decided server-side, so there is
  // nothing to shuffle or slice here.
  const loadRemoteQuestions = useCallback(
    async (): Promise<Question[]> => remoteQuestions ?? [],
    [remoteQuestions]
  );

  // Resume resolves ids against the SERVER's paper, never the local bank: the
  // ids are server question ids and the option order is this session's
  // permutation, so a local lookup would rebuild a different paper.
  const resolveRemoteQuestions = useCallback(
    async (ids: string[]): Promise<Question[]> => {
      const byId = new Map((remoteQuestions ?? []).map((q) => [q.id, q]));
      return ids.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined);
    },
    [remoteQuestions]
  );

  const quiz = useQuiz({
    mode,
    // Keyed on the SESSION for a remote paper, so a new session cannot resume
    // the previous one's draft, and on the run identity locally, where the
    // paper is redrawn per attempt anyway.
    attemptKey: isRemote ? (session ? `practice:${session.sessionId}` : null) : practiceKey,
    loadQuestions: isRemote ? loadRemoteQuestions : loadLocalQuestions,
    resolveQuestions: isRemote ? resolveRemoteQuestions : undefined,
    // Answers the server already accepted. Fills the gaps a local draft cannot
    // — a different browser, or one whose storage was cleared.
    restoredSelections: session?.restoredSelections,
    enabled: isRemote ? session !== null : localEnabled && practiceKey !== null,
    // Per-question correctness for a remote session is the server's to record;
    // it maintains `chapter_stats` and the revision schedule itself. The
    // client's records all read `correct: false` because it has no key, so
    // writing them into local progress would corrupt it.
    persistAttempts: !isRemote,
    // The local path keeps firing straight off the engine. The remote path
    // fires from the effect below instead, once the server's totals exist —
    // a summary handed over at `done` would report zero.
    onComplete: isRemote ? undefined : options.onComplete,
  });

  // Destructured rather than read through `quiz.` inside the callbacks below:
  // the dependency arrays then name plain values, which is what the React
  // Compiler can verify. Reading `quiz.current` inside a `useCallback` whose
  // dependency is `quiz` makes it bail out of optimising this hook entirely.
  const {
    current,
    selection,
    state,
    isSubmitted,
    isRevealed,
    verdict: engineVerdict,
    canSubmitCurrent,
    isLast,
    next,
    submitCurrent,
    discardDraft,
    summary: engineSummary,
  } = quiz;
  const index = state.currentIndex;
  const questionId = current?.id ?? null;

  const serverVerdict = questionId === null ? undefined : remote.verdicts.get(questionId);
  const awaiting = questionId !== null && remote.pending.has(questionId);
  const answerError = (questionId === null ? undefined : remote.errors.get(questionId)) ?? null;

  const card: PracticeCardProps = isRemote
    ? {
        // Before the server answers there is nothing here to render even if
        // `revealed` were forced true: the sentinel is negative, and
        // `OptionList` treats any negative key as "no key".
        correctIndex: serverVerdict?.correctIndex ?? (current?.correctIndex ?? -1),
        // Not `quiz.isRevealed`. The engine reveals a committed question the
        // instant it is committed, which on this path is before the verdict
        // exists; revealing then would show "it was marked on the server"
        // under a question whose marking has not come back yet.
        revealed: serverVerdict !== undefined,
        verdict: serverVerdict === undefined ? 'pending' : verdictToneFor(serverVerdict),
        locked: isSubmitted,
      }
    : {
        correctIndex: current?.correctIndex ?? -1,
        revealed: isRevealed,
        verdict: engineVerdict,
        locked: isSubmitted,
      };

  const { answer: remoteAnswer } = remote;

  /** Posts the current selection for marking. Remote path only. */
  const postCurrent = useCallback(() => {
    if (!isRemote || current === undefined || selection === null) return;
    remoteAnswer({
      questionId: current.id,
      optionIndex: selection,
      // Visible time on this question as the engine measured it, which is
      // what the spaced-repetition grade wants. Recorded, never trusted:
      // correctness is still computed server-side from the key.
      latencyMs: timeSpentAt(state, index, Date.now()),
    });
  }, [isRemote, current, selection, remoteAnswer, state, index]);

  const commitCurrent = useCallback(() => {
    if (current === undefined || selection === null || isSubmitted) return;
    postCurrent();
    // Committed locally either way, and immediately: it is what locks the
    // option, fills the palette cell and banks the timing slice. On the
    // remote path it reveals nothing, because engine state holds no key.
    submitCurrent();
  }, [current, selection, isSubmitted, postCurrent, submitCurrent]);

  const submitOrAdvance = useCallback(() => {
    if (canSubmitCurrent) {
      commitCurrent();
      return;
    }
    if (!isLast) next();
  }, [canSubmitCurrent, commitCurrent, isLast, next]);

  // ── Hand the finished set to the server ───────────────────────────────────
  // `done` is reached by the host's Finish action. `finish` posts once.
  const { finish: remoteFinish } = remote;
  const phase = state.phase;
  useEffect(() => {
    if (!isRemote || phase !== 'done') return;
    remoteFinish();
  }, [isRemote, remoteFinish, phase]);

  // ── onComplete for the remote path, exactly once ──────────────────────────
  const elapsedMs = engineSummary.elapsedMs;
  const remoteResult = remote.result;
  const reportedRef = useRef<string | null>(null);
  const onCompleteRef = useRef(options.onComplete);
  useEffect(() => {
    onCompleteRef.current = options.onComplete;
  });
  useEffect(() => {
    if (!isRemote || remoteResult === null) return;
    if (reportedRef.current === remoteResult.sessionId) return;
    reportedRef.current = remoteResult.sessionId;
    onCompleteRef.current?.(summaryFromPracticeResult(remoteResult, mode, elapsedMs));
  }, [isRemote, remoteResult, mode, elapsedMs]);

  const summary = useMemo(
    () =>
      isRemote && remoteResult !== null
        ? summaryFromPracticeResult(remoteResult, mode, elapsedMs)
        : engineSummary,
    [isRemote, remoteResult, mode, elapsedMs, engineSummary]
  );

  const { discard: remoteDiscard } = remote;
  const discard = useCallback(() => {
    discardDraft();
    remoteDiscard();
  }, [discardDraft, remoteDiscard]);

  return {
    quiz,
    remote,
    isRemote,
    card,
    awaiting,
    answerError,
    // A retry is the same request again, under the same per-question
    // idempotency key, so one that actually landed converges rather than
    // double-counting the answer.
    retryAnswer: postCurrent,
    explanation: serverVerdict?.explanation ?? null,
    commitCurrent,
    submitOrAdvance,
    summary,
    // Locally, `done` is the whole story. Remotely, `done` only means the
    // paper is in; there is deliberately nothing to show until the server's
    // totals land, because the client cannot compute them.
    complete: isRemote ? remoteResult !== null : phase === 'done',
    finishing: remote.finishing,
    error: remote.error,
    retryFinish: remoteFinish,
    discard,
  };
}
