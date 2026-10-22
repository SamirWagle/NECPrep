/**
 * Leaderboard snapshots.
 *
 * The board is NEVER computed on a request path. `migrations/0006_engagement`
 * is explicit about why: ranking means aggregating every submitted attempt in
 * a period, which is the one scan this platform tolerates, and tolerating it
 * once an hour is different from tolerating it per page view. The read path
 * (NQ-35) fetches the latest snapshot row and renders `top_json` without a
 * single join.
 *
 * WHAT IS RANKED
 * --------------
 * Global board only, metric `correct_answers`, over four periods: today, this
 * week, this month, and all time. Chapter- and template-scoped boards are
 * expressible in the schema and deliberately not computed — each additional
 * scope multiplies this job's cost, and nothing in the app reads them yet.
 *
 * Periods are bucketed in Nepal Standard Time (`lib/time.ts`), not UTC. A 9pm
 * study session in Kathmandu belongs to that day, which is the same reason
 * streaks are bucketed that way.
 *
 * OPT-IN IS ENFORCED HERE
 * -----------------------
 * `user_profiles.leaderboard_opt_in` defaults to 0, and this job filters on
 * it. That is the only place it can be enforced: once a name is baked into
 * `top_json`, no read-path filter can take it back out. A user who opts out is
 * gone at the next snapshot rather than leaving a gap in a join — which is
 * exactly why 0006 denormalises the display fields.
 *
 * Soft-deleted users are excluded for the same reason: their rows survive so
 * that attempt history stays intact, but they must not appear on a board.
 */

import { Db } from '../data/d1.ts';
import { T } from '../data/tables.ts';
import { sql, type PendingStatement } from '../data/d1.ts';
import { ACTIVITY_TZ_OFFSET_MINUTES, MINUTE, dayKey } from '../lib/time.ts';

/** How many ranked users each snapshot stores. */
export const TOP_N = 50;

/** Snapshots older than this are pruned, except `all_time`. */
export const SNAPSHOT_RETENTION_DAYS = 14;

/** Children deleted per prune batch. 0006 names 50 for exactly this reason. */
export const PRUNE_BATCH = 50;

export type Period = 'daily' | 'weekly' | 'monthly' | 'all_time';

/** `all_time` has no real start; 0006 fixes it at this sentinel. */
export const ALL_TIME_PERIOD_START = '0001-01-01';

export interface LeaderboardConfig {
  readonly now: number;
  readonly topN?: number;
}

export interface BoardResult {
  readonly period: Period;
  readonly periodStart: string;
  readonly snapshotId: number;
  readonly entrants: number;
  readonly ranked: number;
  readonly computeMs: number;
}

export interface LeaderboardResult {
  readonly boards: readonly BoardResult[];
  readonly snapshotsPruned: number;
  readonly entriesPruned: number;
}

interface AggregateRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  score: number;
  answered: number;
}

/**
 * Inclusive start of a period, as epoch ms, in the activity timezone.
 *
 * `all_time` returns 0 rather than a date, so one code path covers all four
 * periods and the aggregate query never needs a special case.
 */
export function periodWindow(
  period: Period,
  now: number,
): { startMs: number; periodStart: string } {
  if (period === 'all_time') {
    return { startMs: 0, periodStart: ALL_TIME_PERIOD_START };
  }

  const offset = ACTIVITY_TZ_OFFSET_MINUTES * MINUTE;
  // Work in a shifted clock so that "midnight" means midnight in Kathmandu,
  // then shift back to get a real UTC instant to compare `submitted_at` to.
  const shifted = new Date(now + offset);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();

  let startShifted: number;
  if (period === 'daily') {
    startShifted = Date.UTC(y, m, d);
  } else if (period === 'weekly') {
    // Week starts Sunday, matching how the streak display groups days.
    startShifted = Date.UTC(y, m, d - shifted.getUTCDay());
  } else {
    startShifted = Date.UTC(y, m, 1);
  }

  const startMs = startShifted - offset;
  return { startMs, periodStart: dayKey(startMs) };
}

/**
 * Aggregate one period into a ranked list.
 *
 * Reads `attempts`, not `attempt_answers`: `correct_count` and
 * `answered_count` are trigger-maintained summaries, so this survives the
 * retention job deleting the raw rows underneath it. That is the property
 * 0004 called out when it said leaderboards are "precomputed".
 */
