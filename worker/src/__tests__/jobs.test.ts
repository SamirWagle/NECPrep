/**
 * The three scheduled jobs, against a real SQLite database with every
 * migration applied.
 *
 * These existed as cron expressions in `wrangler.toml` with no implementation
 * behind them, which is worse than not having them: Cloudflare fires the
 * trigger, finds no `scheduled` export, and the job silently never runs.
 * `attempt_answers` was growing toward D1's 500 MB wall with no bound at all.
 *
 * So the tests here are mostly about the properties that make these jobs safe
 * to run unattended — that retention cannot overspend the day's write
 * allowance, that it cannot destroy a score, that the sweep cannot free a
 * student from a paper they are still sitting, and that an unknown cron
 * expression fails loudly instead of running the wrong work.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorld, measure, T0 } from './harness.ts';
import type { TestWorld } from './harness.ts';
import { startMock, submitMock } from '../handlers/mock.ts';
import type { MockAttemptPaper } from '../shared/types.ts';
import type { SessionUser } from '../shared/types.ts';
import { DAY, MINUTE, fixedClock } from '../lib/time.ts';
import {
  runAnswerRetention,
  ABANDONED_RETENTION_DAYS,
  WRITE_COST_PER_ANSWER,
} from '../jobs/retention.ts';
import { runNightlySweep } from '../jobs/sweep.ts';
import { runLeaderboardSnapshot, periodWindow } from '../jobs/leaderboard.ts';
import {
  handleScheduled,
  retentionDays,
  CRON_RETENTION,
  CRON_SWEEP,
  CRON_LEADERBOARD,
} from '../jobs/index.ts';
import type { Env } from '../env.ts';

let keyCounter = 0;
function key(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-job-key-${keyCounter}`;
}

async function start(world: TestWorld, user: SessionUser): Promise<MockAttemptPaper> {
  const { result } = await measure(world, user, (ctx) =>
    startMock(ctx, { templateId: world.templateId, idempotencyKey: key('start') }),
  );
  return result.body;
}

/** The option ref the fixture says is correct, for a given delivered question. */
function correctRefFor(world: TestWorld, paper: MockAttemptPaper, questionId: string): string {
  const delivered = paper.questions.find((q) => q.questionId === questionId);
  assert.ok(delivered, 'question not in paper');
  const seeded = world.questionById.get(questionId);
  assert.ok(seeded, 'question not in fixture');
  const ref = delivered.options.find(
    (o) => seeded.bodies.get(seeded.correctOptionId) === o.body,
  );
  assert.ok(ref, 'correct option not delivered');
  return ref.ref;
}

/** Submit a whole paper correctly, so the attempt carries a real score. */
async function submitAllCorrect(
  world: TestWorld,
  user: SessionUser,
  paper: MockAttemptPaper,
): Promise<void> {
  // The wire shape is questionId -> optionRef, which is also what makes a
  // cross-attempt ref impossible to smuggle in.
  const answers: Record<string, string> = {};
  for (const q of paper.questions) {
    answers[q.questionId] = correctRefFor(world, paper, q.questionId);
  }
  await measure(world, user, (ctx) =>
    submitMock(ctx, {
      attemptId: paper.attemptId,
      answers,
      idempotencyKey: key('submit'),
    }),
  );
}

/** Ages an attempt and its answers by rewriting their timestamps directly. */
function ageAttempt(world: TestWorld, publicId: string, toMs: number): void {
  const row = world.d1.raw
    .prepare('SELECT id FROM attempts WHERE public_id = ?')
    .get(publicId) as { id: number } | undefined;
  assert.ok(row, 'attempt not found');
  world.d1.raw
    .prepare('UPDATE attempts SET submitted_at = ? WHERE id = ?')
    .run(toMs, row.id);
  world.d1.raw
    .prepare('UPDATE attempt_answers SET answered_at = ? WHERE attempt_id = ?')
    .run(toMs, row.id);
}

function countAnswers(world: TestWorld): number {
  const row = world.d1.raw
    .prepare('SELECT COUNT(*) AS n FROM attempt_answers')
    .get() as { n: number };
  return row.n;
}

