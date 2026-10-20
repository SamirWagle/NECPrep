#!/usr/bin/env node
/**
 * import-questions.mjs -- load the ten chapter JSONs from
 * frontend/public/data/books/ into questions + question_options +
 * question_answer_keys.
 *
 * ===========================================================================
 * INDEX CONVENTION -- STATED EXPLICITLY, BECAUSE THIS IS WHERE OFF-BY-ONE
 * BUGS COME FROM
 * ===========================================================================
 *
 * The source rows are spreadsheet-shaped and 1-based:
 *
 *     { qsns, opt1, opt2, opt3, opt4, correct_option, correct_option_index }
 *
 * with `correct_option_index` in 1..4 meaning opt1..opt4.
 *
 * THIS SCHEMA IS 1-BASED THROUGHOUT. `question_options.ordinal` is literally
 * the N in `optN`, so the mapping is the identity:
 *
 *     correct_option_index = 3  ->  ordinal 3
 *
 * No arithmetic, nothing to get backwards. The alternative -- 0-based ordinals
 * -- is what the current client does (`correct_option_index - 1` in
 * frontend/src/services/localData.ts) and it means every read and every write
 * has to remember which side of the boundary it is on. Two of the 2,312 source
 * rows have `correct_option_index = 5` against four options, which is the
 * INDEX_RANGE defect below; under a 0-based convention that is index 4, which
 * looks like a plausible fifth option rather than like an error.
 *
 * THE ORDINAL DOES NOT APPEAR IN THE OPTION ID. `question_options.id` is
 * `question_id || '#' || opt_key` with a 12-character CSPRNG `opt_key`, because
 * the earlier `|| ordinal` scheme made an option id joinable against the
 * `correct_option_index` this very file reads out of the published JSON -- see
 * the block above `question_options` in migrations/0002_content.sql. So the
 * importer MINTS a key per option row and the answer key is resolved from the
 * (question_id, ordinal) upsert's RETURNING id, never by string-building an id
 * from the authored index.
 *
 * That is also why the option upsert conflicts on (question_id, ordinal) and
 * not on (id): a re-run must find the EXISTING row by its authored slot and
 * keep its `opt_key`. Conflicting on a freshly minted id would insert a second
 * row per option on every run and orphan every answer already recorded.
 *
 * Everything downstream follows the same convention:
 *   attempt_answers.delivered_position 1-based
 *   attempt_questions.position         1-based
 *   subchapters.ordinal, chapters.ordinal  1-based
 *
 * ===========================================================================
 * IDENTITY
 * ===========================================================================
 *
 * See the header of migrations/0002_content.sql for the full argument. The
 * computation is implemented in `contentHash()` below and must stay in sync
 * with that comment:
 *
 *   sha256('necprep-question-v1' RS chapter_code RS norm(stem) RS
 *          sorted(norm(opt))... joined by US)
 *   id = 'q_' + first 16 hex chars
 *
 * Idempotent: re-running upserts. Re-running after an upstream edit to a stem
 * creates a new question rather than mutating one, which is correct -- a
 * different stem is a different question.
 *
 * ===========================================================================
 * DEFECTS
 * ===========================================================================
 *
 * The importer re-derives defects from the data rather than trusting
 * frontend/src/data/quarantine.json, whose ids are positional
 * (`{topicId}_{arrayIndex}`) and have already gone stale: a de-duplication
 * pass shrank the bank from 2,801 rows to 2,312 and 20 of the 23 quarantine
 * entries now name a different, healthy question. Positional ids are the
 * reason this schema exists; the importer is not going to depend on them.
 *
 * Rules, matching scripts/validate-questions.mjs:
 *   OPTION_DUPLICATE  two options with identical normalised text
 *   INDEX_RANGE       correct_option_index outside 1..option_count
 *   KEY_CONFLICT      `correct_option` text is not any of the options
 *   OPTION_COUNT      fewer than two usable options
 *   EMPTY_STEM        blank question text
 *
 * A defective question is imported with status='flagged' and a
 * `question_reports` row carrying the evidence (source='validator'), so it is
 * excluded from selection without being deleted and an adjudicator has what
 * they need to fix it.
 *
 * quarantine.json is still read, but only to file a report: any entry whose
 * legacy id resolves to a question the rules consider healthy becomes an open
 * `question_reports` row (source='import') for a human to look at. The
 * importer does NOT flag it -- hiding a good question on the strength of a
 * stale array index is the bug, not the fix.
 *
 * Usage:
 *   node db/seed/import-questions.mjs [--db <path>] [--dry-run] [--json]
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomFillSync } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_ROOT = resolve(HERE, '..', '..');
const REPO_ROOT = resolve(WORKER_ROOT, '..');
const BOOKS_DIR = join(REPO_ROOT, 'frontend', 'public', 'data', 'books');
const QUARANTINE_FILE = join(REPO_ROOT, 'frontend', 'src', 'data', 'quarantine.json');

const HASH_NAMESPACE = 'necprep-question-v1';
const RS = '\u001E'; // record separator -- cannot occur in the source JSON
const US = '\u001F'; // unit separator

/**
 * Options whose meaning depends on being last. 'All of the above' shuffled
 * into slot 2 makes the question nonsense, so the permuter must pin these.
 * Pattern mirrors POSITIONAL_OPTION_RE in frontend/src/services/localData.ts.
 */
