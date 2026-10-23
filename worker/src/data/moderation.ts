/**
 * Errata reports, admin triage, question publishing and the audit log.
 *
 * The bank is known to contain wrong keys - the importer's own validator files
 * 106 of them as `question_reports` rows with `source = 'validator'` on every
 * seed - so user-submitted errata is a content pipeline, not a nice-to-have.
 * Every admin mutation writes an audit row in the same batch as the mutation
 * itself, so there is no path that changes published content without leaving a
 * trace.
 *
 * TWO IDS AGAIN. `question_reports.id` is an INTEGER rowid; `public_id` is the
 * ULID in URLs and the only one this API emits. `admin_audit_log.id` is a rowid
 * with no public form at all, and the API stringifies it: the audit log is
 * admin-only and append-only, so there is nothing an enumerable id there
 * exposes that the reader cannot already list.
 *
 * ONE TABLE FOR BOTH KINDS OF FINDING. A user's report and the importer's
 * validator finding are the same object -- a claim that a question is
 * defective, awaiting adjudication -- so they share a table and a queue, with
 * `source` distinguishing them. `reporter_user_id` is NULL for a machine
 * finding, which is what keeps the triage inbox honest about which rows a
 * person is waiting on an answer for.
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
  UserRole,
} from '../shared/types.ts';

/**
 * `question_reports.category` is wider than the wire `ReportReason`: it also
 * carries 'bad_option', which only the importer's validator files. An
 * unrecognised value reads as 'other' rather than throwing, because a report
 * row is evidence and a display mapping must never be the reason a moderator
 * cannot see it.
 */
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
    case 'duplicate':
      return raw;
    default:
      return 'open';
  }
}

/** Statuses that resolve a report, matching the CHECK on `resolved_at`. */
const RESOLVING: ReadonlySet<ReportStatus> = new Set<ReportStatus>([
  'accepted',
  'rejected',
  'duplicate',
]);

// --- User-facing ------------------------------------------------------------

/**
 * Files an errata report. 1 query.
 *
 * The PARTIAL unique index on `(question_id, reporter_user_id) WHERE status =
 * 'open' AND reporter_user_id IS NOT NULL` makes this idempotent on its own: a
 * user re-reporting the same question updates their existing open report rather
 * than filling the triage queue with duplicates, and a replayed offline
 * mutation converges. That is why the endpoint's idempotency key is optional.
 *
 * The conflict target restates the index predicate, which is not optional:
 * SQLite matches a conflict target to a partial unique index only if the
 * predicate is repeated, and omitting it fails at `prepare()` time with "ON
 * CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint" -- at
 * runtime, on the first report anyone files.
 *
 * `SELECT ... FROM questions` rather than `VALUES`, so a nonexistent question
 * id writes nothing and returns nothing instead of creating an orphan report.
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
  const publicId = newId('rep');
  const row = await db.first<{ public_id: string }>(
    `INSERT INTO ${T.questionReports}
       (public_id, question_id, reporter_user_id, source, category, code, detail,
        suggested_option_id, attempt_id, status, resolution, resolved_by,
        resolved_at, created_at, updated_at)
     SELECT ?1, q.id, ?2, 'user', ?3, NULL, ?4, NULL, NULL, 'open', NULL, NULL,
            NULL, ?5, ?5
       FROM ${T.questions} q
      WHERE q.id = ?6
     ON CONFLICT (question_id, reporter_user_id)
       WHERE status = 'open' AND reporter_user_id IS NOT NULL
       DO UPDATE SET
         category   = excluded.category,
         detail     = excluded.detail,
         updated_at = excluded.updated_at
     RETURNING public_id`,
    publicId,
    args.userId,
    args.reason,
    args.detail,
    args.now,
    args.questionId,
  );

  if (!row) return null;
  return { id: row.public_id, created: row.public_id === publicId };
}

const REPORT_SELECT = `r.public_id AS id, r.question_id, q.chapter_id, r.category,
                       r.detail, r.status, r.created_at, r.resolution`;

interface ReportRowShape {
  id: string;
  question_id: string;
  chapter_id: string;
  category: string;
  detail: string | null;
  status: string;
  created_at: number;
  resolution: string | null;
}

function toReportItem(r: ReportRowShape): ReportItem {
  return {
    id: r.id,
    questionId: r.question_id,
    chapterId: r.chapter_id,
    reason: toReason(r.category),
    detail: r.detail,
    status: toStatus(r.status),
    createdAt: r.created_at,
    resolutionNote: r.resolution,
  };
}

/**
 * NQ-16 reports-for-user. 1 query. Scoped to the caller.
 *
 * `chapter_id` comes from the join rather than from a column on the report,
 * because a question can be moved between chapters and a denormalised copy here
 * would then name the wrong one in a moderator's queue.
 */
export async function listOwnReports(db: Db, userId: string): Promise<ReportItem[]> {
  const rows = await db.all<ReportRowShape>(
    `SELECT ${REPORT_SELECT}
       FROM ${T.questionReports} r
       JOIN ${T.questions} q ON q.id = r.question_id
      WHERE r.reporter_user_id = ?1
      ORDER BY r.created_at DESC
      LIMIT 200`,
    userId,
  );
  return rows.map(toReportItem);
}

// --- Admin ------------------------------------------------------------------

/**
 * NQ-15 report-triage-queue. 1 query.
 *
 * Carries `reportCountForQuestion` from a correlated subquery so a question
 * five people have flagged sorts to the top, instead of needing a second pass
 * over the queue to work that out.
 */
