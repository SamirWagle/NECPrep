/**
 * scheduler — spaced repetition, next-question selection, and exam readiness.
 *
 * WHY SM-2 IN AN FSRS-SHAPED BOX
 * ------------------------------
 * FSRS is the better algorithm: it models memory stability and retrievability
 * directly and fits its parameters to the learner's own review history. But a
 * real FSRS needs either the `ts-fsrs` package or a careful reimplementation of
 * a 17-parameter optimiser, and this phase is not adding a dependency.
 *
 * So the *scheduling policy* here is SM-2, while the *persisted state* is
 * FSRS-shaped: `{stability, difficulty, elapsedDays, scheduledDays, reps,
 * lapses, state, due, lastReview}`. Dropping in a real FSRS later is then a code
 * change with no data migration — the fields already exist and already carry the
 * right meanings:
 *
 *   - `stability`  = the current interval in days. Under SM-2 this is the
 *     scheduled gap; under FSRS it is the memory-stability parameter. They are
 *     the same quantity measured differently, and SM-2's value is a usable
 *     starting point for FSRS's.
 *   - `difficulty` = 1 (easiest) … 10 (hardest), FSRS's scale. SM-2's ease
 *     factor is derived from it on the fly (see {@link difficultyToEase}) rather
 *     than stored, so there is no SM-2-only field to migrate away.
 *
 * NO SELF-GRADING
 * ---------------
 * FSRS and SM-2 both expect the learner to rate their own recall. Asking an
 * exam candidate "how well did you know that?" after every MCQ is friction they
 * will not pay, and self-ratings are unreliable anyway. {@link ratingFromOutcome}
 * derives the rating from what the quiz already measured: correctness, latency
 * and the guess flag. It never returns `Easy` — see that function for why.
 */

import { eloForSuccessProbability, expectedCorrect } from './ability';
import { SHRINKAGE_K } from './mastery';
import type { MasteryEstimate } from './mastery';
import type { ImputedField } from './responseLog';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

// ─── Card state ───────────────────────────────────────────────────────────────

/** FSRS rating scale. */
export const Rating = {
  Again: 1,
  Hard: 2,
  Good: 3,
  Easy: 4,
} as const;

export type Rating = (typeof Rating)[keyof typeof Rating];

/** FSRS card states: 0 New, 1 Learning, 2 Review, 3 Relearning. */
export const CardState = {
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3,
} as const;

export type CardState = (typeof CardState)[keyof typeof CardState];

export interface Card {
  qid: string;
  /** Current interval in days. FSRS will reinterpret this as memory stability. */
  stability: number;
  /** 1 (easiest) … 10 (hardest), FSRS's scale. */
  difficulty: number;
  /** Days between the previous review and the one just graded. */
  elapsedDays: number;
  /** Days until the next review, as set by the last grading. */
  scheduledDays: number;
  reps: number;
  lapses: number;
  state: CardState;
  /** Epoch ms when the card next becomes due. */
  due: number;
  /** Epoch ms of the last grading, or null for a new card. */
  lastReview: number | null;
}

/** FSRS's default starting difficulty: mid-scale, i.e. "we do not know yet". */
export const INITIAL_DIFFICULTY = 5;

export const MIN_EASE = 1.3;
export const MAX_EASE = 2.5;

/** Interval granted when a card first graduates, by rating. */
export const GRADUATE_HARD_DAYS = 1;
export const GRADUATE_GOOD_DAYS = 2;

/** Re-show a lapsed card after this long, inside the same session. */
export const RELEARN_STEP_MINUTES = 10;

/** `Hard` on a mature card grows the interval only slightly. */
export const HARD_INTERVAL_MULTIPLIER = 1.2;
/** `Easy` bonus, kept for a future FSRS/manual-grade path. */
export const EASY_INTERVAL_BONUS = 1.3;

export const MAX_INTERVAL_DAYS = 365;

/** Six lapses is Anki's long-standing default, and it holds up: a card that has
 *  been forgotten six times is not a scheduling problem, it is a comprehension
 *  problem, and re-showing it on a curve wastes the learner's time. */