const PINNED_OPTION_RE = /^\s*(all|none|both)\s+(of\s+)?(the\s+)?(above|these|mentioned)/i;

/** NFKC, collapse whitespace, trim, lowercase. The only normaliser. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Normalised stem used ONLY to group rows for duplicate detection.
 *
 * Deliberately separate from `norm()`, and deliberately more aggressive: it
 * also strips punctuation, so `What is the purpose of the "this" pointer` and
 * `What is the purpose of the this pointer` group together. `norm()` cannot be
 * changed to do this because `contentHash()` depends on it and every question
 * id would be re-minted.
 *
 * This matches the normalisation the frontend uses in quarantine generation
 * and in scripts/validate-questions.mjs. When the two disagreed, a pair of
 * stems differing only in quote marks was withheld by the app and published by
 * this importer.
 */
export function stemKey(stem) {
  return norm(stem).replace(/[^\w\s?]/g, '').replace(/\s+/g, ' ').trim();
}

export function contentHash(chapterCode, stem, optionTexts) {
  const payload = [
    HASH_NAMESPACE,
    chapterCode,
    norm(stem),
    optionTexts.map(norm).sort().join(US),
  ].join(RS);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function questionIdFor(contentHashHex) {
  return 'q_' + contentHashHex.slice(0, 16);
}

/** Crockford-style base32, matching worker/src/lib/ids.ts. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A fresh 12-character (60-bit) CSPRNG option key.
 *
 * DELIBERATELY NOT DERIVED from the question id or the ordinal. A derived key
 * -- even a hashed one -- would be brute-forceable back to the ordinal in 26
 * tries per option, which is exactly the leak the random key exists to close.
 * 256 is a multiple of 32, so masking the low 5 bits of each byte is uniform
 * and needs no rejection loop.
 */
export function newOptionKey() {
  const bytes = randomFillSync(new Uint8Array(12));
  let out = '';
  for (let i = 0; i < 12; i++) out += B32[bytes[i] & 31];
  return out;
}

/** Returns the validator codes a source row trips, newest-first in severity. */
export function defectsFor(row, optionTexts) {
  const codes = [];
  if (norm(row.qsns).length === 0) codes.push('EMPTY_STEM');
  if (optionTexts.length < 2) codes.push('OPTION_COUNT');
  if (new Set(optionTexts.map(norm)).size !== optionTexts.length) codes.push('OPTION_DUPLICATE');
  const ci = row.correct_option_index;
  if (!Number.isInteger(ci) || ci < 1 || ci > optionTexts.length) codes.push('INDEX_RANGE');
  const authored = row.correct_option;
  if (authored && !optionTexts.map(norm).includes(norm(authored))) codes.push('KEY_CONFLICT');
  return codes;
}

const DEFECT_DETAIL = {
  EMPTY_STEM: 'question text is blank',
  OPTION_COUNT: 'fewer than two usable options',
  OPTION_DUPLICATE: 'two options carry identical text, so two options can be simultaneously correct',
  INDEX_RANGE: 'correct_option_index is outside 1..option_count, so there is no reachable correct answer',
  KEY_CONFLICT: 'correct_option text is not among the options, so the index and the text disagree',
  DUPLICATE_ANSWER_CONFLICT:
    'another question shares this stem but its answer key names different text, so at least ' +
    'one of the copies is mis-keyed and the data cannot say which',
  OPTION_MULTIPLE_TRUE:
    'more than one option is a true answer to the stem, so a single-answer question cannot ' +
    'be graded fairly. Human adjudication from quarantine.json; no rule here can derive it, ' +
    'because deciding it requires subject knowledge',
};

/** OPTION_DUPLICATE and KEY_CONFLICT are wrong-answer claims; the rest are not. */
const DEFECT_CATEGORY = {
  EMPTY_STEM: 'other',
  OPTION_COUNT: 'bad_option',
  OPTION_DUPLICATE: 'bad_option',
  INDEX_RANGE: 'wrong_answer',
  KEY_CONFLICT: 'wrong_answer',
  DUPLICATE_ANSWER_CONFLICT: 'duplicate',
  OPTION_MULTIPLE_TRUE: 'bad_option',
};

// Monotonic, sortable, opaque. Not a real ULID (no crypto randomness budget
// needed here) but the same 26-char Crockford shape, so it is interchangeable
// with whatever the API mints.
let ulidCounter = 0;
function ulidish(seedTime = Date.now()) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let t = seedTime;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = alphabet[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let n = ++ulidCounter;
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand = alphabet[n % 32] + rand;
    n = Math.floor(n / 32);
  }
  return time + rand;
}

