/**
 * Request schemas. Every endpoint that accepts a body or a query string has one
 * here, and the middleware refuses the request if the body does not parse.
 *
 * The limits are not decoration. `MAX_MOCK_ANSWERS` bounds the JSON blob that
 * gets expanded by `json_each` in the submit batch, and `MAX_SEARCH_LEN` bounds
 * a LIKE pattern. An unbounded answers map is a cheap way to make one D1
 * statement do unbounded work on a single-threaded database.
 */

import { v } from './v.ts';
import type { Infer } from './v.ts';

/** The largest paper the API will accept a submission for. */
export const MAX_MOCK_ANSWERS = 250;
export const MAX_PRACTICE_QUESTIONS = 100;
export const MAX_SEARCH_LEN = 120;
export const MAX_REPORT_DETAIL = 2000;
export const MAX_ADMIN_BATCH = 100;

/** Request bodies larger than this are refused before they are parsed. */
export const MAX_BODY_BYTES = 128 * 1024;

const optionRef = () => v.string().token(32);
const questionId = () => v.entityId();

// --- Auth -------------------------------------------------------------------

/**
 * 8 characters is the floor, 200 the ceiling. The ceiling exists because the
 * password is fed to PBKDF2 and an unbounded input is a cheap CPU-exhaustion
 * vector on a Worker with a 10ms budget.
 */
const password = () => v.string().min(8).max(200);

export const signupSchema = v.object({
  email: v.string().email(),
  password: password(),
  displayName: v.optional(v.string().trimmed().min(1).max(60)),
});

export const loginSchema = v.object({
  email: v.string().email(),
  password: v.string().min(1).max(200),
});

export const upgradeAnonymousSchema = v.object({
  email: v.string().email(),
  password: password(),
  displayName: v.optional(v.string().trimmed().min(1).max(60)),
});

export const googleCallbackSchema = v.object({
  code: v.string().min(1).max(2048),
  state: v.string().token(64),
});

// --- Content ----------------------------------------------------------------

export const chapterQuestionsQuerySchema = v.object({
  chapterId: v.entityId(),
  offset: v.withDefault(v.number().int().min(0).max(100_000), () => 0),
  limit: v.withDefault(v.number().int().min(1).max(100), () => 50),
});

export const searchQuerySchema = v.object({
  q: v.string().trimmed().min(2).max(MAX_SEARCH_LEN),
  chapterId: v.optional(v.entityId()),
  limit: v.withDefault(v.number().int().min(1).max(50), () => 20),
});

// --- Mock -------------------------------------------------------------------

export const mockStartSchema = v.object({
  templateId: v.entityId(),
  idempotencyKey: v.idempotencyKey(),
});

/**
 * The answers map is questionId -> optionRef.
 *
 * Note what is NOT in here: no score, no `isCorrect`, no timestamps and no
 * deadline. The client has no field with which to assert anything about
 * correctness or about time.
 */
const answersMap = () => v.record(questionId(), optionRef(), MAX_MOCK_ANSWERS);

export const mockSyncSchema = v.object({
  attemptId: v.entityId(),
  answers: answersMap(),
});

export const mockSubmitSchema = v.object({
  attemptId: v.entityId(),
  idempotencyKey: v.idempotencyKey(),
  answers: answersMap(),
});

export const attemptIdSchema = v.object({
  attemptId: v.entityId(),
});

// --- Practice ---------------------------------------------------------------

export const practiceStartSchema = v.object({
  mode: v.enumOf(['chapter', 'bookmarks', 'srs', 'wrong', 'custom'] as const),
  chapterIds: v.optional(v.array(v.entityId()).min(1).max(20).unique()),
  questionCount: v.number().int().min(1).max(MAX_PRACTICE_QUESTIONS),
  idempotencyKey: v.idempotencyKey(),
});

/** An hour. Anything longer is a tab left open, not time on the question. */
export const MAX_LATENCY_MS = 60 * 60 * 1000;

export const practiceAnswerSchema = v.object({
  sessionId: v.entityId(),
  questionId: questionId(),
  optionRef: v.nullable(optionRef()),
  idempotencyKey: v.optional(v.idempotencyKey()),
  // Telemetry for the spaced-repetition grade only. Bounded so a hostile value
  // cannot overflow an INTEGER column or skew an aggregate.
  latencyMs: v.optional(v.number().int().min(0).max(MAX_LATENCY_MS)),
  flaggedGuess: v.optional(v.boolean()),
  confidence: v.optional(v.number().int().min(1).max(3)),
});

