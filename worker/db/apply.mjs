#!/usr/bin/env node
/**
 * apply.mjs -- apply every migration, in order, to a local SQLite file.
 *
 * Why this exists alongside `wrangler d1 migrations apply --local`: this runs
 * with zero network and zero node_modules, using node:sqlite (Node 22+), so
 * the schema can be proved to apply before anyone installs a toolchain or
 * creates a Cloudflare account. `npm run d1:migrate:local` is the second
 * check, against Miniflare's D1 implementation.
 *
 * It also enforces the things D1 enforces and plain `sqlite3` does not:
 *
 *   * foreign keys ON. D1 enables them by default; the sqlite3 CLI does not,
 *     so a schema with a broken reference passes there and fails in production.
 *   * no transaction control inside a migration file. `wrangler d1 migrations
 *     apply` wraps each file itself, so a BEGIN in a file is an error you find
 *     at deploy time. Found here instead.
 *   * no PRAGMA statements, which D1 rejects.
 *
 * Usage:
 *   node db/apply.mjs [--db <path>] [--keep]
 *     --db    target file (default: .local/necprep.sqlite)
 *     --keep  apply on top of an existing file instead of recreating it
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORKER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(WORKER_ROOT, 'migrations');

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
export const DEFAULT_DB = join(WORKER_ROOT, '.local', 'necprep.sqlite');
const dbPath = resolve(argOf('--db', DEFAULT_DB));
const keep = argv.includes('--keep');

// Statements D1 will not run. Checked here so the failure is local and cheap.
const FORBIDDEN = [
  // Matches `BEGIN;` / `BEGIN IMMEDIATE TRANSACTION;` but not a trigger body's
  // `BEGIN`, which is never followed by a semicolon.
  { re: /^\s*BEGIN(\s+(DEFERRED|IMMEDIATE|EXCLUSIVE))?(\s+TRANSACTION)?\s*;/im,
    why: 'wrangler wraps each migration in its own transaction' },
  { re: /^\s*COMMIT\b/im, why: 'wrangler wraps each migration in its own transaction' },
  { re: /^\s*ROLLBACK\b/im, why: 'wrangler wraps each migration in its own transaction' },
  { re: /^\s*PRAGMA\s/im, why: 'D1 rejects PRAGMA statements in migrations' },
  { re: /^\s*ATTACH\s/im, why: 'D1 has no filesystem to attach from' },
  { re: /^\s*VACUUM/im, why: 'D1 does not expose VACUUM' },
];

export function migrationFiles() {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) throw new Error(`no .sql files in ${MIGRATIONS_DIR}`);
  for (const f of files) {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/.test(f)) {
      throw new Error(`migration name must be NNNN_lower_snake.sql: ${f}`);
    }
  }
  const nums = files.map((f) => Number(f.slice(0, 4)));
  nums.forEach((n, i) => {
    if (n !== i + 1) throw new Error(`migration numbering has a gap or duplicate at ${files[i]}`);
  });
  return files;
}

export function openApplied(path = DEFAULT_DB, { fresh = true } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  if (fresh && existsSync(path)) {
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  }
  const db = new DatabaseSync(path);
  // D1 behaviour, not sqlite3-CLI behaviour.
  db.exec('PRAGMA foreign_keys = ON');
  const applied = [];
  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // Strip comments before scanning, so the words BEGIN and PRAGMA are
    // allowed to appear in the explanatory prose that this schema is mostly
    // made of.
    const code = sql
      .split('\n')
      .filter((l) => !/^\s*--/.test(l))
      .join('\n');
    for (const { re, why } of FORBIDDEN) {
      if (re.test(code)) throw new Error(`${file}: forbidden statement (${why})`);
    }
    try {
      db.exec(sql);
    } catch (err) {
      throw new Error(`${file}: ${err.message}`);
    }
    applied.push(file);
  }
  const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
  if (fkErrors.length) throw new Error(`foreign_key_check failed: ${JSON.stringify(fkErrors)}`);
  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (integrity.integrity_check !== 'ok') throw new Error(`integrity_check: ${integrity.integrity_check}`);
  return { db, applied };
}

// pathToFileURL, not a template literal: this repo's path contains spaces and
// `file://${argv[1]}` would not match the percent-encoded import.meta.url.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { db, applied } = openApplied(dbPath, { fresh: !keep });
  const count = (sql) => db.prepare(sql).get().n;

  console.log(`applied ${applied.length} migrations to ${dbPath}`);
  for (const f of applied) console.log(`  ok  ${f}`);

  const tables = db
    .prepare(
      `SELECT name, type FROM sqlite_master
        WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE 'questions_fts%'
        ORDER BY type, name`
    )
    .all();
  const idx = count(
    `SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND sql IS NOT NULL`
  );
  const trig = count(`SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'`);

  console.log(
    `\n${tables.filter((t) => t.type === 'table').length} tables, ` +
      `${tables.filter((t) => t.type === 'view').length} view(s), ` +
      `${idx} explicit indexes, ${trig} triggers`
  );
  for (const t of tables) console.log(`  ${t.type.padEnd(5)} ${t.name}`);

  console.log('\nreference data loaded by 0007:');
  for (const [label, sql] of [
    ['subjects', 'SELECT COUNT(*) n FROM subjects'],
    ['chapters', 'SELECT COUNT(*) n FROM chapters'],
    ['subchapters', 'SELECT COUNT(*) n FROM subchapters'],
    ['mock_test_templates', 'SELECT COUNT(*) n FROM mock_test_templates'],
  ]) {
    console.log(`  ${label.padEnd(20)} ${count(sql)}`);
  }
  db.close();
}
