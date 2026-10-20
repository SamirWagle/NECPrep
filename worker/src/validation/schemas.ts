/**
 * Request schemas, in Zod. Every endpoint that accepts a body or a query string
 * has one here, and the middleware refuses the request if it does not parse.
 *
 * EVERY OBJECT IS `z.strictObject`. Zod's `z.object` STRIPS an unrecognised
 * key, which is the worst of the three options at this boundary -- see the
 * header of `validation/parse.ts` for the argument. A bare `z.object` anywhere
 * in this file is a bug.
 *
 * The limits are not decoration. `MAX_MOCK_ANSWERS` bounds the JSON blob that
 * gets expanded by `json_each` in the submit batch, and `MAX_SEARCH_LEN` bounds
 * what reaches the FTS5 tokeniser. An unbounded answers map is a cheap way to
 * make one D1 statement do unbounded work on a single-threaded database.
 */

import { z } from 'zod';

/** The largest paper the API will accept a submission for. */
export const MAX_MOCK_ANSWERS = 250;
export const MAX_PRACTICE_QUESTIONS = 100;
export const MAX_SEARCH_LEN = 120;
export const MAX_REPORT_DETAIL = 2000;
export const MAX_ADMIN_BATCH = 100;

/** Request bodies larger than this are refused before they are parsed. */
export const MAX_BODY_BYTES = 128 * 1024;

/**
 * No string coercion anywhere, and the message says so.
 *
 * `"12"` in a JSON body is a client bug; coercing it hides the bug until a
 * value like `"12abc"` arrives. Zod rejects `NaN` by default and -- verified,
 * not assumed -- also rejects `Infinity`, so a hostile numeric value cannot
 * reach an INTEGER column or skew an aggregate.
 */
const number = () => z.number({ error: 'Expected a finite number.' });
const integer = () => number().int('Expected an integer.');

/**
 * A server-minted entity id, or any opaque token on the wire.
 *
 * Charset-restricted because these reach a primary key and are echoed in logs,
 * and bounded because `question_reports.public_id`, `attempts.public_id` and an
 * idempotency key all become half of a unique index.
 */
const TOKEN_RE = /^[A-Za-z0-9_.:-]+$/;
const token = (maxLen = 64) =>
  z
    .string({ error: 'Expected a string.' })
    .min(1, 'Must be a valid identifier.')
    .max(maxLen, 'Must be a valid identifier.')
    .regex(TOKEN_RE, 'Must be a valid identifier.');

const entityId = () => token(64);
const optionRef = () => token(32);
const questionId = () => entityId();

/**
 * The idempotency key, as a field. Client-supplied, so it is bounded and
 * charset-restricted: it becomes half of a primary key and is echoed in logs.
 * The 8-character floor is so it cannot be trivially guessed by another
 * session -- the key is scoped per user, but a guessable one would still let a
 * second tab collide with the first.
 */
const idempotencyKey = () =>
  token(80).min(8, 'Must be at least 8 characters.');

/**
 * Deliberately boring. A full RFC 5322 matcher is a liability; this rejects
 * everything that cannot be a deliverable address and nothing that can. The
 * transforms run before the checks, so a stored address is already the
 * canonical form `users.email_normalized` will generate from it.
 */
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const email = () =>
  z
    .string({ error: 'Expected a string.' })
    .trim()
    .toLowerCase()
    .max(254, 'Must be a valid email address.')
    .regex(EMAIL_RE, 'Must be a valid email address.');

/** Keys that must never arrive from a client, whatever the schema says. */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Rejects a prototype-polluting key BEFORE the inner schema sees the object.
 *
 * This guard is not optional and it is not paranoia about Zod. Zod's
 * `z.record` builds its output with plain assignment onto a fresh object, so a
 * JSON body of `{"__proto__": "x"}` has the key SILENTLY DROPPED -- the parse
 * succeeds and the field vanishes. That is the stripping failure mode this
 * whole file exists to avoid: the client believes it submitted an answer for a
 * question whose id happens to be a reserved word, and the server believes it
 * submitted nothing. A refinement cannot see it either, because refinements run
 * on the OUTPUT. So the check has to happen on the raw value, which is what
 * `z.unknown().superRefine(...).pipe(inner)` does: the pipe's second half never
 * runs if the first half raised an issue.
 */
function noReservedKeys<T extends z.ZodType>(inner: T): z.ZodType<z.output<T>> {
  return z
    .unknown()
    .superRefine((value, ctx) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
      for (const key of Object.keys(value)) {
        if (RESERVED_KEYS.has(key)) {
          ctx.addIssue({ code: 'custom', message: 'Reserved key.', path: [key] });
        }
      }
    })
    .pipe(inner) as unknown as z.ZodType<z.output<T>>;
}

