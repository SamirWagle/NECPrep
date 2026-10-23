/**
 * mastery — per-sub-chapter mastery with shrinkage, recency and coverage.
 *
 * THE PROBLEM WITH RAW ACCURACY
 * -----------------------------
 * `correct / attempted` is the number every exam app shows and it is wrong in
 * three separate ways:
 *
 *   1. Small samples. 3 of 3 is not 100% mastery, it is a coin landing heads
 *      three times. Fixed here by empirical-Bayes shrinkage toward the chapter
 *      mean with a pseudo-count of k = 8: a 3-question sample is pulled most of
 *      the way back to the chapter's own average, and only earns its own voice
 *      as the sample grows.
 *   2. Stale samples. A chapter answered well in March is not known in October.
 *      Fixed by an exponential recency weight with a 30-day half-life, so the
 *      effective sample size itself decays.
 *   3. Narrow samples. Twelve correct answers on the same three questions is
 *      memorisation, not mastery. Fixed by a coverage multiplier over distinct
 *      question ids.
 *
 * THE HONESTY REQUIREMENT
 * -----------------------
 * When the effective sample is below {@link MIN_N_EFF} the result is a distinct
 * `not-assessed` state, not a number. Showing "0% mastery" for a sub-chapter
 * nobody ever practised is the single most common lie in exam apps: it reads as
 * "you are failing this" when the truth is "we have no idea". The return type
 * is a discriminated union, so a UI *cannot* read `mastery` off an unassessed
 * unit — it will not type-check. That is deliberate; the lie is unrepresentable
 * rather than merely discouraged.
 *
 * All functions are pure folds over response records.
 */

import type { ResponseRecord } from './responseLog';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Recency half-life in days: a 30-day-old response counts half as much. */
export const RECENCY_HALF_LIFE_DAYS = 30;

/** Shrinkage pseudo-count. Also the scale of the confidence curve. */
export const SHRINKAGE_K = 8;

/** Distinct questions that count as full coverage of a sub-chapter. */
export const COVERAGE_TARGET_QIDS = 12;

/** Below this effective sample size, nothing is reported as a score. */
export const MIN_N_EFF = 3;

/** Used as the shrinkage target when the chapter itself has no usable data. */
export const DEFAULT_CHAPTER_MEAN = 0.5;

/** A `strong` verdict additionally requires this much coverage. */
export const STRONG_MIN_COVERAGE = 0.75;

export const BUCKET_THRESHOLDS = {
  weak: 0.45,
  developing: 0.65,
  strong: 0.85,
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MasteryObservation {
  qid: string;
  correct: boolean;
  /** Epoch milliseconds. */
  ts: number;
}

/** Note: `not-assessed` is a *state*, never a bucket. A bucket implies a score. */
export type MasteryBucket = 'critical' | 'weak' | 'developing' | 'strong';

export interface MasterySample {
  /** Recency-weighted sample size, `sum(w_i)`. */
  nEff: number;
  /** Recency-weighted correct count, `sum(w_i * correct_i)`. */
  xEff: number;
  distinctQids: number;
  /** `min(1, distinctQids / 12)`. */
  coverage: number;
  /** Raw, unweighted response count — for "you have answered N questions" copy. */
  responses: number;
  /** Timestamp of the most recent response, or null when there are none. */
  lastSeen: number | null;
}

export interface NotAssessedMastery extends MasterySample {
  state: 'not-assessed';
  /** How much more effective sample is needed before a score is reportable. */
  nEffNeeded: number;
  /** Plain-language reason, safe to show in a UI. */
  reason: string;
}

export interface AssessedMastery extends MasterySample {
  state: 'assessed';
  /** Shrunk, recency-weighted accuracy estimate in [0, 1]. */
  accHat: number;
  /** `accHat * (0.6 + 0.4 * coverage)` — accuracy discounted by breadth. */
  mastery: number;
  /** `nEff / (nEff + k)` — how much of `accHat` is the learner's own data. */
  confidence: number;
  bucket: MasteryBucket;
  /** The shrinkage target that was used. */
  chapterMean: number;
}

export type MasteryEstimate = NotAssessedMastery | AssessedMastery;

/** A sub-chapter (or a whole chapter, when the bank has no sub-chapters). */
export interface MasteryUnit {
  /** `subchapter` when known, else `topicId`. */
  unitId: string;
  topicId: string;
  subchapter: string | null;
  estimate: MasteryEstimate;
}

// ─── Pure maths ───────────────────────────────────────────────────────────────

/** `w = 0.5 ^ (ageDays / 30)`. Clamped at 0 age so clock skew cannot inflate. */
export function recencyWeight(ageDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / RECENCY_HALF_LIFE_DAYS);
}

