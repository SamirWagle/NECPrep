/**
 * The scheduled-job router.
 *
 * `wrangler.toml` declared three crons and nothing implemented them: the
 * Worker exported a Hono app, which gives Cloudflare a `fetch` handler and no
 * `scheduled` handler at all. Cloudflare fires the trigger, finds nothing to
 * call, and the job silently never runs. The visible consequence was
 * `attempt_answers` growing without bound toward D1's 500 MB wall, with the
 * first symptom being every write failing.
 *
 * DISPATCH IS BY CRON STRING
 * --------------------------
 * `ScheduledController.cron` carries the exact expression from
 * `wrangler.toml`, which is the only thing distinguishing one trigger from
 * another. The mapping is therefore a literal table, and an unrecognised
 * expression THROWS rather than defaulting to a job: editing a schedule in
 * `wrangler.toml` without editing this table is a mistake that should surface
 * on the first firing, not silently run the wrong work at the wrong hour.
 *
 * EVERY JOB GETS ITS OWN QUERY BUDGET
 * -----------------------------------
 * The request-path budget (45 queries, or whatever `D1_QUERY_BUDGET` says)
 * exists to keep page loads inside D1's 50-queries-per-invocation limit on the
 * free plan. A cron invocation is not a page load: it is allowed to use the
 * whole limit, and the batching inside each job is what keeps it there. Using
 * the request budget would make the retention job give up after nine delete
 * batches for no reason.
 *
 * FAILURES ARE LOGGED AND RETHROWN
 * --------------------------------
 * Cloudflare records a failed scheduled invocation, and that record is the
 * only alarm this platform has. Swallowing the error would turn a broken
 * nightly job into silence, which is the failure mode that produced this file.
 */

import { Db } from '../data/d1.ts';
import type { Env } from '../env.ts';
import { systemClock, type Clock } from '../lib/time.ts';
import { runAnswerRetention } from './retention.ts';
import { runNightlySweep } from './sweep.ts';
import { runLeaderboardSnapshot } from './leaderboard.ts';

/** Must match `[triggers] crons` in wrangler.toml, expression for expression. */
export const CRON_RETENTION = '10 2 * * *';
export const CRON_SWEEP = '40 2 * * *';
export const CRON_LEADERBOARD = '5 * * * *';

/**
 * Queries one cron invocation may spend.
 *
 * D1's free plan allows 50 per Worker invocation; this sits just under it so
 * that exceeding it raises `QueryBudgetExceeded` with the offending statement
 * rather than a bare D1 error.
 */
export const JOB_QUERY_BUDGET = 48;

/**
 * Row writes the retention job may spend per run.
 *
 * A quarter of the free plan's 100,000 daily allowance. The job stops cleanly
 * when it is spent and resumes the next night, because a retention pass that
 * exhausts the day's writes takes the whole platform read-only — far worse
 * than a backlog that drains over a few nights.
 */
export const RETENTION_ROW_WRITE_BUDGET = 25_000;

const DEFAULT_RETENTION_DAYS = 90;

export interface ScheduledDeps {
  readonly clock?: Clock;
  readonly budget?: number;
}

/**
 * Minimal shape of Cloudflare's `ScheduledController`.
 *
 * Declared locally for the same reason `data/d1.ts` declares `D1Database`:
 * this codebase depends on the contract, not on `@cloudflare/workers-types`.
 */
export interface ScheduledEventLike {
  readonly cron: string;
  readonly scheduledTime?: number;
}

export type JobOutcome = Record<string, unknown>;

export async function handleScheduled(
  event: ScheduledEventLike,
  env: Env,
  deps: ScheduledDeps = {},
): Promise<JobOutcome> {
  const clock = deps.clock ?? systemClock;
  const db = new Db(env.DB, { budget: deps.budget ?? JOB_QUERY_BUDGET });
  // Prefer the scheduled time over the clock: a retried or delayed invocation
  // should compute the window it was scheduled for, not the one it happens to
  // be running in.
  const now = event.scheduledTime ?? clock.now();
  const started = Date.now();

  try {
    const result = await dispatch(event.cron, db, env, now);
    const outcome: JobOutcome = {
      cron: event.cron,
      ok: true,
      ms: Date.now() - started,
      queries: db.queryCount,
      ...result,
    };
    console.log(JSON.stringify(outcome));
    return outcome;
  } catch (err) {
    console.error(
      JSON.stringify({
        cron: event.cron,
        ok: false,
        ms: Date.now() - started,
        queries: db.queryCount,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    // Rethrow: a failed invocation is the only alarm there is.
    throw err;
  }
}

async function dispatch(
  cron: string,
  db: Db,
  env: Env,
  now: number,
): Promise<JobOutcome> {
  switch (cron) {
    case CRON_RETENTION: {
      const days = retentionDays(env);
      const result = await runAnswerRetention(db, {
        submittedRetentionDays: days,
        rowWriteBudget: RETENTION_ROW_WRITE_BUDGET,
        now,
      });
      return { job: 'answer-retention', retentionDays: days, ...result };
    }

    case CRON_SWEEP: {
      const result = await runNightlySweep(db, { now });
      return { job: 'nightly-sweep', ...result };
    }

    case CRON_LEADERBOARD: {
      const result = await runLeaderboardSnapshot(db, { now });
      return { job: 'leaderboard-snapshot', ...result };
    }

    default:
      throw new Error(
        `No scheduled job is registered for cron "${cron}". ` +
          'Add it to src/jobs/index.ts or remove it from wrangler.toml.',
      );
  }
}

/**
 * `ANSWER_RETENTION_DAYS` from the environment.
 *
 * Bounded at 7 days minimum because the submit path needs the raw answers to
 * render a review, and at 400 maximum because beyond a year the free plan's
 * 500 MB ceiling is the binding constraint rather than the policy. An
 * unparseable value throws: silently falling back to a default would be the
 * difference between a 7-day and a 180-day window, decided by a typo.
 */
export function retentionDays(env: Env): number {
  const raw = env.ANSWER_RETENTION_DAYS;
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_RETENTION_DAYS;
  // Digits only. `Number.parseInt` alone stops at the first non-digit, so
  // "90 days" would parse as 90 and a value that was never a number would
  // silently become policy.
  const trimmed = raw.trim();
  const n = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN;
  if (!Number.isInteger(n) || n < 7 || n > 400) {
    throw new Error(
      `Invalid ANSWER_RETENTION_DAYS "${raw}"; expected an integer between 7 and 400.`,
    );
  }
  return n;
}
