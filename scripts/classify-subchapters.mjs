/**
 * Classify the whole question bank into syllabus sub-chapters, offline.
 *
 *   node scripts/classify-subchapters.mjs             # coverage report
 *   node scripts/classify-subchapters.mjs --sample 8  # show N decisions/chapter
 *   node scripts/classify-subchapters.mjs --review    # write a review sheet
 *
 * The classifier itself lives in `frontend/src/services/subchapterClassifier.ts`
 * and is imported directly — Node 22 strips the types — so this report and the
 * running app can never disagree about what a question is classified as.
 *
 * NOTHING HERE IS A BUILD ARTEFACT
 * --------------------------------
 * There is deliberately no generated map. The app classifies at render time
 * and the importer at import time, both through the same module, so a
 * precomputed file would have no consumer and nothing to keep it honest — it
 * would simply drift away from the term lists.
 *
 * WHAT THIS MEASURES, AND WHAT IT CANNOT
 * -------------------------------------
 * COVERAGE is measurable here: how many questions got a label, and whether
 * all six sub-chapters of each chapter are being used. PRECISION is not —
 * there is no ground truth to compare against, so a term list that
 * confidently mislabels a whole topic would show up as excellent coverage.
 *
 * That is what `--review` is for: it writes every label to a TSV, weakest
 * confidence first, so the least-defensible decisions are the ones a reader
 * reaches in the first screenful. Spot-checking the top of that file is the
 * only way precision gets validated.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  classifySubchapter,
  CLASSIFIER_THRESHOLDS,
} from '../frontend/src/services/subchapterClassifier.ts';
import { syllabusChapters } from '../frontend/src/data/syllabus.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'frontend', 'public', 'data', 'books');
const REVIEW_FILE = join(ROOT, 'subchapter-review.tsv');

const args = process.argv.slice(2);
const REVIEW = args.includes('--review');
const sampleIdx = args.indexOf('--sample');
const SAMPLE = sampleIdx === -1 ? 0 : Number(args[sampleIdx + 1] ?? 5);

/**
 * The frontend's positional id, so a review row can be traced back to the
 * exact question — `book-ch4_317` locates it in `ch4.json` without a search.
 */
function questionId(bookChapterId, index) {
  return `${bookChapterId}_${index}`;
}

function optionsOf(row) {
  return [row.opt1, row.opt2, row.opt3, row.opt4].filter(
    o => typeof o === 'string' && o.length > 0
  );
}

const report = [];
const reviewRows = [];
let totalRows = 0;
let totalMatched = 0;
let confidenceSum = 0;

for (const chapter of syllabusChapters) {
  const file = join(DATA_DIR, `${chapter.bookChapterId.replace('book-', '')}.json`);
  let rows;
  try {
    rows = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    console.error(`! cannot read ${file}: ${err.message}`);
    process.exitCode = 1;
    continue;
  }
  if (!Array.isArray(rows)) {
    console.error(`! ${file} is not an array`);
    process.exitCode = 1;
    continue;
  }

  // Per-sub-chapter tallies, so a chapter whose questions all land on one
  // sub-chapter is visible as a problem rather than counted as success.
  const perSub = new Map(chapter.subchapters.map(s => [s.code, 0]));
  const samples = [];
  let matched = 0;

  rows.forEach((row, index) => {
    totalRows += 1;
    const question = typeof row.qsns === 'string' ? row.qsns : '';
    const options = optionsOf(row);
    const hit = classifySubchapter({
      bookChapterId: chapter.bookChapterId,
      question,
      options,
    });
    if (!hit) {
      if (samples.length < SAMPLE) {
        samples.push({ ok: false, stem: question.slice(0, 64) });
      }
      return;
    }
    matched += 1;
    totalMatched += 1;
    confidenceSum += hit.confidenceBp;
    perSub.set(hit.code, (perSub.get(hit.code) ?? 0) + 1);
    reviewRows.push({
      bp: hit.confidenceBp,
      id: questionId(chapter.bookChapterId, index),
      code: hit.displayCode,
      title: hit.title,
      stem: question.replace(/\s+/g, ' ').trim(),
      terms: hit.matchedTerms.slice(0, 4).join('; '),
    });
    if (samples.length < SAMPLE) {
      samples.push({
        ok: true,
        stem: question.slice(0, 64),
        code: hit.displayCode,
        title: hit.title,
        bp: hit.confidenceBp,
        terms: hit.matchedTerms.slice(0, 3),
      });
    }
  });

  report.push({
    chapter: chapter.number,
    total: rows.length,
    matched,
    perSub: [...perSub.entries()],
    samples,
  });
}

/* ── Report ─────────────────────────────────────────────────────────── */

const pct = (n, d) => (d === 0 ? '  0.0' : ((n / d) * 100).toFixed(1).padStart(5));

console.log('Sub-chapter classification — deterministic, no API calls.');
console.log(
  `Thresholds: MIN_SCORE=${CLASSIFIER_THRESHOLDS.MIN_SCORE} ` +
    `MIN_MARGIN=${CLASSIFIER_THRESHOLDS.MIN_MARGIN} ` +
    `OPTION_WEIGHT=${CLASSIFIER_THRESHOLDS.OPTION_WEIGHT}\n`
);
console.log('  ch   total  labelled       spread across the 6 sub-chapters');
console.log('  ───────────────────────────────────────────────────────────────');
for (const r of report) {
  const spread = r.perSub.map(([, n]) => String(n).padStart(4)).join(' ');
  const used = r.perSub.filter(([, n]) => n > 0).length;
  console.log(
    `  ${String(r.chapter).padStart(2)}  ${String(r.total).padStart(6)}  ` +
      `${String(r.matched).padStart(5)} ${pct(r.matched, r.total)}%  ` +
      `${spread}   ${used}/6 used`
  );
}
console.log('  ───────────────────────────────────────────────────────────────');
console.log(
  `  all ${String(totalRows).padStart(6)}  ${String(totalMatched).padStart(5)} ` +
    `${pct(totalMatched, totalRows)}%  ` +
    `mean confidence ${totalMatched ? Math.round(confidenceSum / totalMatched) : 0} bp`
);

if (SAMPLE > 0) {
  for (const r of report) {
    console.log(`\n  ── chapter ${r.chapter} sample ──`);
    for (const s of r.samples) {
      if (s.ok) {
        console.log(`   ${s.code} ${String(s.bp).padStart(4)}bp  ${s.stem}`);
        console.log(`          via ${s.terms.join(', ')}`);
      } else {
        console.log(`   ---  declined   ${s.stem}`);
      }
    }
  }
}

if (REVIEW) {
  // Weakest first, then by sub-chapter, so a reader starts with the labels
  // most likely to be wrong and related ones sit together.
  reviewRows.sort((a, b) => a.bp - b.bp || (a.code < b.code ? -1 : 1));
  const tsv = [
    ['confidence_bp', 'question_id', 'subchapter', 'title', 'matched_terms', 'stem'].join('\t'),
    ...reviewRows.map(r =>
      [r.bp, r.id, r.code, r.title, r.terms, r.stem].join('\t')
    ),
  ].join('\n');
  await writeFile(REVIEW_FILE, tsv + '\n', 'utf8');
  console.log(`\nwrote ${reviewRows.length} labels, weakest first -> ${REVIEW_FILE}`);
  console.log('Spot-check the top of that file: coverage is measured above, precision is not.');
} else {
  console.log('\n(report only; pass --review to write a reviewable TSV of every label)');
}
