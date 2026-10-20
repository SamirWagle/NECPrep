import { describe, it, expect } from 'vitest';
import {
  CardState,
  DEFAULT_LATENCY_THRESHOLDS,
  GRADUATE_GOOD_DAYS,
  GRADUATE_HARD_DAYS,
  LEECH_LAPSE_THRESHOLD,
  MAX_CONSECUTIVE_SAME_SUBCHAPTER,
  Rating,
  RELEARN_STEP_MINUTES,
  difficultyToEase,
  easeToDifficulty,
  examReadiness,
  formatReadiness,
  gradeCard,
  isLeech,
  newCard,
  normalCdf,
  ratingFromOutcome,
  scheduleCard,
  selectDueQueue,
  selectNextQuestions,
} from '../scheduler';
import type { Card, QuestionCandidate, ReadinessSection } from '../scheduler';
import { estimateMastery } from '../mastery';
import type { AssessedMastery, MasteryEstimate } from '../mastery';
import { eloForSuccessProbability, expectedCorrect } from '../ability';

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function assessed(mastery: number, coverage: number, nEff = 20): AssessedMastery {
  return {
    state: 'assessed',
    nEff,
    xEff: nEff * mastery,
    distinctQids: Math.round(coverage * 12),
    coverage,
    responses: nEff,
    lastSeen: NOW,
    accHat: mastery,
    mastery,
    confidence: nEff / (nEff + 8),
    bucket: 'developing',
    chapterMean: 0.5,
  };
}

function notAssessed(): MasteryEstimate {
  return estimateMastery([], { now: NOW });
}

describe('rating from outcome', () => {
  it('maps a wrong answer to Again', () => {
    expect(ratingFromOutcome({ correct: false, latencyMs: 8000 })).toBe(Rating.Again);
    expect(ratingFromOutcome({ correct: false, latencyMs: 100 })).toBe(Rating.Again);
  });

  it('maps correct and fast to Good', () => {
    expect(ratingFromOutcome({ correct: true, latencyMs: 8000 })).toBe(Rating.Good);
  });

  it('maps correct and slow to Hard', () => {
    expect(ratingFromOutcome({ correct: true, latencyMs: DEFAULT_LATENCY_THRESHOLDS.slowMs + 1 })).toBe(
      Rating.Hard,
    );
  });

  it('maps a correct answer under the guess threshold to Hard, not Easy', () => {
    expect(ratingFromOutcome({ correct: true, latencyMs: DEFAULT_LATENCY_THRESHOLDS.guessMs - 1 })).toBe(
      Rating.Hard,
    );
    expect(ratingFromOutcome({ correct: true, latencyMs: 9000, flaggedGuess: true })).toBe(Rating.Hard);
  });

  it('never returns Easy, whatever the outcome', () => {
    for (const correct of [true, false]) {
      for (const latencyMs of [0, 1, 1999, 2000, 5000, 29999, 30001, 600000]) {
        for (const flaggedGuess of [true, false]) {
          expect(ratingFromOutcome({ correct, latencyMs, flaggedGuess })).not.toBe(Rating.Easy);
        }
      }
    }
  });

  it('ignores the latency bands when latency was imputed by the migration', () => {
    // A legacy-migrated record carries latencyMs: 0, which must not be read as
    // an impossibly fast guess.
    expect(ratingFromOutcome({ correct: true, latencyMs: 0, imputed: ['latencyMs'] })).toBe(Rating.Good);
    expect(ratingFromOutcome({ correct: true, latencyMs: 0 })).toBe(Rating.Hard);
  });
});

describe('difficulty / ease mapping', () => {
  it('round-trips across the FSRS 1..10 scale', () => {
    for (const difficulty of [1, 2.5, 5, 7.5, 10]) {
      expect(easeToDifficulty(difficultyToEase(difficulty))).toBeCloseTo(difficulty, 10);
    }
    expect(difficultyToEase(1)).toBeCloseTo(2.5, 10);
    expect(difficultyToEase(10)).toBeCloseTo(1.3, 10);
  });
});

