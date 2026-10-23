import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHAPTER_MEAN,
  MIN_N_EFF,
  SHRINKAGE_K,
  bucketFor,
  chapterMeanOf,
  coverageFor,
  estimateMastery,
  masteryFromResponses,
  overallCoverage,
  recencyWeight,
  summarise,
  triage,
  withUnassessedUnits,
} from '../mastery';
import type { MasteryObservation } from '../mastery';
import { createResponse } from '../responseLog';
import type { ResponseRecord } from '../responseLog';

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function obs(count: number, correct: boolean, ageDays = 0, qidPrefix = 'q'): MasteryObservation[] {
  return Array.from({ length: count }, (_, i) => ({
    qid: `${qidPrefix}${i}`,
    correct,
    ts: NOW - ageDays * DAY,
  }));
}

function record(overrides: Partial<ResponseRecord> & Pick<ResponseRecord, 'qid' | 'topicId'>): ResponseRecord {
  return createResponse({
    mode: 'topic',
    chosenIndex: 0,
    correct: true,
    latencyMs: 4000,
    flaggedGuess: false,
    ts: NOW,
    ...overrides,
  });
}

describe('recency weighting', () => {
  it('halves every 30 days', () => {
    expect(recencyWeight(0)).toBe(1);
    expect(recencyWeight(30)).toBeCloseTo(0.5, 12);
    expect(recencyWeight(60)).toBeCloseTo(0.25, 12);
    expect(recencyWeight(90)).toBeCloseTo(0.125, 12);
  });

  it('refuses to let a future timestamp inflate the weight above 1', () => {
    expect(recencyWeight(-500)).toBe(1);
  });

  it('shrinks the effective sample size, not just the accuracy', () => {
    const fresh = summarise(obs(10, true, 0), NOW);
    const stale = summarise(obs(10, true, 60), NOW);
    expect(fresh.nEff).toBeCloseTo(10, 6);
    expect(stale.nEff).toBeCloseTo(2.5, 6);
    expect(stale.responses).toBe(10); // the raw count is unchanged
  });
});

describe('the not-assessed state', () => {
  it('reports never-practised material as not-assessed, never as 0%', () => {
    const estimate = estimateMastery([], { now: NOW });
    expect(estimate.state).toBe('not-assessed');
    // The whole point: there is no `mastery` field to render as "0%".
    expect('mastery' in estimate).toBe(false);
    if (estimate.state !== 'not-assessed') throw new Error('expected not-assessed');
    expect(estimate.reason).toBe('not practised yet');
    expect(estimate.nEffNeeded).toBe(MIN_N_EFF);
  });

  it('holds back a score until the effective sample reaches 3', () => {
    expect(estimateMastery(obs(2, true), { now: NOW }).state).toBe('not-assessed');
    expect(estimateMastery(obs(3, true), { now: NOW }).state).toBe('assessed');
  });

  it('falls back to not-assessed when the only evidence has gone stale', () => {
    // 8 answers two months ago weigh 8 * 0.25 = 2.0, which is below the bar:
    // "you knew this in August" is not "you know this now".
    const stale = estimateMastery(obs(8, true, 60), { now: NOW });
    expect(stale.nEff).toBeCloseTo(2, 6);
    if (stale.state !== 'not-assessed') throw new Error('expected not-assessed');
    expect(stale.reason).toMatch(/8 response\(s\)/);
  });

  it('says so in a form a UI can print without inventing a number', () => {
    const estimate = estimateMastery(obs(1, false), { now: NOW });
    if (estimate.state !== 'not-assessed') throw new Error('expected not-assessed');
    expect(estimate.reason).toMatch(/too little to score/);
    expect(estimate.distinctQids).toBe(1);
  });
});

