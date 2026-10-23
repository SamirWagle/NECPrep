import { describe, it, expect } from 'vitest';
import { createFakeIndexedDb } from './fakeIndexedDb';
import {
  LEGACY_HISTORY_KEY,
  LEGACY_PROGRESS_KEY,
  LEGACY_TS_BACKDATE_DAYS,
  createIndexedDbResponseLogStore,
  createMemoryResponseLogStore,
  createResponse,
  isResponseLogError,
  matchesQuery,
  migrateLegacyProgress,
  planLegacyMigration,
  planScan,
  probeResponseLog,
  validateResponse,
} from '../responseLog';
import type { ResponseInput, ResponseLogStore } from '../responseLog';

const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function input(overrides: Partial<ResponseInput> = {}): ResponseInput {
  return {
    qid: 'book-ch1_1',
    topicId: 'book-ch1',
    mode: 'topic',
    chosenIndex: 1,
    correct: true,
    latencyMs: 5000,
    flaggedGuess: false,
    ts: T0,
    ...overrides,
  };
}

function idbStore(options: Parameters<typeof createFakeIndexedDb>[0] = {}): ResponseLogStore {
  const { factory, keyRange } = createFakeIndexedDb(options);
  return createIndexedDbResponseLogStore({ factory, keyRange, blockedTimeoutMs: 10 });
}

async function seed(store: ResponseLogStore): Promise<void> {
  await store.appendMany([
    input({ rid: 'a', qid: 'book-ch1_1', topicId: 'book-ch1', ts: T0, mode: 'topic' }),
    input({ rid: 'b', qid: 'book-ch1_2', topicId: 'book-ch1', ts: T0 + DAY, mode: 'quick', correct: false }),
    input({ rid: 'c', qid: 'book-ch2_5', topicId: 'book-ch2', ts: T0 + 2 * DAY, mode: 'mock' }),
    input({ rid: 'd', qid: 'book-ch2_6', topicId: 'book-ch2', ts: T0 + 3 * DAY, mode: 'topic', correct: false }),
    input({ rid: 'e', qid: 'book-ch1_1', topicId: 'book-ch1', ts: T0 + 4 * DAY, mode: 'review' }),
  ]);
}

describe('record shape', () => {
  it('rejects a record that violates the schema instead of storing it', () => {
    expect(() => createResponse(input({ qid: '' }))).toThrowError(/qid is required/);
    expect(() => createResponse(input({ latencyMs: -1 }))).toThrowError(/latencyMs/);
    // `mode` is a closed union; an overloaded pseudo-id like the legacy
    // `quick-practice` must not sneak in as a mode.
    expect(() =>
      createResponse(input({ mode: 'quick-practice' as unknown as ResponseInput['mode'] })),
    ).toThrowError(/not a PracticeMode/);
  });

  it('accepts a null chosenIndex, which is how "not recorded" is expressed', () => {
    const record = createResponse(input({ chosenIndex: null }));
    expect(validateResponse(record)).toEqual([]);
    expect(record.chosenIndex).toBeNull();
  });

  it('mints a rid and freezes the record, so the log cannot be edited in place', () => {
    const record = createResponse(input({ rid: undefined }));
    expect(record.rid).toBeTruthy();
    expect(Object.isFrozen(record)).toBe(true);
  });
});

describe('query planning', () => {
  it('picks the narrowest index available', () => {
    expect(planScan({ qid: 'book-ch1_1' })).toMatchObject({ index: 'qid', chronological: false });
    expect(planScan({ attemptId: 'att-1' })).toMatchObject({ index: 'attemptId', chronological: false });
    expect(planScan({ mode: 'mock' })).toMatchObject({ index: 'mode', chronological: false });
    expect(planScan({ from: 1, to: 2 })).toMatchObject({ index: 'ts', chronological: true });
    expect(planScan({})).toMatchObject({ index: 'ts', range: null, chronological: true });
  });

  it('bounds a topic query by [topicId, ts] so a time window does not scan the chapter', () => {
    const plan = planScan({ topicId: 'book-ch1', from: 10, to: 20 });
    expect(plan.index).toBe('topicId_ts');
    expect(plan.range).toEqual({ kind: 'bound', lower: ['book-ch1', 10], upper: ['book-ch1', 20] });
  });

  it('matchesQuery is the single source of truth for both stores', () => {
    const record = createResponse(input({ rid: 'x', imputed: ['ts'] }));
    expect(matchesQuery(record, { topicId: 'book-ch1' })).toBe(true);
    expect(matchesQuery(record, { topicId: 'book-ch2' })).toBe(false);
    expect(matchesQuery(record, { excludeImputedTs: true })).toBe(false);
  });
});

/**
 * Both stores must behave identically — that is the contract that lets the rest
 * of the model be tested without IndexedDB.
 */
