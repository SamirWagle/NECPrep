#!/usr/bin/env node
/**
 * review-explanations.mjs
 *
 * Drains the AI-draft explanation backlog: shows one question, its options, the
 * keyed answer, and the generated explanation, then records accept / edit /
 * reject.
 *
 * WHY A REVIEW TOOL AT ALL
 * ------------------------
 * The generator publishes drafts with `origin = 'ai_draft'`, which students see
 * badged as unreviewed. That is a deliberate trade — a flagged draft beats "the
 * correct answer is B" — but it is only defensible if the backlog actually gets
 * drained, and a backlog with no tool is a backlog that never shrinks.
 *
 * REVIEW ORDER
 * ------------
 * Least model-confident first. The generator is told its confidence sets review
 * order, so a 3 is the model saying "check this one", and reviewing in that
 * order finds the bad drafts fastest. Once attempt data exists, the better
 * order is `responses * (1 - pCorrect)` — the drafts the most students read —
 * and `--order impact` switches to that; it falls back to confidence while
 * every question still has zero recorded answers.
 *
 * USAGE
 *   node scripts/review-explanations.mjs                      # interactive queue
 *   node scripts/review-explanations.mjs --stats              # backlog summary only
 *   node scripts/review-explanations.mjs --order impact       # most-read first
 *   node scripts/review-explanations.mjs --chapter AExE01     # one chapter
 *   node scripts/review-explanations.mjs --limit 25
 *   node scripts/review-explanations.mjs --reviewer <user_id> # attribute to a real user
 *
 * Keys: [a]ccept  [r]eject  [e]dit  [f]lag the question  [s]kip  [q]uit
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const WORKER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DB = join(WORKER_ROOT, '.local', 'necprep.sqlite');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};

const dbPath = resolve(value('--db', DEFAULT_DB));
if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath}`);
  process.exit(2);
}
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

// A reviewer id is recorded on every acceptance. `explanations` has a CHECK
// that an ai_reviewed row names its reviewer, and reviewed_by is a foreign key
// to users, so an unknown id would fail — hence the existence check rather than
// writing whatever was passed.
const reviewerArg = value('--reviewer', null);
let reviewerId = null;
if (reviewerArg) {
  const found = db.prepare('SELECT id FROM users WHERE id = ?').get(reviewerArg);
  if (!found) {
    console.error(`--reviewer ${reviewerArg} is not a user id in this database`);
    process.exit(2);
  }
  reviewerId = found.id;
}

// --- Stats ------------------------------------------------------------------

function printStats() {
  const row = db
    .prepare(
      `SELECT
         SUM(origin = 'ai_draft'    AND status = 'published') AS unreviewed,
         SUM(origin = 'ai_reviewed')                          AS reviewed,
         SUM(origin = 'human')                                AS human,
         SUM(status = 'rejected')                             AS rejected
       FROM explanations WHERE kind = 'solution'`
    )
    .get();

  const total = db
    .prepare(`SELECT COUNT(*) n FROM questions WHERE status = 'published'`)
    .get().n;
  const covered = db
    .prepare(
      `SELECT COUNT(DISTINCT question_id) n FROM explanations
        WHERE kind = 'solution' AND status = 'published'`
    )
    .get().n;

  const buckets = db
    .prepare(
      `SELECT CASE
                WHEN generator_confidence_bp IS NULL     THEN 'unknown'
                WHEN generator_confidence_bp <= 4000     THEN '0-4  (check first)'
                WHEN generator_confidence_bp <= 6000     THEN '5-6'
                WHEN generator_confidence_bp <= 8000     THEN '7-8'
                ELSE                                          '9-10'
              END AS bucket,
              COUNT(*) n
         FROM explanations
        WHERE kind = 'solution' AND origin = 'ai_draft' AND status = 'published'
     GROUP BY bucket ORDER BY bucket`
    )
    .all();

  const disagreements = db
    .prepare(
      `SELECT COUNT(*) n FROM question_reports
        WHERE status = 'open' AND detail LIKE 'explanation-generator-disagreement%'`
    )
    .get().n;

  console.log(`
  explanation coverage      ${covered} / ${total} published questions  (${((covered / total) * 100).toFixed(1)}%)

  unreviewed AI drafts      ${row.unreviewed ?? 0}   <- served to students, badged
  reviewed AI drafts        ${row.reviewed ?? 0}
  human-written             ${row.human ?? 0}
  rejected                  ${row.rejected ?? 0}

  open key disagreements    ${disagreements}   <- the generator refused to explain these
`);
  if (buckets.length) {
    console.log('  unreviewed drafts by model confidence:');
    for (const b of buckets) console.log(`    ${String(b.n).padStart(5)}  ${b.bucket}`);
    console.log('');
  }
}

if (flag('--stats')) {
  printStats();
  db.close();
  process.exit(0);
}

// --- Queue ------------------------------------------------------------------

const chapter = value('--chapter', null);
const limit = Number(value('--limit', '0')) || 0;
const order = value('--order', 'confidence');

const queue = db
  .prepare(
    `SELECT e.id, e.question_id, e.body, e.generator_confidence_bp AS conf,
            e.generator_model, e.generator_prompt_version,
            q.stem, q.p_value_n, q.p_value_bp,
            c.nec_code AS chapter_code, c.title AS chapter_title,
            k.correct_option_id
       FROM explanations e
       JOIN questions q ON q.id = e.question_id
       JOIN chapters  c ON c.id = q.chapter_id
       JOIN question_answer_keys k ON k.question_id = q.id
      WHERE e.kind = 'solution'
        AND e.origin = 'ai_draft'
        AND e.status = 'published'
        AND (? IS NULL OR c.nec_code = ?)
   ORDER BY CASE WHEN ? = 'impact' AND COALESCE(q.p_value_n, 0) > 0
                 THEN -(q.p_value_n * (10000 - COALESCE(q.p_value_bp, 5000)))
                 ELSE 0 END,
            COALESCE(e.generator_confidence_bp, 0),
            e.id`
  )
  .all(chapter, chapter, order);

const work = limit ? queue.slice(0, limit) : queue;

printStats();

if (work.length === 0) {
  console.log('  nothing to review\n');
  db.close();
  process.exit(0);
}

const optionsFor = db.prepare(
  `SELECT id, ordinal, text FROM question_options
    WHERE question_id = ? AND retired_at IS NULL ORDER BY ordinal`
);
const rationalesFor = db.prepare(
  `SELECT e.body, o.text AS option_text
     FROM explanations e JOIN question_options o ON o.id = e.about_option_id
    WHERE e.question_id = ? AND e.kind = 'distractor' AND e.status = 'published'
 ORDER BY o.ordinal`
);

const accept = db.prepare(
  `UPDATE explanations
      SET origin = 'ai_reviewed', reviewed_by = ?, reviewed_at = ?, updated_at = ?
    WHERE question_id = ? AND origin = 'ai_draft' AND status = 'published'`
);
const rejectAll = db.prepare(
  `UPDATE explanations
      SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, updated_at = ?
    WHERE question_id = ? AND origin = 'ai_draft' AND status = 'published'`
);
const editBody = db.prepare(
  `UPDATE explanations
      SET body = ?, origin = 'human',
          generator_model = NULL, generator_prompt_version = NULL,
          generated_at = NULL, generator_confidence_bp = NULL,
          author_user_id = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
    WHERE id = ?`
);
const flagQuestion = db.prepare(
  `INSERT INTO question_reports
     (public_id, question_id, reporter_user_id, source, category, code, detail,
      status, created_at, updated_at)
   VALUES (?, ?, NULL, 'admin', 'wrong_answer', NULL, ?, 'open', ?, ?)`
);

/**
 * Line reader that works both interactively and from a pipe.
 *
 * `readline.question` does not queue: with piped stdin every line arrives at
 * once, only the prompt with a callback registered at that moment captures one,
 * and the rest are dropped — the next `await` then never settles and the
 * process hangs on an unsettled top-level await. So when stdin is not a TTY,
 * read it to EOF first and serve answers from the buffer. That also makes the
 * tool scriptable, e.g. bulk-accepting a chapter you have already spot-checked:
 *
 *   yes a | node scripts/review-explanations.mjs --chapter ACtE03 --reviewer <id>
 */
