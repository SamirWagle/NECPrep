/**
 * ability — online Elo for the learner AND for every item.
 *
 * WHY ELO AND NOT IRT
 * -------------------
 * The honest alternative is item response theory: fit a 2PL per item and get a
 * difficulty plus a discrimination with real standard errors. It needs roughly
 * 300 responses *per item* to be stable. This bank has ~2,800 items, so a 2PL
 * fit needs ~840,000 graded responses before it says anything, and a single
 * learner preparing for one exam will produce a few thousand. The fit would
 * never run.
 *
 * Elo calibrates from the very first response instead, and it is mathematically
 * the online-gradient form of the 1PL (Rasch) model: `expected` below is exactly
 * the Rasch item characteristic curve with a logistic scale of 400/ln(10) and a
 * fixed discrimination of 1. So what this module produces is a 1PL-equivalent
 * difficulty estimate, no more:
 *
 *   - It cannot represent discrimination. A trick question that everyone with
 *     real understanding still gets wrong looks simply "hard".
 *   - It cannot represent guessing. A 4-option MCQ has a ~25% floor that 1PL
 *     does not model; very hard items therefore drift too easy over time.
 *   - Its ratings are point estimates with no standard error. Treat an item
 *     with under ~30 responses as uncalibrated (see {@link itemCalibration}).
 *
 * REPLACEMENT PATH: once an item reaches {@link IRT_REFIT_THRESHOLD} (300)
 * responses, {@link itemsNeedingIrtRefit} will list it and a 2PL fit should
 * replace that item's rating (and add a discrimination) in the snapshot. The
 * snapshot's `items` entries carry `responses`, so the cut-over is per item and
 * needs no data migration — the response log is the source of truth and can be
 * replayed into either model.
 *
 * Everything here is a pure fold over the response log; the persisted snapshot
 * is a cache, never the truth.
 */

import type { ResponseRecord } from './responseLog';

// ─── Constants ────────────────────────────────────────────────────────────────

export const ABILITY_SCHEMA_VERSION = 1;

/** Both learners and items start here. 1000 is an arbitrary, conventional zero. */
export const INITIAL_ELO = 1000;

/** The logistic scale: a 400-point gap means ~91% expected success. */
export const ELO_SCALE = 400;

/**
 * K-factor denominators. Larger denominator = slower, steadier movement.
 * The learner moves slowest (50) because their ability is genuinely stable over
 * a session; items move faster (30) because an item's rating is the thing we
 * know least about; per-chapter ability moves fastest (20) because a learner
 * revising one chapter really can improve inside a week and the per-chapter
 * number is what drives question selection.
 */
export const K_LEARNER_DENOM = 50;
export const K_ITEM_DENOM = 30;
export const K_CHAPTER_DENOM = 20;

/** Below this many responses an item's rating is a guess, not a measurement. */
export const ITEM_PROVISIONAL_RESPONSES = 30;

/** At or above this, replace the Elo rating with a proper 2PL fit. */
export const IRT_REFIT_THRESHOLD = 300;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RatedEntity {
  /** Current Elo rating. */
  rating: number;
  /** How many graded responses have moved it. */
  responses: number;
}

export interface AbilitySnapshot {
  version: number;
  /** Global learner ability. */
  theta: number;
  responses: number;
  /** Per-chapter ability, keyed by `topicId`. */
  chapters: Record<string, RatedEntity>;
  /** Per-item difficulty, keyed by `qid`. */
  items: Record<string, RatedEntity>;
  updatedAt: number;
}

/** The minimum a response needs to move the ratings. */
export interface AbilityObservation {
  qid: string;
  /** Chapter id; `ResponseRecord.topicId`. */
  chapterId: string;
  correct: boolean;
  ts?: number;
}

export function emptyAbilitySnapshot(now = 0): AbilitySnapshot {
  return {
    version: ABILITY_SCHEMA_VERSION,
    theta: INITIAL_ELO,
    responses: 0,
    chapters: {},
    items: {},
    updatedAt: now,
  };
}

// ─── Pure Elo maths ───────────────────────────────────────────────────────────

/**
 * Probability that a learner of ability `theta` answers an item of difficulty
 * `itemElo` correctly. Identical to the 1PL/Rasch ICC.
 */
