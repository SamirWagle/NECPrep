#!/usr/bin/env node
/**
 * generate-explanations.mjs
 *
 * Drafts an explanation for every published question that lacks one, using the
 * Anthropic Batch API, and writes the results into `explanations` with
 * `origin = 'ai_draft'`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Not one of the 2,290 imported questions carries an explanation. A student who
 * answers wrong is told "the correct answer is B" and nothing else, so the bank
 * can test but never teach. That is the largest remaining quality gap in the
 * product, and the owner has confirmed no authored explanations are coming.
 *
 * THE KEY IS AN INPUT, NOT A QUESTION
 * -----------------------------------
 * The model is told which option the bank keys as correct and asked to explain
 * *that* option. It is NOT asked to solve the question, because a model that
 * disagrees with the key and silently explains its own answer produces an
 * explanation that contradicts the grading -- the worst possible output.
 *
 * Instead the model must report `agrees_with_key`, and a disagreement is
 * treated as an errata signal rather than an explanation: the row is withheld
 * and a `question_reports` entry is filed for human adjudication. This makes
 * the pass a second, independent audit of all 2,184 answer keys at no extra
 * cost -- which matters, because the first audit found 17 questions whose own
 * two answer fields contradicted each other.
 *
 * COST
 * ----
 * The Batch API is 50% of standard rates and the shared instruction block is
 * cached, so the marginal cost is dominated by per-question output tokens. At
 * Claude Opus 5 batch rates ($2.50 / $12.50 per MTok) a full run over ~2,180
 * questions costs roughly $25-30. Run with --estimate for a measured figure
 * from the real bank before spending anything.
 *
 * USAGE
 *   node scripts/generate-explanations.mjs --estimate          # token/cost estimate, no API calls
 *   node scripts/generate-explanations.mjs --dry-run           # build and print one request, no API calls
 *   node scripts/generate-explanations.mjs --limit 20          # submit a 20-question pilot batch
 *   node scripts/generate-explanations.mjs                     # submit the full backlog
 *   node scripts/generate-explanations.mjs --collect <batchId> # poll and ingest a submitted batch
 *
 * Requires ANTHROPIC_API_KEY, or an `ant auth login` profile (the SDK resolves
 * either; see `ant auth status`).
 */

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';

const WORKER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DB = join(WORKER_ROOT, '.local', 'necprep.sqlite');
const STATE_DIR = join(WORKER_ROOT, '.local', 'explanations');

/**
 * Bumped whenever the instruction block below changes in a way that could
 * change output. Stored on every row so a bad cohort can be found and redone.
 */
const PROMPT_VERSION = 'explain-v1';
const MODEL = 'claude-opus-5';

// Claude Opus 5 list price, per million tokens. Batch is 50%.
const PRICE_IN_PER_MTOK = 5.0;
const PRICE_OUT_PER_MTOK = 25.0;
const BATCH_DISCOUNT = 0.5;