describe('shrinkage at small n', () => {
  it('pulls a perfect 3-question sample most of the way back to the chapter mean', () => {
    const estimate = estimateMastery(obs(3, true), { now: NOW, chapterMean: 0.5 });
    if (estimate.state !== 'assessed') throw new Error('expected assessed');
    // (3 + 8*0.5) / (3 + 8) = 0.636, not 1.0.
    expect(estimate.accHat).toBeCloseTo(7 / 11, 10);
    expect(estimate.confidence).toBeCloseTo(3 / 11, 10);
  });

  it('lets a large sample speak for itself', () => {
    const estimate = estimateMastery(obs(80, true, 0, 'big'), { now: NOW, chapterMean: 0.5 });
    if (estimate.state !== 'assessed') throw new Error('expected assessed');
    expect(estimate.accHat).toBeCloseTo((80 + 4) / 88, 10);
    expect(estimate.accHat).toBeGreaterThan(0.95);
    expect(estimate.confidence).toBeGreaterThan(0.9);
  });

  it('monotonically increases confidence with effective sample size', () => {
    const sizes = [3, 6, 12, 25, 60];
    const confidences = sizes.map((n) => {
      const estimate = estimateMastery(obs(n, true, 0, 'c'), { now: NOW, chapterMean: 0.5 });
      return estimate.state === 'assessed' ? estimate.confidence : 0;
    });
    for (let i = 1; i < confidences.length; i += 1) {
      expect(confidences[i]).toBeGreaterThan(confidences[i - 1]);
    }
    expect(confidences[0]).toBeCloseTo(3 / (3 + SHRINKAGE_K), 10);
  });

  it('borrows the direction of the chapter it belongs to', () => {
    const strongChapter = estimateMastery(obs(3, true), { now: NOW, chapterMean: 0.9 });
    const weakChapter = estimateMastery(obs(3, true), { now: NOW, chapterMean: 0.3 });
    if (strongChapter.state !== 'assessed' || weakChapter.state !== 'assessed') {
      throw new Error('expected assessed');
    }
    expect(strongChapter.accHat).toBeGreaterThan(weakChapter.accHat);
    expect(strongChapter.accHat).toBeCloseTo((3 + 8 * 0.9) / 11, 10);
  });

  it('defaults the shrinkage target to 0.5 when the chapter has no data', () => {
    expect(chapterMeanOf([], NOW)).toBe(DEFAULT_CHAPTER_MEAN);
  });
});

describe('coverage', () => {
  it('reaches 1.0 at 12 distinct questions and no sooner', () => {
    expect(coverageFor(0)).toBe(0);
    expect(coverageFor(3)).toBeCloseTo(0.25, 10);
    expect(coverageFor(12)).toBe(1);
    expect(coverageFor(50)).toBe(1);
  });

  it('discounts mastery for a narrow sample even when accuracy is perfect', () => {
    const narrow = estimateMastery(
      Array.from({ length: 20 }, (_, i) => ({ qid: `only${i % 3}`, correct: true, ts: NOW })),
      { now: NOW, chapterMean: 0.9 },
    );
    const broad = estimateMastery(obs(20, true, 0, 'wide'), { now: NOW, chapterMean: 0.9 });
    if (narrow.state !== 'assessed' || broad.state !== 'assessed') throw new Error('expected assessed');
    expect(narrow.distinctQids).toBe(3);
    expect(narrow.coverage).toBeCloseTo(0.25, 10);
    // Same accuracy, far less breadth, so a lower mastery verdict.
    expect(narrow.accHat).toBeCloseTo(broad.accHat, 10);
    expect(narrow.mastery).toBeLessThan(broad.mastery);
    expect(narrow.mastery).toBeCloseTo(narrow.accHat * 0.7, 10);
  });
});

describe('buckets', () => {
  it('uses the documented thresholds', () => {
    expect(bucketFor(0.2, 1)).toBe('critical');
    expect(bucketFor(0.449, 1)).toBe('critical');
    expect(bucketFor(0.45, 1)).toBe('weak');
    expect(bucketFor(0.64, 1)).toBe('weak');
    expect(bucketFor(0.65, 1)).toBe('developing');
    expect(bucketFor(0.84, 1)).toBe('developing');
    expect(bucketFor(0.85, 1)).toBe('strong');
  });

  it('withholds `strong` from a high score on a narrow slice', () => {
    expect(bucketFor(0.95, 0.74)).toBe('developing');
    expect(bucketFor(0.95, 0.75)).toBe('strong');
  });
});