// --- Retention ---------------------------------------------------------------

test('retention deletes answers past the window and keeps the score', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);
  await submitAllCorrect(world, user, paper);

  const before = world.d1.raw
    .prepare('SELECT correct_count, answered_count, score_bp FROM attempts WHERE public_id = ?')
    .get(paper.attemptId) as { correct_count: number; answered_count: number; score_bp: number };
  assert.ok(before.answered_count > 0, 'fixture should have answers');
  assert.equal(before.correct_count, before.answered_count);

  // Age it past a 90-day window.
  ageAttempt(world, paper.attemptId, T0 - 120 * DAY);

  const result = await runAnswerRetention(world.invocation(), {
    submittedRetentionDays: 90,
    rowWriteBudget: 100_000,
    now: T0,
  });

  assert.equal(result.answersDeleted, before.answered_count);
  assert.equal(countAnswers(world), 0);

  // The point of the whole design: the score is trigger-maintained on
  // `attempts`, so deleting the raw answers must not touch it.
  const after = world.d1.raw
    .prepare('SELECT correct_count, answered_count, score_bp FROM attempts WHERE public_id = ?')
    .get(paper.attemptId) as { correct_count: number; answered_count: number; score_bp: number };
  assert.deepEqual(after, before);

  world.close();
});

test('retention leaves answers inside the window alone', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);
  await submitAllCorrect(world, user, paper);

  const total = countAnswers(world);
  ageAttempt(world, paper.attemptId, T0 - 10 * DAY);

  const result = await runAnswerRetention(world.invocation(), {
    submittedRetentionDays: 90,
    rowWriteBudget: 100_000,
    now: T0,
  });

  assert.equal(result.answersDeleted, 0);
  assert.equal(countAnswers(world), total);
  world.close();
});

test('an abandoned paper loses its answers far sooner than a submitted one', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);

  // Answer without submitting, so the attempt stays 'in_progress', then mark
  // it abandoned the way the sweep would.
  const row = world.d1.raw
    .prepare('SELECT id FROM attempts WHERE public_id = ?')
    .get(paper.attemptId) as { id: number };
  const q = paper.questions[0];
  world.d1.raw
    .prepare(
      `INSERT INTO attempt_answers
         (attempt_id, question_id, selected_opt_key, is_correct, delivered_position, answered_at)
       VALUES (?, ?, NULL, 0, 1, ?)`,
    )
    .run(row.id, q.questionId, T0 - (ABANDONED_RETENTION_DAYS + 1) * DAY);
  world.d1.raw.prepare(`UPDATE attempts SET status = 'abandoned' WHERE id = ?`).run(row.id);

  const result = await runAnswerRetention(world.invocation(), {
    // Deliberately generous: the submitted window must not rescue an
    // abandoned attempt's answers.
    submittedRetentionDays: 365,
    rowWriteBudget: 100_000,
    now: T0,
  });

  assert.equal(result.answersDeleted, 1);
  world.close();
});

test('retention stops at its row-write budget rather than taking the platform read-only', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);
  await submitAllCorrect(world, user, paper);
  const total = countAnswers(world);
  assert.ok(total >= 4, 'need several answers to see a partial run');

  ageAttempt(world, paper.attemptId, T0 - 200 * DAY);

  // Budget for exactly two answers.
  const result = await runAnswerRetention(world.invocation(), {
    submittedRetentionDays: 90,
    rowWriteBudget: 2 * WRITE_COST_PER_ANSWER,
    now: T0,
  });

  assert.equal(result.answersDeleted, 2);
  assert.equal(result.budgetExhausted, true);
  assert.equal(countAnswers(world), total - 2);
  // And the rest is still there for tomorrow, oldest-first having made
  // progress on the rows closest to being a problem.
  assert.ok(result.oldestRemainingAt !== null);
  world.close();
});

// --- Sweep -------------------------------------------------------------------