export function loadSourceRows() {
  if (!existsSync(BOOKS_DIR)) throw new Error(`question bank not found at ${BOOKS_DIR}`);
  const chapters = [];
  for (let n = 1; n <= 10; n++) {
    const file = `ch${n}.json`;
    const path = join(BOOKS_DIR, file);
    if (!existsSync(path)) throw new Error(`missing chapter file ${path}`);
    const rows = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(rows)) throw new Error(`${file} is not a JSON array`);
    chapters.push({ chapterId: `book-ch${n}`, file: `books/${file}`, rows });
  }
  return chapters;
}

/**
 * Cross-row defects, which no single row and therefore no CHECK constraint can
 * see.
 *
 * DUPLICATE_ANSWER_CONFLICT: two or more source rows share a question stem but
 * their answer keys name different text. One of them is wrong and there is no
 * way to tell which from the data, so every copy is withheld until a human
 * picks. 128 such rows are listed in frontend/src/data/quarantine.json.
 *
 * This is derived here, from the stems, rather than read from that file,
 * because the file keys on positional `{topicId}_{arrayIndex}` ids. Deriving
 * it means the rule survives any reordering of the bank -- which is the whole
 * argument of migrations/0002_content.sql, applied to the one defect class
 * that genuinely needs a second pass over the data.
 *
 * Grouping is by normalised stem only, NOT by content hash: the hash includes
 * the option set, so two copies that disagree about both the options and the
 * answer -- the common case here -- hash differently and must still be caught.
 *
 * Returns Map<questionId, string[]>.
 */
/**
 * Quarantine codes that are human adjudications, not rule outputs.
 *
 * Nothing in this importer can derive them - OPTION_MULTIPLE_TRUE, for
 * instance, requires knowing that two option strings are both true statements
 * about C++ - so a question carrying one must be withheld on the strength of
 * the human decision alone. The importer is otherwise right to distrust
 * quarantine.json's positional ids, but `validate-questions.mjs --check-ids`
 * gates every id for range on each run, so a code that cannot be re-derived is
 * evidence rather than noise. Publishing a question a human marked unanswerable
 * is the worse error.
 */
