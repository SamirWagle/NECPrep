#!/usr/bin/env node
/**
 * measure.mjs -- measure the real on-disk cost of an `attempt_answers` row,
 * and project the D1 ceiling from it.
 *
 * `attempt_answers` is the only unbounded table on the platform (see the
 * archival note in migrations/0004_assessment.sql). Everything in that note --
 * when the free tier runs out, what retention window fits, when the platform
 * has to move off a single D1 database -- depends on one number: bytes per
 * row, including every index. Guessing it is how a team discovers the ceiling
 * by hitting it.
 *
 * So this inserts synthetic answers into the real schema, with the real
 * triggers and the real indexes, and reads the allocated page bytes out of
 * `dbstat`.
 *
 * Usage:
 *   node db/measure.mjs [--db <path>] [--rows 200000] [--keep]
 *
 * Writes to a throwaway copy by default (.local/measure.sqlite) so the
 * development database is not left full of synthetic rows.
 */

import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORKER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ANSWER_BTREES = [
  'attempt_answers',
  'uq_attempt_answers_attempt_question',
  'idx_attempt_answers_answered_at',
  'idx_attempt_answers_question_correct',
];

const KiB = 1024;
const MiB = 1024 * 1024;

function btreeBytes(db, names) {
  const rows = db
    .prepare(
      `SELECT name, SUM(pgsize) AS bytes FROM dbstat
        WHERE name IN (${names.map(() => '?').join(',')})
        GROUP BY name`
    )
    .all(...names);
  const out = {};
  for (const name of names) out[name] = 0;
  for (const r of rows) out[r.name] = r.bytes;
  return out;
}