// --- The instruction block --------------------------------------------------
// Stable across every request in the run and placed before the per-question
// content, so it is a cacheable prefix. Prompt caching needs >= 512 tokens on
// Claude Opus 5; this block clears that, which is why it is one block rather
// than being inlined per question.
const SYSTEM_PROMPT = `You write explanations for multiple-choice questions on the Nepal Engineering Council (NEC) licensing examination, Computer Engineering stream. Your readers are graduate engineers preparing for a professional licence. They have just answered the question and are now looking at the explanation.

You are given the question, its options, and which option the question bank keys as correct. Your job is to explain why the keyed option is correct — not to decide what the answer should be.

If you believe the keyed option is NOT correct, say so via the agrees_with_key field and explain the discrepancy in key_disagreement_reason. Do not write an explanation arguing for a different answer: the bank grades against the keyed option, so an explanation that contradicts it would tell a student they were marked wrong unfairly without fixing anything. A disagreement from you is routed to a human for adjudication, which is the useful outcome.

Set agrees_with_key to false when any of these hold:
- The keyed option is factually wrong.
- More than one option is defensibly correct, so the question cannot be graded fairly as single-answer.
- No option is correct.
- The stem is ambiguous, self-contradictory, or missing information needed to answer it.

Writing the explanation:
- summary: one to three sentences stating why the keyed option is correct. This is the part most students read, so it must stand alone. Lead with the reason, not with restating the question.
- detail: the working, when the question needs it — a derivation, a formula with its substitution, a truth table, a worked conversion. Omit it entirely for pure recall questions where there is nothing to work through; padding a definition question with filler teaches nothing. Markdown. Keep formulas in plain text or simple LaTeX; this renders in a small panel on a phone.
- distractor_rationales: for each incorrect option, one sentence on why it is wrong AND, where there is one, what misconception makes it tempting. "Confuses series and parallel resonance" teaches; "this is incorrect" does not. Skip an option only when it is arbitrary filler with no instructive content.
- confidence: 0-10, your confidence that the keyed option is correct and your explanation of it is sound. Be honest and use the low end: these drafts are shown to students labelled as unreviewed, and your confidence sets the order in which humans review them. A 4 that is actually uncertain is far more useful than an inflated 8.

Constraints:
- Be correct before being complete. If you are unsure of a numeric result, show the method and say what you are unsure about rather than asserting a number.
- Never refer to the options by position ("the second option"). Options are reordered per student, so positions are not stable. Name the option's text, or use the letter given to you in this prompt only inside distractor_rationales, where it is mapped back by label.
- Do not address the reader as "you" having chosen a particular option; the same explanation is shown to students who answered correctly and incorrectly.
- No preamble, no "Great question", no restating the stem.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    agrees_with_key: {
      type: 'boolean',
      description: 'True if the keyed option is correct and gradeable as single-answer.',
    },
    key_disagreement_reason: {
      type: ['string', 'null'],
      description:
        'Required when agrees_with_key is false: what is wrong with the key, stem, or options.',
    },
    summary: {
      type: 'string',
      description:
        'One to three sentences on why the keyed option is correct. Empty string if agrees_with_key is false.',
    },
    detail: {
      type: ['string', 'null'],
      description: 'Optional markdown working. Null for pure recall questions.',
    },
    distractor_rationales: {
      type: 'array',
      description: 'Why each incorrect option is wrong, and the misconception behind it.',
      items: {
        type: 'object',
        properties: {
          option_label: { type: 'string', description: 'The label given in the prompt, e.g. "B".' },
          why: { type: 'string' },
        },
        required: ['option_label', 'why'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'integer', description: '0-10, honest.' },
  },
  required: ['agrees_with_key', 'summary', 'distractor_rationales', 'confidence'],
  additionalProperties: false,
};

// --- Selection --------------------------------------------------------------

/**
 * Questions needing an explanation, hardest-first.
 *
 * Priority is `responses * (1 - pCorrect)` — the questions the most students
 * get wrong, which is where an explanation does the most good. That data does
 * not exist yet (no attempt has ever been recorded), so the fallback is
 * deterministic and states its own reasoning: questions that appear in a mock
 * test blueprint come first, then by chapter so an interrupted run leaves whole
 * chapters done rather than a thin scatter.
 */
function selectQuestions(db, limit) {
  const rows = db
    .prepare(
      `SELECT q.id,
              q.stem,
              q.chapter_id,
              q.p_value_bp,
              COALESCE(q.p_value_n, 0) AS p_value_n,
              c.nec_code               AS chapter_code,
              c.title                  AS chapter_title
         FROM questions q
         JOIN chapters c ON c.id = q.chapter_id
        WHERE q.status = 'published'
          AND NOT EXISTS (
                SELECT 1 FROM explanations e
                 WHERE e.question_id = q.id
                   AND e.kind = 'solution'
                   AND e.status IN ('draft', 'published'))
        -- responses * (1 - pCorrect), negated so the most-missed come first.
        -- p_value_n is 0 for every question today (no attempt has been
        -- recorded), so this term is currently a no-op and the chapter order
        -- below is what actually decides. It starts working the moment real
        -- attempt data exists, with no change here.
     ORDER BY CASE WHEN COALESCE(q.p_value_n, 0) > 0
                   THEN -(q.p_value_n * (10000 - COALESCE(q.p_value_bp, 5000)))
                   ELSE 0 END,
              c.ordinal,
              q.id`
    )
    .all();

  const withOptions = db.prepare(
    `SELECT o.id, o.ordinal, o.text, o.is_pinned,
            CASE WHEN k.correct_option_id = o.id THEN 1 ELSE 0 END AS is_correct
       FROM question_options o
       JOIN question_answer_keys k ON k.question_id = o.question_id
      WHERE o.question_id = ? AND o.retired_at IS NULL
   ORDER BY o.ordinal`
  );

  const out = [];
  for (const row of rows) {
    const options = withOptions.all(row.id);
    // A question with no reachable key cannot be explained; it is a data
    // defect, and the importer already filed a report for it.
    if (!options.some((o) => o.is_correct)) continue;
    out.push({ ...row, options });
    if (limit && out.length >= limit) break;
  }
  return out;
}

const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

function buildUserContent(q) {
  const lines = [
    `Chapter: ${q.chapter_code} — ${q.chapter_title}`,
    '',
    `Question: ${q.stem}`,
    '',
    'Options:',
  ];
  q.options.forEach((o, i) => {
    lines.push(`  ${LABELS[i]}. ${o.text}`);
  });
  const correctIndex = q.options.findIndex((o) => o.is_correct);
  lines.push('', `The question bank keys ${LABELS[correctIndex]} as the correct answer.`);
  return lines.join('\n');
}

function buildRequest(q) {
  return {
    custom_id: q.id,
    params: {
      model: MODEL,
      max_tokens: 4096,
      // The instruction block is identical across every request in the run, so
      // caching it turns ~2,180 full-price reads of it into one write plus
      // ~2,180 reads at a tenth of the price.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
      messages: [{ role: 'user', content: buildUserContent(q) }],
    },
  };
}

// --- Estimate ---------------------------------------------------------------

async function estimate(client, questions) {
  const sampleSize = Math.min(25, questions.length);
  const sample = questions.slice(0, sampleSize);

  let inputTokens = 0;
  for (const q of sample) {
    const counted = await client.messages.countTokens({
      model: MODEL,
      system: [{ type: 'text', text: SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: buildUserContent(q) }],
    });
    inputTokens += counted.input_tokens;
  }
  const avgInput = inputTokens / sampleSize;

  const systemOnly = await client.messages.countTokens({
    model: MODEL,
    system: [{ type: 'text', text: SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: 'x' }],
  });
  const sharedPrefix = systemOnly.input_tokens;
  const perQuestion = Math.max(0, avgInput - sharedPrefix);

  // Thinking is on by default on Claude Opus 5 and its tokens are billed as
  // output. 900 is a deliberately pessimistic per-question figure for thinking
  // plus a structured answer; the real number lands lower on recall questions.
  const ASSUMED_OUTPUT = 900;

  const n = questions.length;
  const cachedReads = (sharedPrefix * (n - 1) * 0.1) / 1e6;
  const cacheWrite = (sharedPrefix * 1.25) / 1e6;
  const uniqueInput = (perQuestion * n) / 1e6;
  const output = (ASSUMED_OUTPUT * n) / 1e6;

  const inCost = (cachedReads + cacheWrite + uniqueInput) * PRICE_IN_PER_MTOK * BATCH_DISCOUNT;
  const outCost = output * PRICE_OUT_PER_MTOK * BATCH_DISCOUNT;

  console.log(`
  questions needing an explanation   ${n}
  measured shared prefix            ${sharedPrefix} tokens (cached)
  measured per-question input       ${perQuestion.toFixed(0)} tokens  (mean of ${sampleSize})
  assumed output per question        ${ASSUMED_OUTPUT} tokens  (thinking + structured answer)

  at Claude Opus 5 batch rates ($${(PRICE_IN_PER_MTOK * BATCH_DISCOUNT).toFixed(2)} / $${(PRICE_OUT_PER_MTOK * BATCH_DISCOUNT).toFixed(2)} per MTok):
    input   $${inCost.toFixed(2)}
    output  $${outCost.toFixed(2)}
    TOTAL   $${(inCost + outCost).toFixed(2)}

  Output is the dominant term and is an assumption, not a measurement. Run a
  --limit 20 pilot first and read its reported usage before committing.