export function ageInDays(ts: number, now: number): number {
  return (now - ts) / MS_PER_DAY;
}

export function coverageFor(distinctQids: number): number {
  return Math.min(1, distinctQids / COVERAGE_TARGET_QIDS);
}

export function summarise(observations: MasteryObservation[], now: number): MasterySample {
  let nEff = 0;
  let xEff = 0;
  let lastSeen: number | null = null;
  const qids = new Set<string>();

  for (const observation of observations) {
    const w = recencyWeight(ageInDays(observation.ts, now));
    nEff += w;
    if (observation.correct) xEff += w;
    qids.add(observation.qid);
    if (lastSeen === null || observation.ts > lastSeen) lastSeen = observation.ts;
  }

  return {
    nEff,
    xEff,
    distinctQids: qids.size,
    coverage: coverageFor(qids.size),
    responses: observations.length,
    lastSeen,
  };
}

/**
 * The shrinkage target: the chapter's own recency-weighted accuracy.
 *
 * Deliberately *not* shrunk itself — it is already an average over many
 * sub-chapters, so it is the most stable thing available. When the chapter has
 * no usable data there is nothing to shrink toward and we fall back to
 * {@link DEFAULT_CHAPTER_MEAN} (0.5), which is an admission of ignorance rather
 * than a measurement. Note 0.5 is above the 0.25 four-option guess floor, so
 * for a brand-new chapter the prior is mildly optimistic; that only matters
 * while `nEff` is small, and while `nEff` is small nothing is reported at all.
 */
export function chapterMeanOf(observations: MasteryObservation[], now: number): number {
  const sample = summarise(observations, now);
  if (sample.nEff <= 0) return DEFAULT_CHAPTER_MEAN;
  return sample.xEff / sample.nEff;
}

export function bucketFor(mastery: number, coverage: number): MasteryBucket {
  if (mastery < BUCKET_THRESHOLDS.weak) return 'critical';
  if (mastery < BUCKET_THRESHOLDS.developing) return 'weak';
  if (mastery < BUCKET_THRESHOLDS.strong) return 'developing';
  // A high score on a narrow slice of the sub-chapter is not strength. Without
  // this clause, 10/10 on the same 4 questions would read as mastered.
  return coverage >= STRONG_MIN_COVERAGE ? 'strong' : 'developing';
}

export interface EstimateOptions {
  now?: number;
  /** Shrinkage target. Defaults to {@link DEFAULT_CHAPTER_MEAN}. */
  chapterMean?: number;
  k?: number;
  minNEff?: number;
}

export function estimateMastery(
  observations: MasteryObservation[],
  options: EstimateOptions = {},
): MasteryEstimate {
  const now = options.now ?? Date.now();
  const k = options.k ?? SHRINKAGE_K;
  const minNEff = options.minNEff ?? MIN_N_EFF;
  const chapterMean = options.chapterMean ?? DEFAULT_CHAPTER_MEAN;
  const sample = summarise(observations, now);

  if (sample.nEff < minNEff) {
    const reason =
      sample.responses === 0
        ? 'not practised yet'
        : `only ${sample.responses} response(s), and recency-weighted to ${sample.nEff.toFixed(1)} — too little to score`;
    return {
      ...sample,
      state: 'not-assessed',
      nEffNeeded: minNEff - sample.nEff,
      reason,
    };
  }

  const accHat = (sample.xEff + k * chapterMean) / (sample.nEff + k);
  const mastery = accHat * (0.6 + 0.4 * sample.coverage);

  return {
    ...sample,
    state: 'assessed',
    accHat,
    mastery,
    confidence: sample.nEff / (sample.nEff + k),
    bucket: bucketFor(mastery, sample.coverage),
    chapterMean,
  };
}

// ─── Folding the response log ─────────────────────────────────────────────────

export function observationFromResponse(record: ResponseRecord): MasteryObservation {
  return { qid: record.qid, correct: record.correct, ts: record.ts };
}

/** `subchapter` when the bank knows one, otherwise the chapter itself. */
export function unitIdOf(record: Pick<ResponseRecord, 'topicId' | 'subchapter'>): string {
  return record.subchapter ?? record.topicId;
}

export interface MasteryMapOptions {
  now?: number;
  k?: number;
  minNEff?: number;
  /**
   * Drop records whose timestamps were imputed by the legacy migration. Off by
   * default: a migrated record's `correct` flag is still real evidence, and its
   * timestamp is backdated a full half-life so it already counts for half.
   */
  excludeImputedTs?: boolean;
}

export interface MasteryMap {
  /** Keyed by {@link unitIdOf}. */
  units: Map<string, MasteryUnit>;
  /** Shrinkage target actually used per chapter, keyed by `topicId`. */
  chapterMeans: Map<string, number>;
  now: number;
}

