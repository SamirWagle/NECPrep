/**
 * responseLog — the append-only, event-sourced record of every answer.
 *
 * WHY THIS EXISTS
 * ---------------
 * The legacy store (`eng_progress` in localStorage) is
 * `{[topicId]: {attempted: string[], correct: string[]}}` and `recordAttempt`
 * only ever *pushes* ids and dedupes them. Three consequences:
 *
 *   1. A question answered wrong and then right is "correct" forever. Reported
 *      accuracy is monotonically non-decreasing, so it is an upper bound that
 *      can never fall — i.e. it is inflated by construction.
 *   2. There are no response-level events at all: no timestamp, no chosen
 *      option, no latency. Adaptive practice, item calibration, forgetting
 *      curves and weak-area diagnosis are all impossible on that shape.
 *   3. Two devices cannot be merged, because a set-union of ids silently
 *      discards the history that would have resolved the conflict.
 *
 * This module stores one immutable record per response instead. Appending is
 * the only mutation (plus a destructive `clearAll` for an explicit reset), so
 * two devices merge by concatenating logs and deduping on `rid` — there is no
 * conflict to resolve. Every derived number (mastery, Elo, schedule, readiness)
 * is a pure fold over this log and can be recomputed from scratch at any time.
 *
 * STORAGE
 * -------
 * Raw IndexedDB, no Dexie. The store is injectable (`ResponseLogStore`) so the
 * pure logic and the jsdom test suite do not need a real IndexedDB.
 *
 * FAILURE POLICY
 * --------------
 * A dropped write is worse than a visible error: the log is the only source of
 * truth, so losing a record silently corrupts every derived statistic forever.
 * Every entry point therefore rejects with a typed {@link ResponseLogError}
 * carrying a machine-readable `code`, and nothing is ever swallowed. There is a
 * `createMemoryResponseLogStore()` the caller may *explicitly* fall back to, but
 * this module never installs it behind the caller's back.
 */

// ─── Record shape ─────────────────────────────────────────────────────────────

export const PRACTICE_MODES = [
  'topic',
  'quick',
  'custom',
  'mock',
  'review',
  'flashcard',
] as const;

export type PracticeMode = (typeof PRACTICE_MODES)[number];

/** Fields that `migrateLegacyProgress` is able to reconstruct but not observe. */
export const IMPUTED_FIELDS = [
  'ts',
  'chosenIndex',
  'latencyMs',
  'mode',
  'flaggedGuess',
  'subchapter',
] as const;

export type ImputedField = (typeof IMPUTED_FIELDS)[number];

export interface ResponseRecord {
  /** Response id. Globally unique; the merge key across devices. */
  rid: string;
  /** Question id, the `{topicId}_{index}` form minted by localData. */
  qid: string;
  /** Chapter id, e.g. `book-ch1`. */
  topicId: string;
  /** Sub-chapter id when the bank knows one; mastery falls back to `topicId`. */
  subchapter?: string;
  mode: PracticeMode;
  /** Groups the responses of one sitting (a mock attempt, a practice session). */
  attemptId?: string;
  /** Index into the question's presented options; `null` when not recorded. */
  chosenIndex: number | null;
  correct: boolean;
  /** Time from question shown to answer committed. */
  latencyMs: number;
  /** Learner (or heuristic) marked this answer as a guess. */
  flaggedGuess: boolean;
  /** Optional self-report, 1 = unsure … 3 = sure. Never required. */
  confidence?: 1 | 2 | 3;
  /** Epoch milliseconds. */
  ts: number;
  /**
   * Provenance. Absent means every field above was actually observed. Present
   * means the listed fields were reconstructed by a migration and must not be
   * treated as measurements.
   */
  imputed?: ImputedField[];
  /** Absent or `'live'` means the record came from a real answered question. */
  source?: 'live' | 'legacy-migration';
}

/** What a caller supplies; `rid` and `ts` are filled in when omitted. */
export type ResponseInput = Omit<ResponseRecord, 'rid' | 'ts'> & {
  rid?: string;
  ts?: number;
};

// ─── Schema ───────────────────────────────────────────────────────────────────

export const RESPONSE_LOG_DB_NAME = 'necprep-learner';
export const RESPONSE_LOG_STORE = 'responses';
/**
 * Schema version. Bump and extend `applyUpgrade` to add a store or an index.
 * An upgrade may never rewrite existing rows — the log is append-only, and a
 * migration that edits history would break cross-device merge by `rid`.
 */
export const RESPONSE_LOG_SCHEMA_VERSION = 1;

const INDEX_TS = 'ts';
const INDEX_TOPIC_TS = 'topicId_ts';
const INDEX_MODE = 'mode';
const INDEX_QID = 'qid';
const INDEX_ATTEMPT = 'attemptId';

