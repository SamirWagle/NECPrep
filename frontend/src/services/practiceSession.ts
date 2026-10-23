/**
 * Translation layer between a server-scored practice session and the quiz
 * engine. The practice counterpart of `mockAttempt.ts`, and deliberately
 * shaped like it.
 *
 * WHAT CROSSES THIS BOUNDARY, AND WHEN
 * ------------------------------------
 * Inbound, a `PracticeSessionPaper` carries `AttemptQuestion`s whose options
 * are `PublicOption { ref, body }`. That type has no correct-answer field, so
 * the paper cannot carry a key — the absence is structural, enforced by
 * `worker/src/shared/types.ts`. Every question therefore enters engine state
 * with the `KEY_HELD_BY_SERVER` sentinel, exactly as a remote mock does.
 *
 * Outbound, a selection is an option INDEX in engine state and must leave as
 * an opaque `ref`. The index→ref map is held per session: a ref is a keyed
 * digest over the server secret, the viewer, the question and the session's
 * `option_seed`, so one harvested from a finished session is meaningless in
 * the next.
 *
 * THE ONE THING PRACTICE HAS THAT A MOCK DOES NOT
 * -----------------------------------------------
 * Immediate feedback. `POST /api/practice/answer` answers with a
 * `PracticeAnswerResult` — `isCorrect`, `correctRef`, `explanation` — and it
 * does so strictly AFTER committing the answer, for that one question. So this
 * module does hold real option indexes, but only ones the server disclosed
 * about an answer that is already on the record.
 *
 * That is not the thing `features/quiz/answerKey.ts` forbids, and the
 * difference is worth being precise about:
 *
 *   * A disclosed index lives in a `PracticeVerdict`, which is a SEPARATE
 *     value the host renders from. It is never written back into
 *     `Question.correctIndex`, so engine state stays server-keyed for the
 *     whole session, `selectScore` keeps returning zero, and no amount of
 *     forgetting a branch can make the engine grade a remote paper.
 *   * A verdict exists only for a question the server has already marked.
 *     There is no code path that produces one for an unanswered question,
 *     because the only constructor takes a server response.
 *
 * Nothing here decides whether an answer was right. `isCorrect` arrives
 * already decided, and it is the field the UI renders — not a comparison of
 * `selectedIndex` against `correctIndex`, which would be this client scoring
 * the paper by the back door.
 *
 * Everything is pure except the four localStorage helpers at the bottom, which
 * exist so a reload resumes the same session rather than starting a second one.
 */

import { KEY_HELD_BY_SERVER } from '../features/quiz/answerKey';
import type { QuizMode, QuizSummary, Verdict } from '../features/quiz/types';
import type { Question } from './localData';
import { newIdempotencyKey } from './api';
import type {
  PracticeAnswerResult,
  PracticeFinishResponse,
  PracticeSessionPaper,
} from './api';

/** questionId → that question's option refs, in the order they are rendered. */
export type OptionRefIndex = ReadonlyMap<string, readonly string[]>;

/**
 * One question the server has marked, in the engine's coordinate system.
 *
 * `correctIndex` is a real option position — see the header for why that is
 * safe here and nowhere else. `selectedIndex` is null for a recorded skip,
 * which the server accepts and which still reveals the key.
 */
export interface PracticeVerdict {
  readonly questionId: string;
  readonly selectedIndex: number | null;
  readonly correctIndex: number;
  /** The SERVER's decision. Never recomputed from the two indexes above. */
  readonly isCorrect: boolean;
  readonly explanation: string | null;
}

export interface RemoteSession {
  readonly sessionId: string;
  /** Engine questions. Every `correctIndex` is `KEY_HELD_BY_SERVER`. */
  readonly questions: Question[];
  readonly optionRefs: OptionRefIndex;
  /** Verdicts the server had already recorded when the paper was read. */
  readonly verdicts: ReadonlyMap<string, PracticeVerdict>;
  /**
   * Answers the server has already accepted, as option indexes keyed by
   * question id — the shape `useQuiz`'s `restoredSelections` wants.
   */
  readonly restoredSelections: Readonly<Record<string, number>>;
  readonly status: PracticeSessionPaper['status'];
}

/**
 * Resolves a server `PracticeAnswerResult` into engine coordinates.
 *
 * A ref that does not resolve becomes -1 rather than throwing: the only way
 * that happens is a response for a different session, and a missing highlight
 * is a better failure than a highlight on the wrong option.
 */
export function readVerdict(
  result: PracticeAnswerResult,
  refs: readonly string[] | undefined
): PracticeVerdict {
  const order = refs ?? [];
  const selectedIndex =
    result.selectedRef === null ? null : indexOrNull(order, result.selectedRef);
  return {
    questionId: result.questionId,
    selectedIndex,
    correctIndex: order.indexOf(result.correctRef),
    isCorrect: result.isCorrect,
    explanation: result.explanation,
  };
}

function indexOrNull(order: readonly string[], ref: string): number | null {
  const index = order.indexOf(ref);
  return index >= 0 ? index : null;
}

/**
 * Reads a server practice paper into the engine's shape.
 *
 * Questions are ordered by the paper's own `position` rather than by array
 * order, so the numbered palette matches the positions the server assigned.
 */
