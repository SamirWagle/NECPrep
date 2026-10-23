/**
 * The Worker entry point: Hono wiring and nothing else.
 *
 * Every route in this file does exactly four things - validate, build a
 * context, call ONE handler from `handlers/`, serialise the result. No route
 * contains a branch on business state, no route writes SQL, and no route reads
 * `question_options`. That is deliberate: it is what lets the entire real logic
 * path be tested under `node --test` against a local SQLite database without
 * Hono, a Worker runtime, or a network.
 *
 * NOTE ON DEPENDENCIES. `hono` is imported here and in nowhere else. It is not
 * yet in a package manifest - `worker/package.json` and `worker/wrangler.toml`
 * are owned outside this change - so this single file will not type-check or
 * bundle until `npm i hono` has been run in `worker/`. Everything the tests
 * cover is reachable without it.
 */

import { Hono } from 'hono';

import { Db } from './data/d1.ts';
import { loadConfig } from './env.ts';
import type { Env } from './env.ts';
import { systemClock } from './lib/time.ts';
import { handleScheduled, type ScheduledEventLike } from './jobs/index.ts';
import { resolveEmailSender } from './lib/email.ts';
import { readCookie, SESSION_COOKIE } from './lib/cookies.ts';
import { toErrorResponse } from './shared/errors.ts';
import type { HandlerContext, HandlerResult } from './handlers/context.ts';
import { hashIp, resolveSession } from './handlers/auth.ts';
import * as auth from './handlers/auth.ts';
import * as content from './handlers/content.ts';
import * as mock from './handlers/mock.ts';
import * as practice from './handlers/practice.ts';
import * as progress from './handlers/progress.ts';
import * as moderation from './handlers/moderation.ts';
import { pathId, queryObject, readJsonBody, validate } from './middleware/validate.ts';
import {
  adminPublishSchema,
  adminQueueQuerySchema,
  adminTriageSchema,
  auditQuerySchema,
  bookmarkSetSchema,
  chapterQuestionsQuerySchema,
  googleCallbackSchema,
  historyQuerySchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  mockStartSchema,
  mockSubmitSchema,
  mockSyncSchema,
  practiceAnswerSchema,
  practiceFinishSchema,
  practiceStartSchema,
  reportSubmitSchema,
  searchQuerySchema,
  signupSchema,
  srsDueQuerySchema,
  srsReviewSchema,
  upgradeAnonymousSchema,
} from './validation/schemas.ts';

type Vars = { ctx: HandlerContext };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

/**
 * Builds the handler context, once per request.
 *
 * Costs 1 D1 query when a session cookie is present and 0 when it is not. The
 * session touch is applied here, and only when it is actually due, so a
 * `last_seen_at` write does not land on every authenticated request - at 100k
 * row writes a day, that would be a meaningful slice of the budget spent on
 * liveness alone.
 */
app.use('/api/*', async (c, next) => {
  const config = loadConfig(c.env);
  const db = new Db(c.env.DB, { budget: config.queryBudget });

  const ipHash = await hashIp(
    c.req.header('cf-connecting-ip') ?? null,
    config.permutationSecret,
  );

  const sessionId = readCookie(c.req.header('cookie') ?? null, SESSION_COOKIE);
  const resolved = await resolveSession({ db, clock: systemClock }, sessionId);

  if (resolved.touch) {
    await db.batch([resolved.touch]);
  }

  const ctx: HandlerContext = {
    db,
    clock: systemClock,
    config,
    auth: resolved.auth,
    meta: { ipHash, userAgent: c.req.header('user-agent') ?? null },
    cookies: [],
  };

  c.set('ctx', ctx);
  await next();
});

/** CORS for the configured app origin only. No wildcard, ever. */
app.use('/api/*', async (c, next) => {
  const config = loadConfig(c.env);
  const origin = c.req.header('origin');

  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin, config.appOrigin),
    });
  }

  await next();

  for (const [name, value] of Object.entries(corsHeaders(origin, config.appOrigin))) {
    c.res.headers.set(name, value);
  }
});

