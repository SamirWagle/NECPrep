/**
 * ADAPTER BOUNDARY - the only place that knows what a D1 handle looks like.
 *
 * `@cloudflare/workers-types` is not a dependency of this directory (the Worker
 * package manifest is owned elsewhere), so the slice of the D1 API this codebase
 * actually uses is declared here. It is structurally compatible with the real
 * `D1Database`, so a Worker can pass `env.DB` straight in, and the test harness
 * can pass a `node:sqlite` shim that implements the same four methods.
 *
 * Everything above this file talks to `Db`, never to `D1Database` directly.
 */

export type SqlValue = string | number | null | ArrayBuffer;

export interface D1Meta {
  changes: number;
  last_row_id: number;
  rows_read?: number;
  rows_written?: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: SqlValue[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
}

/** A statement queued for a `batch()`. */
export interface PendingStatement {
  sql: string;
  binds: SqlValue[];
}

export function sql(query: string, ...binds: SqlValue[]): PendingStatement {
  return { sql: query, binds };
}

/**
 * Raised when a single Worker invocation tries to spend more D1 queries than
 * the plan allows.
 *
 * D1 Free permits 50 queries per invocation (1,000 on the $5/mo plan) and the
 * budget is enforced here rather than discovered in production: an accidental
 * N+1 inside a handler fails the request - and the test suite - instead of
 * quietly working on a ten-question paper and blowing up on a hundred-question
 * one.
 */
export class QueryBudgetExceeded extends Error {
  // Written out rather than declared as constructor parameter properties:
  // those are not erasable syntax, so neither Node's type stripping nor the
  // frontend's `erasableSyntaxOnly` tsconfig will accept them.
  readonly spent: number;
  readonly budget: number;
  readonly lastSql: string;

  constructor(spent: number, budget: number, lastSql: string) {
    super(
      `D1 query budget exceeded: ${spent} > ${budget}. ` +
        `Last statement: ${lastSql.slice(0, 160)}`,
    );
    this.name = 'QueryBudgetExceeded';
    this.spent = spent;
    this.budget = budget;
    this.lastSql = lastSql;
  }
}

/** D1 refuses more than 100 bound parameters in one statement. */
export const D1_MAX_BOUND_PARAMS = 100;

export class TooManyBoundParams extends Error {
  constructor(count: number, query: string) {
    super(
      `Statement binds ${count} parameters, D1 allows ` +
        `${D1_MAX_BOUND_PARAMS}. Pass the payload as a single JSON parameter ` +
        `and expand it with json_each(). Statement: ${query.slice(0, 160)}`,
    );
    this.name = 'TooManyBoundParams';
  }
}

export interface DbOptions {
  /** Queries allowed for this invocation. Default 45, under the free cap of 50. */
  budget?: number;
}

/**
 * Query-counting facade over a D1 handle.
 *
 * Every data-access function in `worker/src/data/` takes one of these, so the
 * cost of a request is a measured number rather than an estimate. Handlers
 * report it on the `X-D1-Queries` response header and the tests assert that the
 * expensive endpoints are O(1) in the size of the paper.
 */
export class Db {
  #inner: D1Database;
  #spent = 0;
  #budget: number;

  constructor(inner: D1Database, options: DbOptions = {}) {
    this.#inner = inner;
    this.#budget = options.budget ?? 45;
  }

  /** Statements executed so far in this invocation. */
  get queryCount(): number {
    return this.#spent;
  }

  get budget(): number {
    return this.#budget;
  }

  #spend(n: number, query: string): void {
    this.#spent += n;
    if (this.#spent > this.#budget) {
      throw new QueryBudgetExceeded(this.#spent, this.#budget, query);
    }
  }

  #prepare(query: string, binds: SqlValue[]): D1PreparedStatement {
    if (binds.length > D1_MAX_BOUND_PARAMS) {
      throw new TooManyBoundParams(binds.length, query);
    }
    const stmt = this.#inner.prepare(query);
    return binds.length > 0 ? stmt.bind(...binds) : stmt;
  }

  async first<T>(query: string, ...binds: SqlValue[]): Promise<T | null> {
    this.#spend(1, query);
    return await this.#prepare(query, binds).first<T>();
  }

  async all<T>(query: string, ...binds: SqlValue[]): Promise<T[]> {
    this.#spend(1, query);
    const res = await this.#prepare(query, binds).all<T>();
    return res.results;
  }

  async run(query: string, ...binds: SqlValue[]): Promise<D1Meta> {
    this.#spend(1, query);
    const res = await this.#prepare(query, binds).run();
    return res.meta;
  }

  /**
   * One round trip, N statements, implicitly transactional in D1.
   *
   * D1 is single-threaded per database and has no interactive transactions, so
   * this is the only atomic write primitive available. Every multi-row write in
   * this codebase goes through here.
   */
  async batch<T = Record<string, unknown>>(
    statements: PendingStatement[],
  ): Promise<D1Result<T>[]> {
    if (statements.length === 0) return [];
    this.#spend(statements.length, statements[0].sql);
    return await this.#inner.batch<T>(
      statements.map((s) => this.#prepare(s.sql, s.binds)),
    );
  }
}