describe('scheduling', () => {
  it('starts a card in the New state, due immediately', () => {
    const card = newCard('q1', NOW);
    expect(card.state).toBe(CardState.New);
    expect(card).toMatchObject({ reps: 0, lapses: 0, stability: 0, scheduledDays: 0, lastReview: null });
    expect(card.due).toBe(NOW);
  });

  it('graduates a new card to 2 days on Good and 1 day on Hard', () => {
    const good = scheduleCard(newCard('q1', NOW), Rating.Good, NOW);
    expect(good.state).toBe(CardState.Review);
    expect(good.scheduledDays).toBe(GRADUATE_GOOD_DAYS);
    expect(good.due).toBe(NOW + GRADUATE_GOOD_DAYS * DAY);
    expect(good.stability).toBe(GRADUATE_GOOD_DAYS);

    const hard = scheduleCard(newCard('q1', NOW), Rating.Hard, NOW);
    expect(hard.scheduledDays).toBe(GRADUATE_HARD_DAYS);
    expect(hard.difficulty).toBeGreaterThan(good.difficulty);
  });

  it('lapses to relearning on Again and re-shows within the session', () => {
    const mature: Card = { ...newCard('q1', NOW), state: CardState.Review, stability: 30, reps: 5, lapses: 1 };
    const lapsed = scheduleCard(mature, Rating.Again, NOW);
    expect(lapsed.state).toBe(CardState.Relearning);
    expect(lapsed.lapses).toBe(2);
    expect(lapsed.scheduledDays).toBe(0);
    expect(lapsed.stability).toBe(0);
    expect(lapsed.due).toBe(NOW + RELEARN_STEP_MINUTES * 60 * 1000);
    expect(lapsed.difficulty).toBeGreaterThan(mature.difficulty);
  });

  it('multiplies the interval by the ease factor on a mature Good', () => {
    const mature: Card = {
      ...newCard('q1', NOW),
      state: CardState.Review,
      stability: 10,
      scheduledDays: 10,
      reps: 3,
      lastReview: NOW - 10 * DAY,
    };
    const next = scheduleCard(mature, Rating.Good, NOW);
    // Good is ease-neutral in SM-2, so the ease stays at difficulty 5's value.
    expect(next.scheduledDays).toBe(Math.round(10 * difficultyToEase(5)));
    expect(next.elapsedDays).toBeCloseTo(10, 6);
    expect(next.difficulty).toBeCloseTo(5, 6);
  });

  it('grows the interval only slightly on a mature Hard', () => {
    const mature: Card = { ...newCard('q1', NOW), state: CardState.Review, stability: 10, reps: 3 };
    const next = scheduleCard(mature, Rating.Hard, NOW);
    expect(next.scheduledDays).toBe(12);
    expect(next.scheduledDays).toBeLessThan(Math.round(10 * difficultyToEase(5)));
  });

  it('caps the interval', () => {
    const huge: Card = { ...newCard('q1', NOW), state: CardState.Review, stability: 5000, reps: 20 };
    expect(scheduleCard(huge, Rating.Good, NOW).scheduledDays).toBe(365);
  });

  it('does not mutate the card it grades', () => {
    const card = newCard('q1', NOW);
    scheduleCard(card, Rating.Good, NOW);
    expect(card.reps).toBe(0);
    expect(card.state).toBe(CardState.New);
  });

  it('grades straight from a quiz outcome', () => {
    const { card, rating } = gradeCard(newCard('q1', NOW), { correct: true, latencyMs: 6000 }, NOW);
    expect(rating).toBe(Rating.Good);
    expect(card.scheduledDays).toBe(GRADUATE_GOOD_DAYS);
  });
});

describe('due queue and leeches', () => {
  it('flags a card as a leech at six lapses', () => {
    expect(isLeech({ ...newCard('q', NOW), lapses: LEECH_LAPSE_THRESHOLD - 1 })).toBe(false);
    expect(isLeech({ ...newCard('q', NOW), lapses: LEECH_LAPSE_THRESHOLD })).toBe(true);
  });

  it('splits due, leech and upcoming cards, most overdue first', () => {
    const cards: Card[] = [
      { ...newCard('late', NOW), due: NOW - 5 * DAY },
      { ...newCard('justDue', NOW), due: NOW - 1000 },
      { ...newCard('leech', NOW), due: NOW - 2 * DAY, lapses: 7 },
      { ...newCard('future', NOW), due: NOW + DAY },
    ];
    const queue = selectDueQueue(cards, { now: NOW });
    expect(queue.due.map((c) => c.qid)).toEqual(['late', 'justDue']);
    expect(queue.leeches.map((c) => c.qid)).toEqual(['leech']);
    expect(queue.upcoming.map((c) => c.qid)).toEqual(['future']);
  });

  it('honours the session limit', () => {
    const cards = Array.from({ length: 10 }, (_, i) => ({ ...newCard(`q${i}`, NOW), due: NOW - i * 1000 }));
    expect(selectDueQueue(cards, { now: NOW, limit: 3 }).due).toHaveLength(3);
  });
});

