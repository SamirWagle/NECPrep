/**
 * Content reads: chapters, questions, options, templates, search.
 *
 * THE STRUCTURAL RULE OF THIS FILE. There are two functions that can reach an
 * answer, and they read DIFFERENT TABLES:
 *
 *   loadOptionsForQuestions()  SELECTs from `question_options`
 *   loadAnswerKey()            SELECTs from `question_answer_keys`
 *
 * `question_options` has no `is_correct` column -- the key is a separate table
 * with one row per question -- so a query over the option rows is physically
 * incapable of returning the key. Getting it into a response is not a matter of
 * forgetting to delete a field, nor of leaving a column out of a SELECT list:
 * it requires naming a third table in a FROM clause. That is a greppable,
 * reviewable, testable event, and `loadAnswerKey` is the only place in this
 * codebase that does it.
 *
 * ON `v_question_delivery`, WHICH THIS FILE DOES NOT USE. The schema offers it
 * as the shortest correct thing to write for a delivery payload, and it cannot
 * reference the key table, so `SELECT *` over it is safe by construction. The
 * reads here are narrower and go straight at the tables, for one reason: the
 * view is one row per (question, option), so loading 100 questions through it
 * would return 400 rows with every stem repeated four times -- against a 1 MB
 * D1 response limit and on a mobile connection. `loadQuestionStems` and
 * `loadOptionsForQuestions` are the same query split in two, and neither can
 * reach the key either, for the same structural reason the view cannot.
 *
 * Every `IN (...)` list is passed as ONE json parameter and expanded with
 * `json_each`, because D1 refuses more than 100 bound parameters per statement
 * and a 100-question paper would otherwise have to be chunked.
 */

import { Db } from './d1.ts';
import { T } from './tables.ts';
import type {
  ChapterIcon,
  ChapterSummary,
  MockTemplateSummary,
  QuestionDifficulty,
} from '../shared/types.ts';
import type { OptionRow } from '../lib/permute.ts';
import type { BlueprintRule, ChapterPool, SubchapterPool } from '../domain/blueprint.ts';
import type { KeyEntry } from '../domain/scoring.ts';

const VALID_ICONS: ReadonlySet<string> = new Set<ChapterIcon>([
  'cpu', 'code', 'network', 'database', 'brain',
  'chip', 'settings', 'book', 'calculator', 'monitor',
]);

export function toDifficulty(raw: string | null): QuestionDifficulty | null {
  return raw === 'easy' || raw === 'medium' || raw === 'hard' ? raw : null;
}

interface ChapterRowShape {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  description: string;
  icon: string;
  color: string;
  order_index: number;
  question_count: number;
}

/**
 * 1 query.
 *
 * `question_count` is a correlated COUNT rather than a stored column, because
 * the schema does not keep one and a denormalised counter here would need a
 * trigger on every question status change to stay honest. The subquery is
 * served by `idx_questions_published_chapter`, which is partial on
 * `status = 'published'` and covering for `(chapter_id, id)`, so it is ten
 * index-only range scans and never touches the questions table.
 *
 * `name` is `chapters.display_name` -- the short string the practice cards
 * already show. `chapters.title` is the official NEC syllabus title and is a
 * genuinely different string; it is not on this payload because nothing renders
 * it yet.
 */
export async function listChapters(db: Db): Promise<ChapterSummary[]> {
  const rows = await db.all<ChapterRowShape>(
    `SELECT c.id, c.slug, c.display_name AS name, c.short_name,
            COALESCE(c.description, '') AS description, c.icon, c.color,
            c.ordinal AS order_index,
            (SELECT COUNT(*) FROM ${T.questions} q
              WHERE q.chapter_id = c.id AND q.status = 'published') AS question_count
       FROM ${T.chapters} c
      WHERE c.status = 'published'
      ORDER BY c.ordinal, c.slug`,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    shortName: r.short_name,
    description: r.description,
    questionCount: r.question_count,
    icon: (VALID_ICONS.has(r.icon) ? r.icon : 'book') as ChapterIcon,
    color: r.color,
    orderIndex: r.order_index,
  }));
}

/** One rule out of a stored blueprint, as `json_each` yields it. */
interface BlueprintRuleRow {
  chapter_id: string;
  subchapter_code: string | null;
  want: number;
}