// --- Auth -------------------------------------------------------------------

/**
 * 8 characters is the floor, 200 the ceiling. The ceiling exists because the
 * password is fed to PBKDF2 and an unbounded input is a cheap CPU-exhaustion
 * vector on a Worker with a 10ms budget.
 */
const password = () =>
  z.string({ error: 'Expected a string.' }).min(8, 'Must be at least 8 characters.').max(200);

const displayName = () =>
  z.string({ error: 'Expected a string.' }).trim().min(1).max(60);

export const signupSchema = z.strictObject({
  email: email(),
  password: password(),
  displayName: displayName().optional(),
});

export const loginSchema = z.strictObject({
  email: email(),
  // No minimum, deliberately. Rejecting a short password at the schema would
  // tell an attacker their guess was too short to be anyone's password.
  password: z.string({ error: 'Expected a string.' }).min(1).max(200),
});

export const upgradeAnonymousSchema = z.strictObject({
  email: email(),
  password: password(),
  displayName: displayName().optional(),
});

export const googleCallbackSchema = z.strictObject({
  code: z.string({ error: 'Expected a string.' }).min(1).max(2048),
  state: token(64),
});

// --- Content ----------------------------------------------------------------

export const chapterQuestionsQuerySchema = z.strictObject({
  chapterId: entityId(),
  offset: integer().min(0).max(100_000).default(0),
  // An unbounded page size is a bulk-extraction vector against the bank.
  limit: integer().min(1).max(100).default(50),
});

export const searchQuerySchema = z.strictObject({
  q: z.string({ error: 'Expected a string.' }).trim().min(2).max(MAX_SEARCH_LEN),
  chapterId: entityId().optional(),
  limit: integer().min(1).max(50).default(20),
});

// --- Mock -------------------------------------------------------------------

export const mockStartSchema = z.strictObject({
  templateId: entityId(),
  idempotencyKey: idempotencyKey(),
});

/**
 * The answers map is questionId -> optionRef.
 *
 * Note what is NOT in here: no score, no `isCorrect`, no timestamps and no
 * deadline. The client has no field with which to assert anything about
 * correctness or about time, and because the object is strict, inventing one
 * is a 400 rather than a silently ignored field.
 */
const answersMap = () =>
  noReservedKeys(
    z
      .record(questionId(), optionRef())
      .refine(
        (map) => Object.keys(map).length <= MAX_MOCK_ANSWERS,
        `Allows at most ${MAX_MOCK_ANSWERS} entries.`,
      ),
  );

export const mockSyncSchema = z.strictObject({
  attemptId: entityId(),
  answers: answersMap(),
});

export const mockSubmitSchema = z.strictObject({
  attemptId: entityId(),
  idempotencyKey: idempotencyKey(),
  answers: answersMap(),
});

export const attemptIdSchema = z.strictObject({
  attemptId: entityId(),
});

// --- Practice ---------------------------------------------------------------

export const practiceStartSchema = z.strictObject({
  mode: z.enum(['chapter', 'bookmarks', 'srs', 'wrong', 'custom']),
  chapterIds: z
    .array(entityId())
    .min(1)
    .max(20)
    .refine((xs) => new Set(xs).size === xs.length, 'Items must be unique.')
    .optional(),
  questionCount: integer().min(1).max(MAX_PRACTICE_QUESTIONS),
  idempotencyKey: idempotencyKey(),
});

/** An hour. Anything longer is a tab left open, not time on the question. */
export const MAX_LATENCY_MS = 60 * 60 * 1000;

export const practiceAnswerSchema = z.strictObject({
  sessionId: entityId(),
  questionId: questionId(),
  /** `null` records a deliberate skip, which still reveals the key. */
  optionRef: optionRef().nullable(),
  idempotencyKey: idempotencyKey().optional(),
  // Telemetry for the spaced-repetition grade only. Bounded so a hostile value
  // cannot overflow an INTEGER column or skew an aggregate.
  latencyMs: integer().min(0).max(MAX_LATENCY_MS).optional(),
  flaggedGuess: z.boolean({ error: 'Expected true or false.' }).optional(),
  confidence: integer().min(1).max(3).optional(),
});

export const practiceFinishSchema = z.strictObject({
  sessionId: entityId(),
  idempotencyKey: idempotencyKey(),
});

// --- Progress ---------------------------------------------------------------

