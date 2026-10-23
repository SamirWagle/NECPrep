/**
 * useRemotePractice — one server-scored practice session, start to finish.
 *
 * The practice counterpart of `useRemoteMock`, and the same shape: the session
 * is fetched here, the engine is held disabled until the paper lands, and the
 * engine itself stays free of HTTP so all four quiz surfaces keep running on
 * one reducer.
 *
 * WHERE IT DIFFERS FROM THE MOCK, AND WHY
 * ---------------------------------------
 * A mock syncs a whole answer snapshot on a 20-second debounce and learns
 * nothing until it submits. Practice is the opposite: the student commits one
 * question and expects a verdict for it, so every answer is its own request
 * and the response is the only thing that can say "correct".
 *
 * Three consequences, all of them handled here rather than in the pages:
 *
 *  1. LATENCY IS VISIBLE. `pending` holds the question ids with a request in
 *     flight, so the host can say "checking your answer" instead of leaving a
 *     student staring at an unchanged screen wondering whether the click
 *     landed. Nothing is shown optimistically — an optimistic verdict is a
 *     guess, and guessing is what the server exists to stop.
 *
 *  2. A FAILED ANSWER IS SAID OUT LOUD, AND NOT LOST. The request is issued
 *     directly rather than through `sendOrQueue`, because the outbox discards
 *     responses and a discarded response is a verdict the student never gets.
 *     When the server cannot be reached the answer is queued with the SAME
 *     idempotency key, so it is still recorded when connectivity returns, and
 *     `errors` carries a message for that question so the host can offer a
 *     retry rather than pretending it was marked.
 *
 *  3. THERE IS NO ANSWER-KEY WINDOW TO WIDEN. The key for one question is
 *     disclosed by the server only after that question's answer is committed,
 *     which is the Worker's ordering and not something this hook can affect.
 *     It never asks for a key, and there is no request here that could.
 *
 * WHAT THIS HOOK GUARANTEES
 * -------------------------
 *  * It never holds a key for an unanswered question. `PracticeSessionPaper`
 *    has no field for one; see `services/practiceSession.ts`.
 *  * Both session-level idempotency keys are minted and persisted BEFORE the
 *    request they belong to, so a lost response replays instead of opening a
 *    second session or finishing one twice.
 *  * A session the server has already finished resolves to its stored totals
 *    through an idempotent `finish` replay, so a reload after finishing shows
 *    the result rather than silently starting a new set.
 *
 * With no backend configured, `active` is false and nothing here issues a
 * request — `isBackendConfigured()` is checked once, up front.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, enqueue, isBackendConfigured, newIdempotencyKey } from '../services/api';
import type { PracticeFinishResponse, PracticeMode } from '../services/api';
import {
  clearStoredSession,
  newStoredSession,
  readRemoteSession,
  readStoredSession,
  readVerdict,
  refForSelection,
  writeStoredSession,
} from '../services/practiceSession';
import type { PracticeVerdict, RemoteSession } from '../services/practiceSession';

/** The schema bound on `practiceAnswer.latencyMs`. An hour. */
const MAX_LATENCY_MS = 60 * 60 * 1000;

export interface RemotePracticeConfig {
  /**
   * Stable identity for this run, e.g. `chapter:book-ch1:30`. Used as the
   * localStorage key for the session handoff; changing it abandons the
   * current session and starts a new one. Null holds the hook back entirely,
   * which is what a config screen that has not been submitted wants.
   */
  practiceKey: string | null;
  mode: PracticeMode;
  /**
   * Chapters to draw from, or undefined for "anywhere in the bank". Omitted
   * from the request when undefined rather than sent as null — the schema is
   * strict and has no null in it.
   */
  chapterIds?: readonly string[];
  questionCount: number;
}

export interface PracticeAnswerSubmission {
  questionId: string;
  /** Engine option index, or null to record a deliberate skip. */
  optionIndex: number | null;
  /** Visible time on this question, as the engine measured it. */
  latencyMs?: number;
}