function corsHeaders(origin: string | undefined, appOrigin: string): Record<string, string> {
  // Credentials are cookies, so `Access-Control-Allow-Origin` cannot be `*`.
  // An unrecognised origin gets no CORS headers at all, which the browser turns
  // into a blocked request - the correct outcome.
  // `Cookie` as well as `Origin`: `send` sets both, and this runs afterwards,
  // so returning only `Origin` here would quietly drop the half that keeps a
  // personalised response from being shared between sessions.
  if (origin !== appOrigin) return { vary: 'Origin, Cookie' };
  return {
    'access-control-allow-origin': appOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin, Cookie',
  };
}

/**
 * Serialises a handler result, attaching cookies, the replay marker, and the
 * measured D1 cost.
 *
 * `X-D1-Queries` is on every response on purpose: the per-invocation query
 * limit is the tightest constraint this platform has, and a number in a
 * response header is the difference between knowing the cost and guessing it.
 */
/**
 * Every API response is `no-store` unless a handler says otherwise.
 *
 * The default used to be NOTHING - no `Cache-Control` at all, on every
 * endpoint including `GET /api/auth/session`, which answers "who is signed in
 * on this browser". A response with no cache directives is not forbidden from
 * being stored; it is left to heuristics, and the caches that apply those
 * heuristics include corporate proxies and anything a Cloudflare Cache Rule
 * might later be pointed at. The failure mode is one student being served
 * another student's identity, which is the worst bug this platform could
 * have.
 *
 * `no-store` rather than `no-cache`: `no-cache` permits storing and requires
 * revalidation, which still leaves a copy of a personalised response on disk.
 *
 * `Vary: Cookie` is belt and braces. With `no-store` nothing should be stored
 * at all, but if a future change relaxes an endpoint to `public`, varying on
 * the session cookie is what stops that relaxation becoming a leak.
 */
const PRIVATE_CACHE = 'no-store';

function send<T>(ctx: HandlerContext, result: HandlerResult<T>): Response {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  for (const cookie of ctx.cookies) headers.append('set-cookie', cookie);
  headers.set('x-d1-queries', String(ctx.db.queryCount));
  headers.set('cache-control', result.cacheControl ?? PRIVATE_CACHE);
  // `Origin` is already varied on by the CORS layer; `Cookie` is added here so
  // the two travel together on every response rather than only the ones a
  // middleware happened to touch.
  headers.set('vary', 'Origin, Cookie');
  if (result.replayed) headers.set('idempotent-replay', 'true');

  // A 302 from `googleStart` / `googleCallback` carries its target in the body.
  if (result.status === 302 && typeof result.body === 'object' && result.body !== null) {
    const location = (result.body as { location?: unknown }).location;
    if (typeof location === 'string') {
      headers.set('location', location);
      return new Response(null, { status: 302, headers });
    }
  }

  return new Response(JSON.stringify(result.body), { status: result.status, headers });
}

/** The single error boundary. Nothing below it leaks a D1 message. */
app.onError((err, c) => {
  const { status, body, logMessage } = toErrorResponse(err);
  console.error(`[api] ${c.req.method} ${c.req.path} -> ${status}: ${logMessage}`);

  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8' });
  // An error can carry a rate-limit state or a validation message about a
  // specific account; none of it should be stored anywhere.
  headers.set('cache-control', PRIVATE_CACHE);
  headers.set('vary', 'Origin, Cookie');
  const ctx = c.get('ctx') as HandlerContext | undefined;
  if (ctx) {
    for (const cookie of ctx.cookies) headers.append('set-cookie', cookie);
    headers.set('x-d1-queries', String(ctx.db.queryCount));
  }
  if (body.error.retryAfterMs !== undefined) {
    headers.set('retry-after', String(Math.ceil(body.error.retryAfterMs / 1000)));
  }

  return new Response(JSON.stringify(body), { status, headers });
});