async function makeAsk() {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    return {
      ask: (q) => new Promise((res) => rl.question(q, res)),
      close: () => rl.close(),
    };
  }

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const lines = Buffer.concat(chunks).toString('utf8').split('\n');
  let i = 0;
  return {
    // Past end of input, answer 'q' so the queue stops cleanly rather than
    // looping on an empty string and silently skipping every remaining draft.
    ask: async (q) => {
      const line = i < lines.length ? lines[i++] : 'q';
      process.stdout.write(q + line + '\n');
      return line;
    },
    close: () => {},
  };
}

const { ask, close: closeInput } = await makeAsk();

const tally = { accepted: 0, rejected: 0, edited: 0, flagged: 0, skipped: 0 };

console.log(`  ${work.length} draft(s) queued, least-confident first`);
if (!reviewerId) {
  console.log('  NOTE: no --reviewer given; acceptances will be recorded without a reviewer id,');
  console.log('        which the ai_reviewed CHECK forbids. Accept is disabled this run.\n');
}

for (let i = 0; i < work.length; i++) {
  const d = work[i];
  const opts = optionsFor.all(d.question_id);
  const correct = opts.find((o) => o.id === d.correct_option_id);

  console.log('\n' + '='.repeat(74));
  console.log(`  ${i + 1}/${work.length}   ${d.chapter_code}   confidence ${d.conf / 1000}/10`);
  console.log(`  ${d.question_id}   ${d.generator_model} / ${d.generator_prompt_version}`);
  console.log('='.repeat(74));
  console.log(`\n  ${d.stem}\n`);
  for (const o of opts) {
    console.log(`    ${o.id === d.correct_option_id ? '->' : '  '} ${o.text}`);
  }
  console.log(`\n  KEYED ANSWER: ${correct ? correct.text : '(unresolved)'}`);
  console.log('\n  --- draft explanation ---\n');
  console.log(
    d.body
      .split('\n')
      .map((l) => '  ' + l)
      .join('\n')
  );
  const rats = rationalesFor.all(d.question_id);
  if (rats.length) {
    console.log('\n  --- why the others are wrong ---');
    for (const r of rats) console.log(`    ${r.option_text}: ${r.body}`);
  }

  const prompt = reviewerId
    ? '\n  [a]ccept  [r]eject  [e]dit  [f]lag question  [s]kip  [q]uit > '
    : '\n  [r]eject  [f]lag question  [s]kip  [q]uit > ';
  const answer = (await ask(prompt)).trim().toLowerCase();
  const now = Date.now();

  if (answer === 'q') break;

  if (answer === 'a' && reviewerId) {
    accept.run(reviewerId, now, now, d.question_id);
    tally.accepted++;
    console.log('  accepted — badge removed, now reads "AI draft, reviewed"');
  } else if (answer === 'r') {
    // `reviewed_by` and `reviewed_at` must be set or unset together (CHECK), so
    // an anonymous rejection records neither rather than a timestamp with no
    // reviewer. Rejecting without --reviewer is still allowed: withdrawing a
    // bad draft should never be blocked on having a user row to attribute it to.
    rejectAll.run(reviewerId, reviewerId ? now : null, now, d.question_id);
    tally.rejected++;
    console.log('  rejected — withdrawn from delivery; the question has no explanation again');
  } else if (answer === 'e' && reviewerId) {
    console.log('  Enter the corrected explanation. Blank line ends input.');
    const lines = [];
    for (;;) {
      const line = await ask('  | ');
      if (!line.trim()) break;
      lines.push(line);
    }
    const body = lines.join('\n').trim();
    if (body) {
      // An edited explanation is human-authored, so the generator metadata is
      // cleared — the CHECK requires it absent for a human origin, and leaving
      // a model attribution on text a person wrote would be a false record.
      editBody.run(body, reviewerId, reviewerId, now, now, d.id);
      tally.edited++;
      console.log('  saved as human-written');
    } else {
      tally.skipped++;
      console.log('  empty — skipped');
    }
  } else if (answer === 'f') {
    const why = (await ask('  what is wrong with the question? > ')).trim();
    flagQuestion.run(
      randomUUID().replace(/-/g, '').slice(0, 26).toUpperCase(),
      d.question_id,
      `explanation-review: ${why || '(no reason given)'}`,
      now,
      now
    );
    tally.flagged++;
    console.log('  flagged for triage');
  } else {
    tally.skipped++;
  }
}

closeInput();

console.log(`
  accepted ${tally.accepted}   rejected ${tally.rejected}   edited ${tally.edited}   flagged ${tally.flagged}   skipped ${tally.skipped}
`);
printStats();
db.close();