describe('next-question selection', () => {
  const theta = 1200;

  function candidate(qid: string, subchapter: string, itemElo: number, due?: number): QuestionCandidate {
    return { qid, topicId: 'book-ch1', subchapter, itemElo, due };
  }

  it('targets roughly 80% success, i.e. items easier than the learner', () => {
    const target = eloForSuccessProbability(theta, 0.8);
    const picked = selectNextQuestions(
      [
        candidate('far-hard', 'a', theta + 400),
        candidate('on-target', 'b', Math.round(target)),
        candidate('far-easy', 'c', theta - 700),
      ],
      { chapterTheta: theta, count: 1, now: NOW },
    );
    expect(picked[0].qid).toBe('on-target');
    expect(picked[0].predictedSuccess).toBeCloseTo(0.8, 2);
    // Sanity-check the direction: the on-target item is EASIER than the learner.
    expect(picked[0].itemElo).toBeLessThan(theta);
    expect(expectedCorrect(theta, theta + 240)).toBeLessThan(0.25);
  });

  it('prefers a due item over a slightly better-matched new one', () => {
    const target = Math.round(eloForSuccessProbability(theta, 0.8));
    const picked = selectNextQuestions(
      [
        candidate('new-perfect', 'a', target),
        candidate('due-nearby', 'b', target + 100, NOW - DAY),
      ],
      { chapterTheta: theta, count: 1, now: NOW },
    );
    expect(picked[0].qid).toBe('due-nearby');
    expect(picked[0].wasDue).toBe(true);
  });

  it('never emits more than three consecutive items from one sub-chapter', () => {
    const target = Math.round(eloForSuccessProbability(theta, 0.8));
    const candidates: QuestionCandidate[] = [
      // 12 items from 'a' all perfectly on target, so a naive greedy selector
      // would emit twelve in a row.
      ...Array.from({ length: 12 }, (_, i) => candidate(`a${String(i).padStart(2, '0')}`, 'a', target)),
      ...Array.from({ length: 8 }, (_, i) => candidate(`b${String(i).padStart(2, '0')}`, 'b', target + 5)),
    ];
    const picked = selectNextQuestions(candidates, { chapterTheta: theta, count: 16, now: NOW });
    expect(picked).toHaveLength(16);

    let run = 1;
    let longest = 1;
    for (let i = 1; i < picked.length; i += 1) {
      run = picked[i].subchapter === picked[i - 1].subchapter ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    expect(longest).toBe(MAX_CONSECUTIVE_SAME_SUBCHAPTER);
    expect(longest).toBeLessThanOrEqual(MAX_CONSECUTIVE_SAME_SUBCHAPTER);
  });

  it('stops short rather than breaking the interleaving constraint', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => candidate(`a${i}`, 'only-one', 1000));
    const picked = selectNextQuestions(candidates, { chapterTheta: theta, count: 10, now: NOW });
    expect(picked).toHaveLength(MAX_CONSECUTIVE_SAME_SUBCHAPTER);
  });

  it('never repeats a question inside one selection', () => {
    const candidates = [candidate('q1', 'a', 1000), candidate('q2', 'b', 1000)];
    const picked = selectNextQuestions(candidates, { chapterTheta: theta, count: 5, now: NOW });
    expect(new Set(picked.map((p) => p.qid)).size).toBe(picked.length);
  });

  it('is deterministic', () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      candidate(`q${i}`, `s${i % 4}`, 900 + i * 13),
    );
    const first = selectNextQuestions(candidates, { chapterTheta: theta, count: 10, now: NOW });
    const second = selectNextQuestions(candidates, { chapterTheta: theta, count: 10, now: NOW });
    expect(first.map((p) => p.qid)).toEqual(second.map((p) => p.qid));
  });
});