// The 404 needs the same directives as everything else. It is the one
// response an unauthenticated prober sees most of, and the path it names is
// attacker-controlled - there is nothing here worth any cache keeping.
app.notFound(
  () =>
    new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } }), {
      status: 404,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': PRIVATE_CACHE,
        vary: 'Origin, Cookie',
      },
    }),
);

// --- Bootstrap & content ----------------------------------------------------

app.get('/api/bootstrap', async (c) => {
  const ctx = c.get('ctx');
  return send(ctx, await content.bootstrap(ctx));
});

app.get('/api/content/chapters', async (c) => {
  const ctx = c.get('ctx');
  return send(ctx, await content.getChapters(ctx));
});

app.get('/api/content/mock-templates', async (c) => {
  const ctx = c.get('ctx');
  return send(ctx, await content.getMockTemplates(ctx));
});

app.get('/api/content/chapters/:chapterId/questions', async (c) => {
  const ctx = c.get('ctx');
  const input = validate(chapterQuestionsQuerySchema, {
    ...queryObject(new URL(c.req.url), ['offset', 'limit']),
    chapterId: pathId(c.req.param('chapterId'), 'chapterId'),
  });
  return send(ctx, await content.getChapterQuestions(ctx, input));
});

app.get('/api/content/search', async (c) => {
  const ctx = c.get('ctx');
  const input = validate(searchQuerySchema, queryObject(new URL(c.req.url), ['limit']));
  return send(ctx, await content.search(ctx, input));
});

// --- Auth -------------------------------------------------------------------

app.get('/api/auth/session', async (c) => {
  const ctx = c.get('ctx');
  return send(ctx, await auth.readSession(ctx));
});

app.post('/api/auth/anonymous', async (c) => {
  const ctx = c.get('ctx');
  return send(ctx, await auth.startAnonymousSession(ctx));
});

app.post('/api/auth/signup', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, signupSchema);
  return send(ctx, await auth.signup(ctx, input));
});

app.post('/api/auth/login', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, loginSchema);
  return send(ctx, await auth.login(ctx, input));
});

app.post('/api/auth/password/request', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, passwordResetRequestSchema);
  // The sender is resolved per request rather than held in `Config`, because
  // it closes over `fetch` and the tests inject their own.
  return send(ctx, await auth.requestPasswordReset(ctx, input, resolveEmailSender(c.env)));
});

app.post('/api/auth/password/reset', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, passwordResetSchema);
  return send(ctx, await auth.resetPassword(ctx, input));
});

app.post('/api/auth/logout', async (c) => {
  const ctx = c.get('ctx');
  return send(ctx, await auth.logout(ctx));
});

app.post('/api/auth/upgrade', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, upgradeAnonymousSchema);
  return send(ctx, await auth.upgradeAnonymous(ctx, input));
});

app.get('/api/auth/google/start', async (c) => {
  const ctx = c.get('ctx');
  const redirectTo = new URL(c.req.url).searchParams.get('redirect_to');
  return send(ctx, await auth.googleStart(ctx, redirectTo));
});

app.get('/api/auth/google/callback', async (c) => {
  const ctx = c.get('ctx');
  const input = validate(googleCallbackSchema, queryObject(new URL(c.req.url)));
  return send(ctx, await auth.googleCallback(ctx, input, globalThis.fetch as never));
});

// --- Mock -------------------------------------------------------------------

app.post('/api/mock/start', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, mockStartSchema);
  return send(ctx, await mock.startMock(ctx, input));
});

app.get('/api/mock/attempts/:attemptId', async (c) => {
  const ctx = c.get('ctx');
  const attemptId = pathId(c.req.param('attemptId'), 'attemptId');
  return send(ctx, await mock.getMockAttempt(ctx, attemptId));
});