function toRules(rows: readonly BlueprintRuleRow[]): BlueprintRule[] {
  return rows.map((r) => ({
    chapterId: r.chapter_id,
    subchapterCode: r.subchapter_code,
    questionCount: r.want,
  }));
}

/**
 * Templates with their composition. 1 query (NQ-19a + NQ-19b in one).
 *
 * The 60 sub-chapter rules are expanded with `json_each` and folded in as two
 * JSON aggregates -- the per-chapter totals the UI shows in a line, and the
 * real per-code composition -- rather than a second round trip, because this
 * runs inside `/api/bootstrap` where every query competes with the rest of the
 * app shell for the 50-query budget.
 */
export async function listMockTemplates(db: Db): Promise<MockTemplateSummary[]> {
  const rows = await db.all<{
    id: string;
    slug: string;
    name: string;
    description: string;
    duration_minutes: number;
    total_questions: number;
    chapter_json: string;
    subchapter_json: string;
  }>(
    `SELECT t.id, t.slug, t.name, COALESCE(t.description, '') AS description,
            t.duration_minutes, t.total_questions,
            COALESCE((
              SELECT json_group_array(
                       json_object('chapterId', chapter_id, 'questionCount', n))
                FROM (
                  SELECT json_extract(r.value, '$.chapter_id') AS chapter_id,
                         SUM(json_extract(r.value, '$.count'))  AS n
                    FROM json_each(t.blueprint, '$.rules') r
                   GROUP BY chapter_id
                   ORDER BY MIN(r.key)
                )
            ), '[]') AS chapter_json,
            COALESCE((
              SELECT json_group_array(
                       json_object('chapterId', chapter_id,
                                   'subchapterCode', subchapter_code,
                                   'questionCount', n))
                FROM (
                  SELECT json_extract(r.value, '$.chapter_id')      AS chapter_id,
                         json_extract(r.value, '$.subchapter_code') AS subchapter_code,
                         json_extract(r.value, '$.count')           AS n
                    FROM json_each(t.blueprint, '$.rules') r
                   ORDER BY r.key
                )
            ), '[]') AS subchapter_json
       FROM ${T.mockTestTemplates} t
      WHERE t.status = 'published'
      ORDER BY t.ordinal, t.slug`,
  );

  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    durationMinutes: r.duration_minutes,
    totalQuestions: r.total_questions,
    blueprint: parseJsonArray<{ chapterId: string; questionCount: number }>(r.chapter_json),
    subchapterBlueprint: parseJsonArray<{
      chapterId: string;
      subchapterCode: string;
      questionCount: number;
    }>(r.subchapter_json),
  }));
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export interface MockTemplateRow {
  id: string;
  name: string;
  duration_minutes: number;
  total_questions: number;
  strict_subchapter: number;
}

/** NQ-19 template-by-id. 1 query. `null` for an unknown or retired template. */
export async function getActiveMockTemplate(
  db: Db,
  templateId: string,
): Promise<MockTemplateRow | null> {
  return await db.first<MockTemplateRow>(
    `SELECT id, name, duration_minutes, total_questions,
            CASE WHEN json_extract(blueprint, '$.strict_subchapter') IN (1, 'true')
                 THEN 1 ELSE 0 END AS strict_subchapter
       FROM ${T.mockTestTemplates}
      WHERE id = ?1 AND status = 'published'`,
    templateId,
  );
}

/** NQ-19b blueprint-expand. 1 query, all 60 rules. */
export async function getBlueprint(db: Db, templateId: string): Promise<BlueprintRule[]> {
  const rows = await db.all<BlueprintRuleRow>(
    `SELECT json_extract(r.value, '$.chapter_id')      AS chapter_id,
            json_extract(r.value, '$.subchapter_code') AS subchapter_code,
            json_extract(r.value, '$.count')           AS want
       FROM ${T.mockTestTemplates} t, json_each(t.blueprint, '$.rules') r
      WHERE t.id = ?1`,
    templateId,
  );
  return toRules(rows);
}

/**
 * NQ-19c blueprint-draw. The whole paper's candidate pools in ONE query.
 *
 * Two arms, UNION ALL'd:
 *
 *   'subchapter'  up to `count` published questions actually TAGGED with each
 *                 rule's syllabus code. Empty today -- no imported question
 *                 carries `subchapter_id` -- and that is why the second arm
 *                 exists rather than being a fallback bolted on later.
 *   'chapter'     each chapter's whole quota, shuffled by SQLite, for the
 *                 top-up. The window function does the random selection inside
 *                 the database, so the Worker never materialises 2,290
 *                 questions to pick 100.
 *
 * The two arms can overlap -- a tagged question is also in its chapter's pool
 * -- and `selectPaper` de-duplicates. Bounded at 2 x total_questions rows.
 */