export const historyQuerySchema = z.strictObject({
  limit: integer().min(1).max(50).default(20),
  cursor: token(64).optional(),
});

// --- Bookmarks --------------------------------------------------------------

export const bookmarkSetSchema = z.strictObject({
  questionId: questionId(),
  // Not coerced: `'true'` and `1` are both client bugs, and accepting either
  // would make "remove this bookmark" indistinguishable from "add it".
  desired: z.boolean({ error: 'Expected true or false.' }),
  idempotencyKey: idempotencyKey().optional(),
});

// --- SRS --------------------------------------------------------------------

export const srsDueQuerySchema = z.strictObject({
  limit: integer().min(1).max(50).default(20),
});

export const srsReviewSchema = z.strictObject({
  questionId: questionId(),
  grade: z.enum(['again', 'hard', 'good', 'easy']),
  /** The `revision` (`srs_state.reps`) the client last saw for this card. */
  revision: integer().min(0).max(1_000_000),
  idempotencyKey: idempotencyKey().optional(),
});

// --- Reports ----------------------------------------------------------------

export const reportSubmitSchema = z.strictObject({
  questionId: questionId(),
  reason: z.enum([
    'wrong_answer',
    'ambiguous',
    'typo',
    'duplicate',
    'out_of_syllabus',
    'other',
  ]),
  detail: z.string({ error: 'Expected a string.' }).trim().max(MAX_REPORT_DETAIL).optional(),
  idempotencyKey: idempotencyKey().optional(),
});

// --- Admin ------------------------------------------------------------------

/** Matches the CHECK on `question_reports.status`. */
const reportStatus = () => z.enum(['open', 'triaged', 'accepted', 'rejected', 'duplicate']);

export const adminQueueQuerySchema = z.strictObject({
  status: reportStatus().default('open'),
  limit: integer().min(1).max(50).default(25),
  cursor: token(64).optional(),
});

/** A duplicated id in a batch is a client bug worth surfacing, not deduplicating. */
const uniqueIds = (inner: z.ZodType<string>) =>
  z
    .array(inner)
    .min(1)
    .max(MAX_ADMIN_BATCH)
    .refine((xs) => new Set(xs).size === xs.length, 'Items must be unique.');

export const adminTriageSchema = z.strictObject({
  reportIds: uniqueIds(entityId()),
  status: reportStatus(),
  resolutionNote: z.string({ error: 'Expected a string.' }).trim().max(1000).optional(),
  idempotencyKey: idempotencyKey(),
});

export const adminPublishSchema = z.strictObject({
  questionIds: uniqueIds(questionId()),
  state: z.enum(['draft', 'published', 'retired']),
  idempotencyKey: idempotencyKey(),
});

export const auditQuerySchema = z.strictObject({
  limit: integer().min(1).max(100).default(50),
  cursor: token(64).optional(),
});

// --- Inferred input types ---------------------------------------------------
//
// These are the server-side view of each body AFTER validation (defaults
// applied, strings trimmed). The client-side request types live in
// `shared/types.ts`; these are intentionally separate because a validated body
// is not the same type as a request body - `limit` is optional on the wire and
// required here.

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpgradeAnonymousInput = z.infer<typeof upgradeAnonymousSchema>;
export type GoogleCallbackInput = z.infer<typeof googleCallbackSchema>;
export type ChapterQuestionsInput = z.infer<typeof chapterQuestionsQuerySchema>;
export type SearchInput = z.infer<typeof searchQuerySchema>;
export type MockStartInput = z.infer<typeof mockStartSchema>;
export type MockSyncInput = z.infer<typeof mockSyncSchema>;
export type MockSubmitInput = z.infer<typeof mockSubmitSchema>;
export type PracticeStartInput = z.infer<typeof practiceStartSchema>;
export type PracticeAnswerInput = z.infer<typeof practiceAnswerSchema>;
export type PracticeFinishInput = z.infer<typeof practiceFinishSchema>;
export type HistoryInput = z.infer<typeof historyQuerySchema>;
export type BookmarkSetInput = z.infer<typeof bookmarkSetSchema>;
export type SrsDueInput = z.infer<typeof srsDueQuerySchema>;
export type SrsReviewInput = z.infer<typeof srsReviewSchema>;
export type ReportSubmitInput = z.infer<typeof reportSubmitSchema>;
export type AdminQueueInput = z.infer<typeof adminQueueQuerySchema>;
export type AdminTriageInput = z.infer<typeof adminTriageSchema>;
export type AdminPublishInput = z.infer<typeof adminPublishSchema>;
export type AuditInput = z.infer<typeof auditQuerySchema>;
