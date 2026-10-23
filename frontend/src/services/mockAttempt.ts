/**
 * Translation layer between a server-scored mock attempt and the quiz engine.
 *
 * WHAT CROSSES THIS BOUNDARY, AND WHAT CANNOT
 * -------------------------------------------
 * Inbound, a `MockAttemptPaper` carries `AttemptQuestion`s whose options are
 * `PublicOption { ref, body }`. There is no correct-answer field on that type,
 * so there is nothing here to strip, forget to strip, or accidentally log: the
 * absence is structural, enforced by `worker/src/shared/types.ts`. What this
 * module does is give each question the `KEY_HELD_BY_SERVER` sentinel, which
 * is how the engine is told "there is a key and it is not yours".
 *
 * Outbound, a selection is an option INDEX in engine state and must leave as
 * an opaque `ref`. The index→ref map is the only thing held alongside the
 * questions, and it is per attempt: a ref is a keyed digest over the server
 * secret, the viewer, the question and the attempt's `option_seed`, so one
 * harvested from a finished attempt is meaningless in the next.
 *
 * Nothing in this file scores anything, and there is deliberately no function
 * that takes a `MockReviewQuestion` and recomputes a verdict — `isCorrect`
 * arrives already decided by the Worker.
 *
 * Everything here is pure except the three localStorage helpers at the bottom,
 * which exist so a reload resumes the same attempt with the same idempotency
 * keys rather than starting a second paper.
 */

import { KEY_HELD_BY_SERVER } from '../features/quiz/answerKey';
import type { QuizSummary } from '../features/quiz/types';
import type { Question } from './localData';
import { newIdempotencyKey } from './api';
import type { MockAttemptPaper, MockSubmitResponse } from './api';

/** questionId → that question's option refs, in the order they are rendered. */
export type OptionRefIndex = ReadonlyMap<string, readonly string[]>;

export interface RemotePaper {
  readonly attemptId: string;
  /** Engine questions. Every `correctIndex` is `KEY_HELD_BY_SERVER`. */
  readonly questions: Question[];
  readonly optionRefs: OptionRefIndex;
  /**
   * Answers the server has already accepted, as option indexes keyed by
   * question id — the shape `useQuiz`'s `restoredSelections` wants.
   */
  readonly restoredSelections: Readonly<Record<string, number>>;
  /**
   * Milliseconds left at the instant the paper was received, measured on the
   * SERVER's clock (`expiresAt - serverNow`) and therefore immune to a device
   * whose clock is wrong. It is a duration and not a deadline on purpose: the
   * engine turns it into a local absolute deadline, and a duration is the only
   * form that survives the translation between two clocks.
   *
   * It is also only ever advisory. The deadline that decides what gets scored
   * is `deadline_at` in the Worker's database, and a submission arriving after
   * it is scored from the last snapshot the server itself accepted in time.
   */
  readonly remainingMs: number;
  readonly status: MockAttemptPaper['status'];
}

/**
 * Reads a server paper into the engine's shape.
 *
 * Questions are ordered by the paper's own `position` rather than by array
 * order, so the numbered palette matches the positions the server will report
 * in the review.
 */
export function readRemotePaper(paper: MockAttemptPaper): RemotePaper {
  const ordered = [...paper.questions].sort((a, b) => a.position - b.position);

  const questions: Question[] = ordered.map((q) => ({
    id: q.questionId,
    // The engine's `topicId` is the chapter, which is what `describeReference`
    // and the per-chapter stores key on. The server's chapter ids are the same
    // `book-chN` values the local bank uses.
    topicId: q.chapterId,
    question: q.stem,
    options: q.options.map((option) => option.body),
    // NOT a faked index. See features/quiz/answerKey.ts.
    correctIndex: KEY_HELD_BY_SERVER,
  }));

  const optionRefs = new Map<string, readonly string[]>(
    ordered.map((q) => [q.questionId, q.options.map((option) => option.ref)])
  );

  const restoredSelections: Record<string, number> = {};
  for (const q of ordered) {
    const ref = paper.savedAnswers[q.questionId];
    if (ref === undefined) continue;
    const index = q.options.findIndex((option) => option.ref === ref);
    // A ref that no longer resolves is dropped silently: it means the attempt's
    // option seed changed, which cannot happen, or that the snapshot is not for
    // this paper, in which case guessing an index would be worse than a blank.
    if (index >= 0) restoredSelections[q.questionId] = index;
  }

  return {
    attemptId: paper.attemptId,
    questions,
    optionRefs,
    restoredSelections,
    remainingMs: Math.max(0, paper.expiresAt - paper.serverNow),
    status: paper.status,
  };
}

