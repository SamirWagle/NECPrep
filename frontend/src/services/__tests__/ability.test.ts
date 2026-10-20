import { describe, it, expect } from 'vitest';
import {
  ABILITY_STORAGE_KEY,
  INITIAL_ELO,
  applyObservation,
  applyObservations,
  chapterK,
  chapterTheta,
  eloForSuccessProbability,
  emptyAbilitySnapshot,
  expectedCorrect,
  itemCalibration,
  itemElo,
  itemK,
  itemsNeedingIrtRefit,
  learnerK,
  loadAbilitySnapshot,
  rebuildAbility,
  saveAbilitySnapshot,
} from '../ability';
import type { AbilityObservation, AbilitySnapshot } from '../ability';
import { createResponse } from '../responseLog';

/** mulberry32 — deterministic, so a convergence test cannot flake. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function trueProbability(theta: number, difficulty: number): number {
  return 1 / (1 + Math.pow(10, (difficulty - theta) / 400));
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

describe('elo maths', () => {
  it('is symmetric at equal ratings and matches the 1PL curve', () => {
    expect(expectedCorrect(1000, 1000)).toBeCloseTo(0.5, 10);
    expect(expectedCorrect(1400, 1000)).toBeCloseTo(0.909, 3);
    expect(expectedCorrect(1000, 1400)).toBeCloseTo(0.091, 3);
  });

  it('inverts to the item difficulty that yields a target success rate', () => {
    const target = eloForSuccessProbability(1000, 0.8);
    expect(target).toBeCloseTo(1000 - 240.8, 1);
    expect(expectedCorrect(1000, target)).toBeCloseTo(0.8, 6);
  });

  it('decays K as evidence accumulates', () => {
    expect(learnerK(0)).toBeCloseTo(8, 6);
    expect(learnerK(350)).toBeCloseTo(1, 6);
    expect(itemK(0)).toBeCloseTo(400 / 30, 6);
    expect(chapterK(0)).toBeCloseTo(20, 6);
    expect(learnerK(100)).toBeLessThan(learnerK(10));
  });
});

describe('applyObservations', () => {
  it('moves the learner up and the item down by the same surprise', () => {
    const start = emptyAbilitySnapshot(0);
    const { snapshot, detail } = applyObservation(start, {
      qid: 'q1',
      chapterId: 'book-ch1',
      correct: true,
    });
    expect(detail.expected).toBeCloseTo(0.5, 10);
    expect(snapshot.theta).toBeCloseTo(INITIAL_ELO + learnerK(0) * 0.5, 6);
    expect(itemElo(snapshot, 'q1')).toBeCloseTo(INITIAL_ELO - itemK(0) * 0.5, 6);
    expect(chapterTheta(snapshot, 'book-ch1')).toBeCloseTo(INITIAL_ELO + chapterK(0) * 0.5, 6);
  });

  it('does not mutate the input snapshot', () => {
    const start = emptyAbilitySnapshot(0);
    applyObservation(start, { qid: 'q1', chapterId: 'book-ch1', correct: true });
    expect(start.theta).toBe(INITIAL_ELO);
    expect(start.items).toEqual({});
  });

  it('keeps per-chapter ability separate from global ability', () => {
    let snapshot = emptyAbilitySnapshot(0);
    const observations: AbilityObservation[] = [];
    for (let i = 0; i < 40; i += 1) {
      observations.push({ qid: `strong_${i}`, chapterId: 'book-ch2', correct: true });
      observations.push({ qid: `weak_${i}`, chapterId: 'book-ch5', correct: false });
    }
    snapshot = applyObservations(snapshot, observations).snapshot;
    expect(chapterTheta(snapshot, 'book-ch2')).toBeGreaterThan(chapterTheta(snapshot, 'book-ch5') + 200);
    // The global rating averages them out, which is exactly why selection uses
    // the per-chapter number.
    expect(snapshot.theta).toBeGreaterThan(chapterTheta(snapshot, 'book-ch5'));
    expect(snapshot.theta).toBeLessThan(chapterTheta(snapshot, 'book-ch2'));
  });
});

describe('convergence on a simulated learner', () => {
  it('recovers a known ability when item difficulties are already calibrated', () => {
    // Items pre-seeded with their true difficulty and a large response count,
    // so itemK is ~0.04 and they stay put. This isolates learner convergence.
    const trueTheta = 1250;
    const items: Record<string, number> = {};
    const snapshotItems: AbilitySnapshot['items'] = {};
    for (let i = 0; i < 120; i += 1) {
      const difficulty = 850 + i * (500 / 119);
      items[`q${i}`] = difficulty;
      snapshotItems[`q${i}`] = { rating: difficulty, responses: 10_000 };
    }

    const start: AbilitySnapshot = { ...emptyAbilitySnapshot(0), items: snapshotItems };
    const random = seededRandom(20260120);
    const observations: AbilityObservation[] = [];
    const qids = Object.keys(items);
    for (let n = 0; n < 4000; n += 1) {
      const qid = qids[Math.floor(random() * qids.length)];
      const correct = random() < trueProbability(trueTheta, items[qid]);
      observations.push({ qid, chapterId: 'book-ch1', correct });
    }

    // The error closes monotonically. It closes *slowly* on purpose: with
    // K = 400/(50 + n) the learner's total remaining movement after n responses
    // is bounded, which is what stops one unlucky chapter from swinging the
    // rating 200 points. Measured errors for this seed, starting 250 points
    // below the truth:
    //   n=50 → 174, n=100 → 129, n=200 → 96, n=400 → 83,
    //   n=800 → 67, n=1200 → 55, n=2000 → 40, n=3000 → 31, n=4000 → 27
    const checkpoints = [100, 200, 400, 800, 1200, 2000, 3000, 4000];
    const errors = checkpoints.map((n) =>
      Math.abs(applyObservations(start, observations.slice(0, n)).snapshot.theta - trueTheta),
    );
    for (let i = 1; i < errors.length; i += 1) {
      expect(errors[i]).toBeLessThan(errors[i - 1]);
    }
    expect(errors[0]).toBeGreaterThan(100);
    expect(errors[errors.length - 1]).toBeLessThan(30);

    const { snapshot } = applyObservations(start, observations);
    // The per-chapter ladder, with its faster K = 400/(20 + n), gets there
    // sooner — which is why question selection reads the chapter rating.
    expect(Math.abs(chapterTheta(snapshot, 'book-ch1') - trueTheta)).toBeLessThan(20);
  });

  it('recovers item difficulty ordering when learner and items calibrate together', () => {
    // Nothing is known at the start: learner and every item sit at 1000.
    const trueTheta = 1250;
    const trueDifficulty: Record<string, number> = {};
    const qids: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      const qid = `q${i}`;
      qids.push(qid);
      trueDifficulty[qid] = 850 + i * (500 / 59);
    }

    const random = seededRandom(777);
    const observations: AbilityObservation[] = [];
    // 40 exposures per item: enough for an Elo rating, nowhere near the ~300
    // per item a 2PL fit would need.
    for (let round = 0; round < 40; round += 1) {
      for (const qid of qids) {
        observations.push({
          qid,
          chapterId: 'book-ch1',
          correct: random() < trueProbability(trueTheta, trueDifficulty[qid]),
        });
      }
    }

    const { snapshot } = applyObservations(emptyAbilitySnapshot(0), observations);
    const estimated = qids.map((qid) => itemElo(snapshot, qid));
    const actual = qids.map((qid) => trueDifficulty[qid]);
    // Measured for this seed: Pearson r = 0.935 between the Elo ratings and the
    // true difficulties, from 40 exposures per item.
    expect(pearson(estimated, actual)).toBeGreaterThan(0.9);

    // Only the learner-minus-item gap is identified by Elo, not the absolute
    // level, so that is what the test pins down.
    const meanEstimated = estimated.reduce((s, v) => s + v, 0) / estimated.length;
    const meanActual = actual.reduce((s, v) => s + v, 0) / actual.length;
    const estimatedGap = snapshot.theta - meanEstimated;
    const actualGap = trueTheta - meanActual;
    // Measured: 24.5 Elo points of error on a 150-point true gap.
    expect(Math.abs(estimatedGap - actualGap)).toBeLessThan(40);

    // Calibration: predicted success should track the truth.
    let absError = 0;
    for (const qid of qids) {
      absError += Math.abs(
        expectedCorrect(snapshot.theta, itemElo(snapshot, qid)) - trueProbability(trueTheta, trueDifficulty[qid]),
      );
    }
    // Measured: 0.094 mean absolute error on the predicted success probability.
    // That is the honest accuracy of a 1PL/Elo fit at this sample size; a 2PL
    // with ~300 responses per item would do better, and cannot be run yet.
    expect(absError / qids.length).toBeLessThan(0.11);
  });
});

describe('IRT replacement path', () => {
  it('labels an item unseen, provisional, calibrated or ready for a 2PL refit', () => {
    expect(itemCalibration(undefined)).toBe('unseen');
    expect(itemCalibration({ rating: 1000, responses: 0 })).toBe('unseen');
    expect(itemCalibration({ rating: 1000, responses: 12 })).toBe('provisional');
    expect(itemCalibration({ rating: 1000, responses: 120 })).toBe('calibrated');
    expect(itemCalibration({ rating: 1000, responses: 300 })).toBe('refit-2pl');
  });

  it('lists the items that have outgrown Elo', () => {
    const snapshot: AbilitySnapshot = {
      ...emptyAbilitySnapshot(0),
      items: {
        young: { rating: 1000, responses: 20 },
        mature: { rating: 900, responses: 512 },
      },
    };
    expect(itemsNeedingIrtRefit(snapshot)).toEqual(['mature']);
  });
});

describe('rebuild and persistence', () => {
  it('replays the log in timestamp order regardless of arrival order', () => {
    const records = [
      createResponse({ rid: 'b', qid: 'q1', topicId: 'book-ch1', mode: 'topic', chosenIndex: 0, correct: false, latencyMs: 1, flaggedGuess: false, ts: 2000 }),
      createResponse({ rid: 'a', qid: 'q1', topicId: 'book-ch1', mode: 'topic', chosenIndex: 0, correct: true, latencyMs: 1, flaggedGuess: false, ts: 1000 }),
    ];
    const forwards = rebuildAbility(records, 9999);
    const shuffled = rebuildAbility([records[1], records[0]], 9999);
    expect(forwards.theta).toBeCloseTo(shuffled.theta, 12);
    expect(forwards.responses).toBe(2);
  });

  it('round-trips a snapshot and rejects a cache it cannot understand', () => {
    const snapshot = applyObservation(emptyAbilitySnapshot(5), {
      qid: 'q1',
      chapterId: 'book-ch1',
      correct: true,
    }).snapshot;
    expect(saveAbilitySnapshot(snapshot)).toBe(true);
    expect(loadAbilitySnapshot()?.theta).toBeCloseTo(snapshot.theta, 12);

    localStorage.setItem(ABILITY_STORAGE_KEY, JSON.stringify({ version: 99, theta: 1 }));
    expect(loadAbilitySnapshot()).toBeNull();

    localStorage.setItem(ABILITY_STORAGE_KEY, 'not json');
    expect(loadAbilitySnapshot()).toBeNull();
  });
});
