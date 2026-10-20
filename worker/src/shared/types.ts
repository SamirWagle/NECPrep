/**
 * The wire contract between the Worker and the browser.
 *
 * This file is TYPE-ONLY on purpose. `frontend/src/services/api.ts` imports it
 * with `import type`, which `verbatimModuleSyntax` erases completely, so Vite
 * never has to resolve a path outside its root and no Worker runtime code can
 * leak into the client bundle. Keep it free of enums, namespaces, classes and
 * runtime `const` values: the frontend type-checks this file under
 * `erasableSyntaxOnly`, which rejects all of those.
 *
 * Shapes are defined here ONCE. The Worker handlers return them and the client
 * consumes them; neither side re-declares a response body.
 */

/** Milliseconds since the Unix epoch, always produced by the SERVER clock. */
export type EpochMs = number;

/** `YYYY-MM-DD` in the activity timezone (see `ACTIVITY_TZ_OFFSET_MINUTES`). */
export type DayKey = string;

// --- Errors -----------------------------------------------------------------

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'REQUEST_IN_FLIGHT'
  | 'ATTEMPT_NOT_IN_PROGRESS'
  | 'QUESTION_NOT_ON_PAPER'
  | 'UNKNOWN_OPTION_REF'
  | 'EMAIL_IN_USE'
  | 'INVALID_CREDENTIALS'
  | 'NOT_ANONYMOUS'
  | 'OAUTH_STATE_INVALID'
  | 'OAUTH_EXCHANGE_FAILED'
  | 'INSUFFICIENT_CONTENT'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL'
  // Synthesised by the typed client, never sent by the Worker. They live in the
  // same union so a caller can switch over one exhaustive set of codes instead
  // of handling transport failures through a separate channel.
  | 'BACKEND_NOT_CONFIGURED'
  | 'NETWORK_UNAVAILABLE';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  /** Per-field validation messages, keyed by dotted path. */
  fields?: Record<string, string>;
  /** Present on RATE_LIMITED. */
  retryAfterMs?: number;
}

export interface ApiErrorBody {
  error: ApiError;
}

/** What the typed client hands back. It never throws for expected failures. */
export type ApiResult<T> =
  | { ok: true; data: T; replayed: boolean }
  | { ok: false; error: ApiError };

// --- Identity ---------------------------------------------------------------

export type UserRole = 'user' | 'moderator' | 'admin';

export interface SessionUser {
  id: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  /** True for a guest identity that can still be upgraded in place. */
  isAnonymous: boolean;
  hasPassword: boolean;
  createdAt: EpochMs;
}

export interface SessionResponse {
  user: SessionUser | null;
  sessionExpiresAt: EpochMs | null;
  serverNow: EpochMs;
}

export interface SignupRequest {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/** Upgrades the CURRENT anonymous session's user in place. The id is kept. */
export interface UpgradeAnonymousRequest {
  email: string;
  password: string;
  displayName?: string;
}

// --- Content ----------------------------------------------------------------

export type ChapterIcon =
  | 'cpu' | 'code' | 'network' | 'database' | 'brain'
  | 'chip' | 'settings' | 'book' | 'calculator' | 'monitor';

export interface ChapterSummary {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  description: string;
  questionCount: number;
  icon: ChapterIcon;
  color: string;
  orderIndex: number;
}

/**
 * One selectable option as the client sees it.
 *
 * `ref` is an OPAQUE token. It is never an index and never a position. For
 * content browsing it is the `question_options` row id; inside a mock or
 * practice attempt it is a per-attempt random token, so a ref harvested from
 * one attempt is meaningless in another and cannot be joined against the option
 * ordering in the public chapter JSON that still sits in git history.
 *
 * There is deliberately no `isCorrect` field anywhere on this type.
 */
export interface PublicOption {
  ref: string;
  body: string;
}

/** A question with no answer key. Returned by every pre-answer endpoint. */
export interface PublicQuestion {
  id: string;
  chapterId: string;
  stem: string;
  options: PublicOption[];
  difficulty: number | null;
}

export interface ChapterQuestionsResponse {
  chapterId: string;
  total: number;
  offset: number;
  limit: number;
  questions: PublicQuestion[];
}

export interface SearchResultItem {
  questionId: string;
  chapterId: string;
  stem: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
}

export interface MockTemplateSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  durationMinutes: number;
  totalQuestions: number;
  /** Per-chapter composition, so the UI can describe the paper up front. */
  blueprint: Array<{ chapterId: string; questionCount: number }>;
}

