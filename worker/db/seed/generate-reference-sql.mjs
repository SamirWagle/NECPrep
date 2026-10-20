#!/usr/bin/env node
// Extracts SYLLABUS from BookPractice.tsx and bookChapters from the generated
// manifest, and emits 0007_reference_data.sql.
import { readFileSync, writeFileSync } from 'node:fs';

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// worker/db/seed/ -> repo root
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = readFileSync(`${ROOT}/frontend/src/pages/app/BookPractice.tsx`, 'utf8');
const start = src.indexOf('const SYLLABUS = [');
const end = src.indexOf('\n];', start) + 3;
const literal = src.slice(start + 'const SYLLABUS = '.length, end).replace(/;\s*$/, '');
const SYLLABUS = eval(literal);

const gen = readFileSync(`${ROOT}/frontend/src/data/bookChapters.generated.ts`, 'utf8');
const chStart = gen.indexOf('[', gen.indexOf('export const bookChapters'));
const chEnd = gen.indexOf('\n];', chStart) + 2;
const chLiteral = gen.slice(chStart, chEnd).replace(/ as Topic\['icon'\]/g, '');
const chapters = eval(chLiteral);

if (SYLLABUS.length !== 10) throw new Error(`expected 10 syllabus chapters, got ${SYLLABUS.length}`);
if (chapters.length !== 10) throw new Error(`expected 10 generated chapters, got ${chapters.length}`);
const subCount = SYLLABUS.reduce((s, c) => s + c.topics.length, 0);
if (subCount !== 60) throw new Error(`expected 60 subchapters, got ${subCount}`);

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const out = [];
out.push(`-- 0007_reference_data.sql
--
-- GENERATED, then reviewed and committed. The source of truth for the official
-- NEC syllabus in this repo was, until now, a 10-element array literal inside
-- a React component (frontend/src/pages/app/BookPractice.tsx) plus a second
-- array generated from the question files
-- (frontend/src/data/bookChapters.generated.ts). This migration lifts both
-- into the database once, so there is one copy of the syllabus and the client
-- reads it instead of shipping it.
--
-- It is a migration rather than a seed script because it is reference data:
-- ten chapters and sixty syllabus codes published by a regulator. It changes
-- when NEC changes the syllabus, which is a versioned event and exactly what a
-- migration is for. The 2,290 questions are NOT here -- they are bulk data and
-- they load through worker/db/seed/import-questions.mjs.
--
-- Reproduce with: node worker/db/seed/generate-reference-sql.mjs
-- which re-extracts from the two frontend files and overwrites this file.
-- Verified at generation time: 10 chapters, 60 subchapters.

INSERT INTO subjects (id, code, name, description, exam_board, ordinal, status) VALUES
  ('nec-computer', 'NEC-CE',
   'NEC Registration Exam -- Computer Engineering',
   'Nepal Engineering Council registration examination syllabus for Computer Engineering (AExE / ACtE / AALL paper codes).',
   'Nepal Engineering Council', 1, 'published');
`);

out.push(`
-- Chapters. \`id\` keeps the existing frontend identifier so client routes and
-- stored progress keys survive the cutover. \`title\` is the official NEC
-- syllabus title, \`display_name\` the shorter string the practice cards show.
INSERT INTO chapters (id, subject_id, nec_code, ordinal, slug, title, display_name,
                      short_name, description, color, icon, legacy_data_file, status) VALUES`);

const chapterRows = SYLLABUS.map((s, i) => {
  const g = chapters[i];
  const num = s.num;
  if (num !== i + 1) throw new Error(`syllabus out of order at ${i}`);
  if (g.id !== `book-ch${num}`) throw new Error(`chapter id mismatch: ${g.id} vs book-ch${num}`);
  return `  (${q(g.id)}, 'nec-computer', ${q(s.code)}, ${num}, ${q(slugify(s.title))},
   ${q(s.title)},
   ${q(g.name)},
   ${q(g.shortName)},
   ${q(g.description)},
   ${q(g.color)}, ${q(g.icon)}, ${q(g.dataFile)}, 'published')`;
});
out.push(chapterRows.join(',\n') + ';\n');

out.push(`
-- The 60 official syllabus codes, 1.1 .. 10.6. \`description\` is the NEC
-- syllabus paragraph verbatim: it is the authoritative statement of what is
-- examinable, and paraphrasing it would be a silent change to the spec.
INSERT INTO subchapters (id, chapter_id, code, ordinal, title, description, status) VALUES`);

const subRows = [];
for (const s of SYLLABUS) {
  if (s.topics.length !== 6) throw new Error(`chapter ${s.num} has ${s.topics.length} topics`);
  s.topics.forEach((t, j) => {
    const expected = `${s.num}.${j + 1}`;
    if (t.code !== expected) throw new Error(`subchapter code mismatch: ${t.code} vs ${expected}`);
    subRows.push(`  (${q('nec-' + t.code)}, ${q('book-ch' + s.num)}, ${q(t.code)}, ${j + 1},
   ${q(t.title)},
   ${q(t.desc)}, 'published')`);
  });
}
out.push(subRows.join(',\n') + ';\n');

