/**
 * Raw-answer retention.
 *
 * Without this job `attempt_answers` grows forever and the first symptom is
 * every write failing at D1's 500 MB per-database wall. The schema spells the
 * reasoning out in `migrations/0004_assessment.sql`; the policy it states is
 * what this file implements, nothing more:
 *
 *   * answers of a SUBMITTED attempt   -- `ANSWER_RETENTION_DAYS` (90 free)
 *   * answers of an ABANDONED/EXPIRED attempt -- 7 days
 *   * the `attempts` summary row itself -- kept forever, one row per sitting
 *
 * Deleting a raw answer loses the question-by-question review of an old
 * attempt and nothing else. Score, counts, per-question history and SRS state
 * are all trigger-maintained on other tables, and `db/smoke.mjs` asserts that
 * they survive an archival pass.
 *
 * WHY THIS DELETES RATHER THAN ARCHIVES
 * -------------------------------------
 * `attempt_answers_archive` exists in 0004 with an `r2_object_key` column, and
 * its own comment is explicit: a NULL key means "this row is still only in D1
 * and deleting it would lose data". There is no R2 bucket bound in
 * `wrangler.toml`, so copying rows into that table would move them from a
 * 4-index table to a 1-index table in the same database — paying write
 * amplification to bound nothing. Deletion is what actually reclaims pages for
 * reuse.
 *
 * Turning archival on is therefore a two-part change, not a flag: bind an R2
 * bucket, then write the drain (NQ-26d). Until then this job implements the
 * documented trade rather than pretending to preserve what it cannot.
 *
 * WHY IT IS BATCHED AND BUDGETED
 * ------------------------------
 * D1's free plan allows 100,000 row writes per day and counts INDEX rows as
 * writes. `attempt_answers` carries three secondary indexes plus the unique
 * one, so a single deleted answer costs about five row writes. The job
 * therefore works to an explicit row-write budget and stops cleanly when it is
 * spent, leaving the rest for tomorrow: a retention job that exhausts the
 * day's write allowance takes the whole platform read-only, which is a far
 * worse outcome than a backlog draining over several nights.
 */

import { Db } from '../data/d1.ts';
import { T } from '../data/tables.ts';

/** Row writes charged per deleted answer: the row, plus its four indexes. */
export const WRITE_COST_PER_ANSWER = 5;

/** Answers of an attempt that was never submitted are worth very little. */
export const ABANDONED_RETENTION_DAYS = 7;

/**
 * How many answers to delete in one statement.
 *
 * Deliberately well under D1's bound-parameter ceiling, and small enough that
 * one batch is a short-lived write lock on a single-threaded database.
 */
export const DELETE_BATCH_SIZE = 500;

export interface RetentionConfig {
  /** Retention for answers of submitted attempts, in days. */
  readonly submittedRetentionDays: number;
  /**
   * Row-write ceiling for the whole run. Defaults to a quarter of the free
   * plan's daily allowance, so the job can never be the reason a student
   * cannot record an answer.
   */
  readonly rowWriteBudget: number;
  /** Injected so tests do not depend on the wall clock. */
  readonly now: number;
}

export interface RetentionResult {
  readonly answersDeleted: number;
  readonly rowWritesSpent: number;
  readonly batches: number;
  /** True when the budget ran out before the backlog did. */
  readonly budgetExhausted: boolean;
  /** Oldest answer still present after the run, epoch ms, or null if none. */
  readonly oldestRemainingAt: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Delete expired raw answers, oldest first, within a row-write budget.
 *
 * Oldest-first matters: it means an interrupted run always makes progress on
 * the rows closest to being a problem, and a backlog drains deterministically
 * instead of leaving an arbitrary residue.
 */
export async function runAnswerRetention(
  db: Db,
  config: RetentionConfig,
): Promise<RetentionResult> {
  const submittedCutoff = config.now - config.submittedRetentionDays * DAY_MS;
  const abandonedCutoff = config.now - ABANDONED_RETENTION_DAYS * DAY_MS;

  let answersDeleted = 0;
  let batches = 0;
  let budgetExhausted = false;

  for (;;) {
    const remainingWrites = config.rowWriteBudget - answersDeleted * WRITE_COST_PER_ANSWER;
    const affordable = Math.floor(remainingWrites / WRITE_COST_PER_ANSWER);
    if (affordable <= 0) {
      budgetExhausted = true;
      break;
    }
    const limit = Math.min(DELETE_BATCH_SIZE, affordable);

    // The cutoff depends on the PARENT attempt's status, so the predicate has
    // to join. `answered_at` drives the ordering and is indexed
    // (idx_attempt_answers_answered_at), and the attempt lookup is by primary
    // key, so this stays a bounded scan of the oldest rows rather than a table
    // sort.
    const meta = await db.run(
      `DELETE FROM ${T.attemptAnswers}
        WHERE id IN (
          SELECT aa.id
            FROM ${T.attemptAnswers} aa
            JOIN ${T.attempts} a ON a.id = aa.attempt_id
           WHERE (a.status = 'submitted' AND aa.answered_at < ?1)
              OR (a.status IN ('abandoned', 'expired') AND aa.answered_at < ?2)
           ORDER BY aa.answered_at
           LIMIT ?3
        )`,
      submittedCutoff,
      abandonedCutoff,
      limit,
    );

    const deleted = meta.changes ?? 0;
    answersDeleted += deleted;
    batches += 1;

    // Fewer than asked for means the backlog is drained, not that the budget
    // ran out. Distinguishing the two is the whole point of the result shape.
    if (deleted < limit) break;
  }

  const oldest = await db.first<{ answered_at: number }>(
    `SELECT answered_at FROM ${T.attemptAnswers} ORDER BY answered_at LIMIT 1`,
  );

  return {
    answersDeleted,
    rowWritesSpent: answersDeleted * WRITE_COST_PER_ANSWER,
    batches,
    budgetExhausted,
    oldestRemainingAt: oldest?.answered_at ?? null,
  };
}
