/**
 * Errata reports, admin triage, question publishing and the audit log.
 *
 * The bank is known to contain wrong keys - `frontend/src/data/quarantine.json`
 * lists the ones a validator already caught - so user-submitted errata is a
 * content pipeline, not a nice-to-have. Every admin mutation writes an audit row
 * in the same batch as the mutation itself, so there is no path that changes
 * published content without leaving a trace.
 */

import { Db, sql } from './d1.ts';
import type { PendingStatement } from './d1.ts';
import { T } from './tables.ts';
import { newId } from '../lib/ids.ts';
import type {
  AdminReportItem,
  AuditLogItem,
  QuestionPublishState,
  ReportItem,
  ReportReason,
  ReportStatus,
} from '../shared/types.ts';

function toReason(raw: string): ReportReason {
  switch (raw) {
    case 'wrong_answer':
    case 'ambiguous':
    case 'typo':
    case 'duplicate':
    case 'out_of_syllabus':
      return raw;
    default:
      return 'other';
  }
}

function toStatus(raw: string): ReportStatus {
  switch (raw) {
    case 'triaged':
    case 'accepted':
    case 'rejected':
    case 'fixed':
      return raw;
    default:
      return 'open';
  }
}

// --- User-facing ------------------------------------------------------------

/**
 * Files an errata report. 1 query.
 *
 * The unique index on `(user_id, question_id)` makes this idempotent on its
 * own: a user re-reporting the same question updates their existing report
 * rather than filling the triage queue with duplicates, and a replayed offline
 * mutation converges. That is why the endpoint's idempotency key is optional.
 */
export async function submitReport(
  db: Db,
  args: {
    userId: string;
    questionId: string;
    reason: ReportReason;
    detail: string | null;
    now: number;
  },
): Promise<{ id: string; created: boolean } | null> {
  const id = newId('rep');
  const row = await db.first<{ id: string; created_at: number }>(
    `INSERT INTO ${T.questionReports}
       (id, user_id, question_id, chapter_id, reason, detail, status,
        created_at, resolved_at, resolved_by, resolution_note)
     SELECT ?1, ?2, q.id, q.chapter_id, ?3, ?4, 'open', ?5, NULL, NULL, NULL
       FROM ${T.questions} q
      WHERE q.id = ?6
     ON CONFLICT (user_id, question_id) DO UPDATE SET
       reason = excluded.reason,
       detail = excluded.detail,
       status = CASE WHEN ${T.questionReports}.status IN ('open', 'triaged')
                     THEN 'open' ELSE ${T.questionReports}.status END
     RETURNING id, created_at`,
    id,
    args.userId,
    args.reason,
    args.detail,
    args.now,
    args.questionId,
  );

  if (!row) return null;
  return { id: row.id, created: row.id === id };
}

/** 1 query. Scoped to the caller. */
export async function listOwnReports(db: Db, userId: string): Promise<ReportItem[]> {
  const rows = await db.all<{
    id: string;
    question_id: string;
    chapter_id: string;
    reason: string;
    detail: string | null;
    status: string;
    created_at: number;
    resolution_note: string | null;
  }>(
    `SELECT id, question_id, chapter_id, reason, detail, status,
            created_at, resolution_note
       FROM ${T.questionReports}
      WHERE user_id = ?1
      ORDER BY created_at DESC
      LIMIT 200`,
    userId,
  );

  return rows.map((r) => ({
    id: r.id,
    questionId: r.question_id,
    chapterId: r.chapter_id,
    reason: toReason(r.reason),
    detail: r.detail,
    status: toStatus(r.status),
    createdAt: r.created_at,
    resolutionNote: r.resolution_note,
  }));
}

// --- Admin ------------------------------------------------------------------

/**
 * The triage queue. 1 query.
 *
 * Carries `reportCountForQuestion` from a correlated subquery so a question
 * five people have flagged sorts to the top, instead of needing a second pass
 * over the queue to work that out.
 */