async function aggregate(
  db: Db,
  startMs: number,
  topN: number,
): Promise<{ rows: AggregateRow[]; entrants: number }> {
  // One grouped read, bounded by LIMIT. Served by idx_attempts_submitted_at.
  const rows = await db.all<AggregateRow>(
    `SELECT a.user_id                AS user_id,
            p.display_name           AS display_name,
            p.avatar_url             AS avatar_url,
            SUM(a.correct_count)     AS score,
            SUM(a.answered_count)    AS answered
       FROM ${T.attempts} a
       JOIN ${T.userProfiles} p ON p.user_id = a.user_id
       JOIN ${T.users} u        ON u.id = a.user_id
      WHERE a.status = 'submitted'
        AND a.submitted_at >= ?1
        AND p.leaderboard_opt_in = 1
        AND u.deleted_at IS NULL
      GROUP BY a.user_id
      HAVING SUM(a.answered_count) > 0
      ORDER BY score DESC, answered ASC, a.user_id ASC
      LIMIT ?2`,
    startMs,
    topN,
  );

  // Entrant count is the size of the eligible field, not of the top N — a
  // board that says "you are 212th of 3,400" needs the denominator, and
  // counting it here costs one query instead of a second scan at read time.
  const count = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM (
       SELECT a.user_id
         FROM ${T.attempts} a
         JOIN ${T.userProfiles} p ON p.user_id = a.user_id
         JOIN ${T.users} u        ON u.id = a.user_id
        WHERE a.status = 'submitted'
          AND a.submitted_at >= ?1
          AND p.leaderboard_opt_in = 1
          AND u.deleted_at IS NULL
        GROUP BY a.user_id
       HAVING SUM(a.answered_count) > 0
     )`,
    startMs,
  );

  return { rows, entrants: count?.n ?? 0 };
}

/**
 * Writes one board: the snapshot row, then its entries, carrying prev_rank.
 *
 * ONE ROW PER (scope, scope_ref, period, period_start)
 * ----------------------------------------------------
 * 0006 puts a UNIQUE index on exactly that tuple, which settles a question
 * this job would otherwise have got wrong: an hourly cron REPLACES the current
 * period's snapshot in place, it does not append a new one. A naive insert
 * worked on the first run of each day and then failed on the unique index for
 * the other twenty-three, which is the kind of bug that only shows up in
 * production on day two.
 *
 * Updating in place is also the better shape: the read path (NQ-35) wants
 * "today's board", not "the 14th snapshot of today's board", and the retention
 * window stays bounded by period rather than by run count.
 *
 * `prev_rank` then means "rank the last time this board was computed", which
 * is the previous hour within a day and the previous day at a boundary. One
 * query finds either: the most recently computed snapshot of this board,
 * whichever period_start it belongs to.
 */
async function writeBoard(
  db: Db,
  period: Period,
  periodStart: string,
  agg: { rows: AggregateRow[]; entrants: number },
  now: number,
  computeMs: number,
): Promise<BoardResult> {
  // The most recent computation of this board, for the movement arrows. Read
  // BEFORE the write, because when the current period already has a row this
  // is that row, and it is about to be overwritten.
  const prev = await db.first<{ id: number }>(
    `SELECT id FROM ${T.leaderboardSnapshots}
      WHERE scope = 'global' AND scope_ref = '' AND period = ?1
      ORDER BY computed_at DESC LIMIT 1`,
    period,
  );

  const prevRanks = new Map<string, number>();
  if (prev) {
    const prevRows = await db.all<{ user_id: string; rank: number }>(
      `SELECT user_id, rank FROM ${T.leaderboardEntries} WHERE snapshot_id = ?1`,
      prev.id,
    );
    for (const row of prevRows) prevRanks.set(row.user_id, row.rank);
  }

  const top = agg.rows.map((row, i) => ({
    rank: i + 1,
    user_id: row.user_id,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    score: row.score,
    accuracy_bp: accuracyBp(row.score, row.answered),
  }));

  // Upsert on the board key, not on the id: the id is an autoincrementing
  // rowid and the board key is what identifies the thing being recomputed.
  const written = await db.first<{ id: number }>(
    `INSERT INTO ${T.leaderboardSnapshots}
       (scope, scope_ref, period, period_start, metric, top_json, entrant_count,
        computed_at, compute_ms)
     VALUES ('global', '', ?1, ?2, 'correct_answers', ?3, ?4, ?5, ?6)
     ON CONFLICT (scope, scope_ref, period, period_start) DO UPDATE SET
       top_json      = excluded.top_json,
       entrant_count = excluded.entrant_count,
       computed_at   = excluded.computed_at,
       compute_ms    = excluded.compute_ms
     RETURNING id`,
    period,
    periodStart,
    JSON.stringify(top),
    agg.entrants,
    now,
    computeMs,
  );
  if (!written) {
    throw new Error(`leaderboard: snapshot upsert for ${period} returned no id`);
  }

  // Entries are replaced wholesale. A partial update would leave stale ranks
  // behind for anyone who dropped out of the top N, and
  // `uq_leaderboard_entries_snapshot_user` would reject the re-insert anyway.
  const statements: PendingStatement[] = [
    sql(`DELETE FROM ${T.leaderboardEntries} WHERE snapshot_id = ?1`, written.id),
    ...top.map((entry) =>
      sql(
        `INSERT INTO ${T.leaderboardEntries}
           (snapshot_id, rank, user_id, score, accuracy_bp, prev_rank)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        written.id,
        entry.rank,
        entry.user_id,
        entry.score,
        entry.accuracy_bp,
        prevRanks.get(entry.user_id) ?? null,
      ),
    ),
  ];
  await db.batch(statements);

  return {
    period,
    periodStart,
    snapshotId: written.id,
    entrants: agg.entrants,
    ranked: top.length,
    computeMs,
  };
}