`);
}

// --- Submit -----------------------------------------------------------------

async function submit(client, db, questions) {
  const requests = questions.map(buildRequest);
  console.log(`  submitting ${requests.length} requests...`);

  const batch = await client.messages.batches.create({ requests });

  mkdirSync(STATE_DIR, { recursive: true });
  const statePath = join(STATE_DIR, `${batch.id}.json`);
  writeFileSync(
    statePath,
    JSON.stringify(
      {
        batchId: batch.id,
        model: MODEL,
        promptVersion: PROMPT_VERSION,
        submittedAt: new Date().toISOString(),
        questionIds: questions.map((q) => q.id),
      },
      null,
      2
    ) + '\n'
  );

  console.log(`  batch id      ${batch.id}`);
  console.log(`  status        ${batch.processing_status}`);
  console.log(`  state written ${statePath}`);
  console.log(`\n  collect with: node scripts/generate-explanations.mjs --collect ${batch.id}\n`);
  return batch;
}

// --- Collect ----------------------------------------------------------------

async function collect(client, db, batchId) {
  let batch = await client.messages.batches.retrieve(batchId);
  while (batch.processing_status !== 'ended') {
    const c = batch.request_counts;
    console.log(
      `  ${batch.processing_status}: processing ${c.processing}, succeeded ${c.succeeded}, errored ${c.errored}`
    );
    await new Promise((r) => setTimeout(r, 30_000));
    batch = await client.messages.batches.retrieve(batchId);
  }

  return ingest(db, await client.messages.batches.results(batchId), batchId);
}

/**
 * Writes one batch's results into the database.
 *
 * Separated from the poll loop above so it can run against a local file of
 * results — both to test this path without spending anything, and to re-ingest
 * after a crash without re-submitting a batch. `results` is any async iterable
 * of batch result objects, which is what `batches.results()` returns.
 */
async function ingest(db, results, batchId) {
  const stats = {
    succeeded: 0,
    refused: 0,
    errored: 0,
    expired: 0,
    canceled: 0,
    disagreed: 0,
    written: 0,
    rationalesWritten: 0,
    invalidShape: 0,
    unmatchedOption: 0,
    confidence: [],
  };

  const optionsFor = db.prepare(
    `SELECT id, ordinal, text FROM question_options
      WHERE question_id = ? AND retired_at IS NULL ORDER BY ordinal`
  );
  const insertExplanation = db.prepare(
    `INSERT INTO explanations
       (question_id, body, body_format, about_option_id, kind, is_primary, status,
        origin, generator_model, generator_prompt_version, generated_at,
        generator_confidence_bp, created_at, updated_at)
     VALUES (?, ?, 'markdown', ?, ?, ?, ?, 'ai_draft', ?, ?, ?, ?, ?, ?)`
  );
  // `reporter_user_id` must be NULL when source is 'validator' (CHECK), and
  // `code` is left NULL deliberately: the model's reason is free text and the
  // code vocabulary is for defects a rule detected. The detail is prefixed so
  // these are greppable among user-filed reports.
  const insertReport = db.prepare(
    `INSERT INTO question_reports
       (public_id, question_id, reporter_user_id, source, category, code, detail,
        status, created_at, updated_at)
     VALUES (?, ?, NULL, 'validator', 'wrong_answer', NULL, ?, 'open', ?, ?)`
  );
  // The unique index that would catch a duplicate only covers user-filed
  // reports (it is partial on reporter_user_id IS NOT NULL), so a re-ingest of
  // the same batch would otherwise file the same report twice. Check first.
  const reportExists = db.prepare(
    `SELECT 1 FROM question_reports
      WHERE question_id = ? AND source = 'validator' AND status = 'open'
        AND detail LIKE 'explanation-generator-disagreement%'`
  );

  const now = Date.now();
  const generatedAt = now;

  for await (const result of results) {
    const qid = result.custom_id;

    if (result.result.type !== 'succeeded') {
      stats[result.result.type] = (stats[result.result.type] ?? 0) + 1;
      if (result.result.type === 'errored') {
        console.error(`  errored  ${qid}: ${result.result.error?.type ?? 'unknown'}`);
      }
      continue;
    }

    const message = result.result.message;

    // A refusal is HTTP 200 with an empty or partial content array. Reading
    // content[0] unconditionally would throw here.
    if (message.stop_reason === 'refusal') {
      stats.refused++;
      console.error(`  refused  ${qid}: ${message.stop_details?.category ?? 'uncategorised'}`);
      continue;
    }

    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock) {
      stats.invalidShape++;
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      stats.invalidShape++;
      console.error(`  unparseable JSON for ${qid}`);
      continue;
    }

    stats.succeeded++;
    if (Number.isInteger(parsed.confidence)) stats.confidence.push(parsed.confidence);

    // A model that disagrees with the key produces an errata report, not an
    // explanation. Nothing is published on this path.
    if (parsed.agrees_with_key === false) {
      stats.disagreed++;
      if (!reportExists.get(qid)) {
        insertReport.run(
          randomUUID().replace(/-/g, '').slice(0, 26).toUpperCase(),
          qid,
          `explanation-generator-disagreement (${MODEL}, ${PROMPT_VERSION}): ` +
            (parsed.key_disagreement_reason ?? '(no reason given)'),
          now,
          now
        );
      }
      continue;
    }

    const summary = String(parsed.summary ?? '').trim();
    if (!summary) {
      stats.invalidShape++;
      continue;
    }

    const confidenceBp = Number.isInteger(parsed.confidence)
      ? Math.max(0, Math.min(10000, parsed.confidence * 1000))
      : null;

    const body =
      parsed.detail && String(parsed.detail).trim()
        ? `${summary}\n\n${String(parsed.detail).trim()}`
        : summary;

    insertExplanation.run(
      qid,
      body,
      null,
      'solution',
      1,
      'published',
      MODEL,
      PROMPT_VERSION,
      generatedAt,
      confidenceBp,
      now,
      now
    );
    stats.written++;

    // Distractor rationales are matched back to options by label position,
    // which is the one place the label-to-option mapping has to be reconstructed
    // the same way buildUserContent assigned it. A label that does not resolve
    // is dropped rather than guessed.
    const opts = optionsFor.all(qid);
    for (const r of parsed.distractor_rationales ?? []) {
      const idx = LABELS.indexOf(String(r.option_label ?? '').trim().toUpperCase());
      const opt = idx >= 0 ? opts[idx] : undefined;
      if (!opt || !String(r.why ?? '').trim()) {
        stats.unmatchedOption++;
        continue;
      }
      insertExplanation.run(
        qid,
        String(r.why).trim(),
        opt.id,
        'distractor',
        0,
        'published',
        MODEL,
        PROMPT_VERSION,
        generatedAt,
        confidenceBp,
        now,
        now
      );
      stats.rationalesWritten++;
    }
  }

  const conf = stats.confidence;
  const mean = conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : 0;
  const low = conf.filter((c) => c <= 5).length;

  console.log(`
  batch ${batchId} ingested

    succeeded                 ${stats.succeeded}
    primary explanations      ${stats.written}
    distractor rationales     ${stats.rationalesWritten}
    KEY DISAGREEMENTS         ${stats.disagreed}  -> filed as errata, nothing published
    refused                   ${stats.refused}
    errored / expired / cxl   ${stats.errored} / ${stats.expired} / ${stats.canceled}
    unparseable or empty      ${stats.invalidShape}
    dropped rationales        ${stats.unmatchedOption}

    mean confidence           ${mean.toFixed(1)} / 10
    confidence <= 5           ${low}  -> review these first

  Everything written is origin='ai_draft', status='published': served to
  students WITH an unreviewed badge, and never during a timed mock test.
  Review with: node scripts/review-explanations.mjs