export async function drawBlueprintPools(
  db: Db,
  templateId: string,
): Promise<{ subchapterPools: SubchapterPool[]; chapterPools: ChapterPool[] }> {
  const rows = await db.all<{
    src: string;
    id: string;
    chapter_id: string;
    subchapter_code: string | null;
  }>(
    `WITH rules AS (
       SELECT json_extract(r.value, '$.chapter_id')      AS chapter_id,
              json_extract(r.value, '$.subchapter_code') AS subchapter_code,
              json_extract(r.value, '$.count')           AS want
         FROM ${T.mockTestTemplates} t, json_each(t.blueprint, '$.rules') r
        WHERE t.id = ?1
     ),
     chapter_want AS (
       SELECT chapter_id, SUM(want) AS want FROM rules GROUP BY chapter_id
     ),
     tagged AS (
       SELECT q.id, q.chapter_id, s.code AS subchapter_code, r.want,
              ROW_NUMBER() OVER (PARTITION BY s.code ORDER BY RANDOM()) AS rn
         FROM rules r
         JOIN ${T.subchapters} s ON s.code = r.subchapter_code
         JOIN ${T.questions} q
           ON q.subchapter_id = s.id AND q.status = 'published'
     ),
     pool AS (
       SELECT q.id, q.chapter_id, cw.want,
              ROW_NUMBER() OVER (PARTITION BY q.chapter_id ORDER BY RANDOM()) AS rn
         FROM chapter_want cw
         JOIN ${T.questions} q
           ON q.chapter_id = cw.chapter_id AND q.status = 'published'
     )
     SELECT 'subchapter' AS src, id, chapter_id, subchapter_code
       FROM tagged WHERE rn <= want
     UNION ALL
     SELECT 'chapter' AS src, id, chapter_id, NULL AS subchapter_code
       FROM pool WHERE rn <= want`,
    templateId,
  );

  const byCode = new Map<string, string[]>();
  const byChapter = new Map<string, string[]>();
  for (const row of rows) {
    if (row.src === 'subchapter' && row.subchapter_code !== null) {
      const list = byCode.get(row.subchapter_code);
      if (list) list.push(row.id);
      else byCode.set(row.subchapter_code, [row.id]);
    } else {
      const list = byChapter.get(row.chapter_id);
      if (list) list.push(row.id);
      else byChapter.set(row.chapter_id, [row.id]);
    }
  }

  return {
    subchapterPools: [...byCode.entries()].map(([subchapterCode, questionIds]) => ({
      subchapterCode,
      questionIds,
    })),
    chapterPools: [...byChapter.entries()].map(([chapterId, questionIds]) => ({
      chapterId,
      questionIds,
    })),
  };
}

/** Random published questions from a set of chapters, for practice. 1 query. */
export async function drawPracticeQuestions(
  db: Db,
  args: { chapterIds: readonly string[] | null; limit: number },
): Promise<Array<{ questionId: string; chapterId: string }>> {
  const rows = args.chapterIds
    ? await db.all<{ id: string; chapter_id: string }>(
        `SELECT q.id, q.chapter_id
           FROM ${T.questions} q
          WHERE q.status = 'published'
            AND q.chapter_id IN (SELECT value FROM json_each(?1))
          ORDER BY RANDOM()
          LIMIT ?2`,
        JSON.stringify(args.chapterIds),
        args.limit,
      )
    : await db.all<{ id: string; chapter_id: string }>(
        `SELECT q.id, q.chapter_id
           FROM ${T.questions} q
          WHERE q.status = 'published'
          ORDER BY RANDOM()
          LIMIT ?1`,
        args.limit,
      );
  return rows.map((r) => ({ questionId: r.id, chapterId: r.chapter_id }));
}

export interface QuestionStem {
  id: string;
  chapter_id: string;
  stem: string;
  explanation: string | null;
  difficulty: string | null;
}