export function expectedCorrect(theta: number, itemElo: number): number {
  return 1 / (1 + Math.pow(10, (itemElo - theta) / ELO_SCALE));
}

/** Inverse of {@link expectedCorrect}: the item difficulty that yields `p`. */
export function eloForSuccessProbability(theta: number, p: number): number {
  const clamped = Math.min(0.999, Math.max(0.001, p));
  return theta + ELO_SCALE * Math.log10((1 - clamped) / clamped);
}

export function learnerK(responses: number): number {
  return ELO_SCALE / (K_LEARNER_DENOM + responses);
}

export function itemK(responses: number): number {
  return ELO_SCALE / (K_ITEM_DENOM + responses);
}

export function chapterK(responses: number): number {
  return ELO_SCALE / (K_CHAPTER_DENOM + responses);
}

/**
 * How much to trust an item's rating.
 *   - `provisional`: under {@link ITEM_PROVISIONAL_RESPONSES}; usable for
 *     ordering but not for telling a learner an item is "hard".
 *   - `calibrated`: a usable 1PL difficulty.
 *   - `refit-2pl`: enough data that Elo is now the weaker model.
 */
export function itemCalibration(entity: RatedEntity | undefined): 'unseen' | 'provisional' | 'calibrated' | 'refit-2pl' {
  if (!entity || entity.responses === 0) return 'unseen';
  if (entity.responses >= IRT_REFIT_THRESHOLD) return 'refit-2pl';
  if (entity.responses < ITEM_PROVISIONAL_RESPONSES) return 'provisional';
  return 'calibrated';
}

export function itemsNeedingIrtRefit(snapshot: AbilitySnapshot): string[] {
  return Object.entries(snapshot.items)
    .filter(([, entity]) => entity.responses >= IRT_REFIT_THRESHOLD)
    .map(([qid]) => qid);
}

// ─── Updates ──────────────────────────────────────────────────────────────────

export interface AbilityUpdateDetail {
  qid: string;
  chapterId: string;
  correct: boolean;
  expected: number;
  thetaBefore: number;
  thetaAfter: number;
  itemBefore: number;
  itemAfter: number;
  chapterBefore: number;
  chapterAfter: number;
}

function entityOf(map: Record<string, RatedEntity>, key: string): RatedEntity {
  return map[key] ?? { rating: INITIAL_ELO, responses: 0 };
}

function cloneSnapshot(snapshot: AbilitySnapshot): AbilitySnapshot {
  return {
    version: snapshot.version,
    theta: snapshot.theta,
    responses: snapshot.responses,
    chapters: { ...snapshot.chapters },
    items: { ...snapshot.items },
    updatedAt: snapshot.updatedAt,
  };
}

/**
 * Folds a batch of observations into a new snapshot. Pure: the input snapshot
 * is never mutated, and replaying the same observations in the same order
 * always yields the same result — which is what makes the whole model
 * reconstructible from the response log.
 *
 * The learner moves *up* and the item moves *down* by the same signed surprise
 * `(correct - expected)` scaled by their own K, so the pair is zero-sum in
 * surprise terms, as in chess Elo.
 */
export function applyObservations(
  snapshot: AbilitySnapshot,
  observations: AbilityObservation[],
): { snapshot: AbilitySnapshot; details: AbilityUpdateDetail[] } {
  const next = cloneSnapshot(snapshot);
  const details: AbilityUpdateDetail[] = [];

  for (const observation of observations) {
    const item = entityOf(next.items, observation.qid);
    const chapter = entityOf(next.chapters, observation.chapterId);
    const score = observation.correct ? 1 : 0;

    const expected = expectedCorrect(next.theta, item.rating);
    const surprise = score - expected;

    const thetaAfter = next.theta + learnerK(next.responses) * surprise;
    const itemAfter = item.rating - itemK(item.responses) * surprise;

    // Per-chapter ability is a separate ladder with its own expectation, so a
    // learner who is strong overall but weak in one chapter gets chapter-level
    // question selection that reflects the chapter, not the average.
    const chapterExpected = expectedCorrect(chapter.rating, item.rating);
    const chapterAfter = chapter.rating + chapterK(chapter.responses) * (score - chapterExpected);

    details.push({
      qid: observation.qid,
      chapterId: observation.chapterId,
      correct: observation.correct,
      expected,
      thetaBefore: next.theta,
      thetaAfter,
      itemBefore: item.rating,
      itemAfter,
      chapterBefore: chapter.rating,
      chapterAfter,
    });

    next.theta = thetaAfter;
    next.responses += 1;
    next.items[observation.qid] = { rating: itemAfter, responses: item.responses + 1 };
    next.chapters[observation.chapterId] = { rating: chapterAfter, responses: chapter.responses + 1 };
    if (observation.ts !== undefined) next.updatedAt = Math.max(next.updatedAt, observation.ts);
  }

  return { snapshot: next, details };
}