test('the sweep expires a paper whose deadline has passed', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);

  const deadline = world.d1.raw
    .prepare('SELECT deadline_at, started_at FROM attempts WHERE public_id = ?')
    .get(paper.attemptId) as { deadline_at: number; started_at: number };
  assert.ok(deadline.deadline_at > T0, 'fixture paper should be timed and open');

  const result = await runNightlySweep(world.invocation(), {
    now: deadline.deadline_at + MINUTE,
  });

  assert.equal(result.attemptsExpired, 1);
  const after = world.d1.raw
    .prepare('SELECT status, submitted_at, elapsed_ms FROM attempts WHERE public_id = ?')
    .get(paper.attemptId) as { status: string; submitted_at: number | null; elapsed_ms: number };
  assert.equal(after.status, 'expired');
  // The CHECK on `attempts` ties submitted_at to status='submitted'; an
  // expired paper was never submitted.
  assert.equal(after.submitted_at, null);
  // Credited only up to the deadline, not up to whenever the cron happened to
  // run — the student stopped working at an unknown earlier point, and the
  // deadline is the only defensible upper bound. Running the sweep a week late
  // must not inflate the recorded time.
  assert.equal(after.elapsed_ms, deadline.deadline_at - deadline.started_at);
  world.close();
});

test('the sweep does not touch a paper that is still inside its deadline', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);

  const result = await runNightlySweep(world.invocation(), { now: T0 + MINUTE });

  assert.equal(result.attemptsExpired, 0);
  const after = world.d1.raw
    .prepare('SELECT status FROM attempts WHERE public_id = ?')
    .get(paper.attemptId) as { status: string };
  assert.equal(after.status, 'in_progress');
  world.close();
});