/**
 * The published explanation for a question, as a correlated subquery.
 *
 * `explanations` is a separate table because an explanation is long, edited on
 * a different cadence, has its own author and review state, and must never be
 * shipped with the question before the student has answered. Only a PUBLISHED
 * one is readable here, and `uq_explanations_primary` guarantees at most one
 * primary per question, so the `ORDER BY` has nothing to choose between.
 *
 * It returns NULL for every question today: the table is modelled and indexed
 * but unpopulated, and the editor flow that fills it is a later phase.
 */
const EXPLANATION_SUBQUERY = `(SELECT e.body FROM ${T.explanations} e
                                WHERE e.question_id = q.id AND e.status = 'published'
                                ORDER BY e.is_primary DESC, e.id
                                LIMIT 1)`;

/** 1 query. Stems only - no options, no key. */
export async function loadQuestionStems(
  db: Db,
  questionIds: readonly string[],
): Promise<QuestionStem[]> {
  if (questionIds.length === 0) return [];
  return await db.all<QuestionStem>(
    `SELECT q.id, q.chapter_id, q.stem, q.difficulty,
            ${EXPLANATION_SUBQUERY} AS explanation
       FROM ${T.questions} q
      WHERE q.id IN (SELECT value FROM json_each(?1))`,
    JSON.stringify(questionIds),
  );
}

/**
 * NQ-09 deliver-options. Option bodies for a set of questions, keyed by
 * question. 1 query.
 *
 * READS `question_options`, WHICH HAS NO ANSWER COLUMN. This is the function
 * every pre-answer payload uses, and it is physically incapable of returning
 * the key: the key is a row in `question_answer_keys`, a table this statement
 * does not name.
 *
 * `is_pinned` comes back because the permuter needs it: 'All of the above' and
 * friends must stay last, and the schema's flag is better than re-deriving it
 * from the text on every request.
 */
export async function loadOptionsForQuestions(
  db: Db,
  questionIds: readonly string[],
): Promise<Map<string, OptionRow[]>> {
  const out = new Map<string, OptionRow[]>();
  if (questionIds.length === 0) return out;

  const rows = await db.all<{
    id: string;
    question_id: string;
    body: string;
    position: number;
    is_pinned: number;
  }>(
    `SELECT id, question_id, text AS body, ordinal AS position, is_pinned
       FROM ${T.questionOptions}
      WHERE question_id IN (SELECT value FROM json_each(?1))
        AND retired_at IS NULL
      ORDER BY question_id, ordinal`,
    JSON.stringify(questionIds),
  );

  for (const row of rows) {
    const list = out.get(row.question_id);
    const option: OptionRow = {
      id: row.id,
      body: row.body,
      position: row.position,
      isPinned: row.is_pinned === 1,
    };
    if (list) list.push(option);
    else out.set(row.question_id, [option]);
  }
  return out;
}

/**
 * *** THE ANSWER KEY. NQ-10b grade-batch. 1 query. ***
 *
 * The ONLY function in this codebase that names `question_answer_keys`. Three
 * callers: mock scoring, mock review assembly (which reuses the scoring result)
 * and the practice per-question reveal. Each runs strictly AFTER the answer has
 * been committed. Grep for this function name before adding a fourth, and read
 * the block above the table in migrations/0002_content.sql first.
 *
 * One statement for a whole paper, because D1 allows 50 queries per Worker
 * invocation and a 100-question mock graded one question at a time would need
 * 100.
 */
export async function loadAnswerKey(
  db: Db,
  questionIds: readonly string[],
): Promise<KeyEntry[]> {
  if (questionIds.length === 0) return [];
  const rows = await db.all<{ question_id: string; correct_option_id: string }>(
    `SELECT question_id, correct_option_id
       FROM ${T.questionAnswerKeys}
      WHERE question_id IN (SELECT value FROM json_each(?1))`,
    JSON.stringify(questionIds),
  );
  return rows.map((r) => ({ questionId: r.question_id, correctOptionId: r.correct_option_id }));
}

