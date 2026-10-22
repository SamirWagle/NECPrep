/**
 * Nightly sweep: expire stale attempts, retire dead sessions, prune
 * notifications and idempotency keys.
 *
 * Each of these has a reason rooted in a limit or an invariant, not in
 * tidiness:
 *
 *  1. ATTEMPTS past their deadline. `attempts.status` stays 'in_progress'
 *     until something ends it. The submit path clamps a late submission
 *     (`domain/expiry.ts`), but a student who closes the tab and never returns
 *     leaves a row that claims to be in progress forever. That row is not
 *     harmless: the mock-start path refuses to begin a second attempt while
 *     one is open, so a single abandoned paper locks a student out of that
 *     template permanently.
 *
 *  2. SESSIONS past their absolute expiry. Already unusable — the session
 *     lookup checks both clocks — so this is purely about not carrying dead
 *     rows and their index entries forever.
 *
 *  3. NOTIFICATIONS past `expires_at`, which is what that column is for.
 *
 *  4. IDEMPOTENCY KEYS past their TTL, using the statement `data/infra.ts`
 *     already defines. Reusing it rather than writing a second DELETE keeps
 *     one definition of what "expired key" means.
 *
 * Everything here is bounded by LIMIT and reports what it did, for the same
 * reason the retention job is: an unbounded nightly DELETE on a
 * single-threaded database is a self-inflicted outage.
 */

import { Db } from '../data/d1.ts';
import { T } from '../data/tables.ts';
import { IDEMPOTENCY_TTL_MS, sweepIdempotencyStatement } from '../data/infra.ts';

/** Per-category ceiling for one run. */
export const SWEEP_BATCH_SIZE = 1000;

export interface SweepConfig {
  readonly now: number;
  readonly batchSize?: number;
}

export interface SweepResult {
  readonly attemptsExpired: number;
  readonly sessionsDeleted: number;
  readonly notificationsDeleted: number;
  readonly idempotencyKeysDeleted: number;
}

export async function runNightlySweep(db: Db, config: SweepConfig): Promise<SweepResult> {
  const limit = config.batchSize ?? SWEEP_BATCH_SIZE;
  const now = config.now;

  // 1. Expire attempts whose deadline has passed.
  //
  // `elapsed_ms` is set from the deadline rather than from `now`, because the
  // student stopped working at some unknown point before it — crediting them
  // with the time between abandonment and this cron run would be a lie, and
  // the deadline is the only defensible upper bound available.
  //
  // Only timed attempts are touched: `deadline_at IS NULL` is an untimed
  // practice session, which has no deadline to be past.
  //
  // `attempts` has no `updated_at` — one row per sitting whose lifecycle is
  // already described by `started_at`/`submitted_at`/`deadline_at` — so there
  // is nothing to stamp here beyond the status itself. Leaving `submitted_at`
  // NULL is required: the table's CHECK ties it to `status = 'submitted'`, and
  // an expired paper was never submitted.
  const expired = await db.run(
    `UPDATE ${T.attempts}
        SET status = 'expired',
            elapsed_ms = COALESCE(elapsed_ms, deadline_at - started_at)
      WHERE id IN (
        SELECT id FROM ${T.attempts}
         WHERE status = 'in_progress'
           AND deadline_at IS NOT NULL
           AND deadline_at < ?1
         ORDER BY deadline_at
         LIMIT ?2
      )`,
    now,
    limit,
  );

  // 2. Sessions past their hard ceiling. The idle clock slides, the absolute
  // one does not, so `absolute_expires_at` is the only safe deletion key: a
  // session can sit far past `expires_at` and still be legitimately revivable
  // in another tab's race, but nothing survives the absolute ceiling.
  const sessions = await db.run(
    `DELETE FROM ${T.sessions}
      WHERE id IN (
        SELECT id FROM ${T.sessions}
         WHERE absolute_expires_at < ?1
         ORDER BY absolute_expires_at
         LIMIT ?2
      )`,
    now,
    limit,
  );

  // 3. Expired notifications. NULL `expires_at` means "keep until read", which
  // is a different policy and not this job's business.
  const notifications = await db.run(
    `DELETE FROM ${T.notifications}
      WHERE id IN (
        SELECT id FROM ${T.notifications}
         WHERE expires_at IS NOT NULL
           AND expires_at < ?1
         ORDER BY expires_at
         LIMIT ?2
      )`,
    now,
    limit,
  );

  // 4. Idempotency keys, via the one statement that defines their TTL.
  const idem = sweepIdempotencyStatement(now);
  const [idemResult] = await db.batch([idem]);

  return {
    attemptsExpired: expired.changes ?? 0,
    sessionsDeleted: sessions.changes ?? 0,
    notificationsDeleted: notifications.changes ?? 0,
    idempotencyKeysDeleted: idemResult?.meta?.changes ?? 0,
  };
}

export { IDEMPOTENCY_TTL_MS };