export async function readReportQueue(
  db: Db,
  args: { status: ReportStatus; limit: number; beforeCreatedAt: number | null },
): Promise<AdminReportItem[]> {
  const rows = await db.all<
    ReportRowShape & {
      reporter_user_id: string | null;
      stem: string;
      report_count: number;
    }
  >(
    `SELECT ${REPORT_SELECT}, r.reporter_user_id, q.stem,
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
    ...toReportItem(r),
    // '' for a validator or import finding: there is no human behind it, and
    // inventing one would make the queue lie about who is waiting.
    reporterUserId: r.reporter_user_id ?? '',
    stem: r.stem,
    reportCountForQuestion: r.report_count,
  }));
}

/**
 * One audit row. `actor_role` and `entity_type` are NOT NULL in the schema, and
 * both are load-bearing: the role is what the action was permitted BY (a
 * moderator who is later promoted does not retroactively change what they were
 * allowed to do at the time), and the entity type is what makes NQ-37b -- "who
 * touched this question" -- an index hit rather than a scan.
 *
 * `after_json` must be valid JSON (a CHECK), so the detail is stringified here
 * and never passed through as free text.
 */
export function auditStatement(args: {
  actorUserId: string | null;
  actorRole: UserRole | 'system';
  action: string;
  entityType: string;
  entityId: string | null;
  detail: unknown;
  reason?: string | null;
  now: number;
}): PendingStatement {
  return sql(
    `INSERT INTO ${T.adminAuditLog}
       (actor_user_id, actor_role, action, entity_type, entity_id,
        before_json, after_json, reason, ip_hash, user_agent, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, NULL, NULL, ?8)`,
    args.actorUserId,
    args.actorRole,
    args.action,
    args.entityType,
    args.entityId,
    args.detail === undefined || args.detail === null
      ? null
      : JSON.stringify(args.detail).slice(0, 4000),
    args.reason ?? null,
    args.now,
  );
}

/**
 * Bulk triage. 2 statements, ONE batch.
 *
 * The id list travels as one JSON parameter, so triaging 100 reports is still a
 * single statement under D1's 100-bound-parameter ceiling.
 *
 * `resolved_at`/`resolved_by` are set only for a resolving status and NULLed
 * otherwise, because the schema has a CHECK that says so -- moving a report
 * back to 'triaged' without clearing them would be rejected, which is the
 * constraint doing its job.
 */
export async function triageReports(
  db: Db,
  args: {
    actorUserId: string;
    actorRole: UserRole;
    reportIds: readonly string[];
    status: ReportStatus;
    resolutionNote: string | null;
    now: number;
  },
): Promise<number> {
  const resolved = RESOLVING.has(args.status);

  const results = await db.batch([
    sql(
      `UPDATE ${T.questionReports}
          SET status = ?2,
              resolution = COALESCE(?3, resolution),
              resolved_at = CASE WHEN ?4 = 1 THEN ?5 ELSE NULL END,
              resolved_by = CASE WHEN ?4 = 1 THEN ?6 ELSE NULL END,
              updated_at = ?5
        WHERE public_id IN (SELECT value FROM json_each(?1))`,
      JSON.stringify(args.reportIds),
      args.status,
      args.resolutionNote,
      resolved ? 1 : 0,
      args.now,
      args.actorUserId,
    ),
    auditStatement({
      actorUserId: args.actorUserId,
      actorRole: args.actorRole,
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
 * what the quarantine list in the current frontend is doing by hand. A DELETE
 * would be refused by a foreign key anyway, which is the schema making the same
 * point.
 *
 * `status_changed_at` moves with the status, because NQ-38 (the moderation
 * queue) orders by it: a question that has been sitting in draft for a month
 * should surface above one drafted this morning.
 */
export async function setQuestionState(
  db: Db,
  args: {
    actorUserId: string;
    actorRole: UserRole;
    questionIds: readonly string[];
    state: QuestionPublishState;
    now: number;
  },
): Promise<number> {
  const results = await db.batch([
    sql(
      `UPDATE ${T.questions}
          SET status = ?2, status_changed_at = ?3, updated_at = ?3
        WHERE id IN (SELECT value FROM json_each(?1))`,
      JSON.stringify(args.questionIds),
      args.state,
      args.now,
    ),
    auditStatement({
      actorUserId: args.actorUserId,
      actorRole: args.actorRole,
      action: 'question.set_state',
      entityType: 'question',
      entityId: null,
      detail: { questionIds: args.questionIds, state: args.state },
      now: args.now,
    }),
  ]);

  return results[0]?.meta.changes ?? 0;
}

/** NQ-37c audit-recent. 1 query. */
export async function readAuditLog(
  db: Db,
  args: { limit: number; beforeCreatedAt: number | null },
): Promise<AuditLogItem[]> {
  const rows = await db.all<{
    id: number;
    actor_user_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    after_json: string | null;
    created_at: number;
  }>(
    `SELECT id, actor_user_id, action, entity_type, entity_id, after_json, created_at
       FROM ${T.adminAuditLog}
      WHERE created_at < ?1
      ORDER BY created_at DESC, id DESC
      LIMIT ?2`,
    args.beforeCreatedAt ?? Number.MAX_SAFE_INTEGER,
    args.limit,
  );

  return rows.map((r) => ({
    id: String(r.id),
    actorUserId: r.actor_user_id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    detail: r.after_json,
    createdAt: r.created_at,
  }));
}