export function applyObservation(
  snapshot: AbilitySnapshot,
  observation: AbilityObservation,
): { snapshot: AbilitySnapshot; detail: AbilityUpdateDetail } {
  const { snapshot: next, details } = applyObservations(snapshot, [observation]);
  return { snapshot: next, detail: details[0] };
}

export function observationFromResponse(record: ResponseRecord): AbilityObservation {
  return { qid: record.qid, chapterId: record.topicId, correct: record.correct, ts: record.ts };
}

/**
 * Rebuilds the whole model from the log. Records are sorted by `ts` first,
 * because Elo is order-dependent and the log may arrive out of order after a
 * cross-device merge.
 */
export function rebuildAbility(records: ResponseRecord[], now = Date.now()): AbilitySnapshot {
  const ordered = [...records].sort((a, b) => (a.ts === b.ts ? (a.rid < b.rid ? -1 : 1) : a.ts - b.ts));
  const { snapshot } = applyObservations(emptyAbilitySnapshot(now), ordered.map(observationFromResponse));
  return { ...snapshot, updatedAt: now };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export function chapterTheta(snapshot: AbilitySnapshot, chapterId: string): number {
  return snapshot.chapters[chapterId]?.rating ?? snapshot.theta;
}

export function itemElo(snapshot: AbilitySnapshot, qid: string): number {
  return snapshot.items[qid]?.rating ?? INITIAL_ELO;
}

/** Probability this learner answers this item correctly, chapter-aware. */
export function successProbability(snapshot: AbilitySnapshot, qid: string, chapterId?: string): number {
  const theta = chapterId === undefined ? snapshot.theta : chapterTheta(snapshot, chapterId);
  return expectedCorrect(theta, itemElo(snapshot, qid));
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export const ABILITY_STORAGE_KEY = 'eng_ability_v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  return typeof localStorage === 'undefined' ? null : localStorage;
}

function isRatedEntityMap(value: unknown): value is Record<string, RatedEntity> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      Number.isFinite((entry as RatedEntity).rating) &&
      Number.isFinite((entry as RatedEntity).responses),
  );
}

/**
 * Upgrades an older snapshot in place. There is only v1 today; the point of the
 * hook is that a future shape change does not require throwing the cache away
 * silently — and when it cannot be upgraded we return `null` so the caller
 * rebuilds from the log rather than trusting a half-understood object.
 */
function upgradeSnapshot(raw: unknown): AbilitySnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Partial<AbilitySnapshot>;
  if (candidate.version !== ABILITY_SCHEMA_VERSION) return null;
  if (!Number.isFinite(candidate.theta) || !Number.isFinite(candidate.responses)) return null;
  if (!isRatedEntityMap(candidate.chapters) || !isRatedEntityMap(candidate.items)) return null;
  return {
    version: ABILITY_SCHEMA_VERSION,
    theta: candidate.theta as number,
    responses: candidate.responses as number,
    chapters: candidate.chapters,
    items: candidate.items,
    updatedAt: Number.isFinite(candidate.updatedAt) ? (candidate.updatedAt as number) : 0,
  };
}

/** Returns `null` when there is no usable cache; the caller should rebuild. */
export function loadAbilitySnapshot(storage?: StorageLike): AbilitySnapshot | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(ABILITY_STORAGE_KEY);
    return raw === null ? null : upgradeSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Persists the snapshot. Returns false when it could not be written — the
 * snapshot is only a cache, so a failed write is recoverable, but the caller
 * should still know rather than assume success.
 */
export function saveAbilitySnapshot(snapshot: AbilitySnapshot, storage?: StorageLike): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(ABILITY_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function clearAbilitySnapshot(storage?: StorageLike): void {
  resolveStorage(storage)?.removeItem(ABILITY_STORAGE_KEY);
}