describe('normalCdf', () => {
  it('matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413, 4);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 4);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
});

describe('examReadiness', () => {
  const blueprint = (estimates: MasteryEstimate[]): ReadinessSection[] =>
    estimates.map((estimate, i) => ({ unitId: `u${i}`, marks: 10, estimate }));

  it('caps the estimate at 0.35 + 0.65 * coverage, and says so', () => {
    // Ten units, every one answered well but only on a narrow slice.
    const readiness = examReadiness(blueprint(Array.from({ length: 10 }, () => assessed(0.9, 0.1))));
    expect(readiness.overallCoverage).toBeCloseTo(0.1, 10);
    expect(readiness.cap).toBeCloseTo(0.415, 10);
    expect(readiness.uncappedScore).toBeCloseTo(0.9, 10);
    expect(readiness.expectedScore).toBeCloseTo(0.415, 10);
    expect(readiness.cappedBy).toBe('coverage');
  });

  it('cannot show 90% ready to someone who has seen 4% of the bank', () => {
    // One unit mastered out of 25; the other 24 untouched.
    const sections: ReadinessSection[] = [
      { unitId: 'seen', marks: 10, estimate: assessed(0.95, 1, 40) },
      ...Array.from({ length: 24 }, (_, i) => ({
        unitId: `unseen${i}`,
        marks: 10,
        estimate: notAssessed(),
      })),
    ];
    const readiness = examReadiness(sections);
    expect(readiness.overallCoverage).toBeCloseTo(0.04, 10);
    expect(readiness.cap).toBeCloseTo(0.376, 10);
    expect(readiness.expectedScore).toBeLessThanOrEqual(readiness.cap);
    expect(readiness.notAssessedMarks).toBe(240);
    expect(readiness.assessedMarks).toBe(10);
  });

  it('leaves a genuinely well-covered learner uncapped', () => {
    const readiness = examReadiness(blueprint(Array.from({ length: 10 }, () => assessed(0.82, 1, 60))));
    expect(readiness.cap).toBeCloseTo(1, 10);
    expect(readiness.cappedBy).toBeNull();
    expect(readiness.expectedScore).toBeCloseTo(0.82, 10);
    expect(readiness.probabilityOfPassing).toBeGreaterThan(0.99);
  });

  it('always returns an interval alongside the point estimate', () => {
    const readiness = examReadiness(blueprint(Array.from({ length: 10 }, () => assessed(0.6, 0.8, 15))));
    expect(readiness.interval.level).toBe(0.9);
    expect(readiness.interval.lower).toBeLessThan(readiness.expectedScore);
    expect(readiness.interval.upper).toBeGreaterThan(readiness.expectedScore);
    expect(readiness.interval.lower).toBeGreaterThanOrEqual(0);
    expect(readiness.interval.upper).toBeLessThanOrEqual(1);
    expect(readiness.standardDeviation).toBeGreaterThan(0);
  });

  it('widens the interval when the sample behind it is thin', () => {
    const thin = examReadiness(blueprint(Array.from({ length: 10 }, () => assessed(0.6, 1, 4))));
    const thick = examReadiness(blueprint(Array.from({ length: 10 }, () => assessed(0.6, 1, 200))));
    const width = (r: typeof thin) => r.interval.upper - r.interval.lower;
    expect(width(thin)).toBeGreaterThan(width(thick));
  });

  it('treats an unassessed unit as the guess floor with wide uncertainty', () => {
    const allUnknown = examReadiness(blueprint(Array.from({ length: 10 }, () => notAssessed())));
    expect(allUnknown.overallCoverage).toBe(0);
    expect(allUnknown.cap).toBeCloseTo(0.35, 10);
    expect(allUnknown.uncappedScore).toBeCloseTo(0.25, 10);
    // Below the cap, so the cap is not what is holding it down here.
    expect(allUnknown.cappedBy).toBeNull();
    expect(allUnknown.probabilityOfPassing).toBeLessThan(0.3);
  });

  it('degrades safely on an empty blueprint', () => {
    const readiness = examReadiness([]);
    expect(readiness).toMatchObject({ expectedScore: 0, totalMarks: 0, probabilityOfPassing: 0 });
  });

  it('formats as a range, never a bare number', () => {
    const capped = examReadiness(blueprint(Array.from({ length: 10 }, () => assessed(0.9, 0.1))));
    const text = formatReadiness(capped);
    expect(text).toMatch(/%\s*\(\d+%–\d+%\)/);
    expect(text).toMatch(/capped/);
    expect(formatReadiness(examReadiness(blueprint([assessed(0.7, 1, 50)])))).toMatch(/–/);
  });
});