/** 1 query. */
export async function countChapterQuestions(db: Db, chapterId: string): Promise<number> {
  const row = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${T.questions}
      WHERE chapter_id = ?1 AND status = 'published'`,
    chapterId,
  );
  return row?.n ?? 0;
}

/** 1 query. Stable ordering, so paging does not repeat or skip. */
export async function pageChapterQuestions(
  db: Db,
  args: { chapterId: string; offset: number; limit: number },
): Promise<QuestionStem[]> {
  return await db.all<QuestionStem>(
    `SELECT q.id, q.chapter_id, q.stem, q.difficulty,
            ${EXPLANATION_SUBQUERY} AS explanation
       FROM ${T.questions} q
      WHERE q.chapter_id = ?1 AND q.status = 'published'
      ORDER BY q.id
      LIMIT ?2 OFFSET ?3`,
    args.chapterId,
    args.limit,
    args.offset,
  );
}

/**
 * Turns a user's search box into an FTS5 MATCH expression.
 *
 * FTS5's query language is not a safe place to put untrusted text: a bare `"`,
 * a trailing `AND`, a `*` or a `-` is a syntax error that throws at
 * `prepare()`, and `NEAR`/`OR` would let a caller write queries the UI never
 * offered. So the input is reduced to alphanumeric tokens and each is quoted as
 * a literal phrase, which is both injection-proof and what a student means by
 * typing two words. The last token gets a `*` so search-as-you-type finds
 * 'thevenin' from 'theven'.
 *
 * Returns `null` when nothing survives tokenising, which the caller turns into
 * an empty result rather than a 500.
 */
export function toFtsQuery(raw: string): string | null {
  const tokens = raw.toLowerCase().match(/[a-z0-9]+/g);
  if (!tokens || tokens.length === 0) return null;
  const capped = tokens.slice(0, 8);
  return capped
    .map((token, i) => (i === capped.length - 1 ? `"${token}"*` : `"${token}"`))
    .join(' ');
}

/**
 * NQ-11 question-search. 1 query, over the FTS5 index.
 *
 * This replaced a `LIKE '%...%'` scan. The scan was correct and fast enough at
 * 2,290 rows, and it needed no second structure to keep in sync -- but D1 is
 * single-threaded per database, so a scan on a request path is a platform-wide
 * cost, and the bank is expected to reach 10k-50k questions. The FTS index is
 * maintained by the six triggers in 0003, which run inside the statement that
 * edits a question and therefore cost nothing against the query budget, so the
 * "an out-of-date index silently returns wrong results" objection is answered
 * by the triggers rather than by a cron.
 *
 * The bm25 weights are positional over the table's five columns: the three
 * UNINDEXED ones get 0, a stem hit is weighted 10 and an option hit 3. A
 * student searching 'Thevenin' wants the question about Thevenin's theorem
 * ahead of one that merely lists it as a wrong answer.
 */
export async function searchQuestions(
  db: Db,
  args: { query: string; chapterId: string | null; limit: number },
): Promise<Array<{ questionId: string; chapterId: string; stem: string }>> {
  const match = toFtsQuery(args.query);
  if (match === null) return [];

  const rows = args.chapterId
    ? await db.all<{ question_id: string; chapter_id: string; stem: string }>(
        `SELECT question_id, chapter_id, stem
           FROM ${T.questionsFts}
          WHERE ${T.questionsFts} MATCH ?1
            AND status = 'published'
            AND chapter_id = ?2
          ORDER BY bm25(${T.questionsFts}, 0.0, 0.0, 0.0, 10.0, 3.0)
          LIMIT ?3`,
        match,
        args.chapterId,
        args.limit,
      )
    : await db.all<{ question_id: string; chapter_id: string; stem: string }>(
        `SELECT question_id, chapter_id, stem
           FROM ${T.questionsFts}
          WHERE ${T.questionsFts} MATCH ?1
            AND status = 'published'
          ORDER BY bm25(${T.questionsFts}, 0.0, 0.0, 0.0, 10.0, 3.0)
          LIMIT ?2`,
        match,
        args.limit,
      );

  return rows.map((r) => ({
    questionId: r.question_id,
    chapterId: r.chapter_id,
    stem: r.stem,
  }));
}

/**
 * A cheap cache-busting token for the content endpoints. 1 query.
 *
 * Derived from the newest `questions.updated_at`, so publishing or retiring a
 * question changes it and the client knows to refetch, without a separate
 * version table to keep in step.
 */
export async function contentVersion(db: Db): Promise<string> {
  const row = await db.first<{ v: number | null; n: number }>(
    `SELECT MAX(updated_at) AS v, COUNT(*) AS n
       FROM ${T.questions} WHERE status = 'published'`,
  );
  return `${row?.v ?? 0}-${row?.n ?? 0}`;
}