/** IndexedDB's own numeric key bounds for dates; safe sentinels for ranges. */
const MIN_TS = -8.64e15;
const MAX_TS = 8.64e15;

// ─── Errors ───────────────────────────────────────────────────────────────────

export type ResponseLogErrorCode =
  /** No IndexedDB at all, or `open()` threw — Firefox private browsing does this. */
  | 'unavailable'
  /** The browser refused the write because the origin is out of disk quota. */
  | 'quota-exceeded'
  /** Another tab holds an older connection open, so the upgrade cannot run. */
  | 'blocked'
  /** The stored database is newer than this build's schema version. */
  | 'version-error'
  /** The transaction aborted for any other reason; the write did NOT land. */
  | 'aborted'
  /** Append was called with a record that violates the schema. */
  | 'invalid'
  /** A record with that `rid` already exists (the log is immutable). */
  | 'duplicate'
  | 'unknown';

export class ResponseLogError extends Error {
  readonly code: ResponseLogErrorCode;

  constructor(code: ResponseLogErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ResponseLogError';
    this.code = code;
  }
}

export function isResponseLogError(err: unknown): err is ResponseLogError {
  return err instanceof ResponseLogError;
}

function errorName(err: unknown): string {
  if (err instanceof Error) return err.name;
  if (typeof err === 'object' && err !== null && 'name' in err) {
    return String((err as { name: unknown }).name);
  }
  return '';
}

