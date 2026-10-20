/**
 * Content reads: chapters, questions, options, templates, search.
 *
 * THE STRUCTURAL RULE OF THIS FILE. There are two functions that read
 * `question_options`, and they are deliberately different functions:
 *
 *   loadOptionsForQuestions()  SELECTs id, question_id, body, position
 *   loadAnswerKey()            SELECTs question_id, id WHERE is_correct = 1
 *
 * No query here selects `body` and `is_correct` together, and nothing that
 * builds a pre-answer payload can reach `loadAnswerKey`. Getting the key into a
 * response is not a matter of forgetting to delete a field - it requires
 * calling a differently-named function that only the three disclosure sites
 * (mock review, practice reveal, mock scoring) call.
 *
 * Every `IN (...)` list is passed as ONE json parameter and expanded with
 * `json_each`, because D1 refuses more than 100 bound parameters per statement
 * and a 100-question paper would otherwise need to be chunked.
 */

import { Db } from './d1.ts';
import { T } from './tables.ts';
import type { ChapterIcon, ChapterSummary, MockTemplateSummary } from '../shared/types.ts';
import type { OptionRow } from '../lib/permute.ts';
import type { ChapterPool } from '../domain/blueprint.ts';
import type { KeyEntry } from '../domain/scoring.ts';

const VALID_ICONS: ReadonlySet<string> = new Set<ChapterIcon>([
  'cpu', 'code', 'network', 'database', 'brain',
  'chip', 'settings', 'book', 'calculator', 'monitor',
]);

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

/** 1 query. */
export async function listChapters(db: Db): Promise<ChapterSummary[]> {
  const rows = await db.all<ChapterRowShape>(
    `SELECT id, slug, name, short_name, description, icon, color,
            order_index, question_count
       FROM ${T.chapters}
      ORDER BY order_index, slug`,
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

/**
 * Templates with their per-chapter blueprint. 1 query.
 *
 * The blueprint rows are folded in with a correlated `json_group_array` rather
 * than a second round trip, because this runs inside `/api/bootstrap` where
 * every query competes with the rest of the app shell for the 50-query budget.
 */
export async function listMockTemplates(db: Db): Promise<MockTemplateSummary[]> {
  const rows = await db.all<{
    id: string;
    slug: string;
    name: string;
    description: string;
    duration_minutes: number;
    total_questions: number;
    blueprint_json: string;
  }>(
    `SELECT t.id, t.slug, t.name, t.description, t.duration_minutes,
            t.total_questions,
            COALESCE((
              SELECT json_group_array(
                       json_object('chapterId', b.chapter_id,
                                   'questionCount', b.question_count))
                FROM (
                  SELECT chapter_id, question_count
                    FROM ${T.mockTemplateBlueprint}
                   WHERE template_id = t.id
                   ORDER BY position
                ) b
            ), '[]') AS blueprint_json
       FROM ${T.mockTemplates} t
      WHERE t.is_active = 1
      ORDER BY t.slug`,
  );

  return rows.map((r) => {
    let blueprint: Array<{ chapterId: string; questionCount: number }> = [];
    try {
      blueprint = JSON.parse(r.blueprint_json) as typeof blueprint;
    } catch {
      blueprint = [];
    }
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      durationMinutes: r.duration_minutes,
      totalQuestions: r.total_questions,
      blueprint,
    };
  });
}

export interface MockTemplateRow {
  id: string;
  name: string;
  duration_minutes: number;
  total_questions: number;
}

/** 1 query. `null` for an unknown or deactivated template. */
export async function getActiveMockTemplate(
  db: Db,
  templateId: string,
): Promise<MockTemplateRow | null> {
  return await db.first<MockTemplateRow>(
    `SELECT id, name, duration_minutes, total_questions
       FROM ${T.mockTemplates}
      WHERE id = ?1 AND is_active = 1`,
    templateId,
  );
}

/** 1 query. */
export async function getBlueprint(
  db: Db,
  templateId: string,
): Promise<Array<{ chapterId: string; questionCount: number }>> {
  const rows = await db.all<{ chapter_id: string; question_count: number }>(
    `SELECT chapter_id, question_count
       FROM ${T.mockTemplateBlueprint}
      WHERE template_id = ?1
      ORDER BY position`,
    templateId,
  );
  return rows.map((r) => ({ chapterId: r.chapter_id, questionCount: r.question_count }));
}

/**
 * Draws each chapter's quota of published question ids, randomly, in ONE query.
 *
 * The random selection happens in SQLite with a window function, so the Worker
 * never materialises all 2,801 questions to pick 100. The caller then runs the
 * pure `selectPaper()` over the result to interleave chapters, assign positions
 * and record shortfalls - keeping the policy testable without a database while
 * the row selection stays where it belongs.
 */
export async function drawChapterPools(
  db: Db,
  templateId: string,
): Promise<ChapterPool[]> {
  const rows = await db.all<{ id: string; chapter_id: string }>(
    `SELECT id, chapter_id FROM (
       SELECT q.id, q.chapter_id,
              ROW_NUMBER() OVER (
                PARTITION BY q.chapter_id ORDER BY RANDOM()
              ) AS rn,
              b.question_count AS quota
         FROM ${T.mockTemplateBlueprint} b
         JOIN ${T.questions} q
           ON q.chapter_id = b.chapter_id AND q.status = 'published'
        WHERE b.template_id = ?1
     )
     WHERE rn <= quota`,
    templateId,
  );

  const byChapter = new Map<string, string[]>();
  for (const row of rows) {
    const list = byChapter.get(row.chapter_id);
    if (list) list.push(row.id);
    else byChapter.set(row.chapter_id, [row.id]);
  }
  return [...byChapter.entries()].map(([chapterId, questionIds]) => ({
    chapterId,
    questionIds,
  }));
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
  difficulty: number | null;
}

/** 1 query. Stems only - no options, no key. */
export async function loadQuestionStems(
  db: Db,
  questionIds: readonly string[],
): Promise<QuestionStem[]> {
  if (questionIds.length === 0) return [];
  return await db.all<QuestionStem>(
    `SELECT id, chapter_id, stem, explanation, difficulty
       FROM ${T.questions}
      WHERE id IN (SELECT value FROM json_each(?1))`,
    JSON.stringify(questionIds),
  );
}

/**
 * Option bodies for a set of questions, keyed by question. 1 query.
 *
 * `is_correct` IS NOT IN THE SELECT LIST. This is the function every
 * pre-answer payload uses, and it is physically incapable of returning the key.
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
  }>(
    `SELECT id, question_id, body, position
       FROM ${T.questionOptions}
      WHERE question_id IN (SELECT value FROM json_each(?1))
      ORDER BY question_id, position`,
    JSON.stringify(questionIds),
  );

  for (const row of rows) {
    const list = out.get(row.question_id);
    const option: OptionRow = { id: row.id, body: row.body, position: row.position };
    if (list) list.push(option);
    else out.set(row.question_id, [option]);
  }
  return out;
}

/**
 * THE ANSWER KEY. 1 query.
 *
 * Three callers only: mock scoring, mock review assembly (which reuses the
 * scoring result) and the practice per-question reveal. Each of those runs
 * strictly AFTER the answer has been committed. Grep for this function name
 * before adding a fourth.
 */
export async function loadAnswerKey(
  db: Db,
  questionIds: readonly string[],
): Promise<KeyEntry[]> {
  if (questionIds.length === 0) return [];
  const rows = await db.all<{ question_id: string; id: string }>(
    `SELECT question_id, id
       FROM ${T.questionOptions}
      WHERE is_correct = 1
        AND question_id IN (SELECT value FROM json_each(?1))`,
    JSON.stringify(questionIds),
  );
  return rows.map((r) => ({ questionId: r.question_id, correctOptionId: r.id }));
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
    `SELECT id, chapter_id, stem, explanation, difficulty
       FROM ${T.questions}
      WHERE chapter_id = ?1 AND status = 'published'
      ORDER BY id
      LIMIT ?2 OFFSET ?3`,
    args.chapterId,
    args.limit,
    args.offset,
  );
}

