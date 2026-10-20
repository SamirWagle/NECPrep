/**
 * The typed HTTP client for the NECPrep Worker API.
 *
 * HOW THIS COEXISTS WITH `localData.ts`. It does not replace it. The app must
 * keep working with no backend configured - that is the deployment that is live
 * today, questions served from `public/data/*.json` and progress in
 * localStorage. So every call site branches:
 *
 *     import { isBackendConfigured, api } from '../services/api';
 *     import * as local from '../services/localData';
 *
 *     const chapters = isBackendConfigured()
 *       ? (await api.getChapters()).data?.chapters
 *       : local.bookChapters;
 *
 * `isBackendConfigured()` reads `VITE_API_BASE_URL`. With it unset, nothing in
 * this module ever issues a request: every function short-circuits to an
 * `ApiResult` with code `BACKEND_NOT_CONFIGURED`, so a caller that forgets to
 * branch degrades to "no data" rather than to a stack of failed fetches.
 *
 * TYPES ARE NOT DECLARED HERE. They are imported from the Worker's own
 * `shared/types.ts`, so a response shape exists exactly once in the repository
 * and a server change that breaks the client is a type error rather than a
 * runtime surprise. The import is `import type`, which `verbatimModuleSyntax`
 * erases completely - Vite never resolves a path outside its root, and no
 * Worker code reaches the browser bundle.
 *
 * NOTHING HERE SCORES ANYTHING. There is deliberately no function that compares
 * an answer to a key, because the client is never given a key to compare
 * against. `submitMock` posts option refs and reads back a score.
 */

import type {
  AdminPublishRequest,
  AdminPublishResponse,
  AdminReportQueueResponse,
  AdminTriageRequest,
  AdminTriageResponse,
  ApiError,
  ApiErrorBody,
  ApiResult,
  AttemptHistoryResponse,
  AuditLogResponse,
  BookmarkListResponse,
  BookmarkSetRequest,
  BookmarkSetResponse,
  BootstrapResponse,
  ChapterQuestionsResponse,
  ChapterSummary,
  LoginRequest,
  MockAttemptPaper,
  MockStartRequest,
  MockSubmitRequest,
  MockSubmitResponse,
  MockSyncRequest,
  MockSyncResponse,
  MockTemplateSummary,
  OutboxEntry,
  PracticeAnswerRequest,
  PracticeAnswerResponse,
  PracticeFinishRequest,
  PracticeFinishResponse,
  PracticeSessionPaper,
  PracticeStartRequest,
  ProgressOverview,
  QueuedMutation,
  ReportListResponse,
  ReportStatus,
  ReportSubmitRequest,
  SearchResponse,
  SessionResponse,
  SignupRequest,
  SrsDueResponse,
  SrsReviewRequest,
  SrsReviewResponse,
  UpgradeAnonymousRequest,
} from '../../../worker/src/shared/types.ts';

export type * from '../../../worker/src/shared/types.ts';

// --- Configuration ----------------------------------------------------------

/**
 * Trailing slashes stripped once, here, so every call site can concatenate a
 * leading-slash path without producing a double slash that some proxies 404.
 */
const API_BASE: string = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/**
 * Whether a backend is configured for this build.
 *
 * Call this before reaching for anything in `api`. With no backend, the app
 * falls back to `localData.ts` and keeps working offline-first, which is how it
 * ships today.
 */
export function isBackendConfigured(): boolean {
  return API_BASE.length > 0;
}

export function apiBaseUrl(): string {
  return API_BASE;
}

// --- Transport --------------------------------------------------------------

function clientError(code: ApiError['code'], message: string): { ok: false; error: ApiError } {
  return { ok: false, error: { code, message } };
}

const NOT_CONFIGURED = (): { ok: false; error: ApiError } =>
  clientError(
    'BACKEND_NOT_CONFIGURED',
    'No API base URL is configured for this build; using local data instead.',
  );

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * The single fetch in this module.
 *
 * - `credentials: 'include'`, because the session is an HttpOnly cookie. There
 *   is no token in JS to steal, and nothing for XSS to read.
 * - Never throws for an expected failure. A 4xx comes back as
 *   `{ ok: false, error }` so callers handle it in the same branch as a
 *   validation problem, and a thrown error always means a bug.
 * - A network failure is reported as `NETWORK_UNAVAILABLE`, which is what the
 *   outbox keys its retry decision on.
 */
