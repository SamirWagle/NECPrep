/**
 * Load the question bank into the database `wrangler dev` actually uses.
 *
 *   npm run dev:setup      # migrations + content, from nothing
 *   node db/seed/load-local-d1.mjs
 *
 * WHY THIS IS NOT `db:seed:local`
 * -------------------------------
 * There are TWO local databases and they are easy to confuse:
 *
 *   .local/necprep.sqlite                     <- db/apply.mjs + db/seed/*
 *   .wrangler/state/v3/d1/miniflare-<hash>.sqlite  <- `wrangler dev`, `--local`
 *
 * `npm run db:seed:local` fills the first. It is the one the test harness, the
 * smoke suite and `db:verify` read, and it is driven by plain `node:sqlite`
 * with no wrangler involved. `wrangler dev` never looks at it.
 *
 * So a developer can run the full `db:check`, see 2,290 questions, start
 * `wrangler dev`, and get an empty API — which is exactly what happens today.
 * This script closes that gap by replaying the same generated SQL into the
 * miniflare database through `wrangler d1 execute --local`.
 *
 * WHY THROUGH WRANGLER AND NOT STRAIGHT INTO THE FILE
 * ---------------------------------------------------
 * The miniflare database is a plain SQLite file and writing to it directly
 * would be faster. It is also named after a hash that wrangler owns and may
 * change between versions, and wrangler keeps its own metadata database
 * alongside. Going through the supported command costs a few seconds once and
 * cannot desynchronise.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const WORKER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXPORT_DIR = join(WORKER_ROOT, '.local', 'remote');
const DB_NAME = 'necprep';

function run(command, args, label) {
  process.stdout.write(`  ${label} … `);
  const result = spawnSync(command, args, {
    cwd: WORKER_ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.log('FAILED');
    console.error(result.stdout ?? '');
    console.error(result.stderr ?? '');
    process.exit(result.status ?? 1);
  }
  console.log('ok');
  return result.stdout ?? '';
}

if (!existsSync(EXPORT_DIR) || readdirSync(EXPORT_DIR).filter((f) => f.endsWith('.sql')).length === 0) {
  console.error(
    `No SQL to load in ${EXPORT_DIR}.\n` +
      'Run this first, which builds .local/necprep.sqlite and exports it:\n' +
      '  npm run db:apply:local && npm run db:seed:local && npm run db:export:remote',
  );
  process.exit(2);
}

// Sorted, because question_options and question_answer_keys reference
// questions and D1 enforces foreign keys. The filenames are numbered for
// exactly this reason.
const files = readdirSync(EXPORT_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

console.log(`Loading ${String(files.length)} file(s) into the wrangler-local D1.\n`);

for (const file of files) {
  run(
    'npx',
    ['wrangler', 'd1', 'execute', DB_NAME, '--local', '--file', join(EXPORT_DIR, file), '-y'],
    file,
  );
}

const out = run(
  'npx',
  [
    'wrangler', 'd1', 'execute', DB_NAME, '--local', '--json', '--command',
    "SELECT (SELECT COUNT(*) FROM questions) AS questions, " +
      "(SELECT COUNT(*) FROM questions WHERE status='published') AS published, " +
      '(SELECT COUNT(*) FROM question_options) AS options',
  ],
  'verifying',
);

try {
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  const row = parsed[0].results[0];
  console.log(
    `\n  questions ${String(row.questions)} · published ${String(row.published)} · options ${String(row.options)}`,
  );
  if (row.questions === 0) {
    console.error('\nLoaded nothing. Did `d1:migrate:local` run first?');
    process.exit(1);
  }
} catch {
  // The counts are a convenience; a parse failure here is not a load failure.
  console.log('\n  (loaded; could not parse the verification output)');
}

console.log('\nStart the API with `npm run dev`, then point the frontend at it:');
console.log('  echo "VITE_API_BASE_URL=http://localhost:8787" > ../frontend/.env.local');
