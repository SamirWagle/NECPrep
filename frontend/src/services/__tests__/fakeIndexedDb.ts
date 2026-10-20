/**
 * A minimal in-memory IndexedDB fake.
 *
 * jsdom ships no IndexedDB and no IDBKeyRange, so without this the IndexedDB
 * code path in responseLog.ts would be untested and only the in-memory store
 * would ever run. This implements exactly the surface responseLog uses — open
 * with an upgrade, readwrite/readonly transactions, `add` with a unique primary
 * key, `count`, `clear`, and index cursors over a key range — plus switches to
 * reproduce the three real-world failures: open throwing (private browsing),
 * a blocked upgrade, and quota exhaustion mid-write.
 *
 * Not a general-purpose polyfill. It is deliberately small enough to read.
 */

import type { KeyRangeFactory } from '../responseLog';

type Row = Record<string, unknown>;
type Handler = ((event: unknown) => void) | null;

interface RangeLike {
  lower?: IDBValidKey;
  upper?: IDBValidKey;
  lowerOpen?: boolean;
  upperOpen?: boolean;
}

/** `IDBKeyRange`-shaped values the fake's cursors understand. */
export const fakeKeyRange: KeyRangeFactory = {
  only: (value) =>
    ({ lower: value, upper: value, lowerOpen: false, upperOpen: false }) as unknown as IDBKeyRange,
  bound: (lower, upper, lowerOpen = false, upperOpen = false) =>
    ({ lower, upper, lowerOpen, upperOpen }) as unknown as IDBKeyRange,
};

function fakeError(name: string, message = name): DOMException {
  return { name, message } as unknown as DOMException;
}

function typeRank(key: IDBValidKey): number {
  if (typeof key === 'number') return 0;
  if (typeof key === 'string') return 1;
  return 2; // array
}

/** IndexedDB key ordering: numbers < strings < arrays, arrays element-wise. */
export function compareKeys(a: IDBValidKey, b: IDBValidKey): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return (a as number) - (b as number);
  if (ra === 1) return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
  const arrA = a as IDBValidKey[];
  const arrB = b as IDBValidKey[];
  for (let i = 0; i < Math.min(arrA.length, arrB.length); i += 1) {
    const cmp = compareKeys(arrA[i], arrB[i]);
    if (cmp !== 0) return cmp;
  }
  return arrA.length - arrB.length;
}

function inRange(key: IDBValidKey, range: RangeLike | null): boolean {
  if (!range) return true;
  if (range.lower !== undefined) {
    const cmp = compareKeys(key, range.lower);
    if (cmp < 0 || (cmp === 0 && range.lowerOpen === true)) return false;
  }
  if (range.upper !== undefined) {
    const cmp = compareKeys(key, range.upper);
    if (cmp > 0 || (cmp === 0 && range.upperOpen === true)) return false;
  }
  return true;
}

function extractKey(row: Row, keyPath: string | string[]): IDBValidKey {
  if (Array.isArray(keyPath)) return keyPath.map((path) => row[path] as IDBValidKey);
  return row[keyPath] as IDBValidKey;
}

interface StoreMeta {
  keyPath: string;
  indexes: Map<string, string | string[]>;
  rows: Map<string, Row>;
}

interface Task {
  (): void;
}

export interface FakeIndexedDbOptions {
  /** `open()` throws synchronously, as Firefox private browsing does. */
  throwOnOpen?: boolean;
  /** `open()` reports a VersionError. */
  versionError?: boolean;
  /** `open()` fires `onblocked` and never completes. */
  blockOpen?: boolean;
  /** Reject writes with QuotaExceededError once the store holds this many rows. */
  quotaRowLimit?: number;
}

class FakeTransaction {
  readonly mode: IDBTransactionMode;
  error: DOMException | null = null;
  oncomplete: Handler = null;
  onabort: Handler = null;
  onerror: Handler = null;
  private readonly queue: Task[] = [];
  private aborted = false;
  private finished = false;
  private readonly db: FakeDatabase;

  constructor(db: FakeDatabase, mode: IDBTransactionMode) {
    this.db = db;
    this.mode = mode;
    this.drain();
  }

  push(task: Task): void {
    this.queue.push(task);
  }

  abortWith(error: DOMException | null): void {
    if (this.aborted || this.finished) return;
    this.aborted = true;
    this.error = error;
    this.onabort?.({});
  }

  abort(): void {
    this.abortWith(fakeError('AbortError'));
  }

  objectStore(name: string): IDBObjectStore {
    const meta = this.db.stores.get(name);
    if (!meta) throw fakeError('NotFoundError', `no object store ${name}`);
    return makeObjectStore(this, this.db, meta) as unknown as IDBObjectStore;
  }

  private drain(): void {
    queueMicrotask(() => {
      if (this.aborted || this.finished) return;
      const task = this.queue.shift();
      if (!task) {
        this.finished = true;
        this.oncomplete?.({});
        return;
      }
      task();
      this.drain();
    });
  }
}

interface FakeRequest {
  result: unknown;
  error: DOMException | null;
  onsuccess: Handler;
  onerror: Handler;
}

function makeRequest(): FakeRequest {
  return { result: undefined, error: null, onsuccess: null, onerror: null };
}