function accuracyBp(correct: number, answered: number): number | null {
  if (answered <= 0) return null;
  return Math.round((correct / answered) * 10_000);
}

/**
 * Prune old snapshots, children first.
 *
 * `leaderboard_entries.snapshot_id` is deliberately not a foreign key, so
 * there is no cascade to lean on: deleting the parents first would orphan the
 * children silently. 0006 spells out this order (NQ-35d before NQ-35c) and
 * why — a cascading delete here is the shape that blows D1's per-query time
 * limit.
 *
 * `all_time` is never pruned; it is one row per run of history.
 */
async function prune(db: Db, now: number): Promise<{ snapshots: number; entries: number }> {
  const cutoff = now - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const entries = await db.run(
    `DELETE FROM ${T.leaderboardEntries}
      WHERE snapshot_id IN (
        SELECT id FROM ${T.leaderboardSnapshots}
         WHERE computed_at < ?1 AND period <> 'all_time'
         ORDER BY id
         LIMIT ?2
      )`,
    cutoff,
    PRUNE_BATCH,
  );

  const snapshots = await db.run(
    `DELETE FROM ${T.leaderboardSnapshots}
      WHERE id IN (
        SELECT id FROM ${T.leaderboardSnapshots}
         WHERE computed_at < ?1 AND period <> 'all_time'
         ORDER BY id
         LIMIT ?2
      )`,
    cutoff,
    PRUNE_BATCH,
  );

  return { snapshots: snapshots.changes ?? 0, entries: entries.changes ?? 0 };
}

const PERIODS: readonly Period[] = ['daily', 'weekly', 'monthly', 'all_time'];

export async function runLeaderboardSnapshot(
  db: Db,
  config: LeaderboardConfig,
): Promise<LeaderboardResult> {
  const topN = config.topN ?? TOP_N;
  const boards: BoardResult[] = [];

  for (const period of PERIODS) {
    const { startMs, periodStart } = periodWindow(period, config.now);
    // `compute_ms` is recorded because 0006 says this job is the one thing
    // allowed to scan a large table, and the day it gets slow is the day the
    // ceiling arithmetic needs revisiting. Measuring it is how that day is
    // noticed.
    const started = Date.now();
    const agg = await aggregate(db, startMs, topN);
    const computeMs = Date.now() - started;
    boards.push(await writeBoard(db, period, periodStart, agg, config.now, computeMs));
  }

  const pruned = await prune(db, config.now);

  return {
    boards,
    snapshotsPruned: pruned.snapshots,
    entriesPruned: pruned.entries,
  };
}
