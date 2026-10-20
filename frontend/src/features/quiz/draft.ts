/**
 * Quiz engine — attempt persistence.
 *
 * Generalises the scheme MockTestQuiz already uses (`eng_mock_draft_v1:<id>`)
 * so practice modes get the same crash-safety the exam has, and so a half-done
 * attempt survives a reload, an accidental back-navigation or a killed tab.
 *
 * Two invariants carried over from the mock implementation:
 *
 *  - `endsAt` is an absolute wall-clock deadline, never a remaining-seconds
 *    counter. A counter pauses when the tab closes and resets on reload, which
 *    hands the student unlimited time.
 *  - The paper is stored as question ids, and a restore that cannot resolve
 *    every id is thrown away. Scoring against a paper you cannot rebuild is
 *    worse than starting over.
 *
 * Legacy mock drafts are read once and migrated, so an exam in progress when
 * this ships is not destroyed by the upgrade.
 */

import type { FeedbackMode, QuizMode, QuizState } from './types';

export const DRAFT_VERSION = 1;

/** Bump the suffix, never the shape, when the draft format changes. */
export const DRAFT_PREFIX = 'eng_quiz_draft_v1:';

/** The pre-engine mock format. Read-only: migrated on first load, then dropped. */
export const LEGACY_MOCK_DRAFT_PREFIX = 'eng_mock_draft_v1:';

export interface QuizDraft {
  v: typeof DRAFT_VERSION;
  /** Attempt identity, e.g. `topic:book-ch1:30` or `mock:mock-1`. */
  key: string;
  mode: QuizMode;
  feedback: FeedbackMode;
  questionIds: string[];
  selections: (number | null)[];
  submitted: number[];
  flagged: number[];
  accumulatedMs: number[];
  currentIndex: number;
  startedAt: number;
  /** Absolute deadline, epoch ms. Null for untimed attempts. */
  endsAt: number | null;
  savedAt: number;
}

export function draftStorageKey(key: string): string {
  return DRAFT_PREFIX + key;
}

// ─── Validation ──────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asNumberArray(v: unknown, length?: number): number[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((n): n is number => typeof n === 'number' && Number.isFinite(n))) return null;
  if (length !== undefined && v.length !== length) return null;
  return v;
}

function asSelections(v: unknown, length: number): (number | null)[] | null {
  if (!Array.isArray(v) || v.length !== length) return null;
  const ok = v.every(
    (n): n is number | null => n === null || (typeof n === 'number' && Number.isInteger(n))
  );
  return ok ? v : null;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.every((s): s is string => typeof s === 'string') ? v : null;
}

const MODES: readonly QuizMode[] = ['topic', 'quick', 'custom', 'mock', 'bookmarks'];

function asMode(v: unknown): QuizMode | null {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v)
    ? (v as QuizMode)
    : null;
}

/**
 * Parses a stored draft, returning null for anything it does not fully trust.
 *
 * Deliberately strict rather than forgiving: a partially-recovered draft is a
 * silently wrong attempt, while a rejected one just starts fresh.
 */
export function parseDraft(raw: unknown, key: string): QuizDraft | null {
  if (!isRecord(raw)) return null;
  if (raw.v !== DRAFT_VERSION || raw.key !== key) return null;

  const mode = asMode(raw.mode);
  const questionIds = asStringArray(raw.questionIds);
  if (mode === null || questionIds === null || questionIds.length === 0) return null;

  const n = questionIds.length;
  const selections = asSelections(raw.selections, n);
  const accumulatedMs = asNumberArray(raw.accumulatedMs, n);
  const submitted = asNumberArray(raw.submitted);
  const flagged = asNumberArray(raw.flagged);
  if (selections === null || accumulatedMs === null || submitted === null || flagged === null) {
    return null;
  }

  if (typeof raw.startedAt !== 'number' || !Number.isFinite(raw.startedAt)) return null;
  const endsAt =
    raw.endsAt === null
      ? null
      : typeof raw.endsAt === 'number' && Number.isFinite(raw.endsAt)
        ? raw.endsAt
        : undefined;
  if (endsAt === undefined) return null;

  const feedback: FeedbackMode = raw.feedback === 'deferred' ? 'deferred' : 'immediate';
  const currentIndex =
    typeof raw.currentIndex === 'number' && Number.isInteger(raw.currentIndex)
      ? Math.min(Math.max(raw.currentIndex, 0), n - 1)
      : 0;

  return {
    v: DRAFT_VERSION,
    key,
    mode,
    feedback,
    questionIds,
    selections,
    submitted: submitted.filter((i) => i >= 0 && i < n),
    flagged: flagged.filter((i) => i >= 0 && i < n),
    accumulatedMs,
    currentIndex,
    startedAt: raw.startedAt,
    endsAt,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : raw.startedAt,
  };
}

