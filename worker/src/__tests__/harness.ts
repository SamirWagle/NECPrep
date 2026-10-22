/**
 * Test harness: a local SQLite database behind the same interface as D1.
 *
 * `node:sqlite` is in the Node 22 standard library, so the whole suite runs
 * with `node --test` and no network. The shim below implements exactly the four
 * methods `data/d1.ts` declares, which is why the tests can drive the REAL
 * handlers - ownership checks, scoring, the expiry clamp, idempotency, the
 * actual SQL - rather than a re-implementation.
 *
 * ===========================================================================
 * THE SCHEMA IS `worker/migrations/*.sql`, APPLIED VERBATIM
 * ===========================================================================
 *
 * This used to apply `ASSUMED_SCHEMA_DDL` from `src/data/tables.ts` -- a second,
 * hand-written description of the database, written because the API and the
 * migrations were being built concurrently. The suite therefore proved the API
 * against its own assumptions, which is exactly as useful as it sounds: 88
 * tests passed green against a schema that did not exist, while the real one
 * stored seconds where the API read milliseconds.
 *
 * So the migrations are read off disk and executed in order. Everything the
 * suite asserts is now asserted against the DDL that will be deployed:
 * `STRICT` typing, every CHECK, every composite foreign key, the eleven rollup
 * triggers, the FTS5 index and its six maintenance triggers, and the generated
 * columns. A handler that gets a column name wrong fails here instead of on the
 * first real request.
 *
 * `0007_reference_data.sql` IS APPLIED TOO, so the fixture runs against the
 * real syllabus rows and the three real mock templates as well as its own. The
 * fixture's chapters and template sit alongside them with their own codes,
 * which is also the honest shape of the production database: ten official
 * chapters that a seed fills, plus whatever a migration adds later.
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomFillSync } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Db } from '../data/d1.ts';
import type { D1Database, D1PreparedStatement, D1Result, SqlValue } from '../data/d1.ts';
import { fixedClock } from '../lib/time.ts';
import type { Clock } from '../lib/time.ts';
import type { Config } from '../env.ts';
import type { HandlerContext } from '../handlers/context.ts';
import type { SessionUser } from '../shared/types.ts';

const WORKER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(WORKER_ROOT, 'migrations');

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
   * the guard-and-flip ordering in `data/attempts.ts` is only correct if the
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

// --- The real schema --------------------------------------------------------

/**
 * Applies every migration, in filename order, with foreign keys ON.
 *
 * Foreign keys are enabled explicitly because D1 enables them by default and
 * `node:sqlite` does not: without this, a handler that writes a dangling
 * reference passes here and fails in production, which is the single most
 * expensive kind of test-environment difference there is.
 */
function applyMigrations(raw: DatabaseSync): void {
  raw.exec('PRAGMA foreign_keys = ON');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) throw new Error(`no migrations found in ${MIGRATIONS_DIR}`);
  for (const file of files) {
    raw.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
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
  // Google is deliberately unconfigured in the fixture, and unconfigured is
  // not the same as misconfigured -- see `requireGoogle`.
  googleConfigError: null,
  // 32+ chars, as `loadConfig` requires.
  permutationSecret: 'test-permutation-secret-0123456789abcdef',
  passwordIterations: 10_000,
  queryBudget: 45,
  isProduction: false,
  google: null,
};

/** The sub-chapters a chapter is divided into, as the official syllabus does. */
const SUBCHAPTERS_PER_CHAPTER = 6;

/**
 * `equal-chapter-weight-largest-remainder`, the rule
 * `frontend/src/data/examBlueprint.ts` publishes and
 * `db/seed/generate-reference-sql.mjs` implements.
 *
 * Reimplemented here rather than imported because the fixture needs it for an
 * arbitrary per-chapter quota, not just for 10. The assertion that it agrees
 * with the frontend lives in the generator; this is the same three lines.
 */
function largestRemainder(total: number, buckets: number): number[] {
  const base = Math.floor(total / buckets);
  const spare = total - base * buckets;
  return Array.from({ length: buckets }, (_, i) => base + (i < spare ? 1 : 0));
}