describe('masteryFromResponses', () => {
  const records: ResponseRecord[] = [
    // Sub-chapter 1.1: thin but correct.
    record({ rid: '1', qid: 'book-ch1_1', topicId: 'book-ch1', subchapter: 'ch1.1' }),
    record({ rid: '2', qid: 'book-ch1_2', topicId: 'book-ch1', subchapter: 'ch1.1' }),
    record({ rid: '3', qid: 'book-ch1_3', topicId: 'book-ch1', subchapter: 'ch1.1' }),
    // Sub-chapter 1.2: well sampled and mostly wrong.
    ...Array.from({ length: 16 }, (_, i) =>
      record({ rid: `w${i}`, qid: `book-ch1_1${i}`, topicId: 'book-ch1', subchapter: 'ch1.2', correct: i % 5 === 0 }),
    ),
    // A chapter with no sub-chapter metadata at all.
    record({ rid: 'n1', qid: 'book-ch5_1', topicId: 'book-ch5' }),
    record({ rid: 'n2', qid: 'book-ch5_2', topicId: 'book-ch5' }),
    record({ rid: 'n3', qid: 'book-ch5_3', topicId: 'book-ch5' }),
    record({ rid: 'n4', qid: 'book-ch5_4', topicId: 'book-ch5' }),
  ];

  it('keys units by sub-chapter and falls back to the chapter id', () => {
    const map = masteryFromResponses(records, { now: NOW });
    expect([...map.units.keys()].sort()).toEqual(['book-ch5', 'ch1.1', 'ch1.2']);
    expect(map.units.get('book-ch5')?.subchapter).toBeNull();
    expect(map.units.get('ch1.1')?.subchapter).toBe('ch1.1');
    expect(map.units.get('ch1.1')?.topicId).toBe('book-ch1');
  });

  it('shrinks each sub-chapter toward its own chapter mean', () => {
    const map = masteryFromResponses(records, { now: NOW });
    const chapterMean = map.chapterMeans.get('book-ch1');
    // 3 correct in 1.1 plus 4 of 16 in 1.2 = 7 of 19.
    expect(chapterMean).toBeCloseTo(7 / 19, 10);
    const thin = map.units.get('ch1.1')?.estimate;
    if (thin?.state !== 'assessed') throw new Error('expected assessed');
    // 3/3 correct becomes 0.63, not 1.0, because its chapter is weak.
    expect(thin.accHat).toBeCloseTo((3 + 8 * (7 / 19)) / 11, 10);
    expect(thin.chapterMean).toBeCloseTo(7 / 19, 10);
  });

  it('separates not-assessed units from weak ones in triage', () => {
    const map = withUnassessedUnits(masteryFromResponses(records, { now: NOW }), [
      { unitId: 'ch1.1', topicId: 'book-ch1' },
      { unitId: 'ch1.2', topicId: 'book-ch1' },
      { unitId: 'ch1.3', topicId: 'book-ch1' },
      { unitId: 'book-ch5', topicId: 'book-ch5' },
      { unitId: 'book-ch9', topicId: 'book-ch9' },
    ]);
    const buckets = triage(map);
    expect(buckets.notAssessed.map((u) => u.unitId).sort()).toEqual(['book-ch9', 'ch1.3']);
    for (const unit of buckets.notAssessed) {
      expect(unit.estimate.state).toBe('not-assessed');
    }
    expect(buckets.critical.length + buckets.weak.length).toBeGreaterThan(0);
  });

  it('can exclude migrated records whose timestamps were imputed', () => {
    const withLegacy = [
      ...records,
      record({ rid: 'legacy1', qid: 'book-ch9_1', topicId: 'book-ch9', imputed: ['ts'] }),
    ];
    expect(masteryFromResponses(withLegacy, { now: NOW }).units.has('book-ch9')).toBe(true);
    expect(
      masteryFromResponses(withLegacy, { now: NOW, excludeImputedTs: true }).units.has('book-ch9'),
    ).toBe(false);
  });

  it('measures coverage against the blueprint, not against what was touched', () => {
    const map = masteryFromResponses(records, { now: NOW });
    // Three touched units; a 40-unit blueprint means real coverage is low.
    expect(overallCoverage(map, 3)).toBeGreaterThan(overallCoverage(map, 40));
    expect(overallCoverage(map, 40)).toBeLessThan(0.1);
    expect(overallCoverage(map, 0)).toBe(0);
  });
});