export const LEECH_LAPSE_THRESHOLD = 6;

export function newCard(qid: string, now: number = Date.now()): Card {
  return {
    qid,
    stability: 0,
    difficulty: INITIAL_DIFFICULTY,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    state: CardState.New,
    due: now,
    lastReview: null,
  };
}

/** difficulty 1 → ease 2.5, difficulty 10 → ease 1.3. */
export function difficultyToEase(difficulty: number): number {
  const clamped = Math.min(10, Math.max(1, difficulty));
  return MAX_EASE - ((clamped - 1) * (MAX_EASE - MIN_EASE)) / 9;
}

export function easeToDifficulty(ease: number): number {
  const clamped = Math.min(MAX_EASE, Math.max(MIN_EASE, ease));
  return 1 + ((MAX_EASE - clamped) * 9) / (MAX_EASE - MIN_EASE);
}

/** SM-2's quality scale, from the FSRS rating. */
function qualityOf(rating: Rating): number {
  return rating + 1; // Again→2, Hard→3, Good→4, Easy→5
}

/** SM-2's ease-factor delta. `Good` is neutral by construction. */
function easeDelta(rating: Rating): number {
  const q = qualityOf(rating);
  return 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
}

// ─── Outcome → rating ─────────────────────────────────────────────────────────

export interface LatencyThresholds {
  /**
   * Answers faster than this are treated as guesses rather than recall: a
   * correct answer under it is either prior memorisation of the *answer
   * position* or luck, and neither deserves a long interval.
   *
   * This is only a fallback. `Outcome.flaggedGuess` is the canonical signal and
   * is computed per session by `features/quiz/guess.ts`, whose threshold is
   * `max(4000ms, 0.35 x session median)` — adaptive, and therefore better than
   * any fixed number. The default here matches that module's absolute floor so
   * the two layers cannot disagree on an unflagged record.
   */
  guessMs: number;
  /** Correct but slower than this means effortful reconstruction, not recall. */
  slowMs: number;
}

export const DEFAULT_LATENCY_THRESHOLDS: LatencyThresholds = {
  guessMs: 4000,
  slowMs: 30000,
};

export interface Outcome {
  correct: boolean;
  latencyMs: number;
  flaggedGuess?: boolean;
  /**
   * Fields the record could not observe. When `latencyMs` is imputed (every
   * legacy-migrated record has it as a fabricated 0) the latency bands are
   * skipped, because 0 ms would otherwise read as an impossible instant guess.
   */
  imputed?: readonly ImputedField[];
}

/**
 * Maps a quiz outcome to a scheduling rating without asking the learner to
 * grade themselves.
 *
 *   wrong                        → Again
 *   correct, flagged as a guess  → Hard
 *   correct, under `guessMs`     → Hard
 *   correct, over `slowMs`       → Hard
 *   correct, in between          → Good
 *
 * `Easy` is deliberately unreachable. On a four-option MCQ, "fast and correct"
 * carries a 25% guess floor, so promoting it to `Easy` (a 1.3x interval bonus
 * on top of the ease factor) systematically over-schedules lucky guesses. A
 * learner can only earn long intervals by being right repeatedly over time,
 * which is the evidence that actually distinguishes recall from luck.
 */