/** The real `questions.id` derivation: content, never position. */
function questionIdFor(payload: string): { id: string; hash: string } {
  const hash = createHash('sha256').update(payload, 'utf8').digest('hex');
  return { id: `q_${hash.slice(0, 16)}`, hash };
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A 12-character CSPRNG option key, exactly as the importer mints them.
 *
 * THE FIXTURE MUST NOT DERIVE THIS FROM THE ORDINAL. The whole point of the id
 * scheme in `migrations/0002_content.sql` is that an option id carries no
 * information about the authored slot; a fixture that quietly encoded one would
 * make every "no option id reaches a client" assertion in this suite a test of
 * nothing.
 */
function newOptionKey(): string {
  const bytes = randomFillSync(new Uint8Array(12));
  let out = '';
  for (let i = 0; i < 12; i++) out += B32[bytes[i] & 31];
  return out;
}

function insertUser(
  raw: DatabaseSync,
  user: { id: string; email: string | null; displayName: string; role: string; isAnonymous: boolean; now: number },
): void {
  // Two rows per user, as `data/auth.ts#createUser` writes them: the credential
  // in `users` and the display half in `user_profiles`, which physically holds
  // no credential column.
  raw
    .prepare(
      `INSERT INTO users (id, email, email_verified_at, password_hash, password_algo,
                          role, is_anonymous, status, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, NULL, ?, ?, 'active', ?, ?)`,
    )
    .run(user.id, user.email, user.role, user.isAnonymous ? 1 : 0, user.now, user.now);
  raw
    .prepare(
      `INSERT INTO user_profiles (user_id, display_name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(user.id, user.displayName, user.now, user.now);
}

export function createWorld(options: SeedOptions = {}): TestWorld {
  const chapterCount = options.chapters ?? 3;
  const perChapter = options.questionsPerChapter ?? 12;
  const quota = options.quotaPerChapter ?? 4;
  const durationMinutes = options.durationMinutes ?? 45;

  const raw = new DatabaseSync(':memory:');
  applyMigrations(raw);

  const questions: SeededQuestion[] = [];
  const chapterIds: string[] = [];

  // The fixture's chapters live under the subject 0007 already seeded, with
  // their own NEC codes and slugs so the unique indexes on both are satisfied
  // alongside the ten real ones.
  const SUBJECT = 'nec-computer';

  const insertChapter = raw.prepare(
    `INSERT INTO chapters (id, subject_id, nec_code, ordinal, slug, title, display_name,
                           short_name, description, color, icon, legacy_data_file, status,
                           created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '#000000', 'book', NULL, 'published', ?, ?)`,
  );
  const insertSubchapter = raw.prepare(
    `INSERT INTO subchapters (id, chapter_id, code, ordinal, title, description, status,
                              created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'published', ?, ?)`,
  );
  const insertQuestion = raw.prepare(
    `INSERT INTO questions (id, content_hash, subject_id, chapter_id, subchapter_id, stem,
                            stem_format, status, status_reason, status_changed_at,
                            difficulty, has_pinned_options, source, source_ref, legacy_id,
                            created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, 'plain', 'published', NULL, ?, 'medium', 0,
             'book-import', NULL, NULL, ?, ?)`,
  );
  const insertOption = raw.prepare(
    `INSERT INTO question_options (id, question_id, ordinal, opt_key, text, text_format,
                                   is_pinned, retired_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'plain', 0, NULL, ?, ?)`,
  );
  const insertKey = raw.prepare(
    `INSERT INTO question_answer_keys (question_id, correct_option_id, source,
                                       authored_index, authored_text, created_at, updated_at)
     VALUES (?, ?, 'import', ?, NULL, ?, ?)`,
  );

  const subchapterCodes: string[][] = [];

  for (let c = 1; c <= chapterCount; c++) {
    const chapterId = `ch${c}`;
    chapterIds.push(chapterId);
    insertChapter.run(
      chapterId,
      SUBJECT,
      `TEST${String(c).padStart(2, '0')}`,
      100 + c,
      `test-chapter-${c}`,
      `Test Chapter ${c}`,
      `Chapter ${c}`,
      `Ch${c}`,
      T0,
      T0,
    );

    const codes: string[] = [];
    for (let j = 1; j <= SUBCHAPTERS_PER_CHAPTER; j++) {
      const code = `9${c}.${j}`;
      codes.push(code);
      insertSubchapter.run(`test-${code}`, chapterId, code, j, `Topic ${code}`, T0, T0);
    }
    subchapterCodes.push(codes);

    for (let q = 1; q <= perChapter; q++) {
      const stem = `Stem ${chapterId} item ${q}`;
      const { id: questionId, hash } = questionIdFor(`${chapterId}${stem}`);
      insertQuestion.run(questionId, hash, SUBJECT, chapterId, stem, T0, T0, T0);

      // Option ids follow the REAL schema's convention,
      // `question_id || '#' || opt_key` with a 12-character CSPRNG key, so the
      // authored ordinal is NOT recoverable from the id. That is the property
      // `content-refs.test.ts` exists to hold, and seeding it any other way
      // would make that suite prove nothing.
      const optionIds: string[] = [];
      const bodies = new Map<string, string>();
      // Rotate which authored slot is correct, so a test that accidentally
      // depends on "slot 1 is always right" fails.
      const correctSlot = (q % 4) + 1;
      let correctOptionId = '';

      for (let o = 1; o <= 4; o++) {
        const optionId = `${questionId}#${newOptionKey()}`;
        const body = `${chapterId} q${q} choice ${o}`;
        insertOption.run(optionId, questionId, o, optionId.split('#')[1], body, T0, T0);
        optionIds.push(optionId);
        bodies.set(optionId, body);
        if (o === correctSlot) correctOptionId = optionId;
      }

      // The key lives in its own table, one row per question. `questions` and
      // `question_options` have no answer column at all.
      insertKey.run(questionId, correctOptionId, correctSlot, T0, T0);

      questions.push({ id: questionId, chapterId, stem, optionIds, correctOptionId, bodies });
    }
  }

  // A version-2, SUB-CHAPTER-LEVEL blueprint, split by the same
  // largest-remainder rule the real templates use. With no question carrying a
  // `subchapter_id`, every rule is satisfied from its chapter's pool -- which
  // is the production situation too, and the reason the fallback is exercised
  // by every test in this suite rather than by one.
  const quotas = largestRemainder(quota, SUBCHAPTERS_PER_CHAPTER);
  const rules = chapterIds.flatMap((chapterId, index) =>
    subchapterCodes[index].map((code, j) => ({
      chapter_id: chapterId,
      subchapter_code: code,
      count: quotas[j],
      difficulty: null,
      tag_ids: null,
    })),
  );
  const totalQuestions = rules.reduce((sum, r) => sum + r.count, 0);

  const templateId = 'tpl_main';
  raw
    .prepare(
      `INSERT INTO mock_test_templates (id, subject_id, slug, name, description,
                                        duration_minutes, total_questions, blueprint,
                                        selection, status, ordinal, created_by,
                                        created_at, updated_at)
       VALUES (?, ?, 'main', 'Full Mock', '', ?, ?, ?, 'random', 'published', 99, NULL, ?, ?)`,
    )
    .run(
      templateId,
      SUBJECT,
      durationMinutes,
      totalQuestions,
      JSON.stringify({
        version: 2,
        weighting_rule: 'equal-chapter-weight-largest-remainder',
        shuffle_options: true,
        negative_marking: 0,
        pass_mark_bp: 5000,
        strict_subchapter: false,
        rules,
      }),
      T0,
      T0,
    );

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
        // A synthetic session id. It is deliberately not a real `sessions` row:
        // these tests drive handlers directly, and the session lookup is
        // exercised by `auth.test.ts` through the real cookie path.
        auth: { user, sessionId: `ses_${user.id}` },
        meta: { ipHash: 'test-ip-hash', userAgent: 'node-test' },
        cookies: [],
      };
    },

    makeUser(overrides = {}) {
      userSeq += 1;
      const isAnonymous = overrides.isAnonymous ?? false;
      const user: SessionUser = {
        id: overrides.id ?? `usr_test_${userSeq}`,
        // A guest has no address, and the schema has a CHECK that says so.
        email: isAnonymous ? null : (overrides.email ?? `user${userSeq}@test.local`),
        displayName: overrides.displayName ?? `User ${userSeq}`,
        role: overrides.role ?? 'student',
        isAnonymous,
        hasPassword: overrides.hasPassword ?? !isAnonymous,
        createdAt: overrides.createdAt ?? T0,
      };
      insertUser(raw, {
        id: user.id,
        email: user.email,
        displayName: user.displayName ?? `User ${userSeq}`,
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