/**
 * One coarse call that boots the whole app shell: chapters, mock templates and
 * the caller's session. Workers Free allows 100k requests/day, so the client
 * must not spend three round trips on this.
 */
export interface BootstrapResponse {
  session: SessionResponse;
  chapters: ChapterSummary[];
  mockTemplates: MockTemplateSummary[];
  contentVersion: string;
}

// --- Attempts (one shape for mock + practice) -------------------------------

export type AttemptStatus = 'in_progress' | 'submitted' | 'expired' | 'abandoned';

export interface AttemptQuestion {
  questionId: string;
  chapterId: string;
  /** 1-based position on THIS paper. Says nothing about the bank. */
  position: number;
  stem: string;
  options: PublicOption[];
}

// --- Mock tests -------------------------------------------------------------

export interface MockStartRequest {
  templateId: string;
  idempotencyKey: string;
}

export interface MockAttemptPaper {
  attemptId: string;
  templateId: string;
  status: AttemptStatus;
  startedAt: EpochMs;
  /** Server-authored deadline. The client renders its timer against this. */
  expiresAt: EpochMs;
  serverNow: EpochMs;
  durationSeconds: number;
  questionCount: number;
  questions: AttemptQuestion[];
  /**
   * Answers the server has already accepted for this attempt, from the last
   * pre-deadline sync. Lets a reload resume without trusting localStorage.
   */
  savedAnswers: Record<string, string>;
}

/**
 * Coarse autosave. The map is questionId -> optionRef and REPLACES the stored
 * snapshot wholesale, which makes it naturally idempotent and replay-safe.
 * The server stamps it with its own clock and refuses it past `expiresAt`.
 */
export interface MockSyncRequest {
  attemptId: string;
  answers: Record<string, string>;
}

export interface MockSyncResponse {
  accepted: boolean;
  serverNow: EpochMs;
  expiresAt: EpochMs;
  remainingMs: number;
  reason?: 'past_deadline' | 'not_in_progress';
}

export interface MockSubmitRequest {
  attemptId: string;
  idempotencyKey: string;
  answers: Record<string, string>;
}

/** The ONLY place a mock answer key is ever disclosed. */
export interface MockReviewQuestion {
  questionId: string;
  chapterId: string;
  position: number;
  stem: string;
  options: PublicOption[];
  selectedRef: string | null;
  correctRef: string;
  isCorrect: boolean;
  explanation: string | null;
}

export interface MockSubmitResponse {
  attemptId: string;
  status: 'submitted';
  score: number;
  total: number;
  correct: number;
  incorrect: number;
  skipped: number;
  accuracyPct: number;
  /**
   * `on_time` - submitted inside the grace window, so the payload was scored.
   * `expired` - submitted after the deadline, so the payload was discarded and
   *             the last snapshot the server accepted BEFORE `expiresAt` was
   *             scored instead.
   */
  timing: 'on_time' | 'expired';
  startedAt: EpochMs;
  expiresAt: EpochMs;
  submittedAt: EpochMs;
  /** `min(submittedAt, expiresAt)` - the instant the paper was frozen. */
  scoredAt: EpochMs;
  /** Answers discarded because the submission arrived past the deadline. */
  droppedLateAnswers: number;
  /** Submitted questionIds that were not on this attempt's paper. */
  rejectedQuestionIds: string[];
  review: MockReviewQuestion[];
}

// --- Practice ---------------------------------------------------------------