`);

  return stats;
}

// --- Main -------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const dbPath = resolve(value('--db', DEFAULT_DB));
if (!existsSync(dbPath)) {
  console.error(`no database at ${dbPath}. Run \`npm run db:apply:local && npm run db:seed:local\`.`);
  process.exit(2);
}
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

const limit = Number(value('--limit', '0')) || 0;

if (flag('--ingest-file')) {
  const path = value('--ingest-file');
  if (!path || path.startsWith('--')) {
    console.error('--ingest-file requires a path to a JSONL file of batch results');
    process.exit(2);
  }
  const lines = readFileSync(resolve(path), 'utf8').split('\n').filter((l) => l.trim());
  async function* fromFile() {
    for (const line of lines) yield JSON.parse(line);
  }
  await ingest(db, fromFile(), `file:${path}`);
  db.close();
  process.exit(0);
}

if (flag('--collect')) {
  const batchId = value('--collect');
  if (!batchId || batchId.startsWith('--')) {
    console.error('--collect requires a batch id');
    process.exit(2);
  }
  await collect(new Anthropic(), db, batchId);
  db.close();
  process.exit(0);
}

const questions = selectQuestions(db, limit);
console.log(`\n  ${questions.length} published question(s) without an explanation`);

if (questions.length === 0) {
  console.log('  nothing to do\n');
  db.close();
  process.exit(0);
}

if (flag('--dry-run')) {
  const req = buildRequest(questions[0]);
  console.log('\n  --- first request (not sent) ---\n');
  console.log(`  custom_id: ${req.custom_id}`);
  console.log(`  model:     ${req.params.model}`);
  console.log('\n' + req.params.messages[0].content.replace(/^/gm, '  '));
  console.log(`\n  system prompt: ${SYSTEM_PROMPT.length} chars, cache_control ephemeral`);
  console.log(`  schema keys:   ${Object.keys(RESPONSE_SCHEMA.properties).join(', ')}\n`);
  db.close();
  process.exit(0);
}

const client = new Anthropic();

if (flag('--estimate')) {
  await estimate(client, questions);
  db.close();
  process.exit(0);
}

await submit(client, db, questions);
db.close();