export async function readReportQueue(
  db: Db,
  args: { status: ReportStatus; limit: number; beforeCreatedAt: number | null },
): Promise<AdminReportItem[]> {
  const rows = await db.all<{
    id: string;
    user_id: string;
    question_id: string;
    chapter_id: string;
    reason: string;
    detail: string | null;
    status: string;
    created_at: number;
    resolution_note: string | null;
    stem: string;
    report_count: number;
  }>(
    `SELECT r.id, r.user_id, r.question_id, r.chapter_id, r.reason, r.detail,
            r.status, r.created_at, r.resolution_note, q.stem,
            (SELECT COUNT(*) FROM ${T.questionReports} r2
              WHERE r2.question_id = r.question_id
                AND r2.status IN ('open', 'triaged')) AS report_count
       FROM ${T.questionReports} r
       JOIN ${T.questions} q ON q.id = r.question_id
      WHERE r.status = ?1 AND r.created_at < ?2
      ORDER BY report_count DESC, r.created_at DESC
      LIMIT ?3`,
    args.status,
    args.beforeCreatedAt ?? Number.MAX_SAFE_INTEGER,
    args.limit,
  );

  return rows.map((r) => ({
    id: r.id,
    reporterUserId: r.user_id,
    questionId: r.question_id,
    chapterId: r.chapter_id,
    reason: toReason(r.reason),
    detail: r.detail,
    status: toStatus(r.status),
    createdAt: r.created_at,
    resolutionNote: r.resolution_note,
    stem: r.stem,
    reportCountForQuestion: r.report_count,
  }));
}

export function auditStatement(args: {
  actorUserId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  detail: unknown;
  now: number;
}): PendingStatement {
  return sql(
    `INSERT INTO ${T.auditLog}
       (id, actor_user_id, action, entity_type, entity_id, detail, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    newId('aud'),
    args.actorUserId,
    args.action,
    args.entityType,
    args.entityId,
    args.detail === undefined || args.detail === null
      ? null
      : JSON.stringify(args.detail).slice(0, 4000),
    args.now,
  );
}

/**
 * Bulk triage. 2 statements, ONE batch.
 *
 * The id list travels as one JSON parameter, so triaging 100 reports is still a
 * single statement under D1's 100-bound-parameter ceiling.
 */
export async function triageReports(
  db: Db,
  args: {
    actorUserId: string;
    reportIds: readonly string[];
    status: ReportStatus;
    resolutionNote: string | null;
    now: number;
  },
): Promise<number> {
  const resolved = args.status === 'accepted' || args.status === 'rejected' || args.status === 'fixed';

  const results = await db.batch([
    sql(
      `UPDATE ${T.questionReports}
          SET status = ?2,
              resolution_note = COALESCE(?3, resolution_note),
              resolved_at = CASE WHEN ?4 = 1 THEN ?5 ELSE NULL END,
              resolved_by = CASE WHEN ?4 = 1 THEN ?6 ELSE NULL END
        WHERE id IN (SELECT value FROM json_each(?1))`,
      JSON.stringify(args.reportIds),
      args.status,
      args.resolutionNote,
      resolved ? 1 : 0,
      args.now,
      args.actorUserId,
    ),
    auditStatement({
      actorUserId: args.actorUserId,
      action: 'report.triage',
      entityType: 'question_report',
      entityId: null,
      detail: { reportIds: args.reportIds, status: args.status },
      now: args.now,
    }),
  ]);

  return results[0]?.meta.changes ?? 0;
}

/**
 * Publishes, drafts or retires questions in bulk. 2 statements, ONE batch.
 *
 * Retiring a question is the lever that takes a known-bad item out of every
 * future paper without deleting the history of attempts against it, which is
 * what the quarantine list in the current frontend is doing by hand.
 */
export async function setQuestionState(
  db: Db,
  args: {
    actorUserId: string;
    questionIds: readonly string[];
    state: QuestionPublishState;
    now: number;
  },
): Promise<number> {
  const results = await db.batch([
    sql(
      `UPDATE ${T.questions}
          SET status = ?2, updated_at = ?3
        WHERE id IN (SELECT value FROM json_each(?1))`,
      JSON.stringify(args.questionIds),
      args.state,
      args.now,
    ),
    auditStatement({
      actorUserId: args.actorUserId,
      action: 'question.set_state',
      entityType: 'question',
      entityId: null,
      detail: { questionIds: args.questionIds, state: args.state },
      now: args.now,
    }),
  ]);

  return results[0]?.meta.changes ?? 0;
}

/** 1 query. */
export async function readAuditLog(
  db: Db,
  args: { limit: number; beforeCreatedAt: number | null },
): Promise<AuditLogItem[]> {
  const rows = await db.all<{
    id: string;
    actor_user_id: string | null;
    action: string;
    entity_type: string | null;
    entity_id: string | null;
    detail: string | null;
    created_at: number;
  }>(
    `SELECT id, actor_user_id, action, entity_type, entity_id, detail, created_at
       FROM ${T.auditLog}
      WHERE created_at < ?1
      ORDER BY created_at DESC
      LIMIT ?2`,
    args.beforeCreatedAt ?? Number.MAX_SAFE_INTEGER,
    args.limit,
  );

  return rows.map((r) => ({
    id: r.id,
    actorUserId: r.actor_user_id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    detail: r.detail,
    createdAt: r.created_at,
  }));
}
