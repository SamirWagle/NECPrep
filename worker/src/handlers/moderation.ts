/**
 * Errata reports (user-facing) and the admin surface behind a role check.
 *
 * The bank is known to contain wrong keys - `frontend/src/data/quarantine.json`
 * lists 40-odd that a validator already caught, and the frontend currently
 * filters them out at read time with a hardcoded list. Reports plus
 * `POST /api/admin/questions/publish` replace that hardcoded list with a
 * workflow, and every admin mutation writes an audit row in the SAME batch as
 * the mutation, so there is no path that changes published content silently.
 */

import { fail } from '../shared/errors.ts';
import {
  listOwnReports,
  readAuditLog,
  readReportQueue,
  setQuestionState,
  submitReport,
  triageReports,
} from '../data/moderation.ts';
import { consumeRateLimit, RATE_LIMITS } from '../data/infra.ts';
import { ok, requireAdmin, requireUser, withIdempotency } from './context.ts';
import type { HandlerContext, HandlerResult } from './context.ts';
import type {
  AdminPublishResponse,
  AdminReportQueueResponse,
  AdminTriageResponse,
  AuditLogResponse,
  ReportListResponse,
} from '../shared/types.ts';
import type {
  AdminPublishInput,
  AdminQueueInput,
  AdminTriageInput,
  AuditInput,
  ReportSubmitInput,
} from '../validation/schemas.ts';

/**
 * POST /api/reports - 3 D1 queries.
 *
 * Idempotent WITHOUT a key, through the unique index on
 * `(user_id, question_id)`: re-reporting the same question updates the existing
 * report instead of filling the triage queue with duplicates, so a replayed
 * offline mutation converges. The optional key is accepted for uniformity.
 */
export async function submitErrataReport(
  ctx: HandlerContext,
  input: ReportSubmitInput,
): Promise<HandlerResult<{ reportId: string; created: boolean }>> {
  const auth = requireUser(ctx);
  const now = ctx.clock.now();

  const limit = await consumeRateLimit(ctx.db, RATE_LIMITS.report, auth.user.id, now);
  if (!limit.allowed) {
    fail('RATE_LIMITED', 'Too many reports. Try again later.', {
      retryAfterMs: limit.retryAfterMs,
    });
  }

  const result = await submitReport(ctx.db, {
    userId: auth.user.id,
    questionId: input.questionId,
    reason: input.reason,
    detail: input.detail ?? null,
    now,
  });

  // The INSERT selects from `questions`, so a nonexistent question id writes
  // nothing and returns nothing rather than creating an orphan report.
  if (!result) fail('NOT_FOUND', 'That question does not exist.');

  return ok({ reportId: result.id, created: result.created });
}

/** GET /api/reports - 1 D1 query. Scoped to the caller. */
export async function listMyReports(
  ctx: HandlerContext,
): Promise<HandlerResult<ReportListResponse>> {
  const auth = requireUser(ctx);
  return ok<ReportListResponse>({ items: await listOwnReports(ctx.db, auth.user.id) });
}

// --- Admin ------------------------------------------------------------------

/** GET /api/admin/reports - 1 D1 query. Moderator or admin. */
export async function getReportQueue(
  ctx: HandlerContext,
  input: AdminQueueInput,
): Promise<HandlerResult<AdminReportQueueResponse>> {
  requireAdmin(ctx);

  const before = parseCursor(input.cursor);
  const items = await readReportQueue(ctx.db, {
    status: input.status,
    limit: input.limit,
    beforeCreatedAt: before,
  });

  return ok<AdminReportQueueResponse>({
    items,
    nextCursor:
      items.length === input.limit ? String(items[items.length - 1].createdAt) : null,
  });
}

function parseCursor(cursor: string | undefined): number | null {
  if (cursor === undefined) return null;
  const parsed = Number.parseInt(cursor, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail('BAD_REQUEST', 'Invalid cursor.', { fields: { cursor: 'Malformed.' } });
  }
  return parsed;
}

/**
 * POST /api/admin/reports/triage - 4 D1 queries for any batch size.
 *
 * idempotency 2, update + audit 2 (one batch). Up to 100 report ids travel as
 * one JSON parameter, so bulk triage does not scale with the number of rows.
 */
export async function triage(
  ctx: HandlerContext,
  input: AdminTriageInput,
): Promise<HandlerResult<AdminTriageResponse>> {
  const auth = requireAdmin(ctx);

  return await withIdempotency(
    ctx,
    {
      userId: auth.user.id,
      key: input.idempotencyKey,
      endpoint: 'POST /api/admin/reports/triage',
      body: input,
    },
    async () => {
      const updated = await triageReports(ctx.db, {
        actorUserId: auth.user.id,
        reportIds: input.reportIds,
        status: input.status,
        resolutionNote: input.resolutionNote ?? null,
        now: ctx.clock.now(),
      });
      return ok<AdminTriageResponse>({ updated, status: input.status });
    },
  );
}

/**
 * POST /api/admin/questions/publish - 4 D1 queries for any batch size.
 *
 * Publishing, drafting or retiring in bulk. Retiring is the lever that takes a
 * known-bad question out of every future paper WITHOUT deleting the attempts
 * already recorded against it - which is why `questions.status` is a state and
 * not a DELETE.
 *
 * Admin only, not moderator: this changes what candidates sit.
 */
export async function publishQuestions(
  ctx: HandlerContext,
  input: AdminPublishInput,
): Promise<HandlerResult<AdminPublishResponse>> {
  const auth = requireAdmin(ctx);
  if (auth.user.role !== 'admin') {
    fail('FORBIDDEN', 'Publishing requires an admin role.');
  }

  return await withIdempotency(
    ctx,
    {
      userId: auth.user.id,
      key: input.idempotencyKey,
      endpoint: 'POST /api/admin/questions/publish',
      body: input,
    },
    async () => {
      const updated = await setQuestionState(ctx.db, {
        actorUserId: auth.user.id,
        questionIds: input.questionIds,
        state: input.state,
        now: ctx.clock.now(),
      });
      return ok<AdminPublishResponse>({ updated, state: input.state });
    },
  );
}

/** GET /api/admin/audit - 1 D1 query. */
export async function getAuditLog(
  ctx: HandlerContext,
  input: AuditInput,
): Promise<HandlerResult<AuditLogResponse>> {
  requireAdmin(ctx);

  const items = await readAuditLog(ctx.db, {
    limit: input.limit,
    beforeCreatedAt: parseCursor(input.cursor),
  });

  return ok<AuditLogResponse>({
    items,
    nextCursor:
      items.length === input.limit ? String(items[items.length - 1].createdAt) : null,
  });
}