export function readRemoteSession(paper: PracticeSessionPaper): RemoteSession {
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

  const verdicts = new Map<string, PracticeVerdict>();
  const restoredSelections: Record<string, number> = {};
  for (const q of ordered) {
    const recorded = paper.answered[q.questionId];
    if (recorded === undefined) continue;
    const verdict = readVerdict(recorded, optionRefs.get(q.questionId));
    verdicts.set(q.questionId, verdict);
    // A selection that no longer resolves is dropped silently: it means the
    // snapshot is not for this paper, and guessing an index would be worse
    // than a blank.
    if (verdict.selectedIndex !== null) {
      restoredSelections[q.questionId] = verdict.selectedIndex;
    }
  }

  return {
    sessionId: paper.sessionId,
    questions,
    optionRefs,
    verdicts,
    restoredSelections,
    status: paper.status,
  };
}

/** The option ref for one engine selection, or null when it cannot be named. */
export function refForSelection(
  questionId: string,
  optionIndex: number | null,
  optionRefs: OptionRefIndex
): string | null {
  if (optionIndex === null) return null;
  return optionRefs.get(questionId)?.[optionIndex] ?? null;
}

/**
 * The `Verdict` a marked practice question should display.
 *
 * Reads `isCorrect` and nothing else, which is the whole point: the client
 * holds a disclosed index for highlighting the right option, and if this
 * function compared the two indexes instead it would be grading the paper
 * locally again — with a key it was handed, but locally all the same.
 *
 * A recorded skip reports `unanswered`: the key is revealed (the student asked
 * for it) but "Incorrect" is not the honest word for a question nobody
 * answered, and the engine's own selectors say the same thing.
 */
export function verdictToneFor(verdict: PracticeVerdict): Verdict {
  if (verdict.selectedIndex === null) return 'unanswered';
  return verdict.isCorrect ? 'correct' : 'incorrect';
}

/**
 * Presents a server practice result as a `QuizSummary`, so the existing score
 * screen renders a remote session with no changes.
 *
 * `gradableTotal` is `total`, which is the point: every question on a server
 * paper has a key, so the "excluded from the score" note a local attempt
 * sometimes shows must not appear. `responses` is empty because the
 * per-question analytics rows the engine builds carry `correct: false` for a
 * server-keyed question and would be a lie if surfaced.
 *
 * `elapsedMs` is zero and not guessed: practice is untimed, the server reports
 * no duration on `PracticeFinishResponse`, and `finishedAt - startedAt` would
 * be wall clock including however long the tab sat idle. The engine's own
 * visible time on task is passed in by the host, which is the only process
 * that measured it.
 */
export function summaryFromPracticeResult(
  result: PracticeFinishResponse,
  mode: QuizMode,
  elapsedMs = 0
): QuizSummary {
  return {
    mode,
    score: result.correct,
    total: result.total,
    gradableTotal: result.total,
    answered: Math.max(0, result.total - result.skipped),
    skipped: result.skipped,
    incorrect: result.incorrect,
    accuracyPct: result.accuracyPct,
    elapsedMs,
    responses: [],
  };
}

// --- Session handoff across reloads -----------------------------------------

const STORED_SESSION_PREFIX = 'necprep_practice_session_v1:';

/**
 * The identifiers a reload needs to pick a practice session back up.
 *
 * BOTH KEYS ARE MINTED BEFORE THE REQUEST THEY BELONG TO and never
 * regenerated. That is the idempotency contract: a `start` whose response was
 * lost replays to the same session instead of opening a second one, and a
 * `finish` retried after a crash replays the stored totals instead of being
 * refused.
 *
 * Per-answer keys are deliberately NOT here. `POST /api/practice/answer` is
 * idempotent on `(session, question)` server-side, so a replay converges
 * without one, and persisting a key per question would mean a write to
 * localStorage on every answer for no gain.
 */
export interface StoredPracticeSession {
  /** Null between minting the start key and the server answering. */
  sessionId: string | null;
  startKey: string;
  finishKey: string;
}

function isStored(value: unknown): value is StoredPracticeSession {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Partial<StoredPracticeSession>;
  return (
    (row.sessionId === null || typeof row.sessionId === 'string') &&
    typeof row.startKey === 'string' &&
    typeof row.finishKey === 'string'
  );
}

export function readStoredSession(practiceKey: string): StoredPracticeSession | null {
  try {
    const raw = localStorage.getItem(STORED_SESSION_PREFIX + practiceKey);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStored(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredSession(
  practiceKey: string,
  session: StoredPracticeSession
): void {
  try {
    localStorage.setItem(STORED_SESSION_PREFIX + practiceKey, JSON.stringify(session));
  } catch {
    // Private browsing, or storage full. The session still runs; it just will
    // not be resumable, and a reload will start a fresh one. Never let
    // persistence take down a study session.
  }
}

export function clearStoredSession(practiceKey: string): void {
  try {
    localStorage.removeItem(STORED_SESSION_PREFIX + practiceKey);
  } catch {
    // ignore
  }
}

/** A brand-new handoff record, with both keys already minted. */
export function newStoredSession(): StoredPracticeSession {
  return { sessionId: null, startKey: newIdempotencyKey(), finishKey: newIdempotencyKey() };
}
