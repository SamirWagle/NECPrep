/**
 * useRemoteMock — one server-scored mock attempt, start to score.
 *
 * WHY A SEPARATE HOOK AND NOT A BRANCH INSIDE `useQuiz`
 * -----------------------------------------------------
 * `useQuiz` owns a state machine over a paper it is handed. A remote attempt
 * has to exist BEFORE that paper does: the Worker composes the questions from
 * a server-side blueprint, stamps the deadline, and returns both plus any
 * answers it already holds. `useQuiz` cannot ask for a duration it does not
 * know yet — `durationMs` is an input to its load effect — so the attempt is
 * fetched here and the engine is simply kept disabled until it lands. That
 * keeps the engine free of HTTP and keeps all four quiz surfaces on one
 * reducer.
 *
 * WHAT THIS HOOK GUARANTEES
 * -------------------------
 *  * It never holds an answer key. `MockAttemptPaper` has no field for one;
 *    see `services/mockAttempt.ts`.
 *  * Both idempotency keys are minted and persisted BEFORE the request they
 *    belong to, so a lost response replays instead of opening a second paper
 *    or double-submitting one.
 *  * A deadline that passed while the tab was shut is SUBMITTED, not
 *    discarded. The server clamps it and scores the last snapshot it accepted
 *    in time, which is the candidate's real work.
 *  * An attempt that is already submitted resolves to its stored review, so a
 *    reload after submission shows the result rather than starting a new
 *    paper.
 *
 * With no backend configured, `active` is false and nothing here issues a
 * request — `isBackendConfigured()` is checked once, up front.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isBackendConfigured } from '../services/api';
import type { MockSubmitResponse } from '../services/api';
import {
  answersFromSelections,
  clearStoredAttempt,
  newStoredAttempt,
  readRemotePaper,
  readStoredAttempt,
  writeStoredAttempt,
} from '../services/mockAttempt';
import type { RemotePaper } from '../services/mockAttempt';

export interface RemoteMock {
  /** True when a backend is configured AND a template was named. */
  active: boolean;
  /** Null until the attempt has been started or resumed. */
  paper: RemotePaper | null;
  /** The server's score. Present only after submission, or on a resumed one. */
  result: MockSubmitResponse | null;
  /** True between posting the submission and the score arriving. */
  submitting: boolean;
  error: string | null;
  /**
   * Replaces the server's stored answer snapshot. Idempotent by construction
   * (the map is the whole snapshot), so no idempotency key and no outbox.
   */
  sync: (selections: readonly (number | null)[]) => void;
  /** Posts the paper for scoring. Safe to call repeatedly; posts once. */
  submit: (selections: readonly (number | null)[]) => void;
  /**
   * Forget this attempt. The NEXT mount of a host starts a new one.
   *
   * Deliberately not "restart": starting the replacement here would stamp a
   * server-side deadline the moment the student pressed "Try Again", so a
   * paper begun twenty minutes later would open with twenty minutes already
   * gone. Call this as you navigate away from a finished attempt.
   */
  discard: () => void;
}