// Mock templates, from frontend/src/data/topics.ts, reshaped to the
// sub-chapter-level blueprint of frontend/src/data/examBlueprint.ts.
const templates = [
  { id: 'full-mock-1', slug: 'full-mock-1', name: 'Full Mock Test 1',
    description: '100 questions across all 60 NEC syllabus codes -- a fresh set each time',
    perChapter: 10, duration: 45, ordinal: 1 },
  { id: 'full-mock-2', slug: 'full-mock-2', name: 'Full Mock Test 2',
    description: '100 questions across all 60 NEC syllabus codes -- different selection to Mock 1',
    perChapter: 10, duration: 45, ordinal: 2 },
  { id: 'quick-test', slug: 'quick-test', name: 'Quick Assessment',
    description: '50 questions, five per chapter, for a fast readiness check',
    perChapter: 5, duration: 20, ordinal: 3 },
];

/**
 * largest-remainder (Hare quota) on EQUAL shares, with the tie broken by
 * ascending sub-chapter index.
 *
 * This is `equal-chapter-weight-largest-remainder` from
 * frontend/src/data/examBlueprint.ts, implemented here rather than imported
 * because this script runs under plain node with no TypeScript loader. The
 * assertion below is what keeps the two honest: the quotas it produces for
 * `perChapter = 10` must be [2,2,2,2,1,1], which is exactly what that file's
 * `quotaForIndex` publishes.
 *
 * perChapter = 10 over 6 codes: floor = 1 each (6 seats), 4 spare -> 1..4 get 2.
 * perChapter =  5 over 6 codes: floor = 0 each (0 seats), 5 spare -> 1..5 get 1.
 */
function largestRemainder(total, buckets) {
  const base = Math.floor(total / buckets);
  const spare = total - base * buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < spare ? 1 : 0));
}

const TEN_OVER_SIX = largestRemainder(10, 6);
if (JSON.stringify(TEN_OVER_SIX) !== JSON.stringify([2, 2, 2, 2, 1, 1])) {
  throw new Error(
    `largest-remainder drift: 10 over 6 gave ${JSON.stringify(TEN_OVER_SIX)}, ` +
      'but frontend/src/data/examBlueprint.ts publishes [2,2,2,2,1,1]'
  );
}

out.push(`
-- The three mock templates the client currently hardcodes in
-- frontend/src/data/topics.ts, expressed as SUB-CHAPTER-LEVEL blueprints.
--
-- Note what the move buys twice over. 'questionsPerChapter: 10' was a number in
-- a TypeScript literal that the selection code had to interpret; a blueprint is
-- data the selection code reads, so a differently weighted mock is a row and
-- not a deploy. And the rules are now per syllabus code rather than per
-- chapter, which is the granularity the official NEC syllabus is written in and
-- the granularity frontend/src/data/examBlueprint.ts already models -- so the
-- client's exam plan and the server's draw describe the same paper.
--
-- Quotas come from \`equal-chapter-weight-largest-remainder\`: ten questions per
-- chapter split 2/2/2/2/1/1 over its six codes for a full mock, and five split
-- 1/1/1/1/1/0 for the quick assessment. 60 rules each.
INSERT INTO mock_test_templates (id, subject_id, slug, name, description,
                                 duration_minutes, total_questions, blueprint,
                                 selection, status, ordinal) VALUES`);

const tplRows = templates.map((t) => {
  const quotas = largestRemainder(t.perChapter, 6);
  const rules = [];
  for (const s of SYLLABUS) {
    s.topics.forEach((topic, j) => {
      rules.push({
        chapter_id: `book-ch${s.num}`,
        subchapter_code: topic.code,
        count: quotas[j],
        difficulty: null,
        tag_ids: null,
      });
    });
  }
  const total = rules.reduce((sum, r) => sum + r.count, 0);
  if (total !== t.perChapter * 10) {
    throw new Error(`blueprint for ${t.id} sums to ${total}, expected ${t.perChapter * 10}`);
  }
  const blueprint = {
    version: 2,
    weighting_rule: 'equal-chapter-weight-largest-remainder',
    shuffle_options: true,
    negative_marking: 0,
    pass_mark_bp: 5000,
    // Must stay false while questions.subchapter_id is NULL for every imported
    // question; a strict run would fail all 60 rules. See 0004_assessment.sql.
    strict_subchapter: false,
    rules,
  };
  return `  (${q(t.id)}, 'nec-computer', ${q(t.slug)}, ${q(t.name)},
   ${q(t.description)},
   ${t.duration}, ${total},
   ${q(JSON.stringify(blueprint))},
   'random', 'published', ${t.ordinal})`;
});
out.push(tplRows.join(',\n') + ';\n');

writeFileSync(`${ROOT}/worker/migrations/0007_reference_data.sql`, out.join('\n'));
console.log(`wrote 0007_reference_data.sql: 1 subject, ${chapterRows.length} chapters, ${subRows.length} subchapters, ${tplRows.length} templates`);