async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  if (!isBackendConfigured()) return NOT_CONFIGURED();

  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      credentials: 'include',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    // Offline, DNS failure, CORS rejection, or an aborted request. All of them
    // mean "the server did not answer", and all of them are retryable.
    return clientError('NETWORK_UNAVAILABLE', 'Could not reach the server.');
  }

  const replayed = response.headers.get('idempotent-replay') === 'true';

  // A 204 or an empty body is a success with nothing in it.
  const text = await response.text();
  if (text.length === 0) {
    return response.ok
      ? { ok: true, data: undefined as T, replayed }
      : clientError('INTERNAL', `Request failed with status ${response.status}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return clientError('INTERNAL', 'The server returned a malformed response.');
  }

  if (response.ok) return { ok: true, data: parsed as T, replayed };

  const body = parsed as Partial<ApiErrorBody>;
  if (body.error && typeof body.error.code === 'string') {
    return { ok: false, error: body.error };
  }
  return clientError('INTERNAL', `Request failed with status ${response.status}.`);
}

// --- Idempotency keys -------------------------------------------------------

/**
 * A fresh idempotency key.
 *
 * Mint one per logical mutation and then NEVER regenerate it on retry - that is
 * the whole contract. A retry with a new key is a second mutation as far as the
 * server is concerned, which for a mock submission means a 409 and for a
 * practice answer would mean double-counted stats.
 *
 * The charset is restricted to what the Worker's validator accepts
 * (`[A-Za-z0-9_.:-]`, 8-80 characters); `randomUUID` satisfies it.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Older Safari on an insecure origin. Still 128 bits from the CSPRNG.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- Endpoints --------------------------------------------------------------

export const api = {
  // Bootstrap & content
  bootstrap: () => request<BootstrapResponse>('GET', '/api/bootstrap'),

  getChapters: () => request<{ chapters: ChapterSummary[] }>('GET', '/api/content/chapters'),

  getMockTemplates: () =>
    request<{ mockTemplates: MockTemplateSummary[] }>('GET', '/api/content/mock-templates'),

  getChapterQuestions: (chapterId: string, page: { offset?: number; limit?: number } = {}) =>
    request<ChapterQuestionsResponse>(
      'GET',
      `/api/content/chapters/${encodeURIComponent(chapterId)}/questions`,
      { query: { offset: page.offset, limit: page.limit } },
    ),

  search: (q: string, options: { chapterId?: string; limit?: number } = {}) =>
    request<SearchResponse>('GET', '/api/content/search', {
      query: { q, chapterId: options.chapterId, limit: options.limit },
    }),

  // Auth
  getSession: () => request<SessionResponse>('GET', '/api/auth/session'),

  startAnonymousSession: () => request<SessionResponse>('POST', '/api/auth/anonymous'),

  signup: (body: SignupRequest) => request<SessionResponse>('POST', '/api/auth/signup', { body }),

  login: (body: LoginRequest) => request<SessionResponse>('POST', '/api/auth/login', { body }),

  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),

  upgradeAnonymous: (body: UpgradeAnonymousRequest) =>
    request<SessionResponse>('POST', '/api/auth/upgrade', { body }),

  /**
   * Google sign-in is a full-page redirect, not a fetch: the OAuth flow has to
   * run in the browser's top-level context and the callback sets a cookie.
   */
  googleSignInUrl: (redirectTo?: string): string => {
    const url = new URL(`${API_BASE}/api/auth/google/start`);
    if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
    return url.toString();
  },

  // Mock tests
  startMock: (body: MockStartRequest) =>
    request<MockAttemptPaper>('POST', '/api/mock/start', { body }),

  getMockAttempt: (attemptId: string) =>
    request<MockAttemptPaper>('GET', `/api/mock/attempts/${encodeURIComponent(attemptId)}`),

  getMockReview: (attemptId: string) =>
    request<MockSubmitResponse>(
      'GET',
      `/api/mock/attempts/${encodeURIComponent(attemptId)}/review`,
    ),

  syncMock: (body: MockSyncRequest) =>
    request<MockSyncResponse>('POST', '/api/mock/sync', { body }),

  submitMock: (body: MockSubmitRequest) =>
    request<MockSubmitResponse>('POST', '/api/mock/submit', { body }),

  // Practice
  startPractice: (body: PracticeStartRequest) =>
    request<PracticeSessionPaper>('POST', '/api/practice/start', { body }),

  getPracticeSession: (sessionId: string) =>
    request<PracticeSessionPaper>(
      'GET',
      `/api/practice/sessions/${encodeURIComponent(sessionId)}`,
    ),

  answerPractice: (body: PracticeAnswerRequest) =>
    request<PracticeAnswerResponse>('POST', '/api/practice/answer', { body }),

  finishPractice: (body: PracticeFinishRequest) =>
    request<PracticeFinishResponse>('POST', '/api/practice/finish', { body }),

  // Progress
  getProgressOverview: () => request<ProgressOverview>('GET', '/api/progress/overview'),

  getAttemptHistory: (options: { limit?: number; cursor?: string } = {}) =>
    request<AttemptHistoryResponse>('GET', '/api/progress/history', { query: options }),

  // Bookmarks
  getBookmarks: () => request<BookmarkListResponse>('GET', '/api/bookmarks'),

  setBookmark: (body: BookmarkSetRequest) =>
    request<BookmarkSetResponse>('PUT', '/api/bookmarks', { body }),

  // Spaced repetition
  getSrsDue: (options: { limit?: number } = {}) =>
    request<SrsDueResponse>('GET', '/api/srs/due', { query: options }),

  /**
   * `body.revision` is the `revision` the server last reported for this card
   * (`srs_state.reps`). Send it back unchanged: the server applies the review
   * only if it still matches, so a replayed outbox entry or a stale review from
   * a second device is a no-op rather than a conflict. Never invent or
   * increment it client-side.
   */
  reviewSrsCard: (body: SrsReviewRequest) =>
    request<SrsReviewResponse>('POST', '/api/srs/review', { body }),

  // Errata
  submitReport: (body: ReportSubmitRequest) =>
    request<{ reportId: string; created: boolean }>('POST', '/api/reports', { body }),

  getMyReports: () => request<ReportListResponse>('GET', '/api/reports'),

  // Admin
  // `status` is the `ReportStatus` union and not a bare string on purpose: it
  // mirrors the CHECK on `question_reports.status`, so a stale value (the
  // earlier 'fixed', for instance) is a compile error at the call site rather
  // than a 400 at runtime.
  getReportQueue: (options: { status?: ReportStatus; limit?: number; cursor?: string } = {}) =>
    request<AdminReportQueueResponse>('GET', '/api/admin/reports', { query: options }),

  triageReports: (body: AdminTriageRequest) =>
    request<AdminTriageResponse>('POST', '/api/admin/reports/triage', { body }),

  publishQuestions: (body: AdminPublishRequest) =>
    request<AdminPublishResponse>('POST', '/api/admin/questions/publish', { body }),

  getAuditLog: (options: { limit?: number; cursor?: string } = {}) =>
    request<AuditLogResponse>('GET', '/api/admin/audit', { query: options }),
} as const;

// --- The offline outbox -----------------------------------------------------

const OUTBOX_KEY = 'necprep_outbox_v1';
const MAX_OUTBOX_ENTRIES = 500;
const MAX_ATTEMPTS = 8;

/**
 * Error codes a replay will NEVER recover from.
 *
 * Keeping a dead entry in the queue is worse than dropping it: it blocks every
 * later mutation behind it forever, because the drain is ordered. So these are
 * discarded, and `onDropped` is how the UI gets told.
 */
const PERMANENT: ReadonlySet<ApiError['code']> = new Set<ApiError['code']>([
  'BAD_REQUEST',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'ATTEMPT_NOT_IN_PROGRESS',
  'QUESTION_NOT_ON_PAPER',
  'UNKNOWN_OPTION_REF',
  'EMAIL_IN_USE',
  'NOT_ANONYMOUS',
  'INSUFFICIENT_CONTENT',
  'PAYLOAD_TOO_LARGE',
  'UNAUTHENTICATED',
]);

function readOutbox(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is QueuedMutation =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as QueuedMutation).localId === 'string' &&
        typeof (item as QueuedMutation).entry === 'object',
    );
  } catch {
    return [];
  }
}

function writeOutbox(queue: QueuedMutation[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue.slice(0, MAX_OUTBOX_ENTRIES)));
  } catch {
    // Storage full or blocked (private browsing). The mutation is lost, which
    // is bad, but silently corrupting the queue would be worse.
  }
}

export function outboxSize(): number {
  return readOutbox().length;
}

export function outboxEntries(): QueuedMutation[] {
  return readOutbox();
}

export function clearOutbox(): void {
  writeOutbox([]);
}

/**
 * Queues a mutation for replay.
 *
 * THE IDEMPOTENCY KEY IS MINTED HERE AND NOWHERE ELSE. It is stored with the
 * entry, so every replay - this session, after a reload, a week later - sends
 * the same key, and the server either does the work once or replays its stored
 * response. Regenerating the key on retry is the one mistake that breaks the
 * whole contract.
 *
 * Entries that carry no key are the endpoints that are idempotent by
 * construction: `mock.sync` (the map replaces the snapshot), `practice.answer`
 * (unique on session+question), `bookmark.set` (a desired end state),
 * `srs.review` (guarded on a revision counter) and `report.submit` (unique on
 * user+question).
 */
export function enqueue(entry: OutboxEntry): QueuedMutation {
  const withKey = ensureKey(entry);
  const item: QueuedMutation = {
    localId: newIdempotencyKey(),
    entry: withKey,
    enqueuedAt: Date.now(),
    attempts: 0,
    lastError: null,
  };
  writeOutbox([...readOutbox(), item]);
  return item;
}

/**
 * Stamps an entry with a key if it has none.
 *
 * Generic over the body rather than written per-kind, so adding an outbox kind
 * does not mean copying the stamping logic again. Each `case` below is listed
 * separately even though the bodies are identical: grouped case labels widen
 * the discriminated union back into a union of all bodies, and the spread then
 * loses the narrowing.
 */
function withIdempotencyKey<K extends string, B extends { idempotencyKey?: string }>(entry: {
  kind: K;
  body: B;
}): { kind: K; body: B & { idempotencyKey: string } } {
  return entry.body.idempotencyKey
    ? (entry as { kind: K; body: B & { idempotencyKey: string } })
    : { ...entry, body: { ...entry.body, idempotencyKey: newIdempotencyKey() } };
}

function ensureKey(entry: OutboxEntry): OutboxEntry {
  switch (entry.kind) {
    case 'mock.submit':
      return withIdempotencyKey(entry);
    case 'practice.finish':
      return withIdempotencyKey(entry);
    // The rest are already idempotent server-side, but carrying a key turns a
    // replay into a cheap stored-response read instead of a second write.
    case 'practice.answer':
      return withIdempotencyKey(entry);
    case 'bookmark.set':
      return withIdempotencyKey(entry);
    case 'srs.review':
      return withIdempotencyKey(entry);
    case 'report.submit':
      return withIdempotencyKey(entry);
    // `mock.sync` takes no key at all: the answers map REPLACES the stored
    // snapshot, so a replay is already convergent and a key would only add a
    // row to `idempotency_keys` for no benefit.
    case 'mock.sync':
      return entry;
  }
}

async function send(entry: OutboxEntry): Promise<ApiResult<unknown>> {
  switch (entry.kind) {
    case 'mock.sync':
      return await api.syncMock(entry.body);
    case 'mock.submit':
      return await api.submitMock(entry.body);
    case 'practice.answer':
      return await api.answerPractice(entry.body);
    case 'practice.finish':
      return await api.finishPractice(entry.body);
    case 'bookmark.set':
      return await api.setBookmark(entry.body);
    case 'srs.review':
      return await api.reviewSrsCard(entry.body);
    case 'report.submit':
      return await api.submitReport(entry.body);
    default:
      return clientError('BAD_REQUEST', 'Unknown outbox entry.');
  }
}

export interface DrainReport {
  sent: number;
  dropped: number;
  remaining: number;
  /** True when the drain stopped early because the server was unreachable. */
  stalled: boolean;
}

/**
 * Replays queued mutations, oldest first.
 *
 * STRICTLY ORDERED, AND IT STOPS ON THE FIRST RETRYABLE FAILURE. Order matters
 * because a `mock.submit` queued behind a `mock.sync` must not overtake it: the
 * sync is what the expiry clamp scores if the submission turns out to be late.
 * Skipping ahead past a stalled entry would silently change what gets scored.
 *
 * Call it on `online`, on app focus, and after a successful request.
 */
export async function drainOutbox(
  hooks: { onDropped?: (item: QueuedMutation, error: ApiError) => void } = {},
): Promise<DrainReport> {
  if (!isBackendConfigured()) {
    return { sent: 0, dropped: 0, remaining: outboxSize(), stalled: false };
  }

  let queue = readOutbox();
  let sent = 0;
  let dropped = 0;
  let stalled = false;

  while (queue.length > 0) {
    const [head, ...rest] = queue;
    const result = await send(head.entry);

    if (result.ok) {
      sent++;
      queue = rest;
      writeOutbox(queue);
      continue;
    }

    const permanent = PERMANENT.has(result.error.code) || head.attempts + 1 >= MAX_ATTEMPTS;
    if (permanent) {
      dropped++;
      hooks.onDropped?.(head, result.error);
      queue = rest;
      writeOutbox(queue);
      continue;
    }

    // Retryable: record the attempt and stop, preserving order.
    queue = [{ ...head, attempts: head.attempts + 1, lastError: result.error.code }, ...rest];
    writeOutbox(queue);
    stalled = true;
    break;
  }

  return { sent, dropped, remaining: queue.length, stalled };
}

/**
 * Posts a mutation now, falling back to the outbox if the server cannot be
 * reached. Returns the live result when there was one.
 *
 * This is the function most call sites want: it keeps the optimistic path fast
 * and makes the offline path automatic, with the same key used for both, so the
 * eventual replay cannot duplicate a mutation that actually did land.
 */
export async function sendOrQueue(
  entry: OutboxEntry,
): Promise<{ queued: boolean; result: ApiResult<unknown> }> {
  const withKey = ensureKey(entry);
  const result = await send(withKey);

  if (result.ok) return { queued: false, result };

  if (result.error.code === 'NETWORK_UNAVAILABLE' || result.error.code === 'RATE_LIMITED') {
    writeOutbox([
      ...readOutbox(),
      {
        localId: newIdempotencyKey(),
        entry: withKey,
        enqueuedAt: Date.now(),
        attempts: 1,
        lastError: result.error.code,
      },
    ]);
    return { queued: true, result };
  }

  return { queued: false, result };
}

// --- Timer helper -----------------------------------------------------------

/**
 * Converts the server's deadline into a countdown the UI can render.
 *
 * The `expiresAt` and `serverNow` on a `MockAttemptPaper` are both SERVER
 * values, so this measures against the server's clock plus the elapsed time on
 * this device, not against `Date.now()` directly. A device whose clock is
 * hours off still renders a truthful countdown - and, more to the point,
 * freezing or faking the local clock changes only what is DISPLAYED. The
 * scoring deadline is enforced server-side regardless of what the timer shows.
 */
export function remainingMs(paper: {
  expiresAt: number;
  serverNow: number;
}, monotonicStart: number = performance.now()): number {
  const elapsed = performance.now() - monotonicStart;
  return Math.max(0, paper.expiresAt - paper.serverNow - elapsed);
}