export function ratingFromOutcome(
  outcome: Outcome,
  thresholds: LatencyThresholds = DEFAULT_LATENCY_THRESHOLDS,
): Rating {
  if (!outcome.correct) return Rating.Again;
  if (outcome.flaggedGuess === true) return Rating.Hard;
  const latencyUnknown = outcome.imputed?.includes('latencyMs') ?? false;
  if (latencyUnknown) return Rating.Good;
  if (outcome.latencyMs < thresholds.guessMs) return Rating.Hard;
  if (outcome.latencyMs > thresholds.slowMs) return Rating.Hard;
  return Rating.Good;
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

export interface ScheduleOptions {
  maxIntervalDays?: number;
  relearnStepMinutes?: number;
}

/**
 * Grades a card and returns the next card state. Pure: the input card is not
 * mutated, so the full schedule can be rebuilt by folding the response log.
 */
export function scheduleCard(
  card: Card,
  rating: Rating,
  now: number = Date.now(),
  options: ScheduleOptions = {},
): Card {
  const maxIntervalDays = options.maxIntervalDays ?? MAX_INTERVAL_DAYS;
  const relearnStepMinutes = options.relearnStepMinutes ?? RELEARN_STEP_MINUTES;

  const elapsedDays = card.lastReview === null ? 0 : Math.max(0, (now - card.lastReview) / MS_PER_DAY);
  const ease = Math.min(MAX_EASE, Math.max(MIN_EASE, difficultyToEase(card.difficulty) + easeDelta(rating)));
  const difficulty = easeToDifficulty(ease);

  if (rating === Rating.Again) {
    return {
      ...card,
      difficulty,
      elapsedDays,
      scheduledDays: 0,
      stability: 0,
      reps: card.reps + 1,
      lapses: card.lapses + 1,
      state: CardState.Relearning,
      due: now + relearnStepMinutes * MS_PER_MINUTE,
      lastReview: now,
    };
  }

  const isGraduating =
    card.state === CardState.New || card.state === CardState.Learning || card.state === CardState.Relearning;

  let scheduledDays: number;
  if (isGraduating) {
    scheduledDays = rating === Rating.Hard ? GRADUATE_HARD_DAYS : GRADUATE_GOOD_DAYS;
  } else if (rating === Rating.Hard) {
    scheduledDays = Math.round(Math.max(1, card.stability) * HARD_INTERVAL_MULTIPLIER);
  } else if (rating === Rating.Easy) {
    scheduledDays = Math.round(Math.max(1, card.stability) * ease * EASY_INTERVAL_BONUS);
  } else {
    scheduledDays = Math.round(Math.max(1, card.stability) * ease);
  }
  scheduledDays = Math.min(maxIntervalDays, Math.max(1, scheduledDays));

  return {
    ...card,
    difficulty,
    elapsedDays,
    scheduledDays,
    stability: scheduledDays,
    reps: card.reps + 1,
    lapses: card.lapses,
    state: CardState.Review,
    due: now + scheduledDays * MS_PER_DAY,
    lastReview: now,
  };
}

/** Convenience: grade straight from a quiz outcome. */
export function gradeCard(
  card: Card,
  outcome: Outcome,
  now: number = Date.now(),
  options: ScheduleOptions & { thresholds?: LatencyThresholds } = {},
): { card: Card; rating: Rating } {
  const rating = ratingFromOutcome(outcome, options.thresholds ?? DEFAULT_LATENCY_THRESHOLDS);
  return { card: scheduleCard(card, rating, now, options), rating };
}

export function isLeech(card: Card, threshold: number = LEECH_LAPSE_THRESHOLD): boolean {
  return card.lapses >= threshold;
}

export interface DueQueue {
  /** Due now, most overdue first. */
  due: Card[];
  /**
   * Due, but repeatedly forgotten. Separated rather than dropped: the product
   * should offer to reword, suspend or re-teach these, not keep drilling them.
   */
  leeches: Card[];
  /** Not due yet; the caller tops the session up from new material instead. */
  upcoming: Card[];
}

export interface DueQueueOptions {
  now?: number;
  limit?: number;
  leechThreshold?: number;
}

export function selectDueQueue(cards: Card[], options: DueQueueOptions = {}): DueQueue {
  const now = options.now ?? Date.now();
  const leechThreshold = options.leechThreshold ?? LEECH_LAPSE_THRESHOLD;
  const due: Card[] = [];
  const leeches: Card[] = [];
  const upcoming: Card[] = [];

  for (const card of cards) {
    if (card.due > now) upcoming.push(card);
    else if (isLeech(card, leechThreshold)) leeches.push(card);
    else due.push(card);
  }

  const byDue = (a: Card, b: Card) => a.due - b.due;
  due.sort(byDue);
  leeches.sort(byDue);
  upcoming.sort(byDue);

  return {
    due: options.limit === undefined ? due : due.slice(0, Math.max(0, options.limit)),
    leeches,
    upcoming,
  };
}

// ─── Next-question selection ──────────────────────────────────────────────────

/**
 * The success rate practice aims for.
 *
 * 80% is the standard desirable-difficulty target: high enough that the session
 * is not demoralising, low enough that most items carry information. Note what
 * this implies for the Elo target. With
 * `expected = 1 / (1 + 10^((itemElo - theta) / 400))`, an item rated *above*
 * the learner is the HARDER one, so an 80%-success item sits at
 * `theta + 400*log10(0.25) ≈ theta - 240`.
 *
 * The phase brief specified `targetElo = chapterTheta + 240`. Under the brief's
 * own `expected` formula that is a ~20% success rate, i.e. the learner gets four
 * out of five wrong — the opposite of the stated intent. The magnitude of 240
 * is kept and the sign is taken from the stated 80% target, via
 * {@link eloForSuccessProbability}, so the constant and the intent agree. A
 * caller that really wants the other direction can pass
 * `targetSuccessProbability: 0.2`.
 */
export const TARGET_SUCCESS_PROBABILITY = 0.8;

/** Never more than this many consecutive items from one sub-chapter. */
export const MAX_CONSECUTIVE_SAME_SUBCHAPTER = 3;

export interface QuestionCandidate {
  qid: string;
  topicId: string;
  /** Sub-chapter id, or the chapter id when the bank has no sub-chapters. */
  subchapter: string;
  /** Current item Elo from the ability snapshot. */
  itemElo: number;
  /** Due timestamp when this item already has a card; omit for unseen items. */
  due?: number | null;
}

export interface SelectQuestionsOptions {
  /** Ability for the chapter being practised, from `chapterTheta()`. */
  chapterTheta: number;
  count: number;
  now?: number;
  targetSuccessProbability?: number;
  maxConsecutiveSameSubchapter?: number;
  /**
   * Elo-points of preference given to an item that is due for review. 120
   * points is roughly half the 80%-target offset, so a due item wins against a
   * better-matched new item only when the difficulty mismatch is modest.
   */
  dueBonusElo?: number;
}

export interface SelectedQuestion extends QuestionCandidate {
  /** Predicted success probability at selection time. */
  predictedSuccess: number;
  /** Distance from the target difficulty, in Elo points, after the due bonus. */
  cost: number;
  wasDue: boolean;
}

/**
 * Picks the next `count` questions.
 *
 * Two jobs at once:
 *   1. Difficulty targeting — prefer items whose Elo is closest to the
 *      80%-success point for this learner in this chapter.
 *   2. Interleaving — never more than `maxConsecutiveSameSubchapter`
 *      consecutive items from the same sub-chapter. Blocked practice (all of
 *      5.1, then all of 5.2) produces better in-session performance and worse
 *      retention; interleaving is one of the few study-design effects that
 *      replicates reliably.
 *
 * The constraint is hard. If the only remaining candidates would violate it,
 * selection stops short of `count` rather than emitting a run of four — a
 * shorter honest session beats a longer one that quietly abandons the design.
 */
export function selectNextQuestions(
  candidates: QuestionCandidate[],
  options: SelectQuestionsOptions,
): SelectedQuestion[] {
  const now = options.now ?? Date.now();
  const maxRun = options.maxConsecutiveSameSubchapter ?? MAX_CONSECUTIVE_SAME_SUBCHAPTER;
  const targetP = options.targetSuccessProbability ?? TARGET_SUCCESS_PROBABILITY;
  const dueBonus = options.dueBonusElo ?? 120;
  const targetElo = eloForSuccessProbability(options.chapterTheta, targetP);

  const scored = candidates.map((candidate) => {
    const wasDue = candidate.due !== undefined && candidate.due !== null && candidate.due <= now;
    const cost = Math.abs(candidate.itemElo - targetElo) - (wasDue ? dueBonus : 0);
    return {
      ...candidate,
      predictedSuccess: expectedCorrect(options.chapterTheta, candidate.itemElo),
      cost,
      wasDue,
    };
  });

  // Stable ordering: cost, then qid, so selection is deterministic and testable.
  scored.sort((a, b) => (a.cost === b.cost ? (a.qid < b.qid ? -1 : 1) : a.cost - b.cost));

  const picked: SelectedQuestion[] = [];
  const used = new Set<string>();
  let runSubchapter: string | null = null;
  let runLength = 0;

  while (picked.length < options.count) {
    let chosen: SelectedQuestion | null = null;
    for (const candidate of scored) {
      if (used.has(candidate.qid)) continue;
      if (runSubchapter === candidate.subchapter && runLength >= maxRun) continue;
      chosen = candidate;
      break;
    }
    if (!chosen) break;

    used.add(chosen.qid);
    picked.push(chosen);
    if (runSubchapter === chosen.subchapter) runLength += 1;
    else {
      runSubchapter = chosen.subchapter;
      runLength = 1;
    }
  }

  return picked;
}

// ─── Exam readiness ───────────────────────────────────────────────────────────

/**
 * Probability assigned to a sub-chapter the learner has never been assessed on.
 *
 * 0.25 is the four-option guess floor. It is the only defensible number: the
 * learner may well know the material, but nothing in the log says so, and the
 * alternative (borrowing the chapter mean) would let a readiness score rise on
 * the strength of questions never answered. The wide variance assigned below is
 * what carries the "we do not know" part.
 */
export const UNASSESSED_PROBABILITY = 0.25;

/** NEC-style default. Override per exam; this is an assumption, not a fact. */
export const DEFAULT_PASS_MARK = 0.4;

export const Z_FOR_LEVEL: Record<string, number> = {
  '0.5': 0.674,
  '0.8': 1.282,
  '0.9': 1.645,
  '0.95': 1.96,
};

export interface ReadinessSection {
  unitId: string;
  /** Blueprint marks this unit is worth in the real exam. */
  marks: number;
  estimate: MasteryEstimate;
}

export interface ReadinessOptions {
  passMark?: number;
  unassessedProbability?: number;
  intervalLevel?: 0.5 | 0.8 | 0.9 | 0.95;
  /** Shrinkage pseudo-count used when turning confidence into variance. */
  k?: number;
}

export interface ExamReadiness {
  /** Expected fraction of total marks, AFTER the coverage cap. */
  expectedScore: number;
  /** What the model said before the cap; shown so the cap is auditable. */
  uncappedScore: number;
  /** Variance of `expectedScore` as a fraction of total marks. */
  variance: number;
  standardDeviation: number;
  /**
   * Mandatory companion to `expectedScore`. There is no code path that produces
   * a point estimate without one, so a UI cannot render a bare percentage
   * without deliberately discarding this field.
   */
  interval: { lower: number; upper: number; level: number };
  probabilityOfPassing: number;
  cappedBy: 'coverage' | null;
  /** The cap that was applied: `0.35 + 0.65 * overallCoverage`. */
  cap: number;
  overallCoverage: number;
  totalMarks: number;
  assessedMarks: number;
  notAssessedMarks: number;
  passMark: number;
}

/** Normal CDF via Abramowitz & Stegun 7.1.26; max error ~1.5e-7. */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Turns per-sub-chapter mastery plus blueprint marks into a readiness estimate.
 *
 * TWO HONESTY CONSTRAINTS, both mandatory:
 *
 *   1. COVERAGE CAP. `expectedScore` is capped at `0.35 + 0.65 * overallCoverage`.
 *      A learner who has seen 4% of the bank gets a ceiling of ~0.38 no matter
 *      how well they did on those questions, because a sample that small says
 *      almost nothing about the other 96%. Without the cap, three perfect
 *      sessions produce "90% ready" and the learner stops revising.
 *   2. INTERVAL ALWAYS RETURNED. The point estimate is never returned alone —
 *      see {@link ExamReadiness.interval}.
 *
 * `sections` must be the FULL blueprint, including units never practised. If
 * the caller passes only the units with data, `overallCoverage` is computed over
 * the wrong denominator, the cap never binds, and constraint 1 silently stops
 * working. Use `withUnassessedUnits()` from mastery.ts to build the full list.
 *
 * The model is a normal approximation to the sum of per-section mark totals.
 * Each section contributes two sources of variance:
 *   - sampling:  `marks * p * (1 - p)` — exam-day luck on the questions drawn;
 *   - estimation: `marks^2 * p * (1 - p) / (nEff + k)` — our uncertainty about
 *     `p` itself, which is what makes a thin sample widen the interval.
 */
export function examReadiness(sections: ReadinessSection[], options: ReadinessOptions = {}): ExamReadiness {
  const passMark = options.passMark ?? DEFAULT_PASS_MARK;
  const unassessedP = options.unassessedProbability ?? UNASSESSED_PROBABILITY;
  const level = options.intervalLevel ?? 0.9;
  const k = options.k ?? SHRINKAGE_K;
  const z = Z_FOR_LEVEL[String(level)] ?? 1.645;

  const totalMarks = sections.reduce((sum, section) => sum + Math.max(0, section.marks), 0);
  if (totalMarks <= 0) {
    return {
      expectedScore: 0,
      uncappedScore: 0,
      variance: 0,
      standardDeviation: 0,
      interval: { lower: 0, upper: 0, level },
      probabilityOfPassing: 0,
      cappedBy: null,
      cap: 0.35,
      overallCoverage: 0,
      totalMarks: 0,
      assessedMarks: 0,
      notAssessedMarks: 0,
      passMark,
    };
  }

  let expectedMarks = 0;
  let varianceMarks = 0;
  let coverageMarks = 0;
  let assessedMarks = 0;
  let notAssessedMarks = 0;

  for (const section of sections) {
    const marks = Math.max(0, section.marks);
    if (marks === 0) continue;
    const estimate = section.estimate;
    const assessed = estimate.state === 'assessed';
    const p = assessed ? Math.min(1, Math.max(0, estimate.mastery)) : unassessedP;
    const nEff = assessed ? estimate.nEff : 0;

    if (assessed) assessedMarks += marks;
    else notAssessedMarks += marks;

    expectedMarks += marks * p;
    const bernoulli = p * (1 - p);
    varianceMarks += marks * bernoulli + (marks * marks * bernoulli) / (nEff + k);
    coverageMarks += marks * estimate.coverage;
  }

  const overallCoverage = Math.min(1, coverageMarks / totalMarks);
  const uncappedScore = expectedMarks / totalMarks;
  const cap = 0.35 + 0.65 * overallCoverage;
  const expectedScore = Math.min(uncappedScore, cap);
  const cappedBy = uncappedScore > cap ? 'coverage' : null;

  const variance = varianceMarks / (totalMarks * totalMarks);
  const standardDeviation = Math.sqrt(variance);

  const probabilityOfPassing =
    standardDeviation <= 0
      ? expectedScore >= passMark
        ? 1
        : 0
      : 1 - normalCdf((passMark - expectedScore) / standardDeviation);

  return {
    expectedScore,
    uncappedScore,
    variance,
    standardDeviation,
    interval: {
      lower: Math.max(0, expectedScore - z * standardDeviation),
      upper: Math.min(1, expectedScore + z * standardDeviation),
      level,
    },
    probabilityOfPassing,
    cappedBy,
    cap,
    overallCoverage,
    totalMarks,
    assessedMarks,
    notAssessedMarks,
    passMark,
  };
}

/**
 * The only rendering of a readiness figure this module endorses: a range, plus
 * the reason when the coverage cap is doing the talking.
 */
export function formatReadiness(readiness: ExamReadiness): string {
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const range = `${pct(readiness.expectedScore)} (${pct(readiness.interval.lower)}–${pct(readiness.interval.upper)})`;
  return readiness.cappedBy === 'coverage'
    ? `${range}, capped — you have covered ${pct(readiness.overallCoverage)} of the syllabus`
    : range;
}