/**
 * Turns engine selections into the `questionId → optionRef` map that
 * `/api/mock/sync` and `/api/mock/submit` both take.
 *
 * Unanswered questions are OMITTED rather than sent as null: the sync map
 * replaces the stored snapshot wholesale, so an explicit null and an absent
 * key would mean the same thing, and `MockSyncRequest.answers` is typed
 * `Record<string, string>` with no null in it.
 */
export function answersFromSelections(
  questions: readonly Question[],
  selections: readonly (number | null)[],
  optionRefs: OptionRefIndex
): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((question, index) => {
    const chosen = selections[index] ?? null;
    if (chosen === null) return;
    const ref = optionRefs.get(question.id)?.[chosen];
    if (ref === undefined) return;
    answers[question.id] = ref;
  });
  return answers;
}

/**
 * Presents a server result as a `QuizSummary`, so the existing score screen
 * renders a remote attempt with no changes.
 *
 * `gradableTotal` is `total`, which is the point: on a remote paper every
 * question has a key, so the "excluded from the score" note that a local
 * attempt sometimes shows must not appear. `responses` is empty because the
 * per-question analytics rows the engine builds carry `correct: false` for a
 * server-keyed question and would be a lie if surfaced; the authoritative
 * per-question outcome is `MockSubmitResponse.review`.
 *
 * `elapsedMs` is wall-clock (`scoredAt - startedAt`) rather than the engine's
 * visible time on task, because that is the figure the server can vouch for.
 */
export function summaryFromServer(result: MockSubmitResponse): QuizSummary {
  return {
    mode: 'mock',
    score: result.correct,
    total: result.total,
    gradableTotal: result.total,
    answered: Math.max(0, result.total - result.skipped),
    skipped: result.skipped,
    incorrect: result.incorrect,
    accuracyPct: result.accuracyPct,
    elapsedMs: Math.max(0, result.scoredAt - result.startedAt),
    responses: [],
  };
}

// --- Attempt handoff across reloads -----------------------------------------

const STORED_ATTEMPT_PREFIX = 'necprep_mock_attempt_v1:';

/**
 * The identifiers a reload needs to pick an attempt back up.
 *
 * BOTH KEYS ARE MINTED BEFORE THE REQUEST THEY BELONG TO and never
 * regenerated. That is the whole idempotency contract: a `start` whose
 * response was lost replays to the same attempt instead of opening a second
 * paper, and a `submit` retried after a crash replays the stored result
 * instead of hitting `ATTEMPT_NOT_IN_PROGRESS`.
 */
export interface StoredMockAttempt {
  /** Null between minting the start key and the server answering. */
  attemptId: string | null;
  startKey: string;
  submitKey: string;
}

function isStored(value: unknown): value is StoredMockAttempt {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<StoredMockAttempt>;
  return (
    (row.attemptId === null || typeof row.attemptId === 'string') &&
    typeof row.startKey === 'string' &&
    typeof row.submitKey === 'string'
  );
}

export function readStoredAttempt(templateId: string): StoredMockAttempt | null {
  try {
    const raw = localStorage.getItem(STORED_ATTEMPT_PREFIX + templateId);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStored(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredAttempt(templateId: string, attempt: StoredMockAttempt): void {
  try {
    localStorage.setItem(STORED_ATTEMPT_PREFIX + templateId, JSON.stringify(attempt));
  } catch {
    // Private browsing, or storage full. The attempt still runs; it just will
    // not be resumable, and a reload will start a fresh paper. Never let
    // persistence take down an exam.
  }
}

export function clearStoredAttempt(templateId: string): void {
  try {
    localStorage.removeItem(STORED_ATTEMPT_PREFIX + templateId);
  } catch {
    // ignore
  }
}

/** A brand-new handoff record, with both keys already minted. */
export function newStoredAttempt(): StoredMockAttempt {
  return { attemptId: null, startKey: newIdempotencyKey(), submitKey: newIdempotencyKey() };
}