/**
 * Builds the per-sub-chapter mastery map from raw response records.
 *
 * Shrinkage happens toward the *chapter* mean (computed from every record in
 * that chapter, across all its sub-chapters), which is the whole point of
 * empirical Bayes here: a sub-chapter with three responses borrows strength
 * from its siblings instead of inventing a confident number from nothing.
 */
export function masteryFromResponses(
  records: ResponseRecord[],
  options: MasteryMapOptions = {},
): MasteryMap {
  const now = options.now ?? Date.now();
  const usable = options.excludeImputedTs === true
    ? records.filter((record) => !(record.imputed?.includes('ts') ?? false))
    : records;

  const byChapter = new Map<string, MasteryObservation[]>();
  const byUnit = new Map<string, { topicId: string; subchapter: string | null; observations: MasteryObservation[] }>();

  for (const record of usable) {
    const observation = observationFromResponse(record);
    const chapterBucket = byChapter.get(record.topicId);
    if (chapterBucket) chapterBucket.push(observation);
    else byChapter.set(record.topicId, [observation]);

    const unitId = unitIdOf(record);
    const unitBucket = byUnit.get(unitId);
    if (unitBucket) unitBucket.observations.push(observation);
    else {
      byUnit.set(unitId, {
        topicId: record.topicId,
        subchapter: record.subchapter ?? null,
        observations: [observation],
      });
    }
  }

  const chapterMeans = new Map<string, number>();
  for (const [topicId, observations] of byChapter) {
    chapterMeans.set(topicId, chapterMeanOf(observations, now));
  }

  const units = new Map<string, MasteryUnit>();
  for (const [unitId, unit] of byUnit) {
    units.set(unitId, {
      unitId,
      topicId: unit.topicId,
      subchapter: unit.subchapter,
      estimate: estimateMastery(unit.observations, {
        now,
        k: options.k,
        minNEff: options.minNEff,
        chapterMean: chapterMeans.get(unit.topicId) ?? DEFAULT_CHAPTER_MEAN,
      }),
    });
  }

  return { units, chapterMeans, now };
}

/**
 * Includes units the learner has never touched, as explicit `not-assessed`
 * entries. Needed so a dashboard can say "17 sub-chapters not assessed" instead
 * of quietly omitting them, which would make a 4%-covered bank look complete.
 */
export function withUnassessedUnits(
  map: MasteryMap,
  allUnits: Array<{ unitId: string; topicId: string; subchapter?: string | null }>,
  options: MasteryMapOptions = {},
): MasteryMap {
  const units = new Map(map.units);
  for (const unit of allUnits) {
    if (units.has(unit.unitId)) continue;
    units.set(unit.unitId, {
      unitId: unit.unitId,
      topicId: unit.topicId,
      subchapter: unit.subchapter ?? null,
      estimate: estimateMastery([], { now: map.now, minNEff: options.minNEff }),
    });
  }
  return { ...map, units };
}

// ─── Triage ───────────────────────────────────────────────────────────────────

export interface MasteryTriage {
  critical: MasteryUnit[];
  weak: MasteryUnit[];
  developing: MasteryUnit[];
  strong: MasteryUnit[];
  /** Kept separate on purpose: "unknown" is not a weakness. */
  notAssessed: MasteryUnit[];
}

export function triage(map: MasteryMap): MasteryTriage {
  const result: MasteryTriage = { critical: [], weak: [], developing: [], strong: [], notAssessed: [] };
  for (const unit of map.units.values()) {
    if (unit.estimate.state === 'not-assessed') result.notAssessed.push(unit);
    else result[unit.estimate.bucket].push(unit);
  }
  const byMastery = (a: MasteryUnit, b: MasteryUnit) =>
    (a.estimate.state === 'assessed' ? a.estimate.mastery : 0) -
    (b.estimate.state === 'assessed' ? b.estimate.mastery : 0);
  result.critical.sort(byMastery);
  result.weak.sort(byMastery);
  result.developing.sort(byMastery);
  result.strong.sort(byMastery);
  return result;
}

/**
 * Fraction of the whole syllabus actually sampled, weighted by unit count.
 * `totalUnits` must be the blueprint's unit count, not the number of units the
 * learner happens to have touched — otherwise coverage is trivially 1.0 and the
 * readiness cap in scheduler.ts never binds.
 */
export function overallCoverage(map: MasteryMap, totalUnits: number): number {
  if (totalUnits <= 0) return 0;
  let sum = 0;
  for (const unit of map.units.values()) sum += unit.estimate.coverage;
  return Math.min(1, sum / totalUnits);
}
