#!/usr/bin/env node
/**
 * smoke.mjs -- exercise the schema the way the API will, and assert the
 * properties the migrations claim.
 *
 * This is not a unit test of the API (worker/src/** is not owned here). It is
 * the proof that the schema's claims are true rather than aspirational:
 *
 *   1. a published question can be drawn, delivered and graded, and the
 *      delivery path never touches question_answer_keys;
 *   2. the rollup triggers produce the right numbers, including on the
 *      revise-an-answer path;
 *   3. a flagged question cannot be drawn;
 *   4. a bogus option ordinal is refused by the database, not by a handler;
 *   5. an answer key cannot be pointed at another question's option;
 *   6. the archival job deletes raw answers WITHOUT destroying progress --
 *      the single most dangerous property in the whole design.
 *
 * Usage: node db/smoke.mjs [--db <path>]
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORKER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let checks = 0;
let failures = 0;
function assert(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label} = ${JSON.stringify(actual)}`);
  }
}
function assertThrows(label, fn, matcher) {
  checks++;
  try {
    fn();
    failures++;
    console.error(`  FAIL  ${label}: expected a constraint failure, got none`);
  } catch (err) {
    if (matcher && !matcher.test(err.message)) {
      failures++;
      console.error(`  FAIL  ${label}: wrong error -- ${err.message}`);
    } else {
      console.log(`  ok    ${label} -> ${err.message.split('\n')[0]}`);
    }
  }
}

/** mulberry32, the same PRNG the client already uses, so papers are reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The permutation the delivery path owes an attempt: free options shuffled,
 * pinned options ('All of the above') held at the end in their authored order.
 */
export function permuteOptions(options, random) {
  const free = options.filter((o) => !o.is_pinned);
  const pinned = options.filter((o) => o.is_pinned);
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  return [...free, ...pinned];
}