function isQuotaError(err: unknown): boolean {
  const name = errorName(err);
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

function wrapWriteError(err: unknown, what: string): ResponseLogError {
  if (isResponseLogError(err)) return err;
  if (isQuotaError(err)) {
    return new ResponseLogError(
      'quota-exceeded',
      `${what}: storage quota exceeded, the write did not land`,
      err,
    );
  }
  const name = errorName(err);
  if (name === 'ConstraintError') {
    return new ResponseLogError('duplicate', `${what}: a record with that rid already exists`, err);
  }
  if (name === 'AbortError' || name === 'TransactionInactiveError') {
    return new ResponseLogError('aborted', `${what}: transaction aborted, the write did not land`, err);
  }
  return new ResponseLogError('unknown', `${what}: ${name || 'unknown failure'}`, err);
}

// ─── Record construction and validation ───────────────────────────────────────

let ridCounter = 0;

export function makeRid(): string {
  const cryptoObj: Crypto | undefined = typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  ridCounter += 1;
  return `r-${Date.now().toString(36)}-${ridCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns a list of schema problems; empty means the record is well formed. */
export function validateResponse(record: ResponseRecord): string[] {
  const problems: string[] = [];
  if (!record.rid) problems.push('rid is required');
  if (!record.qid) problems.push('qid is required');
  if (!record.topicId) problems.push('topicId is required');
  if (!PRACTICE_MODES.includes(record.mode)) problems.push(`mode "${record.mode}" is not a PracticeMode`);
  if (typeof record.correct !== 'boolean') problems.push('correct must be a boolean');
  if (!Number.isFinite(record.ts)) problems.push('ts must be a finite epoch-ms number');
  if (!Number.isFinite(record.latencyMs) || record.latencyMs < 0) {
    problems.push('latencyMs must be a non-negative finite number');
  }
  if (record.chosenIndex !== null && !Number.isInteger(record.chosenIndex)) {
    problems.push('chosenIndex must be an integer or null');
  }
  if (typeof record.flaggedGuess !== 'boolean') problems.push('flaggedGuess must be a boolean');
  if (record.confidence !== undefined && ![1, 2, 3].includes(record.confidence)) {
    problems.push('confidence must be 1, 2 or 3 when present');
  }
  return problems;
}

/** Fills in `rid`/`ts`, validates, and freezes. Throws `invalid` on a bad record. */
export function createResponse(input: ResponseInput, now: number = Date.now()): ResponseRecord {
  const record: ResponseRecord = {
    ...input,
    rid: input.rid ?? makeRid(),
    ts: input.ts ?? now,
  };
  const problems = validateResponse(record);
  if (problems.length > 0) {
    throw new ResponseLogError('invalid', `invalid response record: ${problems.join('; ')}`);
  }
  return Object.freeze(record);
}

// ─── Query model ──────────────────────────────────────────────────────────────

export interface ResponseQuery {
  /** Inclusive lower bound on `ts`. */
  from?: number;
  /** Inclusive upper bound on `ts`. */
  to?: number;
  topicId?: string;
  subchapter?: string;
  mode?: PracticeMode;
  qid?: string;
  attemptId?: string;
  /** Drop records whose timestamps were imputed by a migration. */
  excludeImputedTs?: boolean;
  /** Max records returned. Applied after chronological ordering. */
  limit?: number;
  /** Chronological direction of the result. Default `'asc'`. */
  direction?: 'asc' | 'desc';
}

export function isTsImputed(record: ResponseRecord): boolean {
  return record.imputed?.includes('ts') ?? false;
}

/** Pure predicate shared by the IndexedDB and in-memory stores. */
export function matchesQuery(record: ResponseRecord, query: ResponseQuery = {}): boolean {
  if (query.from !== undefined && record.ts < query.from) return false;
  if (query.to !== undefined && record.ts > query.to) return false;
  if (query.topicId !== undefined && record.topicId !== query.topicId) return false;
  if (query.subchapter !== undefined && record.subchapter !== query.subchapter) return false;
  if (query.mode !== undefined && record.mode !== query.mode) return false;
  if (query.qid !== undefined && record.qid !== query.qid) return false;
  if (query.attemptId !== undefined && record.attemptId !== query.attemptId) return false;
  if (query.excludeImputedTs === true && isTsImputed(record)) return false;
  return true;
}

export type RangeSpec =
  | { kind: 'only'; value: IDBValidKey }
  | { kind: 'bound'; lower: IDBValidKey; upper: IDBValidKey };

export interface ScanPlan {
  /** Index to cursor over. */
  index: typeof INDEX_TS | typeof INDEX_TOPIC_TS | typeof INDEX_MODE | typeof INDEX_QID | typeof INDEX_ATTEMPT;
  range: RangeSpec | null;
  /**
   * True when the chosen index yields records in `ts` order, which is what lets
   * a limited query stop the cursor early instead of scanning the whole log.
   */
  chronological: boolean;
}

/**
 * Chooses the cheapest index for a query. Exported because it is pure and the
 * interesting part of query performance.
 */
export function planScan(query: ResponseQuery = {}): ScanPlan {
  if (query.qid !== undefined) {
    return { index: INDEX_QID, range: { kind: 'only', value: query.qid }, chronological: false };
  }
  if (query.attemptId !== undefined) {
    return { index: INDEX_ATTEMPT, range: { kind: 'only', value: query.attemptId }, chronological: false };
  }
  if (query.topicId !== undefined) {
    return {
      index: INDEX_TOPIC_TS,
      range: {
        kind: 'bound',
        lower: [query.topicId, query.from ?? MIN_TS],
        upper: [query.topicId, query.to ?? MAX_TS],
      },
      chronological: true,
    };
  }
  if (query.mode !== undefined) {
    return { index: INDEX_MODE, range: { kind: 'only', value: query.mode }, chronological: false };
  }
  if (query.from !== undefined || query.to !== undefined) {
    return {
      index: INDEX_TS,
      range: { kind: 'bound', lower: query.from ?? MIN_TS, upper: query.to ?? MAX_TS },
      chronological: true,
    };
  }
  return { index: INDEX_TS, range: null, chronological: true };
}

/**
 * Visitor for the cursor-based iterator. Return `false` to stop the walk, so a
 * caller can answer "did this learner ever see qid X" without materialising a
 * 50,000-record log.
 */
export type ResponseVisitor = (record: ResponseRecord, index: number) => boolean | void;

export interface AppendOptions {
  /**
   * Treat an existing `rid` as a no-op instead of an error. Needed for the
   * legacy migration (whose rids are deterministic) and for device merge.
   */
  skipDuplicates?: boolean;
}

export interface AppendManyResult {
  appended: number;
  duplicates: number;
}

export interface ResponseLogExport {
  schema: 'necprep-responselog-v1';
  dbVersion: number;
  exportedAt: string;
  count: number;
  records: ResponseRecord[];
}

export interface ResponseLogStore {
  readonly kind: 'indexeddb' | 'memory';
  append(input: ResponseInput): Promise<ResponseRecord>;
  appendMany(inputs: ResponseInput[], options?: AppendOptions): Promise<AppendManyResult>;
  /** Materialises the matching records, chronologically ordered. */
  query(query?: ResponseQuery): Promise<ResponseRecord[]>;
  /** Streams matching records through a cursor; returns how many were visited. */
  iterate(query: ResponseQuery | undefined, visit: ResponseVisitor): Promise<number>;
  count(query?: ResponseQuery): Promise<number>;
  exportAll(): Promise<ResponseLogExport>;
  /** Destructive. Only for an explicit "delete my data" action. */
  clearAll(): Promise<void>;
  close(): void;
}

// ─── Shared ordering helpers ──────────────────────────────────────────────────

function orderAndLimit(records: ResponseRecord[], query: ResponseQuery = {}): ResponseRecord[] {
  const sign = query.direction === 'desc' ? -1 : 1;
  const sorted = [...records].sort((a, b) => (a.ts === b.ts ? (a.rid < b.rid ? -1 : 1) * sign : (a.ts - b.ts) * sign));
  return query.limit !== undefined ? sorted.slice(0, Math.max(0, query.limit)) : sorted;
}

// ─── IndexedDB store ──────────────────────────────────────────────────────────

/**
 * The subset of `IDBKeyRange`'s static side this module uses. Injectable so a
 * test fake can supply plain `{lower, upper, lowerOpen, upperOpen}` objects —
 * jsdom ships no IndexedDB and therefore no `IDBKeyRange`.
 */
export interface KeyRangeFactory {
  only(value: IDBValidKey): IDBKeyRange;
  bound(lower: IDBValidKey, upper: IDBValidKey, lowerOpen?: boolean, upperOpen?: boolean): IDBKeyRange;
}

export interface IndexedDbStoreConfig {
  factory?: IDBFactory;
  keyRange?: KeyRangeFactory;
  dbName?: string;
  version?: number;
  /** How long to wait on a blocked upgrade before reporting `blocked`. */
  blockedTimeoutMs?: number;
}

function resolveFactory(config: IndexedDbStoreConfig): IDBFactory {
  const factory = config.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  if (!factory) {
    throw new ResponseLogError(
      'unavailable',
      'IndexedDB is not available in this context (private browsing, or a non-browser host)',
    );
  }
  return factory;
}

function resolveKeyRange(config: IndexedDbStoreConfig): KeyRangeFactory | null {
  if (config.keyRange) return config.keyRange;
  if (typeof IDBKeyRange === 'undefined') return null;
  return IDBKeyRange;
}

function toKeyRange(spec: RangeSpec | null, keyRange: KeyRangeFactory | null): IDBKeyRange | null {
  if (!spec || !keyRange) return null;
  return spec.kind === 'only' ? keyRange.only(spec.value) : keyRange.bound(spec.lower, spec.upper);
}

function applyUpgrade(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    const store = db.createObjectStore(RESPONSE_LOG_STORE, { keyPath: 'rid' });
    store.createIndex(INDEX_TS, 'ts');
    store.createIndex(INDEX_TOPIC_TS, ['topicId', 'ts']);
    store.createIndex(INDEX_MODE, 'mode');
    store.createIndex(INDEX_QID, 'qid');
    store.createIndex(INDEX_ATTEMPT, 'attemptId');
  }
  // Future versions add stores or indexes here. They must not rewrite rows:
  // the log is append-only and `rid` is the cross-device merge key.
}

function openDatabase(config: IndexedDbStoreConfig): Promise<IDBDatabase> {
  const factory = resolveFactory(config);
  const name = config.dbName ?? RESPONSE_LOG_DB_NAME;
  const version = config.version ?? RESPONSE_LOG_SCHEMA_VERSION;
  const blockedTimeoutMs = config.blockedTimeoutMs ?? 4000;

  return new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (blockedTimer !== null) clearTimeout(blockedTimer);
      fn();
    };

    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, version);
    } catch (err) {
      // Firefox in private browsing throws synchronously here rather than
      // returning a request that errors.
      reject(new ResponseLogError('unavailable', 'indexedDB.open() threw; storage is blocked', err));
      return;
    }

    request.onupgradeneeded = (event) => {
      try {
        applyUpgrade(request.result, event.oldVersion);
      } catch (err) {
        request.transaction?.abort();
        finish(() => reject(wrapWriteError(err, 'schema upgrade failed')));
      }
    };

    request.onblocked = () => {
      // Another tab still holds an older connection. Give it a moment to react
      // to `versionchange` and close; if it does not, the caller needs to know
      // rather than hang forever behind a pending promise.
      blockedTimer = setTimeout(() => {
        finish(() =>
          reject(
            new ResponseLogError(
              'blocked',
              'the database upgrade is blocked by another open tab; ask the user to close other tabs',
            ),
          ),
        );
      }, blockedTimeoutMs);
    };

    request.onsuccess = () => {
      const database = request.result;
      // If another tab later triggers an upgrade, release the connection so we
      // are not the tab that blocks it.
      database.onversionchange = () => database.close();
      if (settled) {
        // We already reported `blocked`; do not leak the late connection.
        database.close();
        return;
      }
      finish(() => resolve(database));
    };

    request.onerror = () => {
      const err = request.error;
      const code: ResponseLogErrorCode =
        errorName(err) === 'VersionError'
          ? 'version-error'
          : isQuotaError(err)
            ? 'quota-exceeded'
            : 'unavailable';
      finish(() =>
        reject(
          new ResponseLogError(
            code,
            code === 'version-error'
              ? `the stored database is newer than schema v${version}; this build cannot read it`
              : 'could not open IndexedDB',
            err,
          ),
        ),
      );
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(wrapWriteError(request.error, what));
  });
}

/**
 * IndexedDB-backed log. Lazily opens the database on first use so constructing
 * the store never throws; every method rejects with a {@link ResponseLogError}.
 */
export function createIndexedDbResponseLogStore(config: IndexedDbStoreConfig = {}): ResponseLogStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  let closed = false;

  const db = (): Promise<IDBDatabase> => {
    if (closed) {
      return Promise.reject(new ResponseLogError('unavailable', 'the response log store was closed'));
    }
    if (!dbPromise) {
      dbPromise = openDatabase(config).catch((err: unknown) => {
        // Do not cache a failed open: a quota or blocked failure is transient
        // and the next call should get a fresh attempt.
        dbPromise = null;
        throw isResponseLogError(err) ? err : wrapWriteError(err, 'open failed');
      });
    }
    return dbPromise;
  };

  const write = async (records: ResponseRecord[], options: AppendOptions): Promise<AppendManyResult> => {
    if (records.length === 0) return { appended: 0, duplicates: 0 };
    const database = await db();
    return new Promise<AppendManyResult>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = database.transaction(RESPONSE_LOG_STORE, 'readwrite');
      } catch (err) {
        reject(wrapWriteError(err, 'could not start a write transaction'));
        return;
      }
      let duplicates = 0;
      let firstError: unknown = null;

      tx.oncomplete = () => {
        if (firstError) {
          reject(wrapWriteError(firstError, 'append failed'));
          return;
        }
        resolve({ appended: records.length - duplicates, duplicates });
      };
      tx.onabort = () => reject(wrapWriteError(firstError ?? tx.error, 'append aborted; no record landed'));

      const store = tx.objectStore(RESPONSE_LOG_STORE);
      for (const record of records) {
        // `add`, never `put`: the log is immutable, so overwriting an existing
        // rid must be an error rather than a silent history rewrite.
        const request = store.add(record);
        request.onerror = (event) => {
          if (options.skipDuplicates === true && errorName(request.error) === 'ConstraintError') {
            duplicates += 1;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (!firstError) firstError = request.error;
        };
      }
    });
  };

  const walk = async (query: ResponseQuery | undefined, visit: ResponseVisitor): Promise<number> => {
    const database = await db();
    const plan = planScan(query);
    const keyRange = resolveKeyRange(config);
    const range = toKeyRange(plan.range, keyRange);
    const direction: IDBCursorDirection = query?.direction === 'desc' && plan.chronological ? 'prev' : 'next';

    return new Promise<number>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = database.transaction(RESPONSE_LOG_STORE, 'readonly');
      } catch (err) {
        reject(wrapWriteError(err, 'could not start a read transaction'));
        return;
      }
      let visited = 0;
      let stopped = false;
      let failure: unknown = null;

      tx.oncomplete = () => (failure ? reject(wrapWriteError(failure, 'iterate failed')) : resolve(visited));
      tx.onabort = () => reject(wrapWriteError(tx.error, 'iterate aborted'));

      const source = tx.objectStore(RESPONSE_LOG_STORE).index(plan.index);
      const request = source.openCursor(range, direction);
      request.onerror = () => {
        failure = request.error;
      };
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || stopped) return;
        const record = cursor.value as ResponseRecord;
        // The range already handles what it can; the rest of the predicate is
        // cheap and keeps one index sufficient for every query shape.
        if (matchesQuery(record, query)) {
          if (visit(record, visited) === false) {
            stopped = true;
            return;
          }
          visited += 1;
        }
        cursor.continue();
      };
    });
  };

  const runQuery = async (query: ResponseQuery = {}): Promise<ResponseRecord[]> => {
    const plan = planScan(query);
    const collected: ResponseRecord[] = [];
    // Only a chronological plan may stop early: on a qid/mode/attempt index the
    // cursor order is index-key order, so an early cut would return the wrong
    // subset once the caller asked for a limit.
    const canStopEarly = plan.chronological && query.limit !== undefined;
    await walk(query, (record, index) => {
      collected.push(record);
      if (canStopEarly && index + 1 >= (query.limit ?? 0)) return false;
      return true;
    });
    return orderAndLimit(collected, query);
  };

  return {
    kind: 'indexeddb',

    async append(input) {
      const record = createResponse(input);
      await write([record], {});
      return record;
    },

    async appendMany(inputs, options = {}) {
      const now = Date.now();
      const records = inputs.map((input) => createResponse(input, now));
      return write(records, options);
    },

    query(query = {}) {
      return runQuery(query);
    },

    iterate(query, visit) {
      return walk(query, visit);
    },

    async count(query = {}) {
      const database = await db();
      const isWholeStore = Object.keys(query).length === 0;
      if (isWholeStore) {
        const tx = database.transaction(RESPONSE_LOG_STORE, 'readonly');
        return requestToPromise(tx.objectStore(RESPONSE_LOG_STORE).count(), 'count failed');
      }
      let n = 0;
      await walk({ ...query, limit: undefined }, () => {
        n += 1;
      });
      return n;
    },

    async exportAll() {
      const records = await runQuery({});
      return {
        schema: 'necprep-responselog-v1',
        dbVersion: config.version ?? RESPONSE_LOG_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        count: records.length,
        records,
      };
    },

    async clearAll() {
      const database = await db();
      const tx = database.transaction(RESPONSE_LOG_STORE, 'readwrite');
      await requestToPromise(tx.objectStore(RESPONSE_LOG_STORE).clear(), 'clear failed');
    },

    close() {
      closed = true;
      const pending = dbPromise;
      dbPromise = null;
      if (pending) void pending.then((database) => database.close()).catch(() => undefined);
    },
  };
}

// ─── In-memory store ──────────────────────────────────────────────────────────

/**
 * Same contract, no persistence. Two uses, both deliberate:
 *   - tests, so the pure logic needs no IndexedDB fake;
 *   - an *explicit* caller-chosen fallback when `createIndexedDbResponseLogStore`
 *     reports `unavailable` and the product decides a session-only log beats no
 *     practice at all. This module never installs it silently.
 */
export function createMemoryResponseLogStore(seed: ResponseRecord[] = []): ResponseLogStore {
  const rows = new Map<string, ResponseRecord>();
  for (const record of seed) rows.set(record.rid, record);

  const all = (): ResponseRecord[] => [...rows.values()].sort((a, b) => a.ts - b.ts);

  const write = (records: ResponseRecord[], options: AppendOptions): AppendManyResult => {
    // Check before writing anything, so a rejected batch leaves no partial
    // state — matching the all-or-nothing IndexedDB transaction.
    if (options.skipDuplicates !== true) {
      const clash = records.find((record) => rows.has(record.rid));
      if (clash) {
        throw new ResponseLogError('duplicate', `rid ${clash.rid} already exists`);
      }
    }
    let duplicates = 0;
    for (const record of records) {
      if (rows.has(record.rid)) {
        duplicates += 1;
        continue;
      }
      rows.set(record.rid, record);
    }
    return { appended: records.length - duplicates, duplicates };
  };

  return {
    kind: 'memory',

    // Both of these report failure by rejecting, never by throwing
    // synchronously, so a caller's `.catch` is enough for either store.
    append(input) {
      try {
        const record = createResponse(input);
        write([record], {});
        return Promise.resolve(record);
      } catch (err) {
        return Promise.reject(err);
      }
    },

    appendMany(inputs, options = {}) {
      try {
        const now = Date.now();
        const records = inputs.map((input) => createResponse(input, now));
        return Promise.resolve(write(records, options));
      } catch (err) {
        return Promise.reject(err);
      }
    },

    query(query = {}) {
      return Promise.resolve(orderAndLimit(all().filter((r) => matchesQuery(r, query)), query));
    },

    iterate(query, visit) {
      const ordered = query?.direction === 'desc' ? all().reverse() : all();
      let visited = 0;
      for (const record of ordered) {
        if (!matchesQuery(record, query)) continue;
        if (visit(record, visited) === false) break;
        visited += 1;
      }
      return Promise.resolve(visited);
    },

    count(query = {}) {
      return Promise.resolve(all().filter((r) => matchesQuery(r, query)).length);
    },

    exportAll() {
      const records = all();
      return Promise.resolve({
        schema: 'necprep-responselog-v1' as const,
        dbVersion: RESPONSE_LOG_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        count: records.length,
        records,
      });
    },

    clearAll() {
      rows.clear();
      return Promise.resolve();
    },

    close() {
      /* nothing to release */
    },
  };
}

// ─── Default store (module singleton) ─────────────────────────────────────────

let defaultConfig: IndexedDbStoreConfig = {};
let defaultStore: ResponseLogStore | null = null;

/** Point the default store at a different factory/db name. Resets the singleton. */
export function configureResponseLog(config: IndexedDbStoreConfig): void {
  defaultConfig = config;
  defaultStore?.close();
  defaultStore = null;
}

/** Install a specific store (tests, or an explicit memory fallback). */
export function setResponseLogStore(store: ResponseLogStore | null): void {
  if (defaultStore && defaultStore !== store) defaultStore.close();
  defaultStore = store;
}

export function getResponseLogStore(): ResponseLogStore {
  if (!defaultStore) defaultStore = createIndexedDbResponseLogStore(defaultConfig);
  return defaultStore;
}

/**
 * Cheap availability probe so the UI can warn before the learner answers 40
 * questions into a log that cannot be written.
 */
export async function probeResponseLog(store: ResponseLogStore = getResponseLogStore()): Promise<
  { ok: true; count: number } | { ok: false; code: ResponseLogErrorCode; message: string }
> {
  try {
    return { ok: true, count: await store.count() };
  } catch (err) {
    const wrapped = isResponseLogError(err) ? err : wrapWriteError(err, 'probe failed');
    return { ok: false, code: wrapped.code, message: wrapped.message };
  }
}

export const appendResponse = (input: ResponseInput): Promise<ResponseRecord> =>
  getResponseLogStore().append(input);

export const appendResponses = (inputs: ResponseInput[], options?: AppendOptions): Promise<AppendManyResult> =>
  getResponseLogStore().appendMany(inputs, options);

export const queryResponses = (query?: ResponseQuery): Promise<ResponseRecord[]> =>
  getResponseLogStore().query(query);

export const iterateResponses = (query: ResponseQuery | undefined, visit: ResponseVisitor): Promise<number> =>
  getResponseLogStore().iterate(query, visit);

export const countResponses = (query?: ResponseQuery): Promise<number> =>
  getResponseLogStore().count(query);

export const exportResponseLog = (): Promise<ResponseLogExport> => getResponseLogStore().exportAll();

export const clearResponseLog = (): Promise<void> => getResponseLogStore().clearAll();

// ─── Legacy migration ─────────────────────────────────────────────────────────

export const LEGACY_PROGRESS_KEY = 'eng_progress';
export const LEGACY_HISTORY_KEY = 'eng_history';

/**
 * Imputed timestamps are backdated by this much rather than stamped "now".
 *
 * The legacy store never recorded when anything was answered. Stamping `now`
 * would hand every migrated record a recency weight of 1.0 in mastery.ts and
 * make a year-old half-remembered session look like this morning's practice.
 * 30 days is exactly one mastery half-life, so a migrated record carries weight
 * 0.5 — a deliberately discounted placeholder, flagged as imputed either way.
 */
export const LEGACY_TS_BACKDATE_DAYS = 30;

interface LegacyProgressEntry {
  attempted?: unknown;
  correct?: unknown;
}

export interface LegacyMigrationPlan {
  records: ResponseRecord[];
  /** Fields present on every migrated record that were reconstructed, not observed. */
  imputedFields: ImputedField[];
  stats: {
    topics: number;
    questions: number;
    markedCorrect: number;
    correctWithoutAttempt: number;
    legacyHistoryEntries: number;
  };
  /** Things the legacy shape cannot support, with the reason, rather than guesses. */
  skipped: Array<{ what: string; reason: string }>;
  warnings: string[];
}

interface LegacyMigrationOptions {
  storage?: Pick<Storage, 'getItem'>;
  now?: number;
  backdateDays?: number;
}

function readJson(storage: Pick<Storage, 'getItem'>, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function topicIdOfQid(qid: string, fallback: string): string {
  const cut = qid.lastIndexOf('_');
  return cut > 0 ? qid.slice(0, cut) : fallback;
}

/**
 * Pure half of the migration: reads the legacy localStorage shape and builds
 * response records, without touching IndexedDB.
 *
 * WHAT IS REAL AND WHAT IS NOT
 * ----------------------------
 * Real: the question id, the chapter id, and the fact that the question was
 * attempted. `correct` is as recorded — but see the warning below.
 *
 * Imputed on every record (listed in `record.imputed`):
 *   - `ts`          — never stored; backdated by one mastery half-life.
 *   - `chosenIndex` — never stored; emitted as `null`, never a guessed option.
 *   - `latencyMs`   — never stored; emitted as 0, which the scheduler must not
 *                     read as "answered instantly" (see `ratingFromOutcome`,
 *                     which ignores latency on imputed records).
 *   - `mode`        — the legacy store overloaded `topicId` across chapter
 *                     practice, mock tests and pseudo-ids like
 *                     `quick-practice`, so the real mode is unrecoverable;
 *                     emitted as `'topic'`.
 *   - `flaggedGuess`— never stored; emitted as `false`.
 *
 * Not migrated at all: `eng_history` rows (`{topicId, topicName, score, total,
 * date}`). They carry a score but no question ids, so turning them into
 * response records would mean inventing which questions were answered. They are
 * counted and reported, never fabricated.
 *
 * Known distortion: because `recordAttempt` only ever pushed ids, a question
 * answered wrong then right appears only as correct. Migrated accuracy is
 * therefore an upper bound, and the project owner has accepted a clean reset as
 * the alternative. This is a convenience, not a correctness guarantee.
 */
export function planLegacyMigration(options: LegacyMigrationOptions = {}): LegacyMigrationPlan {
  const storage = options.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  const now = options.now ?? Date.now();
  const backdateDays = options.backdateDays ?? LEGACY_TS_BACKDATE_DAYS;
  const imputedTs = now - backdateDays * 24 * 60 * 60 * 1000;
  const imputedFields: ImputedField[] = ['ts', 'chosenIndex', 'latencyMs', 'mode', 'flaggedGuess'];

  const empty: LegacyMigrationPlan = {
    records: [],
    imputedFields,
    stats: { topics: 0, questions: 0, markedCorrect: 0, correctWithoutAttempt: 0, legacyHistoryEntries: 0 },
    skipped: [],
    warnings: [],
  };
  if (!storage) {
    return { ...empty, warnings: ['no localStorage in this context; nothing to migrate'] };
  }

  const progressRaw = readJson(storage, LEGACY_PROGRESS_KEY);
  const historyRaw = readJson(storage, LEGACY_HISTORY_KEY);
  const legacyHistoryEntries = Array.isArray(historyRaw) ? historyRaw.length : 0;

  const warnings: string[] = [];
  const skipped: Array<{ what: string; reason: string }> = [];
  if (legacyHistoryEntries > 0) {
    skipped.push({
      what: `${legacyHistoryEntries} eng_history row(s)`,
      reason:
        'a history row stores only score/total/date and no question ids, so per-response records cannot be derived without inventing which questions were answered',
    });
  }

  if (progressRaw === null || typeof progressRaw !== 'object' || Array.isArray(progressRaw)) {
    return {
      ...empty,
      stats: { ...empty.stats, legacyHistoryEntries },
      skipped,
      warnings: [...warnings, 'eng_progress was missing or unreadable'],
    };
  }

  const records: ResponseRecord[] = [];
  let markedCorrect = 0;
  let correctWithoutAttempt = 0;
  let topics = 0;

  for (const [legacyTopicId, rawEntry] of Object.entries(progressRaw as Record<string, LegacyProgressEntry>)) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    topics += 1;
    const attempted = asStringArray(rawEntry.attempted);
    const correct = asStringArray(rawEntry.correct);
    const correctSet = new Set(correct);
    const seen = new Set(attempted);
    for (const qid of correct) {
      if (!seen.has(qid)) {
        correctWithoutAttempt += 1;
        seen.add(qid);
      }
    }

    for (const qid of seen) {
      const isCorrect = correctSet.has(qid);
      if (isCorrect) markedCorrect += 1;
      records.push(
        createResponse(
          {
            // Deterministic rid: re-running the migration appends nothing new,
            // because `add` reports the duplicate and `skipDuplicates` absorbs it.
            rid: `legacy:${legacyTopicId}:${qid}`,
            qid,
            // The legacy key was overloaded (chapter id / mock id / pseudo-id),
            // so prefer the chapter encoded in the question id itself.
            topicId: topicIdOfQid(qid, legacyTopicId),
            mode: 'topic',
            chosenIndex: null,
            correct: isCorrect,
            latencyMs: 0,
            flaggedGuess: false,
            ts: imputedTs,
            imputed: imputedFields,
            source: 'legacy-migration',
          },
          now,
        ),
      );
    }
  }

  if (records.length > 0) {
    warnings.push(
      'legacy `correct` is monotonic: a question answered wrong then right was stored as correct only, so migrated accuracy is an upper bound',
    );
    warnings.push(
      `every migrated record has imputed ${imputedFields.join(', ')}; chosenIndex is null and timestamps are backdated ${backdateDays} days`,
    );
  }
  if (correctWithoutAttempt > 0) {
    warnings.push(
      `${correctWithoutAttempt} question(s) appeared in \`correct\` but not in \`attempted\`; counted as attempted`,
    );
  }

  return {
    records,
    imputedFields,
    stats: { topics, questions: records.length, markedCorrect, correctWithoutAttempt, legacyHistoryEntries },
    skipped,
    warnings,
  };
}

export interface LegacyMigrationResult extends LegacyMigrationPlan {
  appended: number;
  duplicates: number;
}

/**
 * Converts `eng_progress` into response-log records and appends them.
 *
 * Idempotent: rids are deterministic, so a second run appends nothing. Best
 * effort by design — see {@link planLegacyMigration} for exactly which fields
 * are imputed and what is deliberately not migrated.
 */
export async function migrateLegacyProgress(
  options: LegacyMigrationOptions & { store?: ResponseLogStore } = {},
): Promise<LegacyMigrationResult> {
  const plan = planLegacyMigration(options);
  if (plan.records.length === 0) return { ...plan, appended: 0, duplicates: 0 };
  const store = options.store ?? getResponseLogStore();
  const { appended, duplicates } = await store.appendMany(plan.records, { skipDuplicates: true });
  return { ...plan, appended, duplicates };
}