export type PracticeMode = 'chapter' | 'bookmarks' | 'srs' | 'wrong' | 'custom';

export interface PracticeStartRequest {
  mode: PracticeMode;
  chapterIds?: string[];
  questionCount: number;
  idempotencyKey: string;
}

export interface PracticeAnswerResult {
  questionId: string;
  selectedRef: string | null;
  /** Disclosed only after the answer is committed, for this question alone. */
  correctRef: string;
  isCorrect: boolean;
  explanation: string | null;
}

export interface PracticeSessionPaper {
  sessionId: string;
  mode: PracticeMode;
  status: AttemptStatus;
  startedAt: EpochMs;
  serverNow: EpochMs;
  questionCount: number;
  questions: AttemptQuestion[];
  /** Already-committed answers, so a reload keeps the revealed keys visible. */
  answered: Record<string, PracticeAnswerResult>;
}

export interface PracticeAnswerRequest {
  sessionId: string;
  questionId: string;
  /** `null` records a deliberate skip, which still reveals the key. */
  optionRef: string | null;
  /** Optional: this endpoint is already idempotent per (session, question). */
  idempotencyKey?: string;
  /**
   * Learner telemetry, all optional and all UNTRUSTED.
   *
   * These are inputs to the spaced-repetition grade, not to the score: see
   * `ratingFromOutcome` in `frontend/src/services/scheduler.ts`, which turns
   * time-on-question and a guess flag into a Rating. They are safe to accept
   * from the client precisely because the only thing they can influence is how
   * soon the learner sees the question again - lying makes your own revision
   * schedule worse. Correctness is still computed server-side from the key.
   *
   * `latencyMs` is clamped server-side; a mock answer accepts none of this.
   */
  latencyMs?: number;
  flaggedGuess?: boolean;
  confidence?: 1 | 2 | 3;
}

export interface PracticeAnswerResponse extends PracticeAnswerResult {
  answeredCount: number;
  correctCount: number;
}

export interface PracticeFinishRequest {
  sessionId: string;
  idempotencyKey: string;
}

export interface PracticeFinishResponse {
  sessionId: string;
  total: number;
  correct: number;
  incorrect: number;
  skipped: number;
  accuracyPct: number;
  finishedAt: EpochMs;
}

// --- Progress ---------------------------------------------------------------

export interface ChapterProgress {
  chapterId: string;
  attempted: number;
  correct: number;
  accuracyPct: number;
  questionCount: number;
}

export interface ProgressStats {
  totalAnswered: number;
  totalCorrect: number;
  accuracyPct: number;
  totalAvailable: number;
  chapters: ChapterProgress[];
}

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  todayAnswered: number;
  /** Most recent active days, newest first. */
  activeDays: DayKey[];
}

export interface AttemptHistoryItem {
  kind: 'mock' | 'practice';
  id: string;
  label: string;
  score: number;
  total: number;
  accuracyPct: number;
  at: EpochMs;
  status: AttemptStatus;
}

/** One coarse call for the whole dashboard. */
export interface ProgressOverview {
  stats: ProgressStats;
  streak: StreakInfo;
  recent: AttemptHistoryItem[];
}

export interface AttemptHistoryResponse {
  items: AttemptHistoryItem[];
  nextCursor: string | null;
}

// --- Bookmarks --------------------------------------------------------------

export interface BookmarkItem {
  questionId: string;
  chapterId: string;
  stem: string;
  createdAt: EpochMs;
}

export interface BookmarkListResponse {
  items: BookmarkItem[];
}

/**
 * `desired: true` adds, `false` removes. Expressing it as a desired end state
 * rather than as add/remove verbs is what makes offline replay safe: replaying
 * the same mutation twice converges instead of toggling.
 */
export interface BookmarkSetRequest {
  questionId: string;
  desired: boolean;
  idempotencyKey?: string;
}

export interface BookmarkSetResponse {
  questionId: string;
  bookmarked: boolean;
  total: number;
}