export interface RemotePractice {
  /** True when a backend is configured AND a practice key was named. */
  active: boolean;
  /** Null until the session has been started or resumed. */
  session: RemoteSession | null;
  /** Verdicts the server has returned, keyed by question id. */
  verdicts: ReadonlyMap<string, PracticeVerdict>;
  /** Question ids with an answer request in flight. */
  pending: ReadonlySet<string>;
  /** Per-question failure messages, for the questions that have one. */
  errors: ReadonlyMap<string, string>;
  /** Session-level failure: the start, the resume, or the finish. */
  error: string | null;
  /** The server's totals. Present only after finishing, or on a resumed one. */
  result: PracticeFinishResponse | null;
  /** True between posting the finish and the totals arriving. */
  finishing: boolean;
  /** Commit one answer and ask the server to mark it. */
  answer: (submission: PracticeAnswerSubmission) => void;
  /** Close the session. Safe to call repeatedly; posts once. */
  finish: () => void;
  /**
   * Forget this session. The NEXT mount of a host starts a new one.
   *
   * Deliberately not "restart": starting the replacement here would compose a
   * paper the student may never look at, and the server counts a started
   * session in the study history.
   */
  discard: () => void;
}

export function useRemotePractice(config: RemotePracticeConfig): RemotePractice {
  const { practiceKey, mode, questionCount } = config;
  const active = isBackendConfigured() && practiceKey !== null;

  // Serialised so the start effect can depend on the chapter SET rather than
  // on an array identity a host recreates on every render. An empty selection
  // serialises to null — the same as "not specified" — because `chapterIds: []`
  // is not a thing the schema accepts, and a request shaped that way would
  // come back as a 400 instead of as the server's own "pick at least one
  // chapter" message.
  const chapterKey =
    config.chapterIds === undefined || config.chapterIds.length === 0
      ? null
      : [...config.chapterIds].join(',');

  const [session, setSession] = useState<RemoteSession | null>(null);
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, PracticeVerdict>>(
    () => new Map()
  );
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PracticeFinishResponse | null>(null);
  const [finishing, setFinishing] = useState(false);

  // `answer` and `finish` read the session through a ref so their identity
  // stays stable once mounted: they are called from event handlers and from a
  // phase effect, and a callback that changed when the paper arrived would
  // re-run the effect for a reason unrelated to the student.
  const sessionRef = useRef<RemoteSession | null>(null);
  const finishedRef = useRef(false);
  // One idempotency key per question, minted on the first attempt and reused
  // on every retry of THAT question. A retry with a fresh key would be a
  // second mutation as far as the server's outbox is concerned.
  const answerKeysRef = useRef<Map<string, string>>(new Map());

  const remember = useCallback((next: RemoteSession | null) => {
    sessionRef.current = next;
    setSession(next);
    setVerdicts(next === null ? new Map() : new Map(next.verdicts));
  }, []);

  const answer = useCallback((submission: PracticeAnswerSubmission) => {
    const current = sessionRef.current;
    if (current === null) return;
    const { questionId, optionIndex } = submission;

    // A ref that cannot be named means the selection does not belong to this
    // paper. Posting null would record a skip the student did not ask for.
    const optionRef = refForSelection(questionId, optionIndex, current.optionRefs);
    if (optionIndex !== null && optionRef === null) return;

    let idempotencyKey = answerKeysRef.current.get(questionId);
    if (idempotencyKey === undefined) {
      idempotencyKey = newIdempotencyKey();
      answerKeysRef.current.set(questionId, idempotencyKey);
    }

    const body = {
      sessionId: current.sessionId,
      questionId,
      optionRef,
      idempotencyKey,
      // Clamped to what the schema accepts, so a tab left open overnight
      // reports an hour rather than being refused with a 400 that would cost
      // the student their verdict.
      ...(submission.latencyMs === undefined
        ? {}
        : { latencyMs: clampLatency(submission.latencyMs) }),
    };

    setPending((prev) => new Set(prev).add(questionId));
    setErrors((prev) => withoutKey(prev, questionId));

    void (async () => {
      const posted = await api.answerPractice(body);
      setPending((prev) => withoutMember(prev, questionId));

      if (posted.ok) {
        const verdict = readVerdict(posted.data, current.optionRefs.get(questionId));
        setVerdicts((prev) => new Map(prev).set(questionId, verdict));
        return;
      }

      if (
        posted.error.code === 'NETWORK_UNAVAILABLE' ||
        posted.error.code === 'RATE_LIMITED'
      ) {
        // Queued under the same key, so the answer is still recorded when the
        // connection comes back. The verdict is not recoverable that way —
        // the outbox throws responses away — so the host is told, and a retry
        // once online both records and marks it.
        enqueue({ kind: 'practice.answer', body });
        setErrors((prev) =>
          new Map(prev).set(
            questionId,
            'Saved on this device — it could not be marked while offline.'
          )
        );
        return;
      }

      setErrors((prev) => new Map(prev).set(questionId, posted.error.message));
    })();
  }, []);

  const finish = useCallback(() => {
    const current = sessionRef.current;
    if (current === null || practiceKey === null) return;
    // One POST per session. The persisted key makes a duplicate harmless on
    // the server; this makes it not happen, because the host calls finish
    // from an effect that re-runs while the quiz sits in its `done` phase.
    if (finishedRef.current) return;
    finishedRef.current = true;
    setFinishing(true);

    void (async () => {
      const stored = readStoredSession(practiceKey) ?? newStoredSession();
      const posted = await api.finishPractice({
        sessionId: current.sessionId,
        idempotencyKey: stored.finishKey,
      });

      setFinishing(false);
      if (posted.ok) {
        setResult(posted.data);
        // A finished session must not be resumable: the next visit is a new
        // set, not this one again.
        clearStoredSession(practiceKey);
        return;
      }

      // Releasing the guard is what lets the host's retry button work. The
      // idempotency key is NOT regenerated, so a retry of a finish that
      // actually landed replays the stored totals.
      finishedRef.current = false;
      setError(posted.error.message);
    })();
  }, [practiceKey]);

  const discard = useCallback(() => {
    if (practiceKey !== null) clearStoredSession(practiceKey);
    finishedRef.current = false;
    answerKeysRef.current = new Map();
    sessionRef.current = null;
    setSession(null);
    setVerdicts(new Map());
    setPending(new Set());
    setErrors(new Map());
    setResult(null);
    setError(null);
    setFinishing(false);
  }, [practiceKey]);

  useEffect(() => {
    if (!active || practiceKey === null) return;
    let cancelled = false;

    void (async () => {
      setError(null);

      let stored = readStoredSession(practiceKey);
      if (stored === null) {
        stored = newStoredSession();
        writeStoredSession(practiceKey, stored);
      }

      if (stored.sessionId !== null) {
        const existing = await api.getPracticeSession(stored.sessionId);
        if (cancelled) return;

        if (existing.ok) {
          if (existing.data.status === 'in_progress') {
            remember(readRemoteSession(existing.data));
            return;
          }

          // Already closed server-side — a finish whose response was lost, or
          // a second device. Replaying the finish is how the stored totals are
          // read back: it is idempotent twice over (the key, and the
          // `in_progress` predicate on the UPDATE), so this reports the same
          // numbers rather than inventing any.
          const replayed = await api.finishPractice({
            sessionId: stored.sessionId,
            idempotencyKey: stored.finishKey,
          });
          if (cancelled) return;
          if (replayed.ok) {
            finishedRef.current = true;
            setResult(replayed.data);
            clearStoredSession(practiceKey);
            return;
          }
          // Nothing recoverable to show, so fall through and start a fresh set.
        } else if (existing.error.code === 'NETWORK_UNAVAILABLE') {
          // Do NOT start a second session because the network blipped: the
          // first one is still open server-side and its answers are the
          // student's work.
          setError('Could not reach the server to resume your practice session.');
          return;
        }

        clearStoredSession(practiceKey);
        stored = newStoredSession();
        writeStoredSession(practiceKey, stored);
      }

      const started = await api.startPractice({
        mode,
        ...(chapterKey === null ? {} : { chapterIds: chapterKey.split(',') }),
        questionCount,
        idempotencyKey: stored.startKey,
      });
      if (cancelled) return;
      if (!started.ok) {
        setError(started.error.message);
        return;
      }

      writeStoredSession(practiceKey, { ...stored, sessionId: started.data.sessionId });
      remember(readRemoteSession(started.data));
    })();

    return () => {
      cancelled = true;
    };
  }, [active, practiceKey, mode, chapterKey, questionCount, remember]);

  return {
    active,
    session,
    verdicts,
    pending,
    errors,
    error,
    result,
    finishing,
    answer,
    finish,
    discard,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function clampLatency(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.min(MAX_LATENCY_MS, Math.max(0, Math.round(ms)));
}

function withoutMember(set: ReadonlySet<string>, member: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(member);
  return next;
}

function withoutKey<V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}