app.get('/api/mock/attempts/:attemptId/review', async (c) => {
  const ctx = c.get('ctx');
  const attemptId = pathId(c.req.param('attemptId'), 'attemptId');
  return send(ctx, await mock.getMockReview(ctx, attemptId));
});

app.post('/api/mock/sync', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, mockSyncSchema);
  return send(ctx, await mock.syncMock(ctx, input));
});

app.post('/api/mock/submit', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, mockSubmitSchema);
  return send(ctx, await mock.submitMock(ctx, input));
});

// --- Practice ---------------------------------------------------------------

app.post('/api/practice/start', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, practiceStartSchema);
  return send(ctx, await practice.startPractice(ctx, input));
});

app.get('/api/practice/sessions/:sessionId', async (c) => {
  const ctx = c.get('ctx');
  const sessionId = pathId(c.req.param('sessionId'), 'sessionId');
  return send(ctx, await practice.getPracticeSession(ctx, sessionId));
});

app.post('/api/practice/answer', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, practiceAnswerSchema);
  return send(ctx, await practice.answerPractice(ctx, input));
});

app.post('/api/practice/finish', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, practiceFinishSchema);
  return send(ctx, await practice.finishPractice(ctx, input));
});

// --- Progress, bookmarks, SRS ----------------------------------------------

app.get('/api/progress/overview', async (c) => {
  const ctx = c.get('ctx');
  return send(ctx, await progress.getProgressOverview(ctx));
});

app.get('/api/progress/history', async (c) => {
  const ctx = c.get('ctx');
  const input = validate(historyQuerySchema, queryObject(new URL(c.req.url), ['limit']));
  return send(ctx, await progress.getAttemptHistory(ctx, input));
});

app.get('/api/bookmarks', async (c) => {
  const ctx = c.get('ctx');
  return send(ctx, await progress.getBookmarks(ctx));
});

app.put('/api/bookmarks', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, bookmarkSetSchema);
  return send(ctx, await progress.putBookmark(ctx, input));
});

app.get('/api/srs/due', async (c) => {
  const ctx = c.get('ctx');
  const input = validate(srsDueQuerySchema, queryObject(new URL(c.req.url), ['limit']));
  return send(ctx, await progress.getSrsDue(ctx, input));
});

app.post('/api/srs/review', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, srsReviewSchema);
  return send(ctx, await progress.reviewSrsCard(ctx, input));
});

// --- Reports ----------------------------------------------------------------

app.post('/api/reports', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, reportSubmitSchema);
  return send(ctx, await moderation.submitErrataReport(ctx, input));
});

app.get('/api/reports', async (c) => {
  const ctx = c.get('ctx');
  return send(ctx, await moderation.listMyReports(ctx));
});

// --- Admin ------------------------------------------------------------------

app.get('/api/admin/reports', async (c) => {
  const ctx = c.get('ctx');
  const input = validate(adminQueueQuerySchema, queryObject(new URL(c.req.url), ['limit']));
  return send(ctx, await moderation.getReportQueue(ctx, input));
});

app.post('/api/admin/reports/triage', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, adminTriageSchema);
  return send(ctx, await moderation.triage(ctx, input));
});

app.post('/api/admin/questions/publish', async (c) => {
  const ctx = c.get('ctx');
  const input = await readJsonBody(c.req.raw, adminPublishSchema);
  return send(ctx, await moderation.publishQuestions(ctx, input));
});

app.get('/api/admin/audit', async (c) => {
  const ctx = c.get('ctx');
  const input = validate(auditQuerySchema, queryObject(new URL(c.req.url), ['limit']));
  return send(ctx, await moderation.getAuditLog(ctx, input));
});

/**
 * The Worker's two entry points.
 *
 * Exporting the Hono app directly gave Cloudflare a `fetch` handler and no
 * `scheduled` handler, so all three declared crons fired into nothing. They
 * are routed by cron expression in `src/jobs/`.
 */
export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledEventLike, env: Env): Promise<void> => {
    await handleScheduled(event, env);
  },
};