function storeContract(name: string, make: () => ResponseLogStore): void {
  describe(`${name} store`, () => {
  it('appends and reads back chronologically', async () => {
    const store = make();
    await seed(store);
    const all = await store.query();
    expect(all.map((r) => r.rid)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(await store.count()).toBe(5);
  });

  it('filters by topic, mode, qid and time window', async () => {
    const store = make();
    await seed(store);
    expect((await store.query({ topicId: 'book-ch1' })).map((r) => r.rid)).toEqual(['a', 'b', 'e']);
    expect((await store.query({ mode: 'mock' })).map((r) => r.rid)).toEqual(['c']);
    expect((await store.query({ qid: 'book-ch1_1' })).map((r) => r.rid)).toEqual(['a', 'e']);
    expect((await store.query({ from: T0 + DAY, to: T0 + 2 * DAY })).map((r) => r.rid)).toEqual(['b', 'c']);
    expect(await store.count({ topicId: 'book-ch2' })).toBe(2);
  });

  it('honours direction and limit', async () => {
    const store = make();
    await seed(store);
    expect((await store.query({ direction: 'desc', limit: 2 })).map((r) => r.rid)).toEqual(['e', 'd']);
  });

  it('streams through a cursor and stops early when the visitor says so', async () => {
    const store = make();
    await seed(store);
    const seen: string[] = [];
    const visited = await store.iterate({ topicId: 'book-ch1' }, (record) => {
      seen.push(record.rid);
      return false; // answer "has this learner ever touched ch1" without materialising it
    });
    expect(seen).toEqual(['a']);
    expect(visited).toBe(0);

    const allSeen: string[] = [];
    await store.iterate(undefined, (record) => {
      allSeen.push(record.rid);
    });
    expect(allSeen).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('treats a repeated rid as an error, because the log is immutable', async () => {
    const store = make();
    await store.append(input({ rid: 'dup' }));
    await expect(store.append(input({ rid: 'dup', correct: false }))).rejects.toMatchObject({
      code: 'duplicate',
    });
    // The original must survive: an append may never rewrite history.
    expect((await store.query({}))[0].correct).toBe(true);
  });

  it('absorbs duplicates when asked, which is what makes a device merge idempotent', async () => {
    const store = make();
    await store.appendMany([input({ rid: 'x' })]);
    const result = await store.appendMany([input({ rid: 'x' }), input({ rid: 'y' })], { skipDuplicates: true });
    expect(result).toEqual({ appended: 1, duplicates: 1 });
    expect(await store.count()).toBe(2);
  });

  it('exports every record with a schema tag', async () => {
    const store = make();
    await seed(store);
    const dump = await store.exportAll();
    expect(dump.schema).toBe('necprep-responselog-v1');
    expect(dump.count).toBe(5);
    expect(dump.records).toHaveLength(5);
  });

  it('clears on an explicit reset', async () => {
    const store = make();
    await seed(store);
    await store.clearAll();
    expect(await store.count()).toBe(0);
  });
  });
}

storeContract('indexeddb', () => idbStore());
storeContract('memory', () => createMemoryResponseLogStore());

describe('IndexedDB failure modes', () => {
  it('reports `unavailable` when open() throws (private browsing)', async () => {
    const store = idbStore({ throwOnOpen: true });
    await expect(store.append(input())).rejects.toMatchObject({ code: 'unavailable' });
    const probe = await probeResponseLog(store);
    expect(probe).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('reports `unavailable` when there is no IndexedDB at all', async () => {
    const store = createIndexedDbResponseLogStore({ factory: undefined, keyRange: undefined });
    const probe = await probeResponseLog(store);
    // jsdom provides no indexedDB, so this is the real private-browsing path.
    expect(probe).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('reports `version-error` when the stored database is newer than this build', async () => {
    const store = idbStore({ versionError: true });
    await expect(store.count()).rejects.toMatchObject({ code: 'version-error' });
  });

  it('reports `blocked` when another tab holds the old version open', async () => {
    const store = idbStore({ blockOpen: true });
    await expect(store.count()).rejects.toMatchObject({ code: 'blocked' });
  });

  it('reports `quota-exceeded` and never pretends the write landed', async () => {
    const store = idbStore({ quotaRowLimit: 2 });
    await store.append(input({ rid: '1' }));
    await store.append(input({ rid: '2' }));
    const failure = await store.append(input({ rid: '3' })).catch((err: unknown) => err);
    expect(isResponseLogError(failure) && failure.code).toBe('quota-exceeded');
    // The whole transaction aborted, so the log still holds exactly two rows.
    expect(await store.count()).toBe(2);
  });

  it('retries the open after a transient failure instead of caching it', async () => {
    const fake = createFakeIndexedDb({ blockOpen: true });
    const store = createIndexedDbResponseLogStore({
      factory: fake.factory,
      keyRange: fake.keyRange,
      blockedTimeoutMs: 5,
    });
    await expect(store.count()).rejects.toMatchObject({ code: 'blocked' });
    await expect(store.count()).rejects.toMatchObject({ code: 'blocked' });
  });
});

// ─── Legacy migration ─────────────────────────────────────────────────────────

function legacyStorage(progress: unknown, history: unknown): Pick<Storage, 'getItem'> {
  const entries: Record<string, string> = {};
  if (progress !== undefined) entries[LEGACY_PROGRESS_KEY] = JSON.stringify(progress);
  if (history !== undefined) entries[LEGACY_HISTORY_KEY] = JSON.stringify(history);
  return { getItem: (key: string) => entries[key] ?? null };
}

const LEGACY_PROGRESS = {
  'book-ch1': { attempted: ['book-ch1_0', 'book-ch1_1', 'book-ch1_2'], correct: ['book-ch1_1'] },
  'quick-practice': { attempted: ['book-ch2_7'], correct: ['book-ch2_7', 'book-ch2_8'] },
};

const LEGACY_HISTORY = [
  { topicId: 'full-mock-1', topicName: 'Full Mock Test 1', score: 42, total: 100, date: '2025-11-02' },
  { topicId: 'book-ch3', topicName: 'Chapter 3', score: 7, total: 10, date: '2025-11-03' },
];

describe('migrateLegacyProgress', () => {
  it('marks every reconstructed field as imputed and never invents a chosen option', () => {
    const plan = planLegacyMigration({
      storage: legacyStorage(LEGACY_PROGRESS, LEGACY_HISTORY),
      now: T0,
    });

    expect(plan.records).toHaveLength(5);
    expect(plan.imputedFields).toEqual(['ts', 'chosenIndex', 'latencyMs', 'mode', 'flaggedGuess']);

    for (const record of plan.records) {
      expect(record.source).toBe('legacy-migration');
      // The legacy store recorded which questions were answered, never which
      // option was picked, so this must stay null rather than become a guess.
      expect(record.chosenIndex).toBeNull();
      expect(record.imputed).toEqual(['ts', 'chosenIndex', 'latencyMs', 'mode', 'flaggedGuess']);
      expect(record.latencyMs).toBe(0);
      expect(record.flaggedGuess).toBe(false);
      // Timestamps were never stored, so they are backdated one mastery
      // half-life rather than stamped "now".
      expect(record.ts).toBe(T0 - LEGACY_TS_BACKDATE_DAYS * DAY);
    }
  });

  it('recovers the real chapter from the question id, not the overloaded legacy key', () => {
    const plan = planLegacyMigration({ storage: legacyStorage(LEGACY_PROGRESS, undefined), now: T0 });
    const migrated = plan.records.filter((record) => record.qid.startsWith('book-ch2_'));
    // These sat under the pseudo-id `quick-practice` in the legacy store.
    expect(migrated.map((record) => record.topicId)).toEqual(['book-ch2', 'book-ch2']);
  });

  it('carries the correct/incorrect split across, and warns that it is an upper bound', () => {
    const plan = planLegacyMigration({ storage: legacyStorage(LEGACY_PROGRESS, undefined), now: T0 });
    const byQid = new Map(plan.records.map((record) => [record.qid, record.correct]));
    expect(byQid.get('book-ch1_1')).toBe(true);
    expect(byQid.get('book-ch1_0')).toBe(false);
    expect(plan.stats.markedCorrect).toBe(3);
    expect(plan.warnings.join(' ')).toMatch(/upper bound/);
  });

  it('counts ids that were only ever in `correct` instead of dropping them', () => {
    const plan = planLegacyMigration({ storage: legacyStorage(LEGACY_PROGRESS, undefined), now: T0 });
    expect(plan.stats.correctWithoutAttempt).toBe(1);
    expect(plan.records.some((record) => record.qid === 'book-ch2_8')).toBe(true);
  });

  it('refuses to fabricate response records out of eng_history rows', () => {
    const plan = planLegacyMigration({ storage: legacyStorage({}, LEGACY_HISTORY), now: T0 });
    expect(plan.records).toHaveLength(0);
    expect(plan.stats.legacyHistoryEntries).toBe(2);
    expect(plan.skipped[0].what).toMatch(/2 eng_history row/);
    expect(plan.skipped[0].reason).toMatch(/no question ids/);
  });

  it('is idempotent: a second run appends nothing', async () => {
    const store = createMemoryResponseLogStore();
    const options = { storage: legacyStorage(LEGACY_PROGRESS, LEGACY_HISTORY), now: T0, store };
    const first = await migrateLegacyProgress(options);
    const second = await migrateLegacyProgress(options);
    expect(first).toMatchObject({ appended: 5, duplicates: 0 });
    expect(second).toMatchObject({ appended: 0, duplicates: 5 });
    expect(await store.count()).toBe(5);
  });

  it('survives a missing or corrupt legacy store', () => {
    const empty = planLegacyMigration({ storage: { getItem: () => null }, now: T0 });
    expect(empty.records).toHaveLength(0);
    expect(empty.warnings.join(' ')).toMatch(/missing or unreadable/);

    const corrupt = planLegacyMigration({ storage: { getItem: () => '{not json' }, now: T0 });
    expect(corrupt.records).toHaveLength(0);
  });
});