export const practiceFinishSchema = v.object({
  sessionId: v.entityId(),
  idempotencyKey: v.idempotencyKey(),
});

// --- Progress ---------------------------------------------------------------

export const historyQuerySchema = v.object({
  limit: v.withDefault(v.number().int().min(1).max(50), () => 20),
  cursor: v.optional(v.string().token(64)),
});

// --- Bookmarks --------------------------------------------------------------

export const bookmarkSetSchema = v.object({
  questionId: questionId(),
  desired: v.boolean(),
  idempotencyKey: v.optional(v.idempotencyKey()),
});

// --- SRS --------------------------------------------------------------------

export const srsDueQuerySchema = v.object({
  limit: v.withDefault(v.number().int().min(1).max(50), () => 20),
});

export const srsReviewSchema = v.object({
  questionId: questionId(),
  grade: v.enumOf(['again', 'hard', 'good', 'easy'] as const),
  revision: v.number().int().min(0).max(1_000_000),
  idempotencyKey: v.optional(v.idempotencyKey()),
});

// --- Reports ----------------------------------------------------------------

export const reportSubmitSchema = v.object({
  questionId: questionId(),
  reason: v.enumOf([
    'wrong_answer',
    'ambiguous',
    'typo',
    'duplicate',
    'out_of_syllabus',
    'other',
  ] as const),
  detail: v.optional(v.string().trimmed().max(MAX_REPORT_DETAIL)),
  idempotencyKey: v.optional(v.idempotencyKey()),
});

// --- Admin ------------------------------------------------------------------

export const adminQueueQuerySchema = v.object({
  status: v.withDefault(
    v.enumOf(['open', 'triaged', 'accepted', 'rejected', 'fixed'] as const),
    () => 'open' as const,
  ),
  limit: v.withDefault(v.number().int().min(1).max(50), () => 25),
  cursor: v.optional(v.string().token(64)),
});

export const adminTriageSchema = v.object({
  reportIds: v.array(v.entityId()).min(1).max(MAX_ADMIN_BATCH).unique(),
  status: v.enumOf(['open', 'triaged', 'accepted', 'rejected', 'fixed'] as const),
  resolutionNote: v.optional(v.string().trimmed().max(1000)),
  idempotencyKey: v.idempotencyKey(),
});

export const adminPublishSchema = v.object({
  questionIds: v.array(questionId()).min(1).max(MAX_ADMIN_BATCH).unique(),
  state: v.enumOf(['draft', 'published', 'retired'] as const),
  idempotencyKey: v.idempotencyKey(),
});

export const auditQuerySchema = v.object({
  limit: v.withDefault(v.number().int().min(1).max(100), () => 50),
  cursor: v.optional(v.string().token(64)),
});

// --- Inferred input types ---------------------------------------------------
//
// These are the server-side view of each body AFTER validation (defaults
// applied, strings trimmed). The client-side request types live in
// `shared/types.ts`; these are intentionally separate because a validated body
// is not the same type as a request body - `limit` is optional on the wire and
// required here.

export type SignupInput = Infer<typeof signupSchema>;
export type LoginInput = Infer<typeof loginSchema>;
export type UpgradeAnonymousInput = Infer<typeof upgradeAnonymousSchema>;
export type GoogleCallbackInput = Infer<typeof googleCallbackSchema>;
export type ChapterQuestionsInput = Infer<typeof chapterQuestionsQuerySchema>;
export type SearchInput = Infer<typeof searchQuerySchema>;
export type MockStartInput = Infer<typeof mockStartSchema>;
export type MockSyncInput = Infer<typeof mockSyncSchema>;
export type MockSubmitInput = Infer<typeof mockSubmitSchema>;
export type PracticeStartInput = Infer<typeof practiceStartSchema>;
export type PracticeAnswerInput = Infer<typeof practiceAnswerSchema>;
export type PracticeFinishInput = Infer<typeof practiceFinishSchema>;
export type HistoryInput = Infer<typeof historyQuerySchema>;
export type BookmarkSetInput = Infer<typeof bookmarkSetSchema>;
export type SrsDueInput = Infer<typeof srsDueQuerySchema>;
export type SrsReviewInput = Infer<typeof srsReviewSchema>;
export type ReportSubmitInput = Infer<typeof reportSubmitSchema>;
export type AdminQueueInput = Infer<typeof adminQueueQuerySchema>;
export type AdminTriageInput = Infer<typeof adminTriageSchema>;
export type AdminPublishInput = Infer<typeof adminPublishSchema>;
export type AuditInput = Infer<typeof auditQuerySchema>;