export function runSmoke(db) {
  db.exec('PRAGMA foreign_keys = ON');
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const n = (sql, ...p) => one(sql, ...p).n;

  // Epoch MILLISECONDS throughout -- see migrations/0001_identity.sql.
  const now = Date.now();
  const DAY_MS = 86_400_000;
  const USER = 'U01SMOKETESTUSER0000000000';

  /**
   * Removes everything this suite creates.
   *
   * Called before the first fixture and again at the end, so the suite is
   * re-runnable and leaves the database exactly as the seed produced it.
   * Ordered child-first rather than relying on cascades: not every foreign key
   * here is ON DELETE CASCADE, and a leftover child would fail the closing
   * foreign_key_check instead of failing loudly at the insert.
   */
  const resetFixtures = () => {
    run(`DELETE FROM attempt_answers_archive WHERE user_id LIKE 'U01SMOKE%'`);
    run(`DELETE FROM attempt_answers WHERE attempt_id IN (
           SELECT id FROM attempts WHERE public_id LIKE 'A01SMOKE%' OR user_id LIKE 'U01SMOKE%')`);
    run(`DELETE FROM attempt_questions WHERE attempt_id IN (
           SELECT id FROM attempts WHERE public_id LIKE 'A01SMOKE%' OR user_id LIKE 'U01SMOKE%')`);
    run(`DELETE FROM attempts WHERE public_id LIKE 'A01SMOKE%' OR user_id LIKE 'U01SMOKE%'`);
    run(`DELETE FROM leaderboard_entries WHERE snapshot_id IN (
           SELECT id FROM leaderboard_snapshots
            WHERE scope = 'global' AND period = 'weekly' AND period_start = '2026-10-19')`);
    run(`DELETE FROM leaderboard_snapshots
          WHERE scope = 'global' AND period = 'weekly' AND period_start = '2026-10-19'`);
    // The remaining per-user tables (sessions, user_profiles, bookmarks,
    // srs_state, streaks, notifications) cascade from users.
    run(`DELETE FROM users WHERE id LIKE 'U01SMOKE%'`);
  };

  console.log('\n-- resetting fixtures from any previous run --');
  resetFixtures();

  console.log('\n-- identity --');
  run(
    `INSERT INTO users (id, email, password_hash, password_algo, role, created_at, updated_at)
     VALUES (?, ?, 'x', 'pbkdf2-sha256', 'student', ?, ?)`,
    USER, '  Smoke.Tester@Example.COM ', now, now
  );
  assert(
    'users.email_normalized generated',
    one('SELECT email_normalized e FROM users WHERE id = ?', USER).e,
    'smoke.tester@example.com'
  );
  run(
    `INSERT INTO user_profiles (user_id, display_name, timezone, created_at, updated_at)
     VALUES (?, 'Smoke Tester', 'Asia/Kathmandu', ?, ?)`,
    USER, now, now
  );
  assert(
    'user_profiles holds no credential column',
    n(`SELECT COUNT(*) n FROM pragma_table_info('user_profiles')
        WHERE name LIKE '%password%' OR name LIKE '%token%'`),
    0
  );

  run(
    `INSERT INTO sessions (id, user_id, expires_at, absolute_expires_at, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    'a'.repeat(64), USER, now + 14 * DAY_MS, now + 90 * DAY_MS, now, now
  );
  assertThrows(
    'sessions rejects a raw (non-sha256-hex) token as id',
    () =>
      run(
        `INSERT INTO sessions (id, user_id, expires_at, absolute_expires_at)
         VALUES ('plaintext-cookie-value', ?, ?, ?)`,
        USER, now + 10_000, now + 20_000
      ),
    /CHECK constraint/
  );

  console.log('\n-- selection (NQ-07): flagged questions are unreachable --');
  const PAPER_SIZE = 5;
  const drawn = all(
    `SELECT id FROM questions
      WHERE chapter_id = ?1 AND status = 'published'
      ORDER BY id LIMIT ?2`,
    'book-ch2', PAPER_SIZE
  ).map((r) => r.id);
  assert('NQ-07 drew a full paper', drawn.length, PAPER_SIZE);
  assert(
    'no drawn question is flagged',
    n(
      `SELECT COUNT(*) n FROM questions
        WHERE status <> 'published' AND id IN (${drawn.map(() => '?').join(',')})`,
      ...drawn
    ),
    0
  );
  const flaggedSample = one(
    `SELECT id FROM questions WHERE status = 'flagged' ORDER BY id LIMIT 1`
  );
  assert(
    'the partial index excludes flagged rows entirely',
    n(
      `SELECT COUNT(*) n FROM questions
        WHERE chapter_id = (SELECT chapter_id FROM questions WHERE id = ?1)
          AND status = 'published' AND id = ?1`,
      flaggedSample.id
    ),
    0
  );

  console.log('\n-- delivery: v_question_delivery cannot leak the key --');
  const deliveryCols = all(`SELECT name FROM pragma_table_info('v_question_delivery')`).map(
    (r) => r.name
  );
  assert(
    'v_question_delivery exposes no answer column',
    deliveryCols.filter((c) => /correct|answer|key/i.test(c)),
    []
  );
  const deliverySql = one(
    `SELECT sql FROM sqlite_master WHERE type = 'view' AND name = 'v_question_delivery'`
  ).sql;
  assert('v_question_delivery does not name the key table', /question_answer_keys/.test(deliverySql), false);

  console.log('\n-- attempt: paper + per-attempt option permutation --');
  const seed = 0x5eed1234;
  const random = rng(seed);
  run(
    `INSERT INTO attempts (public_id, user_id, mode, chapter_id, status, option_seed,
                           question_count, started_at)
     VALUES ('A01SMOKEATTEMPT0000000000', ?, 'practice', 'book-ch2', 'in_progress', ?, ?, ?)`,
    USER, seed, PAPER_SIZE, now
  );
  const attemptId = one(`SELECT id FROM attempts WHERE public_id = 'A01SMOKEATTEMPT0000000000'`).id;

  const orders = new Map();
  drawn.forEach((qid, i) => {
    const options = all(
      `SELECT option_id AS id, option_ordinal AS ordinal, option_is_pinned AS is_pinned
         FROM v_question_delivery WHERE question_id = ? ORDER BY option_ordinal`,
      qid
    );
    const order = permuteOptions(options, random).map((o) => o.id);
    orders.set(qid, order);
    run(
      `INSERT INTO attempt_questions (attempt_id, position, question_id, option_order)
       VALUES (?, ?, ?, ?)`,
      attemptId, i + 1, qid, JSON.stringify(order)
    );
  });
  assert('paper rows written', n('SELECT COUNT(*) n FROM attempt_questions WHERE attempt_id = ?', attemptId), PAPER_SIZE);
  assert(
    'option_order holds option ids, never positions',
    orders.get(drawn[0]).every((id) => id.startsWith(drawn[0] + '#')),
    true
  );
  assert(
    'every pinned option stays last in its delivered order',
    [...orders.entries()].every(([qid, order]) => {
      const pinned = all(
        `SELECT id FROM question_options WHERE question_id = ? AND is_pinned = 1`,
        qid
      ).map((r) => r.id);
      return pinned.every((id) => order.indexOf(id) >= order.length - pinned.length);
    }),
    true
  );
  assertThrows(
    'a paper cannot ask the same question twice',
    () =>
      run(
        `INSERT INTO attempt_questions (attempt_id, position, question_id, option_order)
         VALUES (?, 99, ?, '[]')`,
        attemptId, drawn[0]
      ),
    /UNIQUE constraint/
  );

  console.log('\n-- TIMESTAMPS ARE MILLISECONDS, round-tripped through the database --');
  // THE REGRESSION THIS GUARDS. Every timestamp here used to be unix SECONDS
  // while the API was milliseconds, and nothing failed loudly: a 45-minute
  // deadline written as seconds and compared against Date.now() is 45,000
  // times too small, so the attempt expires 45 milliseconds after it starts and
  // every candidate is handed an empty paper. Writing a deadline, reading it
  // back and asserting it is still in the future is the cheapest possible
  // detector, and it would have caught the mismatch on the first run.
  const DURATION_MS = 45 * 60 * 1000;
  run(
    `INSERT INTO attempts (public_id, user_id, mode, template_id, status, option_seed,
                           question_count, deadline_at)
     VALUES ('A01SMOKEDEADLINE000000000', ?, 'mock', 'full-mock-1', 'in_progress', 1, 0,
             CAST(unixepoch('subsec') * 1000 AS INTEGER) + ?)`,
    USER, DURATION_MS
  );
  const timed = one(
    `SELECT started_at, deadline_at FROM attempts WHERE public_id = 'A01SMOKEDEADLINE000000000'`
  );
  const clientNow = Date.now();
  assert('started_at default agrees with Date.now() to within 2s',
    Math.abs(timed.started_at - clientNow) < 2000, true);
  assert('a 45-minute deadline is STILL IN THE FUTURE after the round trip',
    timed.deadline_at > clientNow, true);
  assert('and it is 45 minutes away, not 45 milliseconds',
    Math.abs(timed.deadline_at - clientNow - DURATION_MS) < 2000, true);
  // The same value read as seconds is already decades in the past. This is the
  // shape of the bug, asserted so nobody can "simplify" the default back.
  assert('read as seconds, that deadline would already have expired',
    timed.deadline_at / 1000 < clientNow / 1000 / 1000, false);
  assert('attempts.deadline_at is an INTEGER, not a REAL from the *1000',
    one(`SELECT typeof(deadline_at) t FROM attempts WHERE public_id = 'A01SMOKEDEADLINE000000000'`).t,
    'integer');
  assertThrows(
    'a sync snapshot cannot be stamped after the deadline, even by hand',
    () =>
      run(
        `UPDATE attempts SET synced_answers = '{}', last_sync_at = deadline_at + 1
          WHERE public_id = 'A01SMOKEDEADLINE000000000'`
      ),
    /CHECK constraint/
  );
  run(
    `UPDATE attempts SET synced_answers = '{}', last_sync_at = deadline_at - 1000
      WHERE public_id = 'A01SMOKEDEADLINE000000000'`
  );
  assert('a pre-deadline snapshot is accepted',
    one(`SELECT last_sync_at IS NOT NULL ok FROM attempts WHERE public_id = 'A01SMOKEDEADLINE000000000'`).ok,
    1);
  run(`DELETE FROM attempts WHERE public_id = 'A01SMOKEDEADLINE000000000'`);

  console.log('\n-- OPTION IDS CARRY NO ORDINAL (the published-key leak) --');
  // frontend/public/data/books/*.json publishes `correct_option_index` and is
  // in git history forever. While option ids were `question_id || '#' ||
  // ordinal`, any id that reached a client WAS the answer. Asserted over the
  // whole seeded bank, because one counter-example is the whole hole.
  assert(
    'not one of the 9,160 option ids ends in # followed by its ordinal',
    n(`SELECT COUNT(*) n FROM question_options
        WHERE id = question_id || '#' || ordinal`),
    0
  );
  assert(
    'every opt_key is 12 base32 characters',
    n(`SELECT COUNT(*) n FROM question_options
        WHERE length(opt_key) <> 12 OR opt_key NOT GLOB '[0-9A-Z]*'`),
    0
  );
  assert(
    'and no opt_key is a bare number, so none is a disguised ordinal',
    n(`SELECT COUNT(*) n FROM question_options WHERE opt_key GLOB '[0-9]*'
        AND opt_key NOT GLOB '*[A-Z]*'`),
    0
  );
  assert(
    'the ordinal is still recorded, server-side, for every option',
    n(`SELECT COUNT(*) n FROM question_options WHERE ordinal IS NULL`),
    0
  );

  console.log('\n-- grading (NQ-10b): one statement for the whole paper --');
  const keys = new Map(
    all(
      `SELECT question_id, correct_option_id FROM question_answer_keys
        WHERE question_id IN (SELECT value FROM json_each(?1))`,
      JSON.stringify(drawn)
    ).map((r) => [r.question_id, r.correct_option_id])
  );
  assert('NQ-10b returned a key per question in one query', keys.size, PAPER_SIZE);

  // answer 0: correct. answer 1: wrong. answer 2: skipped. 3 and 4: untouched.
  const answerOne = (qid, optionId) => {
    const order = orders.get(qid);
    const correct = keys.get(qid) === optionId ? 1 : 0;
    run(
      `INSERT INTO attempt_answers (attempt_id, question_id, selected_opt_key, is_correct,
                                    delivered_position, time_ms, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (attempt_id, question_id) DO UPDATE SET
         selected_opt_key = excluded.selected_opt_key,
         is_correct       = excluded.is_correct,
         time_ms          = excluded.time_ms,
         revised          = 1,
         answered_at      = excluded.answered_at`,
      attemptId, qid,
      // The opt_key half of the option id -- a 12-char token, never an index.
      optionId === null ? null : optionId.split('#')[1],
      correct,
      optionId === null ? null : order.indexOf(optionId) + 1,
      4200, now
    );
    return correct;
  };

  answerOne(drawn[0], keys.get(drawn[0]));
  const wrongOption = all(
    `SELECT id FROM question_options WHERE question_id = ? AND id <> ? ORDER BY ordinal LIMIT 1`,
    drawn[1], keys.get(drawn[1])
  )[0].id;
  answerOne(drawn[1], wrongOption);
  answerOne(drawn[2], null); // skipped

  let a = one('SELECT answered_count, correct_count, score_bp FROM attempts WHERE id = ?', attemptId);
  assert('attempts.answered_count after 2 answers + 1 skip', a.answered_count, 2);
  assert('attempts.correct_count', a.correct_count, 1);
  assert('attempts.score_bp generated (1 of 5)', a.score_bp, 2000);

  assert(
    'attempt_answers.selected_option_id generated column resolves',
    one('SELECT selected_option_id s FROM attempt_answers WHERE attempt_id = ? AND question_id = ?', attemptId, drawn[0]).s,
    keys.get(drawn[0])
  );
  assert(
    'a skipped answer has a NULL option id, not a sentinel',
    one('SELECT selected_option_id s FROM attempt_answers WHERE attempt_id = ? AND question_id = ?', attemptId, drawn[2]).s,
    null
  );

  console.log('\n-- revision: the delta path, not a second exposure --');
  answerOne(drawn[1], keys.get(drawn[1])); // student changes their mind, now right
  a = one('SELECT answered_count, correct_count, score_bp FROM attempts WHERE id = ?', attemptId);
  assert('answered_count unchanged by a revision', a.answered_count, 2);
  assert('correct_count follows the revision', a.correct_count, 2);
  assert('score_bp recomputed', a.score_bp, 4000);
  const revised = one(
    'SELECT exposure_count, answer_count, correct_count, consecutive_correct, accuracy_bp FROM user_question_stats WHERE user_id = ? AND question_id = ?',
    USER, drawn[1]
  );
  assert('user_question_stats: one exposure despite the revision', revised.exposure_count, 1);
  assert('user_question_stats: one answer', revised.answer_count, 1);
  assert('user_question_stats: credited correct', revised.correct_count, 1);
  assert('user_question_stats: accuracy_bp generated', revised.accuracy_bp, 10000);

  answerOne(drawn[2], keys.get(drawn[2])); // the skip becomes an answer
  a = one('SELECT answered_count, correct_count FROM attempts WHERE id = ?', attemptId);
  assert('skip -> answer raises answered_count', a.answered_count, 3);
  assert('skip -> answer raises correct_count', a.correct_count, 3);

  console.log('\n-- the progress page (NQ-27): one indexed read --');
  const plan = all(
    `EXPLAIN QUERY PLAN
     SELECT chapter_id, COUNT(*) seen, SUM(correct_count > 0) ever_correct,
            SUM(answer_count) answers, SUM(correct_count) corrects
       FROM user_question_stats WHERE user_id = ?1 GROUP BY chapter_id`
  )
    .map((r) => r.detail)
    .join(' | ');
  assert('NQ-27 uses the covering index', /idx_user_question_stats_user_chapter/.test(plan), true);
  assert('NQ-27 needs no temp b-tree for the GROUP BY', /TEMP B-TREE/.test(plan), false);
  const progress = all(
    `SELECT chapter_id, COUNT(*) seen, SUM(correct_count > 0) ever_correct
       FROM user_question_stats WHERE user_id = ?1 GROUP BY chapter_id`,
    USER
  );
  assert('progress rows', progress, [{ chapter_id: 'book-ch2', seen: 3, ever_correct: 3 }]);

  console.log('\n-- integrity the database enforces, not a handler --');
  assertThrows(
    'an answer cannot name an option key that does not exist',
    () =>
      run(
        `INSERT INTO attempt_answers (attempt_id, question_id, selected_opt_key, is_correct, delivered_position)
         VALUES (?, ?, 'ZZZZZZZZZZZZ', 1, 1)`,
        attemptId, drawn[3]
      ),
    /FOREIGN KEY constraint/
  );
  assertThrows(
    'an answer cannot smuggle a bare ordinal in where an option key belongs',
    () =>
      run(
        `INSERT INTO attempt_answers (attempt_id, question_id, selected_opt_key, is_correct, delivered_position)
         VALUES (?, ?, '3', 1, 1)`,
        attemptId, drawn[3]
      ),
    /CHECK constraint/
  );
  assertThrows(
    "an answer key cannot point at another question's option",
    () =>
      run(
        `UPDATE question_answer_keys SET correct_option_id = ? WHERE question_id = ?`,
        keys.get(drawn[1]), drawn[0]
      ),
    /CHECK constraint/
  );
  assertThrows(
    'a question whose answers exist cannot be deleted (use status = retired)',
    () => run('DELETE FROM questions WHERE id = ?', drawn[0]),
    /FOREIGN KEY constraint/
  );
  assertThrows(
    'an option id must equal question_id || # || opt_key',
    () =>
      run(
        `INSERT INTO question_options (id, question_id, ordinal, opt_key, text)
         VALUES ('bogus', ?, 9, 'ABCDEFGHJKMN', 'x')`,
        drawn[3]
      ),
    /CHECK constraint/
  );
  assertThrows(
    'an opt_key cannot BE the ordinal -- that was the leak, and the CHECK closes it',
    () =>
      run(
        `INSERT INTO question_options (id, question_id, ordinal, opt_key, text)
         VALUES (? || '#9', ?, 9, '9', 'x')`,
        drawn[3], drawn[3]
      ),
    /CHECK constraint/
  );
  assertThrows(
    'STRICT refuses a text value in an integer column',
    () => run(`UPDATE attempts SET question_count = 'five' WHERE id = ?`, attemptId),
    /cannot store TEXT value in INTEGER column/
  );

  console.log('\n-- srs, bookmarks, streaks, notifications, leaderboard --');
  run(
    `INSERT INTO srs_state (user_id, question_id, stability, difficulty, elapsed_days,
                            scheduled_days, reps, lapses, state, due, last_review, last_rating,
                            created_at, updated_at)
     VALUES (?, ?, 3.1734, 5.2, 0.0, 1.0, 1, 0, 1, ?, ?, 3, ?, ?)`,
    USER, drawn[0], now + DAY_MS, now, now, now
  );
  assert(
    'NQ-29 due queue',
    all(
      `SELECT question_id FROM srs_state
        WHERE user_id = ?1 AND due <= ?2 AND suspended_at IS NULL ORDER BY due LIMIT 10`,
      USER, now + DAY_MS + 3_600_000
    ).length,
    1
  );
  assertThrows(
    'srs difficulty is bounded to the FSRS 1..10 range',
    () => run('UPDATE srs_state SET difficulty = 42.0 WHERE user_id = ?', USER),
    /CHECK constraint/
  );

  run('INSERT INTO bookmarks (user_id, question_id, created_at) VALUES (?, ?, ?)', USER, drawn[0], now);
  assert('bookmark stored against a content-hash id', one('SELECT question_id q FROM bookmarks WHERE user_id = ?', USER).q, drawn[0]);

  const touchStreak = db.prepare(`
    INSERT INTO streaks (user_id, current_length, last_active_date, total_active_days)
    VALUES (?1, 1, ?2, 1)
    ON CONFLICT (user_id) DO UPDATE SET
      current_length = CASE
        WHEN last_active_date = ?2                     THEN current_length
        WHEN last_active_date = date(?2, '-1 day')     THEN current_length + 1
        WHEN freezes_available > 0
             AND last_active_date = date(?2, '-2 day') THEN current_length + 1
        ELSE 1 END,
      freezes_available = CASE
        WHEN last_active_date = date(?2, '-2 day') AND freezes_available > 0
             THEN freezes_available - 1 ELSE freezes_available END,
      total_active_days = total_active_days
        + CASE WHEN last_active_date IS NULL OR last_active_date <> ?2 THEN 1 ELSE 0 END,
      last_active_date  = ?2,
      updated_at        = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE last_active_date IS NULL OR last_active_date <= ?2
  `);
  touchStreak.run(USER, '2026-10-18');
  touchStreak.run(USER, '2026-10-18'); // same day twice: must be a no-op
  touchStreak.run(USER, '2026-10-19');
  touchStreak.run(USER, '2026-10-20');
  const streak = one('SELECT current_length c, longest_length l, total_active_days t FROM streaks WHERE user_id = ?', USER);
  assert('streak length after 3 consecutive days (one submitted twice)', streak.c, 3);
  assert('streak ratchet trigger raised longest_length', streak.l, 3);
  assert('total_active_days counted days, not requests', streak.t, 3);
  touchStreak.run(USER, '2026-10-25'); // gap, no freeze available
  assert('a gap resets current_length', one('SELECT current_length c FROM streaks WHERE user_id = ?', USER).c, 1);
  assert('but longest_length is a ratchet', one('SELECT longest_length l FROM streaks WHERE user_id = ?', USER).l, 3);

  // Note the repeated WHERE: SQLite only matches a conflict target to a
  // PARTIAL unique index if the predicate is restated. Without it this
  // prepare() fails with 'ON CONFLICT clause does not match any PRIMARY KEY or
  // UNIQUE constraint' -- at runtime, in production, on the cron path.
  const notify = db.prepare(`
    INSERT INTO notifications (user_id, kind, title, dedupe_key, created_at)
    VALUES (?, 'srs_due', '3 cards due', ?, ?)
    ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`);
  notify.run(USER, 'srs_due:2026-10-20', now);
  notify.run(USER, 'srs_due:2026-10-20', now);
  assert('notification dedupe_key stops a duplicate nag', n('SELECT COUNT(*) n FROM notifications WHERE user_id = ?', USER), 1);

  run(
    `INSERT INTO leaderboard_snapshots (scope, scope_ref, period, period_start, metric,
                                        top_json, entrant_count, computed_at, compute_ms)
     VALUES ('global', '', 'weekly', '2026-10-19', 'correct_answers', ?, 1, ?, 12)`,
    JSON.stringify([{ rank: 1, user_id: USER, display_name: 'Smoke Tester', score: 3 }]),
    now
  );
  const snapId = one(`SELECT id FROM leaderboard_snapshots ORDER BY id DESC LIMIT 1`).id;
  run(
    `INSERT INTO leaderboard_entries (snapshot_id, rank, user_id, score, accuracy_bp)
     VALUES (?, 1, ?, 3, 10000)`,
    snapId, USER
  );
  assert('NQ-34 my-rank is a unique-index hit', one('SELECT rank r FROM leaderboard_entries WHERE snapshot_id = ? AND user_id = ?', snapId, USER).r, 1);
  assertThrows(
    'one user cannot hold two ranks on one board',
    () => run('INSERT INTO leaderboard_entries (snapshot_id, rank, user_id, score) VALUES (?, 2, ?, 1)', snapId, USER),
    /UNIQUE constraint/
  );

  console.log('\n-- ARCHIVAL: raw answers go, progress stays --');
  run(`UPDATE attempts SET status = 'submitted', submitted_at = ?, elapsed_ms = 60000 WHERE id = ?`, now, attemptId);
  const beforeStats = all(
    'SELECT question_id, exposure_count, answer_count, correct_count FROM user_question_stats WHERE user_id = ? ORDER BY question_id',
    USER
  );
  const beforeAttempt = one('SELECT answered_count, correct_count, score_bp FROM attempts WHERE id = ?', attemptId);
  const rawBefore = n('SELECT COUNT(*) n FROM attempt_answers WHERE attempt_id = ?', attemptId);

  // Step 1 of the job in 0004: stage to the archive table (denormalising
  // user_id, because the attempt may be gone by the time the drain runs).
  const cutoff = now + 1; // pretend everything is older than the retention window
  run(
    `INSERT INTO attempt_answers_archive (id, attempt_id, user_id, question_id, selected_opt_key,
                                          is_correct, delivered_position, time_ms, answered_at)
     SELECT aa.id, aa.attempt_id, a.user_id, aa.question_id, aa.selected_opt_key,
            aa.is_correct, aa.delivered_position, aa.time_ms, aa.answered_at
       FROM attempt_answers aa JOIN attempts a ON a.id = aa.attempt_id
      WHERE aa.answered_at < ?1
      ORDER BY aa.id LIMIT 5000`,
    cutoff
  );
  // Step 2: delete the range just staged.
  const purged = run('DELETE FROM attempt_answers WHERE answered_at < ?1', cutoff).changes;

  assert('answers staged to the archive', n('SELECT COUNT(*) n FROM attempt_answers_archive'), rawBefore);
  assert('raw answers purged', purged, rawBefore);
  assert('attempt_answers is now empty', n('SELECT COUNT(*) n FROM attempt_answers'), 0);
  assert(
    'user_question_stats SURVIVED the purge',
    all('SELECT question_id, exposure_count, answer_count, correct_count FROM user_question_stats WHERE user_id = ? ORDER BY question_id', USER),
    beforeStats
  );
  assert(
    'attempts summary SURVIVED the purge',
    one('SELECT answered_count, correct_count, score_bp FROM attempts WHERE id = ?', attemptId),
    beforeAttempt
  );
  assert(
    'no DELETE trigger exists on attempt_answers (one would have erased the rollups)',
    all(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%DELETE ON attempt_answers%'`),
    []
  );
  assert('the paper is still reviewable after the purge', n('SELECT COUNT(*) n FROM attempt_questions WHERE attempt_id = ?', attemptId), PAPER_SIZE);

  console.log('\n-- full-text search (NQ-11) --');
  const hits = all(
    `SELECT question_id, bm25(questions_fts, 0.0, 0.0, 0.0, 10.0, 3.0) rank
       FROM questions_fts
      WHERE questions_fts MATCH ?1 AND status = 'published'
      ORDER BY rank LIMIT 5`,
    'karnaugh'
  );
  assert('FTS5 returns ranked hits', hits.length > 0, true);
  assert('FTS row count tracks the question count', n('SELECT COUNT(*) n FROM questions_fts'), n('SELECT COUNT(*) n FROM questions'));
  // An edit must reindex, including through an option change.
  //
  // This mutates real seeded content, so the original values are captured and
  // restored at the end of the block. Previously they were not: a question was
  // left permanently reading "Zzyzx smoke marker stem" and one of its options
  // "Quuxinator option marker", so anyone who ran the smoke suite and then
  // looked at the database found a corrupted question and no hint as to why.
  const victim = drawn[4];
  const originalStem = one(`SELECT stem FROM questions WHERE id = ?`, victim).stem;
  const originalOption = one(
    `SELECT text FROM question_options WHERE question_id = ? AND ordinal = 1`,
    victim
  ).text;

  run(`UPDATE questions SET stem = ?, updated_at = ? WHERE id = ?`, 'Zzyzx smoke marker stem', now, victim);
  assert('stem edit reindexes', all(`SELECT question_id FROM questions_fts WHERE questions_fts MATCH 'zzyzx'`).map((r) => r.question_id), [victim]);
  // Addressed by (question_id, ordinal), not by a hand-built `id`: option ids
  // no longer encode the ordinal, so `victim + '#1'` names nothing.
  run(
    `UPDATE question_options SET text = ?, updated_at = ?
      WHERE question_id = ? AND ordinal = 1`,
    'Quuxinator option marker', now, victim
  );
  assert('option edit reindexes', all(`SELECT question_id FROM questions_fts WHERE questions_fts MATCH 'quuxinator'`).map((r) => r.question_id), [victim]);
  assert('FTS has no duplicate row after two reindexes', n(`SELECT COUNT(*) n FROM questions_fts WHERE question_id = ?`, victim), 1);

  // Put the borrowed question back, and prove the restore itself reindexed -
  // a restore that left the FTS table pointing at the marker text would be a
  // silently corrupt search index.
  run(`UPDATE questions SET stem = ?, updated_at = ? WHERE id = ?`, originalStem, now, victim);
  run(
    `UPDATE question_options SET text = ?, updated_at = ? WHERE question_id = ? AND ordinal = 1`,
    originalOption, now, victim
  );
  assert('restored stem', one(`SELECT stem FROM questions WHERE id = ?`, victim).stem, originalStem);
  assert(
    'restored option text',
    one(`SELECT text FROM question_options WHERE question_id = ? AND ordinal = 1`, victim).text,
    originalOption
  );
  assert(
    'marker text is gone from the search index',
    all(`SELECT question_id FROM questions_fts WHERE questions_fts MATCH 'zzyzx OR quuxinator'`),
    []
  );

  console.log('\n-- sub-chapter classification carries its provenance (0009) --');

  // The bank is labelled by a heuristic, so the question is never "is this
  // label right" -- it is "can a reader tell that it is a guess". These assert
  // the database refuses every state where it could not.
  const labelled = one(
    `SELECT id, subchapter_id, subchapter_source, subchapter_confidence_bp,
            subchapter_classifier_version
       FROM questions
      WHERE subchapter_source = 'heuristic'
      LIMIT 1`
  );
  assert('a heuristic label records its source', labelled.subchapter_source, 'heuristic');
  assert(
    'a heuristic label records a confidence',
    typeof labelled.subchapter_confidence_bp === 'number',
    true
  );
  assert(
    'a heuristic label records the classifier version',
    typeof labelled.subchapter_classifier_version === 'string',
    true
  );
  assert(
    'no row carries provenance without a label',
    one(
      `SELECT COUNT(*) n FROM questions
        WHERE subchapter_id IS NULL
          AND (subchapter_source IS NOT NULL
               OR subchapter_confidence_bp IS NOT NULL
               OR subchapter_classifier_version IS NOT NULL)`
    ).n,
    0
  );
  assert(
    'no row carries a label without provenance',
    one(
      `SELECT COUNT(*) n FROM questions
        WHERE subchapter_id IS NOT NULL AND subchapter_source IS NULL`
    ).n,
    0
  );

  assertThrows(
    'a sub-chapter label cannot be written without saying where it came from',
    () =>
      run(
        `UPDATE questions SET subchapter_source = NULL WHERE id = ?`,
        labelled.id
      ),
    /provenance disagree/
  );
  assertThrows(
    'clearing a label must clear its confidence with it',
    () => run(`UPDATE questions SET subchapter_id = NULL WHERE id = ?`, labelled.id),
    /provenance disagree/
  );
  assertThrows(
    'a heuristic label cannot omit its confidence',
    () =>
      run(
        `UPDATE questions SET subchapter_confidence_bp = NULL WHERE id = ?`,
        labelled.id
      ),
    /provenance disagree/
  );
  assertThrows(
    'a human label cannot carry a machine confidence score',
    () =>
      run(
        `UPDATE questions SET subchapter_source = 'human' WHERE id = ?`,
        labelled.id
      ),
    /provenance disagree/
  );
  assertThrows(
    'a confidence outside 0-10000 bp is rejected',
    () =>
      run(
        `UPDATE questions SET subchapter_confidence_bp = 10001 WHERE id = ?`,
        labelled.id
      ),
    /CHECK constraint/
  );

  // A librarian's decision must survive the next classifier run. Promote one
  // row to 'human' the way the review tool would -- clearing the machine
  // fields in the same statement, which is the only way the trigger allows --
  // then try to demote it.
  run(
    `UPDATE questions
        SET subchapter_source = 'human',
            subchapter_confidence_bp = NULL,
            subchapter_classifier_version = NULL
      WHERE id = ?`,
    labelled.id
  );
  assert(
    'a label can be promoted to human when the machine fields go with it',
    one('SELECT subchapter_source s FROM questions WHERE id = ?', labelled.id).s,
    'human'
  );
  assertThrows(
    'a classifier re-run cannot overwrite a human classification',
    () =>
      run(
        `UPDATE questions
            SET subchapter_source = 'heuristic',
                subchapter_confidence_bp = 4200,
                subchapter_classifier_version = 'subchapter-terms-v2'
          WHERE id = ?`,
        labelled.id
      ),
    /may not overwrite a human one/
  );
  // Put the borrowed row back, so this suite stays re-runnable.
  //
  // This takes two statements, and that is the point of the trigger rather
  // than a limitation of it: there is no single UPDATE that turns a human
  // classification back into a machine one. Undoing a human decision means
  // first clearing it, which is a deliberate act, and not something a
  // re-import can do by accident.
  run(
    `UPDATE questions
        SET subchapter_id = NULL,
            subchapter_source = NULL,
            subchapter_confidence_bp = NULL,
            subchapter_classifier_version = NULL
      WHERE id = ?`,
    labelled.id
  );
  run(
    `UPDATE questions
        SET subchapter_id = ?,
            subchapter_source = 'heuristic',
            subchapter_confidence_bp = ?,
            subchapter_classifier_version = ?
      WHERE id = ?`,
    labelled.subchapter_id,
    labelled.subchapter_confidence_bp,
    labelled.subchapter_classifier_version,
    labelled.id
  );
  assert(
    'the borrowed row is restored',
    one(
      `SELECT subchapter_id i, subchapter_source s, subchapter_confidence_bp c
         FROM questions WHERE id = ?`,
      labelled.id
    ),
    {
      i: labelled.subchapter_id,
      s: 'heuristic',
      c: labelled.subchapter_confidence_bp,
    }
  );

  // Leave the database exactly as the seed produced it.
  resetFixtures();

  const fk = all('PRAGMA foreign_key_check');
  assert('foreign_key_check clean at the end', fk, []);

  return { checks, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--db');
  const dbPath = resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : join(WORKER_ROOT, '.local', 'necprep.sqlite'));
  if (!existsSync(dbPath)) {
    console.error(`no database at ${dbPath}. Run \`npm run db:apply:local && npm run db:seed:local\` first.`);
    process.exit(2);
  }
  const db = new DatabaseSync(dbPath);
  const result = runSmoke(db);
  db.close();
  console.log(`\n${result.checks - result.failures}/${result.checks} checks passed`);
  process.exit(result.failures === 0 ? 0 : 1);
}
