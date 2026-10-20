#!/usr/bin/env node
/**
 * validate-questions.mjs
 *
 * Quality gate for the question bank in frontend/public/data/books/.
 *
 * The bank is authored as a spreadsheet-shaped JSON array:
 *   { qsns, opt1..opt4, correct_option, correct_option_index }
 * with `correct_option_index` 1-based. Nothing has ever checked it, which is
 * how the live bank came to contain answer keys that disagree with themselves,
 * indices pointing past the last option, and a correct-answer position so
 * skewed that guessing "option 2" scores well above chance.
 *
 * Usage:
 *   node scripts/validate-questions.mjs            # human report
 *   node scripts/validate-questions.mjs --json     # machine report
 *   node scripts/validate-questions.mjs --csv out.csv
 *   node scripts/validate-questions.mjs --strict   # also fail on warnings
 *   node scripts/validate-questions.mjs --check-ids # only: quarantine ids in range
 *
 * Exit codes: 0 clean, 1 errors found, 2 could not run.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Imported directly from the app so there is exactly one implementation of
// option ordering. Node >= 22.18 strips the TypeScript types natively, which
// is why CI pins Node 22. A mirrored copy here drifted from the app once and
// would have gone unnoticed.
import {
  assignOptionOrders,
  attainableWorstShare,
} from '../frontend/src/services/optionOrdering.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'frontend', 'public', 'data', 'books');
const QUARANTINE_FILE = join(ROOT, 'frontend', 'src', 'data', 'quarantine.json');

/**
 * Questions already known to be broken and withheld from practice. Their errors
 * are reported separately so the gate stays green on a known baseline while any
 * newly introduced bad question fails the build.
 */
const quarantined = new Map();
if (existsSync(QUARANTINE_FILE)) {
  for (const entry of JSON.parse(readFileSync(QUARANTINE_FILE, 'utf8'))) {
    quarantined.set(entry.id, entry);
  }
}
const topicIdFor = (file) => 'book-' + file.replace('.json', '');
const qidFor = (file, idx) => `${topicIdFor(file)}_${idx}`;

const REQUIRED = ['qsns', 'opt1', 'opt2', 'opt3', 'opt4', 'correct_option', 'correct_option_index'];
const OPT_KEYS = ['opt1', 'opt2', 'opt3', 'opt4'];

// Options whose meaning depends on being last. They must never be shuffled
// into another slot, and they must not all pile into one position.
const POSITIONAL_RE = /^\s*(all|none|both)\s+(of\s+)?(the\s+)?(above|these|mentioned)/i;

/** Normalised stem, for duplicate detection. */
const normStem = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s?]/g, '').trim();

// --- Collect ----------------------------------------------------------------

if (!existsSync(DATA_DIR)) {
  console.error(`Data directory not found: ${DATA_DIR}`);
  process.exit(2);
}

