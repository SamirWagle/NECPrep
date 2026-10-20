/**
 * Test harness: a local SQLite database behind the same interface as D1.
 *
 * `node:sqlite` is in the Node 22 standard library, so the whole suite runs
 * with `node --test` and no dependencies, no `npm install` and no network. The
 * shim below implements exactly the four methods `data/d1.ts` declares, which
 * is why the tests can drive the REAL handlers - ownership checks, scoring, the
 * expiry clamp, idempotency, the actual SQL - rather than a re-implementation.
 *
 * The schema comes from `ASSUMED_SCHEMA_DDL`, so the suite is simultaneously a
 * test of the API and an executable statement of what it expects from the
 * Drizzle schema being written in parallel.
 */

import { DatabaseSync } from 'node:sqlite';

import { Db } from '../data/d1.ts';
import type { D1Database, D1PreparedStatement, D1Result, SqlValue } from '../data/d1.ts';
import { ASSUMED_SCHEMA_DDL } from '../data/tables.ts';
import { fixedClock } from '../lib/time.ts';
import type { Clock } from '../lib/time.ts';
import type { Config } from '../env.ts';
import type { HandlerContext } from '../handlers/context.ts';
import type { SessionUser } from '../shared/types.ts';

// --- The D1 shim ------------------------------------------------------------

class SqliteStatement implements D1PreparedStatement {
  #db: DatabaseSync;
  #sql: string;
  #binds: SqlValue[] = [];

  constructor(db: DatabaseSync, sql: string) {
    this.#db = db;
    this.#sql = sql;
  }

  bind(...values: SqlValue[]): D1PreparedStatement {
    this.#binds = values;
    return this;
  }