// ─── Legacy migration ────────────────────────────────────────────────────────

/**
 * Reads a pre-engine mock draft (`{testId, questionIds, answers, endsAt,
 * startedAt}`) and lifts it into the new shape. Answers were never committed
 * per question in the old mock, so `submitted` starts empty — correct, because
 * a deferred attempt commits nothing until the paper goes in.
 */
export function readLegacyMockDraft(testId: string, key: string): QuizDraft | null {
  let raw: unknown;
  try {
    const stored = localStorage.getItem(LEGACY_MOCK_DRAFT_PREFIX + testId);
    if (!stored) return null;
    raw = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.testId !== testId) return null;

  const questionIds = asStringArray(raw.questionIds);
  if (questionIds === null || questionIds.length === 0) return null;
  const selections = asSelections(raw.answers, questionIds.length);
  if (selections === null) return null;
  if (typeof raw.endsAt !== 'number' || !Number.isFinite(raw.endsAt)) return null;
  const startedAt = typeof raw.startedAt === 'number' ? raw.startedAt : raw.endsAt;

  return {
    v: DRAFT_VERSION,
    key,
    mode: 'mock',
    feedback: 'deferred',
    questionIds,
    selections,
    submitted: [],
    flagged: [],
    accumulatedMs: Array<number>(questionIds.length).fill(0),
    currentIndex: 0,
    startedAt,
    endsAt: raw.endsAt,
    savedAt: startedAt,
  };
}

// ─── Storage ─────────────────────────────────────────────────────────────────

export interface DraftOptions {
  /** When set, a missing draft falls back to the legacy mock draft for this id. */
  legacyMockTestId?: string;
}

export function readDraft(key: string, options: DraftOptions = {}): QuizDraft | null {
  let parsed: QuizDraft | null = null;
  try {
    const stored = localStorage.getItem(draftStorageKey(key));
    if (stored) parsed = parseDraft(JSON.parse(stored), key);
  } catch {
    parsed = null;
  }
  if (parsed) return parsed;
  if (options.legacyMockTestId) return readLegacyMockDraft(options.legacyMockTestId, key);
  return null;
}

export function writeDraft(draft: QuizDraft): void {
  try {
    localStorage.setItem(draftStorageKey(draft.key), JSON.stringify(draft));
  } catch {
    // Storage full, blocked, or private mode. The attempt continues; it just
    // will not resume. Never let persistence take down the quiz.
  }
}

export function clearDraft(key: string, options: DraftOptions = {}): void {
  try {
    localStorage.removeItem(draftStorageKey(key));
    if (options.legacyMockTestId) {
      localStorage.removeItem(LEGACY_MOCK_DRAFT_PREFIX + options.legacyMockTestId);
    }
  } catch {
    // ignore
  }
}

/**
 * Snapshots live state as a draft.
 *
 * Returns null for a finished or unloaded attempt: there is nothing worth
 * resuming, and writing one would resurrect a quiz the student completed.
 */
export function draftFromState(state: QuizState, key: string, savedAt: number): QuizDraft | null {
  if (state.phase === 'loading' || state.phase === 'done') return null;
  if (state.questions.length === 0 || state.timing.startedAt === null) return null;
  return {
    v: DRAFT_VERSION,
    key,
    mode: state.mode,
    feedback: state.feedback,
    questionIds: state.questions.map((q) => q.id),
    selections: [...state.selections],
    submitted: [...state.submitted],
    flagged: [...state.flagged],
    // Banked time only. The running slice is intentionally left out: on resume
    // the clock restarts, and crediting time for a tab that was closed would
    // inflate every latency that feeds guess detection.
    accumulatedMs: [...state.timing.accumulatedMs],
    currentIndex: state.currentIndex,
    startedAt: state.timing.startedAt,
    endsAt: state.timing.endsAt,
    savedAt,
  };
}