export const HUMAN_ADJUDICATED_CODES = new Set(['OPTION_MULTIPLE_TRUE']);

/**
 * legacy id -> codes, for quarantine entries this importer cannot re-derive.
 */
export function planHumanQuarantine(quarantineFile) {
  const byLegacy = new Map();
  if (!existsSync(quarantineFile)) return byLegacy;
  for (const entry of JSON.parse(readFileSync(quarantineFile, 'utf8'))) {
    const human = (entry.codes ?? []).filter((c) => HUMAN_ADJUDICATED_CODES.has(c));
    if (human.length > 0) byLegacy.set(entry.id, human);
  }
  return byLegacy;
}

export function planCrossRowDefects(chapters, necCodeByChapter) {
  // normalised stem -> { questionIds:Set, answerTexts:Set }
  const byStem = new Map();

  for (const { chapterId, rows } of chapters) {
    const necCode = necCodeByChapter.get(chapterId);
    for (const row of rows) {
      const optionTexts = usableOptions(row);
      const qid = questionIdFor(contentHash(necCode, row.qsns, optionTexts));
      const key = stemKey(row.qsns);
      if (key.length === 0) continue;
      if (!byStem.has(key)) byStem.set(key, { questionIds: new Set(), answerTexts: new Set() });
      const group = byStem.get(key);
      group.questionIds.add(qid);
      const ci = row.correct_option_index;
      if (Number.isInteger(ci) && ci >= 1 && ci <= optionTexts.length) {
        group.answerTexts.add(norm(optionTexts[ci - 1]));
      }
    }
  }

  const codes = new Map();
  for (const { questionIds, answerTexts } of byStem.values()) {
    // Disagreement is judged on the ANSWER, not on how many question ids the
    // group produced. There used to be an additional `questionIds.size < 2`
    // guard here, and it was the wrong test: contentHash() covers the stem and
    // the sorted option texts but deliberately NOT the answer key, so two rows
    // that differ only in correct_option_index hash to the same id. Those rows
    // collapsed to one question whose id appeared exactly once, the guard
    // skipped the group, and the question was published carrying whichever
    // answer happened to be read first - silently resolving a contradiction by
    // array order. One id with two authored answers is a stronger signal than
    // two ids with two answers, not a weaker one.
    if (answerTexts.size < 2) continue;      // same stem, same answer -- benign duplicate
    for (const qid of questionIds) {
      if (!codes.has(qid)) codes.set(qid, []);
      codes.get(qid).push('DUPLICATE_ANSWER_CONFLICT');
    }
  }
  return codes;
}

/** The option strings a row actually offers, in optN order, blanks dropped. */
export function usableOptions(row) {
  return [row.opt1, row.opt2, row.opt3, row.opt4]
    .map((t) => (t === null || t === undefined ? '' : String(t)))
    .filter((t) => t.trim().length > 0);
}