function makeObjectStore(tx: FakeTransaction, db: FakeDatabase, meta: StoreMeta) {
  const orderedRows = (): Row[] => [...meta.rows.values()];

  return {
    add(value: Row) {
      const request = makeRequest();
      tx.push(() => {
        const key = String(extractKey(value, meta.keyPath));
        if (db.options.quotaRowLimit !== undefined && meta.rows.size >= db.options.quotaRowLimit) {
          request.error = fakeError('QuotaExceededError', 'simulated quota exhaustion');
          let prevented = false;
          request.onerror?.({ preventDefault: () => (prevented = true), stopPropagation: () => undefined });
          if (!prevented) tx.abortWith(request.error);
          return;
        }
        if (meta.rows.has(key)) {
          request.error = fakeError('ConstraintError', `key ${key} already exists`);
          let prevented = false;
          request.onerror?.({ preventDefault: () => (prevented = true), stopPropagation: () => undefined });
          if (!prevented) tx.abortWith(request.error);
          return;
        }
        meta.rows.set(key, { ...value });
        request.result = key;
        request.onsuccess?.({});
      });
      return request as unknown as IDBRequest<IDBValidKey>;
    },

    count() {
      const request = makeRequest();
      tx.push(() => {
        request.result = meta.rows.size;
        request.onsuccess?.({});
      });
      return request as unknown as IDBRequest<number>;
    },

    clear() {
      const request = makeRequest();
      tx.push(() => {
        meta.rows.clear();
        request.result = undefined;
        request.onsuccess?.({});
      });
      return request as unknown as IDBRequest<undefined>;
    },

    createIndex(name: string, keyPath: string | string[]) {
      meta.indexes.set(name, keyPath);
      return {} as unknown as IDBIndex;
    },

    index(name: string) {
      const keyPath = meta.indexes.get(name);
      if (!keyPath) throw fakeError('NotFoundError', `no index ${name}`);
      return {
        openCursor(range?: IDBKeyRange | null, direction: IDBCursorDirection = 'next') {
          const request = makeRequest();
          const entries = orderedRows()
            .map((row) => ({ row, key: extractKey(row, keyPath), primary: String(extractKey(row, meta.keyPath)) }))
            // Rows missing the index key are absent from a real index too.
            .filter((entry) => entry.key !== undefined && entry.key !== null)
            .filter((entry) => inRange(entry.key, (range ?? null) as RangeLike | null))
            .sort((a, b) => compareKeys(a.key, b.key) || (a.primary < b.primary ? -1 : 1));
          const ordered = direction === 'prev' ? entries.reverse() : entries;

          const step = (i: number): Task => () => {
            if (i >= ordered.length) {
              request.result = null;
              request.onsuccess?.({});
              return;
            }
            request.result = {
              value: ordered[i].row,
              key: ordered[i].key,
              primaryKey: ordered[i].primary,
              continue: () => tx.push(step(i + 1)),
            };
            request.onsuccess?.({});
          };
          tx.push(step(0));
          return request as unknown as IDBRequest<IDBCursorWithValue | null>;
        },
      } as unknown as IDBIndex;
    },
  };
}

class FakeDatabase {
  readonly name: string;
  version: number;
  readonly stores = new Map<string, StoreMeta>();
  readonly options: FakeIndexedDbOptions;
  onversionchange: Handler = null;
  closed = false;

  constructor(name: string, version: number, options: FakeIndexedDbOptions) {
    this.name = name;
    this.version = version;
    this.options = options;
  }

  createObjectStore(name: string, params: { keyPath: string }): IDBObjectStore {
    const meta: StoreMeta = { keyPath: params.keyPath, indexes: new Map(), rows: new Map() };
    this.stores.set(name, meta);
    const tx = new FakeTransaction(this, 'versionchange');
    return makeObjectStore(tx, this, meta) as unknown as IDBObjectStore;
  }

  transaction(_name: string, mode: IDBTransactionMode = 'readonly'): IDBTransaction {
    if (this.closed) throw fakeError('InvalidStateError', 'database closed');
    return new FakeTransaction(this, mode) as unknown as IDBTransaction;
  }

  close(): void {
    this.closed = true;
  }
}

/**
 * Creates an `IDBFactory`-compatible fake plus its matching key-range factory.
 * Pass both into `createIndexedDbResponseLogStore({ factory, keyRange })`.
 */
export function createFakeIndexedDb(options: FakeIndexedDbOptions = {}): {
  factory: IDBFactory;
  keyRange: KeyRangeFactory;
  /** Row counts per store, for assertions that bypass the public API. */
  inspect(): Map<string, number>;
} {
  const databases = new Map<string, FakeDatabase>();

  const factory = {
    open(name: string, version = 1) {
      if (options.throwOnOpen === true) {
        throw fakeError('InvalidStateError', 'storage is blocked in this context');
      }
      const request = {
        result: undefined as unknown,
        error: null as DOMException | null,
        transaction: null as unknown,
        onsuccess: null as Handler,
        onerror: null as Handler,
        onblocked: null as Handler,
        onupgradeneeded: null as Handler,
      };

      queueMicrotask(() => {
        if (options.versionError === true) {
          request.error = fakeError('VersionError', 'stored database is newer');
          request.onerror?.({});
          return;
        }
        if (options.blockOpen === true) {
          request.onblocked?.({});
          return;
        }
        const existing = databases.get(name);
        const db = existing ?? new FakeDatabase(name, 0, options);
        if (!existing) databases.set(name, db);
        const oldVersion = db.version;
        if (version > oldVersion) {
          db.version = version;
          request.result = db as unknown as IDBDatabase;
          request.onupgradeneeded?.({ oldVersion, newVersion: version });
        }
        request.result = db as unknown as IDBDatabase;
        request.onsuccess?.({});
      });

      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  return {
    factory,
    keyRange: fakeKeyRange,
    inspect() {
      const counts = new Map<string, number>();
      for (const db of databases.values()) {
        for (const [storeName, meta] of db.stores) counts.set(storeName, meta.rows.size);
      }
      return counts;
    },
  };
}