/**
 * Substring search over stems. 1 query.
 *
 * A LIKE scan over 2,801 published rows, which D1 handles in single-digit
 * milliseconds and which needs no extra table to stay in sync. The upgrade path
 * when the bank grows is an FTS5 virtual table plus triggers; it is deliberately
 * not here yet, because an out-of-date FTS index silently returns wrong results
 * and that is worse than a scan.
 *
 * `%` and `_` in the user's input are escaped, so a query of "100%" is a
 * literal search and not a match-everything wildcard.
 */
export async function searchQuestions(
  db: Db,
  args: { query: string; chapterId: string | null; limit: number },
): Promise<Array<{ questionId: string; chapterId: string; stem: string }>> {
  const escaped = args.query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const pattern = `%${escaped}%`;

  const rows = args.chapterId
    ? await db.all<{ id: string; chapter_id: string; stem: string }>(
        `SELECT id, chapter_id, stem FROM ${T.questions}
          WHERE status = 'published' AND chapter_id = ?2
            AND stem LIKE ?1 ESCAPE '\\'
          ORDER BY LENGTH(stem) LIMIT ?3`,
        pattern,
        args.chapterId,
        args.limit,
      )
    : await db.all<{ id: string; chapter_id: string; stem: string }>(
        `SELECT id, chapter_id, stem FROM ${T.questions}
          WHERE status = 'published' AND stem LIKE ?1 ESCAPE '\\'
          ORDER BY LENGTH(stem) LIMIT ?2`,
        pattern,
        args.limit,
      );

  return rows.map((r) => ({ questionId: r.id, chapterId: r.chapter_id, stem: r.stem }));
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