// --- Spaced repetition ------------------------------------------------------

export type SrsGrade = 'again' | 'hard' | 'good' | 'easy';

export type SrsState = 'new' | 'learning' | 'review' | 'relearning';

export interface SrsCardState {
  questionId: string;
  dueAt: EpochMs;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  state: SrsState;
  /** Monotonic counter, incremented by every applied review. */
  revision: number;
}

export interface SrsDueResponse {
  serverNow: EpochMs;
  dueCount: number;
  questions: AttemptQuestion[];
  /** Keyed by questionId, parallel to `questions`. */
  cards: Record<string, SrsCardState>;
}

export interface SrsReviewRequest {
  questionId: string;
  grade: SrsGrade;
  /**
   * The `revision` the client last saw for this card. The server applies the
   * review only if it still matches, so a replayed outbox entry is a no-op.
   */
  revision: number;
  idempotencyKey?: string;
}

export interface SrsReviewResponse {
  card: SrsCardState;
  applied: boolean;
}

// --- Errata reports ---------------------------------------------------------

export type ReportReason =
  | 'wrong_answer' | 'ambiguous' | 'typo' | 'duplicate' | 'out_of_syllabus' | 'other';

export type ReportStatus = 'open' | 'triaged' | 'accepted' | 'rejected' | 'fixed';

export interface ReportSubmitRequest {
  questionId: string;
  reason: ReportReason;
  detail?: string;
  idempotencyKey?: string;
}

export interface ReportItem {
  id: string;
  questionId: string;
  chapterId: string;
  reason: ReportReason;
  detail: string | null;
  status: ReportStatus;
  createdAt: EpochMs;
  resolutionNote: string | null;
}

export interface ReportListResponse {
  items: ReportItem[];
}

// --- Admin ------------------------------------------------------------------

export interface AdminReportItem extends ReportItem {
  reporterUserId: string;
  stem: string;
  /** Open reports against this question, so triage can prioritise. */
  reportCountForQuestion: number;
}

export interface AdminReportQueueResponse {
  items: AdminReportItem[];
  nextCursor: string | null;
}

export interface AdminTriageRequest {
  reportIds: string[];
  status: ReportStatus;
  resolutionNote?: string;
  idempotencyKey: string;
}

export interface AdminTriageResponse {
  updated: number;
  status: ReportStatus;
}

export type QuestionPublishState = 'draft' | 'published' | 'retired';

export interface AdminPublishRequest {
  questionIds: string[];
  state: QuestionPublishState;
  idempotencyKey: string;
}

export interface AdminPublishResponse {
  updated: number;
  state: QuestionPublishState;
}

export interface AuditLogItem {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  detail: string | null;
  createdAt: EpochMs;
}

export interface AuditLogResponse {
  items: AuditLogItem[];
  nextCursor: string | null;
}

// --- Offline outbox ---------------------------------------------------------

/**
 * Every mutating endpoint the offline outbox may replay, with the body it
 * replays. Discriminated so the queue can be persisted as JSON and drained
 * without `any`.
 *
 * See `docs/api.md` for the replay contract. The rule: an outbox entry carries
 * an idempotency key minted ONCE at enqueue time, never regenerated on retry.
 */
export type OutboxEntry =
  | { kind: 'mock.sync'; body: MockSyncRequest }
  | { kind: 'mock.submit'; body: MockSubmitRequest }
  | { kind: 'practice.answer'; body: PracticeAnswerRequest }
  | { kind: 'practice.finish'; body: PracticeFinishRequest }
  | { kind: 'bookmark.set'; body: BookmarkSetRequest }
  | { kind: 'srs.review'; body: SrsReviewRequest }
  | { kind: 'report.submit'; body: ReportSubmitRequest };

export interface QueuedMutation {
  /** Local queue id. Never sent to the server. */
  localId: string;
  entry: OutboxEntry;
  enqueuedAt: EpochMs;
  attempts: number;
  lastError: string | null;
}