  #prepared() {
    return this.#db.prepare(this.#sql);
  }

  async first<T>(): Promise<T | null> {
    const row = this.#prepared().get(...(this.#binds as never[]));
    return (row as T | undefined) ?? null;
  }

  async all<T>(): Promise<D1Result<T>> {
    const rows = this.#prepared().all(...(this.#binds as never[])) as T[];
    return {
      results: rows,
      success: true,
      meta: { changes: 0, last_row_id: 0 },
    };
  }

  async run<T>(): Promise<D1Result<T>> {
    const result = this.#prepared().run(...(this.#binds as never[]));
    return {
      results: [],
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

class SqliteD1 implements D1Database {
  readonly raw: DatabaseSync;

  constructor(raw: DatabaseSync) {
    this.raw = raw;
  }

  prepare(query: string): D1PreparedStatement {
    return new SqliteStatement(this.raw, query);
  }

  /**
   * Mirrors D1's batch semantics: one implicit transaction, statements applied
   * in order, all-or-nothing on error.
   *
   * Running a batch as a real transaction matters for the submission tests -
   * the guard-and-flip ordering in `data/mock.ts` is only correct if the
   * statements see each other's effects in sequence and roll back together.
   */
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.raw.exec('BEGIN');
    try {
      const out: D1Result<T>[] = [];
      for (const statement of statements) {
        out.push((await statement.run<T>()) as D1Result<T>);
      }
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }
}

// --- Fixtures ---------------------------------------------------------------

export interface SeededQuestion {
  id: string;
  chapterId: string;
  stem: string;
  /** All option ids, in authored order. */
  optionIds: string[];
  correctOptionId: string;
  bodies: Map<string, string>;
}

export interface SeedOptions {
  chapters?: number;
  questionsPerChapter?: number;
  /** Blueprint quota per chapter for the seeded template. */
  quotaPerChapter?: number;
  durationMinutes?: number;
}

export interface TestWorld {
  d1: SqliteD1;
  clock: ReturnType<typeof fixedClock>;
  config: Config;
  questions: SeededQuestion[];
  questionById: Map<string, SeededQuestion>;
  chapterIds: string[];
  templateId: string;
  /** A fresh query-counting Db, i.e. one simulated Worker invocation. */
  invocation(budget?: number): Db;
  /** Context for a given user, with its own invocation budget. */
  contextFor(user: SessionUser, options?: { db?: Db }): HandlerContext;
  makeUser(overrides?: Partial<SessionUser>): SessionUser;
  close(): void;
}

export const T0 = Date.parse('2026-03-01T04:00:00.000Z');

const TEST_CONFIG: Config = {
  appOrigin: 'https://app.test',
  // 32+ chars, as `loadConfig` requires.
  permutationSecret: 'test-permutation-secret-0123456789abcdef',
  passwordIterations: 10_000,
  queryBudget: 45,
  isProduction: false,
  google: null,
};

function insertUser(
  raw: DatabaseSync,
  user: { id: string; email: string | null; role: string; isAnonymous: boolean; now: number },
): void {
  raw
    .prepare(
      `INSERT INTO users (id, email, email_verified, password_hash, display_name,
                          role, is_anonymous, created_at, updated_at)
       VALUES (?, ?, 0, NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      user.id,
      user.email,
      user.email ?? 'Guest',
      user.role,
      user.isAnonymous ? 1 : 0,
      user.now,
      user.now,
    );
}

export function createWorld(options: SeedOptions = {}): TestWorld {
  const chapterCount = options.chapters ?? 3;
  const perChapter = options.questionsPerChapter ?? 12;
  const quota = options.quotaPerChapter ?? 4;
  const durationMinutes = options.durationMinutes ?? 45;

  const raw = new DatabaseSync(':memory:');
  for (const statement of ASSUMED_SCHEMA_DDL) raw.exec(statement);

  const questions: SeededQuestion[] = [];
  const chapterIds: string[] = [];

  const insertChapter = raw.prepare(
    `INSERT INTO chapters (id, slug, name, short_name, description, icon, color,
                           order_index, question_count)
     VALUES (?, ?, ?, ?, '', 'book', '#000000', ?, ?)`,
  );
  const insertQuestion = raw.prepare(
    `INSERT INTO questions (id, chapter_id, stem, explanation, difficulty, status,
                            created_at, updated_at)
     VALUES (?, ?, ?, ?, 2, 'published', ?, ?)`,
  );
  const insertOption = raw.prepare(
    `INSERT INTO question_options (id, question_id, body, is_correct, position)
     VALUES (?, ?, ?, ?, ?)`,
  );

  for (let c = 1; c <= chapterCount; c++) {
    const chapterId = `ch${c}`;
    chapterIds.push(chapterId);
    insertChapter.run(chapterId, `chapter-${c}`, `Chapter ${c}`, `Ch${c}`, c, perChapter);

    for (let q = 1; q <= perChapter; q++) {
      const questionId = `q_${chapterId}_${q}`;
      insertQuestion.run(questionId, chapterId, `Stem ${chapterId} item ${q}`, `Because ${q}.`, T0, T0);

      // Option ids follow the REAL schema's convention,
      // `question_id || '#' || ordinal` (see `worker/migrations/0002_content.sql`),
      // which means the authored ordinal is readable straight off the id.
      //
      // Seeding them this way on purpose: it makes every "no option id reaches
      // a client" assertion in this suite a test of something that matters.
      // `frontend/public/data/books/*.json` publishes `correct_option_index`
      // and is in git history forever, so an id of `q_ch1_1#3` next to a
      // published key of 3 IS the answer - no database access needed, and a
      // per-viewer option permutation does not help, because the ordinal
      // travels inside the id rather than as a position in the array.
      const optionIds: string[] = [];
      const bodies = new Map<string, string>();
      // Rotate which authored slot is correct, so a test that accidentally
      // depends on "slot 1 is always right" fails.
      const correctSlot = (q % 4) + 1;
      let correctOptionId = '';

      for (let o = 1; o <= 4; o++) {
        const optionId = `${questionId}#${o}`;
        const body = `${chapterId} q${q} choice ${o}`;
        const isCorrect = o === correctSlot;
        insertOption.run(optionId, questionId, body, isCorrect ? 1 : 0, o);
        optionIds.push(optionId);
        bodies.set(optionId, body);
        if (isCorrect) correctOptionId = optionId;
      }

      questions.push({ id: questionId, chapterId, stem: `Stem ${chapterId} item ${q}`, optionIds, correctOptionId, bodies });
    }
  }

  const templateId = 'tpl_main';
  raw
    .prepare(
      `INSERT INTO mock_templates (id, slug, name, description, duration_minutes,
                                   questions_per_chapter, total_questions, is_active)
       VALUES (?, 'main', 'Full Mock', '', ?, ?, ?, 1)`,
    )
    .run(templateId, durationMinutes, quota, quota * chapterCount);

  const insertBlueprint = raw.prepare(
    `INSERT INTO mock_template_blueprint (id, template_id, chapter_id, question_count, position)
     VALUES (?, ?, ?, ?, ?)`,
  );
  chapterIds.forEach((chapterId, index) => {
    insertBlueprint.run(`bp_${chapterId}`, templateId, chapterId, quota, index);
  });

  const clock = fixedClock(T0);
  const d1 = new SqliteD1(raw);

  let userSeq = 0;

  const world: TestWorld = {
    d1,
    clock,
    config: TEST_CONFIG,
    questions,
    questionById: new Map(questions.map((q) => [q.id, q])),
    chapterIds,
    templateId,

    invocation(budget = 45) {
      return new Db(d1, { budget });
    },

    contextFor(user, opts = {}) {
      return {
        db: opts.db ?? new Db(d1, { budget: TEST_CONFIG.queryBudget }),
        clock: clock as Clock,
        config: TEST_CONFIG,
        auth: { user, sessionId: `ses_${user.id}` },
        meta: { ipHash: 'test-ip-hash', userAgent: 'node-test' },
        cookies: [],
      };
    },

    makeUser(overrides = {}) {
      userSeq += 1;
      const user: SessionUser = {
        id: overrides.id ?? `usr_test_${userSeq}`,
        email: overrides.email ?? `user${userSeq}@test.local`,
        displayName: overrides.displayName ?? `User ${userSeq}`,
        role: overrides.role ?? 'user',
        isAnonymous: overrides.isAnonymous ?? false,
        hasPassword: overrides.hasPassword ?? true,
        createdAt: overrides.createdAt ?? T0,
      };
      insertUser(raw, {
        id: user.id,
        email: user.email,
        role: user.role,
        isAnonymous: user.isAnonymous,
        now: T0,
      });
      return user;
    },

    close() {
      raw.close();
    },
  };

  return world;
}

/** Runs a handler on its own invocation budget and reports what it spent. */
export async function measure<T>(
  world: TestWorld,
  user: SessionUser,
  run: (ctx: HandlerContext) => Promise<T>,
): Promise<{ result: T; queries: number; ctx: HandlerContext }> {
  const ctx = world.contextFor(user);
  const result = await run(ctx);
  return { result, queries: ctx.db.queryCount, ctx };
}

/** Asserts a thrown `ApiException` and returns its code. */
export async function expectFailure(
  run: () => Promise<unknown>,
): Promise<{ code: string; status: number; message: string }> {
  try {
    await run();
  } catch (err) {
    const e = err as { name?: string; code?: string; status?: number; message?: string };
    if (e.name !== 'ApiException') {
      throw new Error(`Expected an ApiException, got ${String(err)}`);
    }
    return {
      code: e.code ?? '',
      status: e.status ?? 0,
      message: e.message ?? '',
    };
  }
  throw new Error('Expected the call to fail, but it succeeded.');
}