export function useRemoteMock(templateId: string | null): RemoteMock {
  const active = isBackendConfigured() && templateId !== null;

  const [paper, setPaper] = useState<RemotePaper | null>(null);
  const [result, setResult] = useState<MockSubmitResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `sync` and `submit` read the attempt through a ref so their identity stays
  // stable once mounted. The host debounces `sync` in an effect keyed on the
  // selections array; a callback that changed identity when the paper arrived
  // would reset that timer for a reason unrelated to the student answering.
  const paperRef = useRef<RemotePaper | null>(null);
  const postedRef = useRef(false);

  const remember = useCallback((next: RemotePaper | null) => {
    paperRef.current = next;
    setPaper(next);
  }, []);

  const submit = useCallback(
    (selections: readonly (number | null)[]) => {
      const current = paperRef.current;
      if (current === null || templateId === null) return;
      // One POST per attempt. The persisted key makes a duplicate harmless on
      // the server; this makes it not happen in the first place, because the
      // host calls submit from an effect that re-runs on every render while
      // the quiz sits in its `done` phase.
      if (postedRef.current) return;
      postedRef.current = true;
      setSubmitting(true);

      void (async () => {
        const stored = readStoredAttempt(templateId) ?? newStoredAttempt();
        const posted = await api.submitMock({
          attemptId: current.attemptId,
          idempotencyKey: stored.submitKey,
          answers: answersFromSelections(current.questions, selections, current.optionRefs),
        });

        if (posted.ok) {
          setResult(posted.data);
          setSubmitting(false);
          return;
        }

        // Already scored — a submission that landed but whose response was
        // lost, or a second device. Read the stored review rather than
        // reporting a failure for a paper that is safely marked.
        if (
          posted.error.code === 'ATTEMPT_NOT_IN_PROGRESS' ||
          posted.error.code === 'IDEMPOTENCY_KEY_REUSED'
        ) {
          const review = await api.getMockReview(current.attemptId);
          if (review.ok) {
            setResult(review.data);
            setSubmitting(false);
            return;
          }
        }

        // Releasing the guard is what lets the host's retry button work. The
        // idempotency key is NOT regenerated, so a retry of a submission that
        // actually landed replays the stored result.
        postedRef.current = false;
        setSubmitting(false);
        setError(posted.error.message);
      })();
    },
    [templateId]
  );

  const sync = useCallback((selections: readonly (number | null)[]) => {
    const current = paperRef.current;
    if (current === null || postedRef.current) return;
    const answers = answersFromSelections(current.questions, selections, current.optionRefs);
    // Fire and forget. A refused or dropped sync is not an error the student
    // can act on: the next one replaces the snapshot wholesale, and the
    // submission carries the full answer map anyway.
    void api.syncMock({ attemptId: current.attemptId, answers });
  }, []);

  const discard = useCallback(() => {
    if (templateId !== null) clearStoredAttempt(templateId);
    postedRef.current = false;
    paperRef.current = null;
    setPaper(null);
    setResult(null);
    setError(null);
    setSubmitting(false);
    // No new attempt is started here on purpose — see `discard` above. The
    // start effect's dependencies are all stable, so it does not re-run, and
    // the fresh paper is composed when the host is next mounted.
  }, [templateId]);

  useEffect(() => {
    if (!active || templateId === null) return;
    let cancelled = false;

    void (async () => {
      setError(null);

      let stored = readStoredAttempt(templateId);
      if (stored === null) {
        stored = newStoredAttempt();
        writeStoredAttempt(templateId, stored);
      }

      if (stored.attemptId !== null) {
        const existing = await api.getMockAttempt(stored.attemptId);
        if (cancelled) return;

        if (existing.ok) {
          const resumed = readRemotePaper(existing.data);

          if (existing.data.status === 'in_progress' && resumed.remainingMs > 0) {
            remember(resumed);
            return;
          }

          if (existing.data.status === 'in_progress') {
            // The deadline passed while the tab was closed. Submitting is the
            // honest move: the server discards this (late, empty) payload and
            // scores the last snapshot it accepted before the deadline, which
            // is what the candidate actually answered in time.
            remember(resumed);
            submit([]);
            return;
          }

          const review = await api.getMockReview(stored.attemptId);
          if (cancelled) return;
          if (review.ok) {
            postedRef.current = true;
            setResult(review.data);
            return;
          }
          // Abandoned or expired with nothing recorded: there is no review to
          // show, so fall through and start a fresh paper.
        } else if (existing.error.code === 'NETWORK_UNAVAILABLE') {
          // Do NOT start a second attempt because the network blipped — that
          // would strand the one already running, with its clock ticking.
          setError('Could not reach the server to resume your attempt.');
          return;
        }

        clearStoredAttempt(templateId);
        stored = newStoredAttempt();
        writeStoredAttempt(templateId, stored);
      }

      const started = await api.startMock({ templateId, idempotencyKey: stored.startKey });
      if (cancelled) return;
      if (!started.ok) {
        setError(started.error.message);
        return;
      }

      writeStoredAttempt(templateId, { ...stored, attemptId: started.data.attemptId });
      remember(readRemotePaper(started.data));
    })();

    return () => {
      cancelled = true;
    };
  }, [active, templateId, remember, submit]);

  return { active, paper, result, submitting, error, sync, submit, discard };
}