const files = readdirSync(DATA_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort((a, b) => {
    const na = Number(a.match(/\d+/)?.[0] ?? 0);
    const nb = Number(b.match(/\d+/)?.[0] ?? 0);
    return na - nb || a.localeCompare(b);
  });

if (files.length === 0) {
  console.error(`No JSON files in ${DATA_DIR}`);
  process.exit(2);
}

const errors = [];      // block the build
const warnings = [];    // report, do not block unless --strict
const quarantinedFindings = []; // known-bad rows already withheld from practice
const stemIndex = new Map(); // normalised stem -> [{file, idx}]
const positionHistogram = [0, 0, 0, 0, 0, 0, 0];       // 1-based index -> count, as authored
const shuffledHistogram = [0, 0, 0, 0, 0, 0, 0];      // after orderOptions()
const perFile = [];

const err = (file, idx, code, message, extra = {}) => {
  const finding = { file, idx, code, message, ...extra };
  // A row on the quarantine list is a logged, reviewed decision. Reporting it as
  // a build error every run would make the gate permanently red and therefore
  // useless for catching the next bad question.
  if (idx >= 0 && quarantined.has(qidFor(file, idx))) quarantinedFindings.push(finding);
  else errors.push(finding);
};
const warn = (file, idx, code, message, extra = {}) =>
  warnings.push({ file, idx, code, message, ...extra });

for (const file of files) {
  let rows;
  try {
    rows = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
  } catch (e) {
    err(file, -1, 'PARSE', `Not valid JSON: ${e.message}`);
    continue;
  }
  if (!Array.isArray(rows)) {
    err(file, -1, 'SHAPE', 'Top level must be a JSON array of question objects');
    continue;
  }

  const filePositions = [0, 0, 0, 0, 0, 0, 0];
  const fileShuffled = [0, 0, 0, 0, 0, 0, 0];
  // Questions a student can actually be served, in the exact shape the loader
  // passes to assignOptionOrders(). Ordering is decided per chapter, so it is
  // computed after the row loop rather than inside it.
  const orderable = [];
  let positionalCount = 0;

  rows.forEach((q, idx) => {
    // -- required fields ---------------------------------------------------
    const missing = REQUIRED.filter((k) => !(k in (q ?? {})));
    if (missing.length) {
      err(file, idx, 'MISSING_FIELD', `Missing field(s): ${missing.join(', ')}`);
      return;
    }

    // -- option sanity -----------------------------------------------------
    const opts = OPT_KEYS.map((k) => q[k]);
    opts.forEach((o, i) => {
      if (typeof o !== 'string') err(file, idx, 'OPTION_TYPE', `${OPT_KEYS[i]} is not a string`);
      else if (!o.trim()) err(file, idx, 'OPTION_EMPTY', `${OPT_KEYS[i]} is empty`);
    });

    const seen = new Map();
    opts.forEach((o, i) => {
      if (typeof o !== 'string') return;
      const key = o.trim().toLowerCase();
      if (seen.has(key)) {
        err(file, idx, 'OPTION_DUPLICATE',
          `${OPT_KEYS[seen.get(key)]} and ${OPT_KEYS[i]} are both "${o.trim()}" - two options can be simultaneously correct`);
      } else {
        seen.set(key, i);
      }
    });

    if (typeof q.qsns !== 'string' || !q.qsns.trim()) {
      err(file, idx, 'STEM_EMPTY', 'Question stem is empty');
      return;
    }

    // -- the answer key ----------------------------------------------------
    const ix = q.correct_option_index;
    if (!Number.isInteger(ix)) {
      err(file, idx, 'INDEX_TYPE', `correct_option_index is not an integer (got ${JSON.stringify(ix)})`);
    } else if (ix < 1 || ix > OPT_KEYS.length) {
      err(file, idx, 'INDEX_RANGE',
        `correct_option_index is ${ix} but there are only ${OPT_KEYS.length} options - this question is unanswerable`,
        { stem: q.qsns.slice(0, 80) });
    } else {
      const keyed = opts[ix - 1];
      const stated = typeof q.correct_option === 'string' ? q.correct_option.trim() : '';
      if (stated && typeof keyed === 'string' && stated !== keyed.trim()) {
        const presentAt = opts.findIndex((o) => typeof o === 'string' && o.trim() === stated);
        err(file, idx, 'KEY_CONFLICT',
          `correct_option_index ${ix} points at "${keyed}" but correct_option says "${stated}"` +
          (presentAt === -1
            ? ' - and that text is not among the options at all'
            : ` (which is ${OPT_KEYS[presentAt]})`),
          { stem: q.qsns.slice(0, 80), keyed, stated, statedAt: presentAt + 1 || null });
      }
      if (!stated) {
        warn(file, idx, 'KEY_MISSING_TEXT', 'correct_option is empty; only the index identifies the answer');
      }
      filePositions[ix]++;
      positionHistogram[ix]++;

      // Quarantined rows never reach a student, so they must not count toward
      // the distribution the student actually experiences.
      if (!quarantined.has(qidFor(file, idx))) {
        orderable.push({
          id: qidFor(file, idx),
          options: opts.filter(Boolean),
          correctIndex: ix - 1,
        });
      }
    }

    // -- positional options ------------------------------------------------
    opts.forEach((o, i) => {
      if (typeof o === 'string' && POSITIONAL_RE.test(o)) {
        positionalCount++;
        if (i !== OPT_KEYS.length - 1) {
          warn(file, idx, 'POSITIONAL_NOT_LAST',
            `"${o.trim()}" is in ${OPT_KEYS[i]}; options of this kind must be pinned last when shuffling`);
        }
      }
    });

    // -- truncation / authoring smells -------------------------------------
    const stem = q.qsns.trim();
    if (/\.\.\.$|…$/.test(stem)) {
      warn(file, idx, 'STEM_TRUNCATED', `Stem ends in an ellipsis: "${stem.slice(-50)}"`);
    }
    if (stem.length < 15) {
      warn(file, idx, 'STEM_SHORT', `Stem is only ${stem.length} chars: "${stem}"`);
    }

    // -- duplicates --------------------------------------------------------
    const key = normStem(stem);
    if (!stemIndex.has(key)) stemIndex.set(key, []);
    stemIndex.get(key).push({ file, idx, stem: stem.slice(0, 90) });
  });

  // Order the whole chapter at once - exactly what the loader does - and tally
  // the slot each correct answer actually lands in.
  for (const { correctIndex } of assignOptionOrders(orderable)) {
    if (correctIndex >= 0 && correctIndex < OPT_KEYS.length) {
      fileShuffled[correctIndex + 1]++;
      shuffledHistogram[correctIndex + 1]++;
    }
  }

  perFile.push({
    file,
    rows: rows.length,
    positions: filePositions,
    shuffled: fileShuffled,
    attainableWorstPct: attainableWorstShare(orderable) * 100,
    positionalCount,
  });
}

// --- Quarantine id integrity ------------------------------------------------

/**
 * Quarantine ids are `{topicId}_{arrayIndex}`, so they are tied to array
 * position: deleting or inserting a row in a chapter JSON silently re-points
 * every id after it. The failure is invisible and inverted - the loader
 * withholds an innocent question and serves the broken one it was meant to
 * withhold. So the list is checked against the files on every run, and
 * `--check-ids` reports it on its own for a fast CI gate.
 */
const rowCountByTopic = new Map(perFile.map((f) => [topicIdFor(f.file), f.rows]));
const fileByTopic = new Map(perFile.map((f) => [topicIdFor(f.file), f.file]));
const quarantineIdErrors = [];

for (const id of quarantined.keys()) {
  const m = /^(.+)_(\d+)$/.exec(id);
  if (!m) {
    quarantineIdErrors.push({
      file: QUARANTINE_FILE.replace(ROOT + '/', ''), idx: -1, id,
      code: 'QUARANTINE_ID_MALFORMED',
      message: `Quarantine id "${id}" is not of the form {topicId}_{arrayIndex}`,
    });
    continue;
  }
  const [, topicId, idxStr] = m;
  const idx = Number(idxStr);
  if (!rowCountByTopic.has(topicId)) {
    quarantineIdErrors.push({
      file: QUARANTINE_FILE.replace(ROOT + '/', ''), idx: -1, id,
      code: 'QUARANTINE_ID_UNKNOWN_TOPIC',
      message: `Quarantine id "${id}" names topic "${topicId}", but no such file exists in ${
        DATA_DIR.replace(ROOT + '/', '')}`,
    });
  } else if (idx >= rowCountByTopic.get(topicId)) {
    quarantineIdErrors.push({
      file: fileByTopic.get(topicId), idx: -1, id,
      code: 'QUARANTINE_ID_OUT_OF_RANGE',
      message: `Quarantine id "${id}" points at index ${idx}, but ${
        fileByTopic.get(topicId)} has only ${rowCountByTopic.get(topicId)} rows (0-${
        rowCountByTopic.get(topicId) - 1}). The question bank was edited without regenerating the list, ` +
        `so every id at or after the edit now withholds the wrong question.`,
    });
  }
}
errors.push(...quarantineIdErrors);

// --- Duplicates -------------------------------------------------------------

const dupGroups = [...stemIndex.entries()].filter(([, v]) => v.length > 1);
const dupRows = dupGroups.reduce((n, [, v]) => n + v.length - 1, 0);
const crossFileGroups = dupGroups.filter(([, v]) => new Set(v.map((x) => x.file)).size > 1);

for (const [, group] of dupGroups) {
  const where = group.map((g) => `${g.file}[${g.idx}]`).join(' ');
  warn(group[0].file, group[0].idx, 'DUPLICATE_STEM',
    `Appears ${group.length}x: ${where} - "${group[0].stem}"`);
}

// --- Answer-position bias ---------------------------------------------------

/** Chi-square against a uniform distribution over the 4 option slots. */
function chiSquare(counts) {
  const obs = counts.slice(1, 5);
  const n = obs.reduce((a, b) => a + b, 0);
  if (n === 0) return { chi2: 0, n: 0, df: 3 };
  const expected = n / obs.length;
  const chi2 = obs.reduce((acc, o) => acc + (o - expected) ** 2 / expected, 0);
  return { chi2, n, df: obs.length - 1 };
}

const overall = chiSquare(positionHistogram);
const overallShuffled = chiSquare(shuffledHistogram);
// Critical values for df=3: p<.05 = 7.81, p<.01 = 11.34, p<.001 = 16.27
const BIAS_CRITICAL = 16.27;
const biasFindings = [];

// The gate measures the distribution a student is shown, after orderOptions().
// Gating on the authored distribution would be permanently red and would push
// toward re-authoring 2,801 questions to fix something the loader already
// neutralises. Raw skew is still reported, because it signals how the content
// was produced and only the loader is holding it in check.
for (const f of perFile) {
  const raw = chiSquare(f.positions);
  const shown = chiSquare(f.shuffled);
  const rawPct = f.positions.slice(1, 5).map((c) => (raw.n ? (c / raw.n) * 100 : 0));
  const shownPct = f.shuffled.slice(1, 5).map((c) => (shown.n ? (c / shown.n) * 100 : 0));
  const worst = Math.max(...shownPct, 0);
  const worstSlot = shownPct.indexOf(worst) + 1;

  // Lower bound on what any ordering could achieve for this file, given the
  // options it pins last. Optimistic - see attainableWorstShare().
  const floorWorst = f.attainableWorstPct ?? 25;

  biasFindings.push({
    file: f.file,
    rawN: raw.n, rawChi2: raw.chi2, rawPct,
    shownN: shown.n, shownChi2: shown.chi2, shownPct,
    worst, worstSlot,
    attainableWorst: floorWorst,
  });

  if (shown.n >= 100 && worst >= 32) {
    err(f.file, -1, 'ANSWER_POSITION_BIAS',
      `After option ordering, option ${worstSlot} is still the answer in ${worst.toFixed(1)}% of ` +
      `${shown.n} questions (chi2=${shown.chi2.toFixed(1)}; uniform is 25%). ` +
      `No ordering of these same questions could beat a worst slot of ` +
      `${floorWorst.toFixed(1)}%, ` +
      (floorWorst >= 32
        ? `so this file cannot pass while ${f.positionalCount} options are pinned last - the content, not the loader, has to change.`
        : `so the gate is reachable: the ordering seed is landing badly, not hitting a structural limit.`));
  }
  if (raw.n >= 30 && raw.chi2 > BIAS_CRITICAL) {
    warn(f.file, -1, 'ANSWER_POSITION_SKEW_AS_AUTHORED',
      `As authored, answer positions are non-uniform (chi2=${raw.chi2.toFixed(1)}, p<0.001): ` +
      `${rawPct.map((x) => x.toFixed(0) + '%').join(' / ')}. ` +
      `Neutralised at load time to ${shownPct.map((x) => x.toFixed(0) + '%').join(' / ')} ` +
      `(chi2=${shown.chi2.toFixed(1)}).`);
  }
}

// --- Report -----------------------------------------------------------------

const args = process.argv.slice(2);
const totalRows = perFile.reduce((n, f) => n + f.rows, 0);

if (args.includes('--check-ids')) {
  console.log(`\n  Quarantine id check - ${QUARANTINE_FILE.replace(ROOT + '/', '')}\n`);
  if (!existsSync(QUARANTINE_FILE)) {
    console.log('  No quarantine file; nothing to check.\n');
    process.exit(0);
  }
  const byTopic = new Map();
  for (const id of quarantined.keys()) {
    const topicId = /^(.+)_(\d+)$/.exec(id)?.[1] ?? '(malformed)';
    if (!byTopic.has(topicId)) byTopic.set(topicId, []);
    byTopic.get(topicId).push(id);
  }
  console.log(`  ${'topic'.padEnd(12)} ${'ids'.padStart(5)} ${'rows'.padStart(6)}   max index used`);
  for (const [topicId, ids] of [...byTopic.entries()].sort()) {
    const rows = rowCountByTopic.get(topicId);
    const maxIdx = Math.max(...ids.map((id) => Number(/_(\d+)$/.exec(id)?.[1] ?? -1)));
    console.log(`  ${topicId.padEnd(12)} ${String(ids.length).padStart(5)} ` +
                `${String(rows ?? '-').padStart(6)}   ${maxIdx}` +
                (rows === undefined ? '  <- no such file' : maxIdx >= rows ? '  <- OUT OF RANGE' : ''));
  }
  if (quarantineIdErrors.length) {
    console.log(`\n  ${quarantineIdErrors.length} bad id(s):`);
    for (const e of quarantineIdErrors) console.log(`    ${e.code}  ${e.message}`);
    console.log('\n  Regenerate the list against the current files before shipping.\n');
  } else {
    console.log(`\n  All ${quarantined.size} quarantine id(s) are in range for their chapter file.\n`);
  }
  process.exit(quarantineIdErrors.length ? 1 : 0);
}
const byCode = (list) => list.reduce((m, e) => ((m[e.code] = (m[e.code] || 0) + 1), m), {});

const summary = {
  files: perFile.length,
  totalRows,
  uniqueStems: stemIndex.size,
  duplicateRows: dupRows,
  duplicateGroups: dupGroups.length,
  crossFileDuplicateGroups: crossFileGroups.length,
  positionHistogram: positionHistogram.slice(1, 6),
  shuffledHistogram: shuffledHistogram.slice(1, 6),
  overallChi2: Number(overall.chi2.toFixed(2)),
  overallChi2AfterOrdering: Number(overallShuffled.chi2.toFixed(2)),
  quarantined: quarantined.size,
  quarantinedFindings: quarantinedFindings.length,
  quarantineIdErrors: quarantineIdErrors.length,
  positionalOptions: perFile.reduce((n, f) => n + f.positionalCount, 0),
  errors: errors.length,
  warnings: warnings.length,
  errorsByCode: byCode(errors),
  warningsByCode: byCode(warnings),
};

if (args.includes('--json')) {
  console.log(JSON.stringify(
    { summary, errors, warnings, quarantinedFindings, perFile, biasFindings }, null, 2));
} else {
  const bar = (n, max, width = 40) => '#'.repeat(Math.max(0, Math.round((n / (max || 1)) * width)));

  console.log(`\n  Question bank validation - ${DATA_DIR.replace(ROOT + '/', '')}\n`);
  console.log(`  ${'file'.padEnd(12)} ${'rows'.padStart(6)}   as authored 1/2/3/4        as shown 1/2/3/4`);
  for (const f of perFile) {
    const fmt = (counts) => {
      const n = counts.slice(1, 5).reduce((a, b) => a + b, 0);
      return counts.slice(1, 5)
        .map((c) => (n ? ((c / n) * 100).toFixed(0).padStart(3) + '%' : '   - '))
        .join(' ');
    };
    console.log(`  ${f.file.padEnd(12)} ${String(f.rows).padStart(6)}   ${fmt(f.positions)}    ${fmt(f.shuffled)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(12)} ${String(totalRows).padStart(6)}`);

  const maxPos = Math.max(...positionHistogram.slice(1, 5));
  console.log(`\n  Answer-position distribution across the whole bank:`);
  for (let i = 1; i <= 4; i++) {
    const c = positionHistogram[i];
    const pct = overall.n ? ((c / overall.n) * 100).toFixed(1) : '0.0';
    console.log(`    option ${i}: ${String(c).padStart(5)}  ${pct.padStart(5)}%  ${bar(c, maxPos)}`);
  }
  console.log(`    chi-square as authored: ${overall.chi2.toFixed(1)} on ${overall.df} df` +
              ` | after option ordering: ${overallShuffled.chi2.toFixed(1)}` +
              ` (uniform expects ~0; p<0.05 above 7.81, p<0.001 above ${BIAS_CRITICAL})`);

  console.log(`\n  Duplicates: ${dupRows} redundant rows in ${dupGroups.length} groups ` +
              `(${crossFileGroups.length} span more than one file). ` +
              `${stemIndex.size} unique stems of ${totalRows}.`);
  console.log(`  Positional options ("all of the above" and similar): ${summary.positionalOptions}`);

  const show = (list, label, limit) => {
    if (!list.length) return;
    console.log(`\n  ${label} (${list.length}):`);
    const counts = byCode(list);
    for (const [code, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(5)}  ${code}`);
    }
    console.log('');
    for (const e of list.slice(0, limit)) {
      const at = e.idx >= 0 ? `${e.file}[${e.idx}]` : e.file;
      console.log(`    ${at}  ${e.code}\n        ${e.message}`);
    }
    if (list.length > limit) console.log(`    ... and ${list.length - limit} more (use --json for all)`);
  };

  show(errors, 'ERRORS - these block the build', 40);

  if (quarantinedFindings.length) {
    console.log(`\n  QUARANTINED (${quarantinedFindings.length} findings across ${quarantined.size} questions):`);
    console.log(`    Already withheld from practice via frontend/src/data/quarantine.json.`);
    console.log(`    These do not block the build. Fix the rows, then remove their ids from that file.`);
    const codes = byCode(quarantinedFindings);
    for (const [code, n] of Object.entries(codes).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(5)}  ${code}`);
    }
  }
  show(warnings.filter((w) => w.code !== 'DUPLICATE_STEM'), 'WARNINGS', 15);

  if (dupGroups.length) {
    console.log(`\n  Worst duplicate groups:`);
    for (const d of [...dupGroups].sort((a, b) => b[1].length - a[1].length).slice(0, 5)) {
      console.log(`    x${d[1].length}  ${d[1].map((g) => `${g.file}[${g.idx}]`).join(' ')}\n        "${d[1][0].stem}"`);
    }
  }

  console.log(`\n  ${errors.length} error(s), ${warnings.length} warning(s), ` +
              `${quarantinedFindings.length} finding(s) on quarantined questions\n`);
}

const csvArg = args.indexOf('--csv');
if (csvArg !== -1 && args[csvArg + 1]) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['severity,file,index,code,message'];
  for (const e of errors) lines.push(['error', e.file, e.idx, e.code, e.message].map(esc).join(','));
  for (const w of warnings) lines.push(['warning', w.file, w.idx, w.code, w.message].map(esc).join(','));
  writeFileSync(args[csvArg + 1], lines.join('\n') + '\n');
  console.error(`  triage CSV written to ${args[csvArg + 1]}`);
}

const failed = errors.length > 0 || (args.includes('--strict') && warnings.length > 0);
process.exit(failed ? 1 : 0);