test('the sweep deletes sessions past their absolute ceiling, not their idle one', async () => {
  const world = createWorld();
  const user = world.makeUser();

  const mk = (id: string, idle: number, absolute: number) =>
    world.d1.raw
      .prepare(
        `INSERT INTO sessions (id, user_id, created_at, expires_at, absolute_expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, user.id, T0, idle, absolute);

  // Idle-expired but inside its absolute ceiling: must survive, because the
  // idle clock slides and a live tab can legitimately revive it.
  mk('a'.repeat(64), T0 - DAY, T0 + 30 * DAY);
  // Past the hard ceiling: nothing revives this.
  mk('b'.repeat(64), T0 - 60 * DAY, T0 - 30 * DAY);

  const result = await runNightlySweep(world.invocation(), { now: T0 });

  assert.equal(result.sessionsDeleted, 1);
  const left = world.d1.raw.prepare('SELECT id FROM sessions').all() as { id: string }[];
  assert.deepEqual(
    left.map((r) => r.id),
    ['a'.repeat(64)],
  );
  world.close();
});

test('the sweep prunes expired notifications but keeps open-ended ones', async () => {
  const world = createWorld();
  const user = world.makeUser();

  const mk = (kind: string, expiresAt: number | null) =>
    world.d1.raw
      .prepare(
        `INSERT INTO notifications (user_id, kind, title, body, created_at, expires_at)
         VALUES (?, ?, 'T', NULL, ?, ?)`,
      )
      .run(user.id, kind, T0 - DAY, expiresAt);

  mk('streak_risk', T0 - MINUTE);
  mk('streak_risk', null);

  const result = await runNightlySweep(world.invocation(), { now: T0 });

  assert.equal(result.notificationsDeleted, 1);
  const row = world.d1.raw
    .prepare('SELECT COUNT(*) AS n FROM notifications')
    .get() as { n: number };
  assert.equal(row.n, 1);
  world.close();
});

// --- Leaderboard -------------------------------------------------------------

test('a snapshot ranks only users who opted in', async () => {
  const world = createWorld();
  const optedIn = world.makeUser();
  const optedOut = world.makeUser();

  for (const u of [optedIn, optedOut]) {
    const paper = await start(world, u);
    await submitAllCorrect(world, u, paper);
  }

  world.d1.raw
    .prepare('UPDATE user_profiles SET leaderboard_opt_in = 1 WHERE user_id = ?')
    .run(optedIn.id);
  world.d1.raw
    .prepare('UPDATE user_profiles SET leaderboard_opt_in = 0 WHERE user_id = ?')
    .run(optedOut.id);

  const result = await runLeaderboardSnapshot(world.invocation(), { now: T0 });

  const allTime = result.boards.find((b) => b.period === 'all_time');
  assert.ok(allTime);
  assert.equal(allTime.ranked, 1);
  assert.equal(allTime.entrants, 1);

  const top = world.d1.raw
    .prepare('SELECT top_json FROM leaderboard_snapshots WHERE id = ?')
    .get(allTime.snapshotId) as { top_json: string };
  const parsed = JSON.parse(top.top_json) as { user_id: string; rank: number }[];
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].user_id, optedIn.id);
  assert.equal(parsed[0].rank, 1);

  world.close();
});

test('a snapshot writes one entry row per rank, and they agree with top_json', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);
  await submitAllCorrect(world, user, paper);
  world.d1.raw
    .prepare('UPDATE user_profiles SET leaderboard_opt_in = 1 WHERE user_id = ?')
    .run(user.id);

  const result = await runLeaderboardSnapshot(world.invocation(), { now: T0 });
  const allTime = result.boards.find((b) => b.period === 'all_time');
  assert.ok(allTime);

  const entries = world.d1.raw
    .prepare('SELECT rank, user_id, score, accuracy_bp, prev_rank FROM leaderboard_entries WHERE snapshot_id = ? ORDER BY rank')
    .all(allTime.snapshotId) as {
    rank: number;
    user_id: string;
    score: number;
    accuracy_bp: number | null;
    prev_rank: number | null;
  }[];

  assert.equal(entries.length, 1);
  assert.equal(entries[0].rank, 1);
  assert.equal(entries[0].user_id, user.id);
  // Every answer was correct, so accuracy is 100% in basis points.
  assert.equal(entries[0].accuracy_bp, 10_000);
  // First snapshot of this board, so there is no previous rank to show.
  assert.equal(entries[0].prev_rank, null);

  world.close();
});

test('the second snapshot carries the first run’s rank forward', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);
  await submitAllCorrect(world, user, paper);
  world.d1.raw
    .prepare('UPDATE user_profiles SET leaderboard_opt_in = 1 WHERE user_id = ?')
    .run(user.id);

  await runLeaderboardSnapshot(world.invocation(), { now: T0 });
  const second = await runLeaderboardSnapshot(world.invocation(), { now: T0 + 60 * MINUTE });

  const allTime = second.boards.find((b) => b.period === 'all_time');
  assert.ok(allTime);
  const entry = world.d1.raw
    .prepare('SELECT prev_rank FROM leaderboard_entries WHERE snapshot_id = ? AND user_id = ?')
    .get(allTime.snapshotId, user.id) as { prev_rank: number | null };
  assert.equal(entry.prev_rank, 1);

  world.close();
});

test('a board with nobody on it is still written, with an empty array', async () => {
  const world = createWorld();
  // Nobody has opted in, so every board is empty. The read path reads the
  // latest snapshot; if the job skipped empty boards it would serve a stale
  // one forever.
  const result = await runLeaderboardSnapshot(world.invocation(), { now: T0 });

  assert.equal(result.boards.length, 4);
  for (const board of result.boards) {
    assert.equal(board.ranked, 0);
    assert.equal(board.entrants, 0);
    const row = world.d1.raw
      .prepare('SELECT top_json FROM leaderboard_snapshots WHERE id = ?')
      .get(board.snapshotId) as { top_json: string };
    assert.equal(row.top_json, '[]');
  }
  world.close();
});

test('period windows are bucketed in Nepal time, not UTC', () => {
  // 23:30 UTC on 1 March is 05:15 on 2 March in Kathmandu (UTC+05:45), so the
  // daily board belongs to the 2nd. Bucketing in UTC would put a late-evening
  // Nepali study session on the wrong day, which is the same bug the streak
  // code avoids.
  const lateUtc = Date.parse('2026-03-01T23:30:00.000Z');
  assert.equal(periodWindow('daily', lateUtc).periodStart, '2026-03-02');

  // all_time uses the sentinel the schema's CHECK requires.
  assert.equal(periodWindow('all_time', lateUtc).periodStart, '0001-01-01');
  assert.equal(periodWindow('all_time', lateUtc).startMs, 0);

  // A monthly window starts on the first of the local month.
  assert.equal(periodWindow('monthly', lateUtc).periodStart, '2026-03-01');
});

// --- Dispatch ----------------------------------------------------------------

function envFor(world: TestWorld, overrides: Partial<Env> = {}): Env {
  return {
    DB: world.d1,
    APP_ORIGIN: 'https://app.test',
    CONTENT_PERMUTATION_SECRET: 'test-permutation-secret-0123456789abcdef',
    ...overrides,
  } as Env;
}

test('each declared cron expression reaches its job', async () => {
  const world = createWorld();
  const clock = fixedClock(T0);

  for (const [cron, job] of [
    [CRON_RETENTION, 'answer-retention'],
    [CRON_SWEEP, 'nightly-sweep'],
    [CRON_LEADERBOARD, 'leaderboard-snapshot'],
  ] as const) {
    const outcome = await handleScheduled({ cron }, envFor(world), { clock });
    assert.equal(outcome.ok, true, `${cron} should succeed`);
    assert.equal(outcome.job, job);
  }

  world.close();
});

test('an unregistered cron expression fails loudly', async () => {
  const world = createWorld();
  await assert.rejects(
    () => handleScheduled({ cron: '0 0 * * 0' }, envFor(world), { clock: fixedClock(T0) }),
    /No scheduled job is registered/,
  );
  world.close();
});

test('a delayed invocation computes the window it was scheduled for', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);
  await submitAllCorrect(world, user, paper);
  ageAttempt(world, paper.attemptId, T0 - 120 * DAY);

  // The clock says a week later than the scheduled time. Using the clock
  // would be harmless here, but using `scheduledTime` is what makes a retried
  // invocation compute the same window as the original.
  const outcome = await handleScheduled(
    { cron: CRON_RETENTION, scheduledTime: T0 },
    envFor(world),
    { clock: fixedClock(T0 + 7 * DAY) },
  );

  assert.equal(outcome.ok, true);
  assert.equal(outcome.retentionDays, 90);
  assert.ok((outcome.answersDeleted as number) > 0);
  world.close();
});

test('ANSWER_RETENTION_DAYS is validated, not silently defaulted', () => {
  assert.equal(retentionDays({} as Env), 90);
  assert.equal(retentionDays({ ANSWER_RETENTION_DAYS: '180' } as Env), 180);
  // A typo must not quietly become a 90-day window, or a 7-day one.
  assert.throws(() => retentionDays({ ANSWER_RETENTION_DAYS: '90 days' } as Env), /Invalid/);
  assert.throws(() => retentionDays({ ANSWER_RETENTION_DAYS: '3' } as Env), /Invalid/);
  assert.throws(() => retentionDays({ ANSWER_RETENTION_DAYS: '9999' } as Env), /Invalid/);
});

test('every job stays inside one Worker invocation’s query budget', async () => {
  const world = createWorld();
  const user = world.makeUser();
  const paper = await start(world, user);
  await submitAllCorrect(world, user, paper);
  world.d1.raw
    .prepare('UPDATE user_profiles SET leaderboard_opt_in = 1 WHERE user_id = ?')
    .run(user.id);

  // D1's free plan allows 50 queries per invocation. A job that needs more
  // than that cannot run at all, so this is a hard ceiling rather than a
  // performance note.
  for (const cron of [CRON_RETENTION, CRON_SWEEP, CRON_LEADERBOARD]) {
    const outcome = await handleScheduled({ cron, scheduledTime: T0 }, envFor(world), {
      clock: fixedClock(T0),
    });
    assert.ok(
      (outcome.queries as number) <= 48,
      `${cron} used ${String(outcome.queries)} queries`,
    );
  }

  world.close();
});
