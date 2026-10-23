/**
 * Turn the seeded local database into SQL that can be replayed into remote D1.
 *
 *   node db/seed/export-content-sql.mjs
 *   node db/seed/export-content-sql.mjs --out .local/remote --chunk 2000
 *
 * WHY THIS EXISTS RATHER THAN `wrangler d1 export`
 * ------------------------------------------------
 * `wrangler d1 export --local` exports the database `wrangler dev` uses —
 * `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`. That is NOT the
 * database `npm run db:seed:local` writes, which is `.local/necprep.sqlite`
 * (see `db/apply.mjs`). Exporting the wrong file succeeds and produces an
 * empty-looking import, which is the worst possible failure mode for a step
 * whose whole purpose is "put the questions in production".
 *
 * It also emits the schema by default, and replaying CREATE TABLE against a
 * database that already has the migrations applied fails.
 *
 * So: read the file the seed actually wrote, emit data only, and chunk it.
 *
 * WHAT IT EXPORTS
 * ---------------
 * Content only — questions, their options and their answer keys. Nothing
 * user-owned: no users, sessions, attempts, answers or progress. That split is
 * deliberate. Content is derived from files in git and is safe to replace
 * wholesale; user data is not, and a seeding script that could touch it is a
 * script that will one day delete somebody's attempt history.
 *
 * Reference data (subjects, chapters, sub-chapters, templates) is NOT exported
 * either: it arrives via migration 0007, so it is already in the remote
 * database before this file is replayed.
 *
 * INSERT OR REPLACE, not INSERT
 * -----------------------------
 * Re-running this must be safe. Question ids are content hashes, so a replay
 * after a bank update overwrites the rows that changed and leaves the rest
 * identical. `question_options.id` is `{question_id}#{opt_key}`, stable across
 * re-imports by design (see the `RETURNING` note in import-questions.mjs), so
 * replacing an option row does not orphan a recorded answer.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_DB = join(WORKER_ROOT, '.local', 'necprep.sqlite');

/**
 * Order matters: options and answer keys reference questions, and D1 enforces
 * foreign keys. Answer keys last because they reference both.
 */
const TABLES = ['questions', 'question_options', 'question_answer_keys'];

/**
 * Statements per output file.
 *
 * `wrangler d1 execute --file` sends the file as one request, and a very large
 * one is both slow and hard to retry from the middle. A few numbered files
 * that can each be replayed independently is easier to recover from than one
 * that half-applied.
 */
const DEFAULT_CHUNK = 2000;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const dbPath = resolve(arg('--db', DEFAULT_DB));
const outDir = resolve(arg('--out', join(WORKER_ROOT, '.local', 'remote')));
const chunkSize = Number.parseInt(arg('--chunk', String(DEFAULT_CHUNK)), 10);

if (!Number.isInteger(chunkSize) || chunkSize < 1) {
  console.error(`invalid --chunk ${String(chunkSize)}`);
  process.exit(2);
}

if (!existsSync(dbPath)) {
  console.error(
    `no database at ${dbPath}.\n` +
      'Run `npm run db:apply:local && npm run db:seed:local` first.',
  );
  process.exit(2);
}

/** SQLite literal. Single quotes doubled; blobs are not expected in content. */
function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`cannot serialise non-finite number ${String(value)}`);
    }
    return String(value);
  }
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  throw new Error(`cannot serialise ${typeof value}`);
}

const db = new DatabaseSync(dbPath);

const files = [];
let totalRows = 0;

for (const table of TABLES) {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    // Generated columns cannot be inserted into. `attempts.score_bp` is one;
    // reading `hidden` rather than hardcoding a list means a future generated
    // column does not silently break this export.
    .filter((c) => c.hidden !== 2 && c.hidden !== 3)
    .map((c) => c.name);

  if (columns.length === 0) {
    console.error(`! table ${table} not found in ${dbPath}`);
    process.exit(1);
  }

  const rows = db.prepare(`SELECT ${columns.join(', ')} FROM ${table}`).all();
  totalRows += rows.length;

  const statements = rows.map(
    (row) =>
      `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (` +
      columns.map((c) => literal(row[c])).join(', ') +
      ');',
  );

  for (let i = 0; i < statements.length; i += chunkSize) {
    const part = statements.slice(i, i + chunkSize);
    const index = String(files.length + 1).padStart(3, '0');
    files.push({
      name: `${index}-${table}.sql`,
      table,
      statements: part.length,
      body:
        `-- ${table}: rows ${String(i + 1)}-${String(i + part.length)} of ${String(statements.length)}\n` +
        '-- Generated by db/seed/export-content-sql.mjs. Safe to replay.\n' +
        'PRAGMA defer_foreign_keys = TRUE;\n' +
        part.join('\n') +
        '\n',
    });
  }
}

db.close();

mkdirSync(outDir, { recursive: true });
for (const file of files) {
  writeFileSync(join(outDir, file.name), file.body, 'utf8');
}

console.log(`read  ${dbPath}`);
console.log(`wrote ${String(files.length)} file(s) to ${outDir}\n`);
for (const file of files) {
  console.log(`  ${file.name.padEnd(28)} ${String(file.statements).padStart(5)} statements`);
}
console.log(`\n  total ${String(totalRows)} rows\n`);
console.log('Replay them into the remote database IN THIS ORDER:');
console.log('  for f in .local/remote/*.sql; do');
console.log('    npx wrangler d1 execute necprep --remote --file "$f" -y || break');
console.log('  done');
console.log('\nThe `|| break` matters: a later file references rows an earlier one inserts.');