export function measure(db, { rows = 200_000 } = {}) {
  db.exec('PRAGMA foreign_keys = ON');
  const one = (sql, ...p) => db.prepare(sql).get(...p);

  const questionIds = db
    .prepare(`SELECT id FROM questions WHERE status = 'published' ORDER BY id`)
    .all()
    .map((r) => r.id);
  if (questionIds.length === 0) {
    throw new Error('no published questions -- run db/seed/import-questions.mjs first');
  }
  const minOptions = one(
    `SELECT MIN(c) AS c FROM (SELECT COUNT(*) c FROM question_options GROUP BY question_id)`
  ).c;

  const baseline = btreeBytes(db, ANSWER_BTREES);
  const dbBytesBefore = one('SELECT SUM(pgsize) AS b FROM dbstat').b;
  const ftsBytes = one(
    `SELECT SUM(pgsize) AS b FROM dbstat WHERE name LIKE 'questions_fts%'`
  ).b;

  // Epoch MILLISECONDS -- see migrations/0001_identity.sql.
  const now = Date.now();
  const USER = 'U0MEASUREUSER000000000000X';
  db.prepare(
    `INSERT INTO users (id, email, role, created_at, updated_at)
     VALUES (?, 'measure@example.invalid', 'student', ?, ?)
     ON CONFLICT (id) DO NOTHING`
  ).run(USER, now, now);

  // Papers of 2,000 questions: large enough that attempt overhead is noise,
  // and `question_count` has to cover `answered_count` (a CHECK).
  const perAttempt = Math.min(2000, questionIds.length);
  const attemptCount = Math.ceil(rows / perAttempt);

  const insertAttempt = db.prepare(
    `INSERT INTO attempts (public_id, user_id, mode, chapter_id, status, option_seed,
                           question_count, started_at)
     VALUES (?, ?, 'practice', NULL, 'in_progress', ?, ?, ?)`
  );
  // Real option keys, read back from the bank: `selected_opt_key` has a
  // composite foreign key to question_options, so a synthetic value would be
  // rejected -- and measuring the table with that key absent would understate
  // the index width this whole file exists to report.
  const optKeyByQuestionOrdinal = new Map();
  for (const r of db
    .prepare(`SELECT question_id, ordinal, opt_key FROM question_options`)
    .all()) {
    optKeyByQuestionOrdinal.set(`${r.question_id}#${r.ordinal}`, r.opt_key);
  }
  const insertAnswer = db.prepare(
    `INSERT INTO attempt_answers (attempt_id, question_id, selected_opt_key, is_correct,
                                  delivered_position, time_ms, answered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const started = Date.now();
  let written = 0;
  db.exec('BEGIN');
  for (let a = 0; a < attemptCount && written < rows; a++) {
    insertAttempt.run(`M${String(a).padStart(25, '0')}`, USER, a + 1, perAttempt, now);
    const attemptId = one('SELECT max(id) AS id FROM attempts').id;
    for (let k = 0; k < perAttempt && written < rows; k++) {
      const qid = questionIds[k % questionIds.length];
      insertAnswer.run(
        attemptId, qid,
        optKeyByQuestionOrdinal.get(`${qid}#${(written % minOptions) + 1}`) ?? null,
        written % 3 === 0 ? 1 : 0,
        (written % 4) + 1,
        1500 + (written % 9000),
        now - (written % 7_776_000_000)
      );
      written++;
    }
  }
  db.exec('COMMIT');
  const elapsedMs = Date.now() - started;

  const after = btreeBytes(db, ANSWER_BTREES);
  const perRow = {};
  let totalPerRow = 0;
  for (const name of ANSWER_BTREES) {
    const bytes = after[name] - baseline[name];
    perRow[name] = bytes / written;
    totalPerRow += perRow[name];
  }

  const dbBytesAfter = one('SELECT SUM(pgsize) AS b FROM dbstat').b;
  const schemaBytes = dbBytesBefore; // seeded bank + reference data + FTS, no answers

  // D1 limits, stated so the projection cannot drift from them silently.
  const FREE_DB_BYTES = 500 * MiB;
  const PAID_DB_BYTES = 10 * 1024 * MiB;
  const ANSWERS_PER_MAU_MONTH = 500;

  const capacity = (limitBytes) => Math.floor((limitBytes - schemaBytes) / totalPerRow);

  const projection = [1_000, 2_000, 5_000, 10_000, 25_000].map((mau) => {
    const perMonth = mau * ANSWERS_PER_MAU_MONTH;
    const live90 = perMonth * 3;
    const live180 = perMonth * 6;
    return {
      mau,
      rowsPerMonth: perMonth,
      // D1 counts index rows as writes, so one answer costs 1 table write plus
      // one per index on it.
      rowWritesPerDay: Math.round((perMonth / 30) * (1 + ANSWER_BTREES.length - 1)),
      live90Rows: live90,
      live90Bytes: live90 * totalPerRow,
      live180Rows: live180,
      live180Bytes: live180 * totalPerRow,
      fitsFree90: live90 * totalPerRow + schemaBytes <= FREE_DB_BYTES,
      fitsPaid90: live90 * totalPerRow + schemaBytes <= PAID_DB_BYTES,
    };
  });

  return {
    rowsWritten: written,
    elapsedMs,
    rowsPerSecond: Math.round((written / elapsedMs) * 1000),
    minOptionsPerQuestion: minOptions,
    perRowBytes: perRow,
    totalPerRowBytes: totalPerRow,
    schemaBytes,
    ftsBytes,
    dbBytesAfter,
    freeTierAnswerCapacity: capacity(FREE_DB_BYTES),
    paidTierAnswerCapacity: capacity(PAID_DB_BYTES),
    projection,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const argOf = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const source = resolve(argOf('--db', join(WORKER_ROOT, '.local', 'necprep.sqlite')));
  if (!existsSync(source)) {
    console.error(`no database at ${source}. Run \`npm run db:apply:local && npm run db:seed:local\` first.`);
    process.exit(2);
  }
  const target = join(WORKER_ROOT, '.local', 'measure.sqlite');
  for (const suffix of ['', '-wal', '-shm']) rmSync(target + suffix, { force: true });
  copyFileSync(source, target);

  const db = new DatabaseSync(target);
  const m = measure(db, { rows: Number(argOf('--rows', '200000')) });
  db.close();

  const fmt = (b) =>
    b >= 1024 * MiB
      ? `${(b / (1024 * MiB)).toFixed(2)} GB`
      : b >= MiB
        ? `${(b / MiB).toFixed(1)} MB`
        : `${(b / KiB).toFixed(0)} KB`;

  console.log(`measured on a copy at ${target}`);
  console.log(`\n${m.rowsWritten.toLocaleString()} synthetic answer rows in ${m.elapsedMs} ms (${m.rowsPerSecond.toLocaleString()} rows/s, triggers live)\n`);
  console.log('bytes per attempt_answers row, allocated pages, real indexes:');
  for (const [name, bytes] of Object.entries(m.perRowBytes)) {
    console.log(`  ${name.padEnd(38)} ${bytes.toFixed(1)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(38)} ${m.totalPerRowBytes.toFixed(1)}`);
  console.log(`\nschema + seeded bank, no answers:   ${fmt(m.schemaBytes)}`);
  console.log(`  of which the FTS5 index:          ${fmt(m.ftsBytes)}`);
  console.log(`database after the measurement:     ${fmt(m.dbBytesAfter)}`);
  console.log(`\nanswer rows that fit a 500 MB D1 free database:  ${m.freeTierAnswerCapacity.toLocaleString()}`);
  console.log(`answer rows that fit a 10 GB D1 paid database:   ${m.paidTierAnswerCapacity.toLocaleString()}`);

  console.log('\nprojection at ~500 answers per active user per month:');
  console.log('   MAU   rows/month  row-writes/day   90d live        180d live      free 500MB@90d  paid 10GB@90d');
  for (const p of m.projection) {
    console.log(
      `  ${String(p.mau).padStart(6)}  ${String(p.rowsPerMonth).padStart(10)}  ` +
        `${String(p.rowWritesPerDay).padStart(14)}  ` +
        `${(p.live90Rows / 1e6).toFixed(1).padStart(5)}M ${fmt(p.live90Bytes).padStart(8)}  ` +
        `${(p.live180Rows / 1e6).toFixed(1).padStart(5)}M ${fmt(p.live180Bytes).padStart(8)}  ` +
        `${(p.fitsFree90 ? 'yes' : 'NO').padStart(14)}  ${(p.fitsPaid90 ? 'yes' : 'NO').padStart(13)}`
    );
  }
  console.log(
    '\nThe free plan also caps row WRITES at 100,000/day. D1 counts index rows,\n' +
      `so one answer is ${ANSWER_BTREES.length} row writes here -- the write cap, not the 500 MB\n` +
      'storage cap, is what actually bites first. See migrations/0004_assessment.sql.'
  );
  if (!argv.includes('--keep')) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(target + suffix, { force: true });
    console.log(`\nremoved ${target} (pass --keep to inspect it)`);
  } else {
    console.log(`\nkept ${target} (${fmt(statSync(target).size)} on disk)`);
  }
}