export function importQuestions(db, { dryRun = false } = {}) {
  const chapters = loadSourceRows();

  // chapter_id -> nec_code. The NEC code goes into the hash, not the
  // 'book-chN' id: the frontend id is an implementation detail that could be
  // renamed, and renaming it must not change a single question's identity.
  const necCodeByChapter = new Map(
    db.prepare('SELECT id, nec_code FROM chapters').all().map((r) => [r.id, r.nec_code])
  );
  const subjectByChapter = new Map(
    db.prepare('SELECT id, subject_id FROM chapters').all().map((r) => [r.id, r.subject_id])
  );
  if (necCodeByChapter.size !== 10) {
    throw new Error(
      `expected 10 chapters from migration 0007, found ${necCodeByChapter.size}. ` +
        'Run db/apply.mjs (or `wrangler d1 migrations apply`) first.'
    );
  }

  // Two passes. The first sees the whole bank, which is what a cross-row
  // defect needs; the second writes.
  const crossRowCodes = planCrossRowDefects(chapters, necCodeByChapter);
  const humanQuarantine = planHumanQuarantine(QUARANTINE_FILE);

  const insertQuestion = db.prepare(`
    INSERT INTO questions (
      id, content_hash, subject_id, chapter_id, subchapter_id, stem, stem_format,
      status, status_reason, status_changed_at, has_pinned_options,
      source, source_ref, legacy_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, 'plain', ?, ?, ?, ?, 'book-import', ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      stem               = excluded.stem,
      status             = excluded.status,
      status_reason      = excluded.status_reason,
      has_pinned_options = excluded.has_pinned_options,
      source_ref         = excluded.source_ref,
      legacy_id          = excluded.legacy_id,
      updated_at         = excluded.updated_at
  `);

  // Conflict target is the AUTHORED SLOT, not the id. A re-run must find the
  // existing row for (question, ordinal) and keep its `opt_key` -- the id it
  // would otherwise mint is fresh every time, so conflicting on `id` would add
  // a second row per option per run and orphan every recorded answer.
  // RETURNING hands back whichever id won, which is what the answer key below
  // references; nothing string-builds an option id from the authored index.
  const insertOption = db.prepare(`
    INSERT INTO question_options (id, question_id, ordinal, opt_key, text, text_format,
                                  is_pinned, retired_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'plain', ?, ?, ?, ?)
    ON CONFLICT (question_id, ordinal) DO UPDATE SET
      text       = excluded.text,
      is_pinned  = excluded.is_pinned,
      retired_at = excluded.retired_at,
      updated_at = excluded.updated_at
    RETURNING id
  `);

  const insertKey = db.prepare(`
    INSERT INTO question_answer_keys (question_id, correct_option_id, source,
                                      authored_index, authored_text,
                                      created_at, updated_at)
    VALUES (?, ?, 'import', ?, ?, ?, ?)
    ON CONFLICT (question_id) DO UPDATE SET
      correct_option_id = excluded.correct_option_id,
      authored_index    = excluded.authored_index,
      authored_text     = excluded.authored_text,
      updated_at        = excluded.updated_at
  `);

  const insertReport = db.prepare(`
    INSERT INTO question_reports (public_id, question_id, reporter_user_id, source,
                                  category, code, detail, status, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, 'open', ?, ?)
  `);
  const reportExists = db.prepare(`
    SELECT 1 FROM question_reports
     WHERE question_id = ? AND source = ? AND COALESCE(code, '') = COALESCE(?, '')
       AND status = 'open'
  `);

  // Epoch MILLISECONDS. Every timestamp column in this schema is ms; see the
  // convention block at the top of migrations/0001_identity.sql.
  const now = Date.now();
  const stats = {
    sourceRows: 0,
    questionsInserted: 0,
    collapsedDuplicates: 0,
    crossChapterDuplicateGroups: 0,
    optionsInserted: 0,
    optionsRetiredAsDuplicate: 0,
    answerKeysInserted: 0,
    flagged: 0,
    publishedWithoutKey: 0,
    reportsFiled: 0,
    byCode: {},
    byChapter: {},
    pinnedOptions: 0,
    questionsWithPinnedOptions: 0,
    correctOrdinalHistogram: {},
  };

  // Seen within this run, to collapse exact duplicates and report them rather
  // than letting the upsert silently absorb them.
  const seen = new Map(); // questionId -> source_ref of the first occurrence
  const hashWithoutChapter = new Map();

  db.exec('BEGIN');
  try {
    for (const { chapterId, file, rows } of chapters) {
      const necCode = necCodeByChapter.get(chapterId);
      const subjectId = subjectByChapter.get(chapterId);
      const chapterStats = { rows: rows.length, questions: 0, flagged: 0, collapsed: 0 };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        stats.sourceRows++;
        const optionTexts = usableOptions(row);

        const legacyId = `${chapterId}_${i}`;
        const sourceRef = `${file}#${i}`;
        const hash = contentHash(necCode, row.qsns, optionTexts);
        const qid = questionIdFor(hash);

        // Cross-chapter duplicate telemetry: same text, different chapter.
        const plainHash = contentHash('', row.qsns, optionTexts);
        if (!hashWithoutChapter.has(plainHash)) hashWithoutChapter.set(plainHash, new Set());
        hashWithoutChapter.get(plainHash).add(chapterId);

        if (seen.has(qid)) {
          stats.collapsedDuplicates++;
          chapterStats.collapsed++;
          // Same stem and same option set, so the same question identity. The
          // answer key may still differ between the two rows; when it does,
          // planCrossRowDefects has already marked this qid
          // DUPLICATE_ANSWER_CONFLICT and the kept row is flagged rather than
          // published, so dropping this row cannot resolve a contradiction by
          // arrival order.
          continue;
        }
        seen.set(qid, sourceRef);

        const codes = [
          ...defectsFor(row, optionTexts),
          ...(crossRowCodes.get(qid) ?? []),
          ...(humanQuarantine.get(legacyId) ?? []),
        ];
        const status = codes.length > 0 ? 'flagged' : 'published';
        const statusReason = codes.length > 0 ? codes[0] : null;

        const pinned = optionTexts.map((t) => (PINNED_OPTION_RE.test(t) ? 1 : 0));
        const hasPinned = pinned.some((p) => p === 1) ? 1 : 0;

        if (!dryRun) {
          insertQuestion.run(
            qid, hash, subjectId, chapterId, String(row.qsns),
            status, statusReason, now, hasPinned, sourceRef, legacyId, now, now
          );
        }
        stats.questionsInserted++;
        chapterStats.questions++;
        if (hasPinned) stats.questionsWithPinnedOptions++;

        // ordinal === the N in optN. 1-based. See the header.
        //
        // The second and later copies of an identical option text are imported
        // RETIRED. `uq_question_options_question_text` is partial on
        // `retired_at IS NULL`, so this is what lets a defective question in at
        // all -- and it is the right shape rather than a workaround: the
        // duplicate option genuinely should not be offered to anyone, the row
        // is preserved for the editor who has to fix it, and the ordinal stays
        // claimed forever so no future option can inherit a historical answer.
        // The question itself is flagged, so nothing is delivered either way.
        const seenText = new Set();
        // ordinal -> the option id the database actually holds. Populated from
        // the upsert's RETURNING, so a re-import reuses the stored `opt_key`.
        const optionIdByOrdinal = new Map();
        optionTexts.forEach((text, k) => {
          const ordinal = k + 1;
          const optKey = newOptionKey();
          const key = norm(text);
          const retiredAt = seenText.has(key) ? now : null;
          seenText.add(key);
          if (!dryRun) {
            const returned = insertOption.get(
              `${qid}#${optKey}`, qid, ordinal, optKey, text, pinned[k], retiredAt, now, now
            );
            optionIdByOrdinal.set(ordinal, returned.id);
          } else {
            optionIdByOrdinal.set(ordinal, `${qid}#${optKey}`);
          }
          stats.optionsInserted++;
          if (retiredAt !== null) stats.optionsRetiredAsDuplicate++;
          stats.pinnedOptions += pinned[k];
        });

        // The answer key. Written only when the authored index actually names
        // an option that exists -- an INDEX_RANGE row gets no key at all,
        // which is honest: there is no correct answer to record. Such a
        // question is also flagged, so it can never reach a student.
        //
        // `correct_option_id` comes from the map above and NOT from the
        // authored index: the id no longer contains the index, and building one
        // by hand is how the leak this schema just closed would come back.
        // `authored_index` keeps the source JSON's number for audit, in the
        // server-only table where a `SELECT *` on `questions` cannot reach it.
        const ci = row.correct_option_index;
        const keyable = Number.isInteger(ci) && ci >= 1 && ci <= optionTexts.length;
        if (keyable) {
          const correctOptionId = optionIdByOrdinal.get(ci);
          if (correctOptionId === undefined) {
            throw new Error(`no option row for ${qid} ordinal ${ci} -- refusing to key it`);
          }
          if (!dryRun) {
            insertKey.run(
              qid, correctOptionId, ci,
              row.correct_option === undefined || row.correct_option === null
                ? null
                : String(row.correct_option),
              now, now
            );
          }
          stats.answerKeysInserted++;
          stats.correctOrdinalHistogram[ci] = (stats.correctOrdinalHistogram[ci] ?? 0) + 1;
        }

        if (codes.length > 0) {
          stats.flagged++;
          chapterStats.flagged++;
          for (const code of codes) {
            stats.byCode[code] = (stats.byCode[code] ?? 0) + 1;
            if (!dryRun && !reportExists.get(qid, 'validator', code)) {
              insertReport.run(
                ulidish(), qid, 'validator', DEFECT_CATEGORY[code], code,
                `${DEFECT_DETAIL[code]} (source ${sourceRef}, legacy id ${legacyId}, ` +
                  `correct_option_index=${JSON.stringify(ci)}, ` +
                  `correct_option=${JSON.stringify(row.correct_option ?? null)})`,
                now, now
              );
              stats.reportsFiled++;
            }
          }
        }
      }
      stats.byChapter[chapterId] = chapterStats;
    }

    stats.crossChapterDuplicateGroups = [...hashWithoutChapter.values()].filter(
      (set) => set.size > 1
    ).length;

    // ------------------------------------------------------------------
    // quarantine.json cross-check. Reported, never acted on -- see header.
    // ------------------------------------------------------------------
    const quarantineDrift = { entries: 0, resolved: 0, agreed: 0, stale: 0, unresolvable: 0 };
    if (existsSync(QUARANTINE_FILE)) {
      const entries = JSON.parse(readFileSync(QUARANTINE_FILE, 'utf8'));
      quarantineDrift.entries = entries.length;
      const byLegacy = db.prepare('SELECT id, status FROM questions WHERE legacy_id = ?');
      for (const entry of entries) {
        const hit = byLegacy.get(entry.id);
        if (!hit) {
          quarantineDrift.unresolvable++;
          continue;
        }
        quarantineDrift.resolved++;
        if (hit.status === 'flagged') {
          quarantineDrift.agreed++;
          continue;
        }
        quarantineDrift.stale++;
        if (!dryRun && !reportExists.get(hit.id, 'import', null)) {
          insertReport.run(
            ulidish(), hit.id, 'import', 'other', null,
            `quarantine.json lists legacy id ${entry.id} (${entry.codes.join(', ')}: ` +
              `${entry.notes.join(' / ')}) but this importer's rules find no defect in ` +
              'the question now at that array position. Two explanations, needing ' +
              'different fixes: either the legacy id has drifted (it is positional, and ' +
              'the bank has been re-ordered since the list was written) so the entry now ' +
              'names the wrong question, or the finding is a near-duplicate stem that ' +
              'the exact-normalised-stem rule here does not match. Needs human ' +
              'adjudication. The question has NOT been withheld on this evidence: ' +
              'hiding a question that passes every rule, on the strength of a stale ' +
              'array index, is the bug this schema exists to end.',
            now, now
          );
          stats.reportsFiled++;
        }
      }
    }
    stats.quarantineDrift = quarantineDrift;

    // ------------------------------------------------------------------
    // Invariant: nothing deliverable may lack an answer key. If this is ever
    // non-zero the grader would mark a real student wrong for a question it
    // cannot grade, so it aborts the import rather than reporting it.
    // ------------------------------------------------------------------
    stats.publishedWithoutKey = db
      .prepare(
        `SELECT COUNT(*) n FROM questions q
          WHERE q.status = 'published'
            AND NOT EXISTS (SELECT 1 FROM question_answer_keys k WHERE k.question_id = q.id)`
      )
      .get().n;
    if (stats.publishedWithoutKey > 0) {
      throw new Error(
        `${stats.publishedWithoutKey} published questions have no answer key -- refusing to commit`
      );
    }

    // One audit row for the whole run. 2,290 content_versions rows would cost
    // ~1 MB of a 500 MB budget to record a single mechanical event; the event
    // is the import, not each question.
    if (!dryRun) {
      db.prepare(
        `INSERT INTO admin_audit_log (actor_user_id, actor_role, action, entity_type,
                                      entity_id, after_json, reason, created_at)
         VALUES (NULL, 'system', 'questions.import', 'subject', 'nec-computer', ?, ?, ?)`
      ).run(
        JSON.stringify({
          sourceRows: stats.sourceRows,
          questions: stats.questionsInserted,
          options: stats.optionsInserted,
          answerKeys: stats.answerKeysInserted,
          flagged: stats.flagged,
          byCode: stats.byCode,
          collapsedDuplicates: stats.collapsedDuplicates,
        }),
        'bulk import from frontend/public/data/books/',
        now
      );
    }

    if (dryRun) db.exec('ROLLBACK');
    else db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return stats;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const argOf = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const dbPath = resolve(argOf('--db', join(WORKER_ROOT, '.local', 'necprep.sqlite')));
  if (!existsSync(dbPath)) {
    console.error(`no database at ${dbPath}. Run \`npm run db:apply:local\` first.`);
    process.exit(2);
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  const dryRun = argv.includes('--dry-run');
  const stats = importQuestions(db, { dryRun });

  if (argv.includes('--json')) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    const q = (sql) => db.prepare(sql).get().n;
    console.log(`${dryRun ? 'DRY RUN -- ' : ''}import from ${BOOKS_DIR}\n`);
    console.log(`source rows read              ${stats.sourceRows}`);
    console.log(`exact duplicates collapsed    ${stats.collapsedDuplicates}`);
    console.log(`cross-chapter dup groups      ${stats.crossChapterDuplicateGroups}`);
    console.log(`questions written             ${stats.questionsInserted}`);
    console.log(`  published                   ${stats.questionsInserted - stats.flagged}`);
    console.log(`  flagged (withheld)          ${stats.flagged}`);
    console.log(`options written               ${stats.optionsInserted}`);
    console.log(`  retired as duplicate text   ${stats.optionsRetiredAsDuplicate}`);
    console.log(`  pinned ('all of the above') ${stats.pinnedOptions} across ${stats.questionsWithPinnedOptions} questions`);
    console.log(`answer keys written           ${stats.answerKeysInserted}`);
    console.log(`published without a key       ${stats.publishedWithoutKey}  (must be 0)`);
    console.log(`errata reports filed          ${stats.reportsFiled}`);
    console.log(`\ndefect codes: ${JSON.stringify(stats.byCode)}`);
    console.log(`authored correct-option position: ${JSON.stringify(stats.correctOrdinalHistogram)}`);
    console.log(`quarantine.json cross-check: ${JSON.stringify(stats.quarantineDrift)}`);

    console.log('\nper chapter (source rows / questions / flagged / collapsed):');
    for (const [id, c] of Object.entries(stats.byChapter)) {
      console.log(`  ${id.padEnd(11)} ${String(c.rows).padStart(5)} ${String(c.questions).padStart(6)} ${String(c.flagged).padStart(8)} ${String(c.collapsed).padStart(10)}`);
    }

    console.log('\nin-database totals:');
    for (const [label, sql] of [
      ['questions', 'SELECT COUNT(*) n FROM questions'],
      ["  status='published'", "SELECT COUNT(*) n FROM questions WHERE status='published'"],
      ["  status='flagged'", "SELECT COUNT(*) n FROM questions WHERE status='flagged'"],
      ['question_options', 'SELECT COUNT(*) n FROM question_options'],
      ['question_answer_keys', 'SELECT COUNT(*) n FROM question_answer_keys'],
      ['question_reports', 'SELECT COUNT(*) n FROM question_reports'],
      ['questions_fts rows', 'SELECT COUNT(*) n FROM questions_fts'],
      ['v_question_delivery rows', 'SELECT COUNT(*) n FROM v_question_delivery'],
    ]) {
      console.log(`  ${label.padEnd(26)} ${q(sql)}`);
    }
  }
  db.close();
}
