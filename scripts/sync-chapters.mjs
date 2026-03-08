/**
 * sync-chapters.mjs
 * Scans frontend/public/data/books/ for ch*.json files and regenerates
 * frontend/src/data/bookChapters.generated.ts automatically.
 *
 * Chapter names, descriptions, icons and colors are defined in CHAPTER_META below.
 * The script only reads the JSON files to get the question count — so the count
 * stays accurate as you add/remove questions daily.
 *
 * To add a new chapter:
 *   1. Drop chN.json into frontend/public/data/books/
 *   2. Add an entry for it in CHAPTER_META below
 *   3. Run npm run dev or npm run build
 *
 * Run via:  node scripts/sync-chapters.mjs
 * Wired into:  npm run dev  and  npm run build  in frontend/package.json
 */

import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, '..');
const BOOKS_DIR  = join(ROOT, 'frontend', 'public', 'data', 'books');
const GEN_TS     = join(ROOT, 'frontend', 'src', 'data', 'bookChapters.generated.ts');

// ─── Chapter metadata ────────────────────────────────────────────────────────
// Authoritative source of truth for chapter names, descriptions, icons & colors.
// questionCount is filled automatically from the JSON files.
const CHAPTER_META = {
  1:  { name: 'Basic Electrical & Electronics',                        shortName: 'Basic Electrical & Electronics',                        description: "Ohm's Law, circuit analysis, AC/DC circuits and electronic components",        icon: 'chip',       color: '#f59e0b' },
  2:  { name: 'Digital Logic & Number Systems',                        shortName: 'Digital Logic & Number Systems',                        description: 'Number systems, Boolean algebra, logic gates and digital electronics',         icon: 'chip',       color: '#6366f1' },
  3:  { name: 'C / C++ Programming',                                   shortName: 'C / C++ Programming',                                   description: 'C and C++ fundamentals, pointers, data types and OOP concepts',                icon: 'code',       color: '#22c55e' },
  4:  { name: 'Operating Systems & DBMS',                              shortName: 'Operating Systems & DBMS',                              description: 'OS process management, memory, databases and algorithms',                      icon: 'database',   color: '#ec4899' },
  5:  { name: 'Computer Networks & Security',                          shortName: 'Computer Networks & Security',                          description: 'Network protocols, OSI model and network security concepts',                   icon: 'brain',      color: '#06b6d4' },
  6:  { name: 'Theory of Computation and Computer Graphics',           shortName: 'Theory of Computation and Computer Graphics',           description: 'Finite automata, CFGs, Turing machines, 2D/3D transformations and graphics',   icon: 'network',    color: '#a855f7' },
  7:  { name: 'DSA, DBMS and OS',                                      shortName: 'DSA, DBMS and OS',                                      description: 'Data structures, algorithms, database systems and operating systems',          icon: 'monitor',    color: '#f97316' },
  8:  { name: 'Software Engineering and Object-Oriented Analysis & Design', shortName: 'Software Engineering and Object-Oriented Analysis & Design', description: 'Software processes, testing, UML, design patterns and OOAD',        icon: 'calculator', color: '#10b981' },
  9:  { name: 'AI & Machine Learning',                                 shortName: 'AI & Machine Learning',                                 description: 'Artificial intelligence, neural networks and machine learning concepts',       icon: 'book',       color: '#3b82f6' },
  10: { name: 'Project Planning, Design and Implementation',           shortName: 'Project Planning, Design and Implementation',           description: 'Engineering drawings, economics, project management and professional practice', icon: 'settings',   color: '#8b5cf6' },
};

// Default fallback for any new chapter not yet in CHAPTER_META
const DEFAULT_ICON  = 'book';
const DEFAULT_COLOR = '#6366f1';

async function main() {
  await mkdir(BOOKS_DIR, { recursive: true });

  if (!existsSync(BOOKS_DIR)) {
    console.log('[sync-chapters] frontend/public/data/books/ not found — skipping.');
    return;
  }

  const files = (await readdir(BOOKS_DIR))
    .filter(f => /^ch\d+\.json$/i.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));

  if (files.length === 0) {
    console.log('[sync-chapters] No ch*.json files found in frontend/public/data/books/.');
    return;
  }

  const entries = [];
  for (const file of files) {
    const num      = parseInt(file.match(/\d+/)[0], 10);
    const raw_text = await readFile(join(BOOKS_DIR, file), 'utf8');
    if (!raw_text.trim()) {
      console.log(`[sync-chapters] ch${num}: empty file — skipped`);
      continue;
    }
    let raw;
    try {
      raw = JSON.parse(raw_text);
    } catch (e) {
      console.log(`[sync-chapters] ch${num}: invalid JSON — skipped (${e.message})`);
      continue;
    }
    const count = Array.isArray(raw) ? raw.length : 0;
    const meta  = CHAPTER_META[num];

    entries.push({
      id:            `book-ch${num}`,
      name:          `Chapter ${num}: ${meta ? meta.name : 'Chapter ' + num}`,
      shortName:     `Ch${num} - ${meta ? meta.shortName : 'Chapter ' + num}`,
      description:   meta ? meta.description : `Questions from chapter ${num} of the engineering exam textbook`,
      questionCount: count,
      icon:          meta ? meta.icon : DEFAULT_ICON,
      color:         meta ? meta.color : DEFAULT_COLOR,
      dataFile:      `books/ch${num}.json`,
    });
    console.log(`[sync-chapters] ch${num}: ${count} questions`);
  }

  // Escape single quotes so generated TS strings don't break
  const esc = (s) => s.replace(/'/g, "\\'");

  const tsLines = [
    '// AUTO-GENERATED by scripts/sync-chapters.mjs — DO NOT EDIT MANUALLY.',
    '// To change chapter names/descriptions, edit CHAPTER_META in scripts/sync-chapters.mjs.',
    "import type { Topic } from './topics';",
    '',
    'export const bookChapters: Topic[] = [',
    ...entries.map(e =>
      `  { id: '${esc(e.id)}', name: '${esc(e.name)}', shortName: '${esc(e.shortName)}', ` +
      `description: '${esc(e.description)}', questionCount: ${e.questionCount}, ` +
      `icon: '${esc(e.icon)}' as Topic['icon'], color: '${e.color}', dataFile: '${e.dataFile}' },`
    ),
    '];',
    '',
  ];

  await writeFile(GEN_TS, tsLines.join('\n'), 'utf8');
  console.log(`[sync-chapters] ✓ Generated ${files.length} chapter(s) → bookChapters.generated.ts`);
}

main().catch(e => { console.error(e); process.exit(1); });
