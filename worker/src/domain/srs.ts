/**
 * Spaced repetition scheduling.
 *
 * Pure, and the server is the only place it runs: the due queue and the next
 * interval are server state, so a client cannot bring a card forward to farm an
 * easy session, and the schedule survives a cleared browser.
 *
 * ===========================================================================
 * FSRS'S VOCABULARY, SM-2'S ARITHMETIC
 * ===========================================================================
 *
 * The columns are FSRS's -- `stability`, `difficulty`, `elapsed_days`,
 * `scheduled_days`, `reps`, `lapses`, `state`, `due`, `last_review` -- because
 * that is what `srs_state` stores (migrations/0005_learning.sql) and what
 * `frontend/src/services/scheduler.ts` already carries on its own `Card`. This
 * module used to speak SM-2's `ease` and `interval_days` instead, and the
 * mapping between the two was the problem: `ease` is a multiplier in
 * [1.3, 2.8] where `difficulty` is a 1..10 scale with the OPPOSITE sense, so
 * every read and write would have had to apply an affine transform, and
 * `applySrsReview` reads a card and writes it straight back -- so the rounding
 * would compound on every single review.
 *
 * What is NOT claimed: this is not FSRS. The update rules below are a trimmed
 * SM-2 re-expressed over `difficulty`, because FSRS needs `pow` and `exp` and
 * D1 does not guarantee SQLite's math functions, and because a real FSRS
 * implementation with fitted parameters is a separate piece of work. The point
 * of speaking FSRS's field names now is that dropping the real scheduler in
 * later is a change to THIS file and nothing else -- no migration, no wire
 * change, no translation layer.
 *
 * `difficulty` is 1..10 and HIGHER IS HARDER, which is the opposite sense to
 * SM-2's ease. Getting that backwards would make every lapse lengthen the
 * interval, so the CHECK in the migration bounds it and the tests pin the
 * direction.
 */

import { DAY } from '../lib/time.ts';
import type { SrsGrade, SrsState } from '../shared/types.ts';

export interface CardState {
  dueAt: number;
  /** Days until recall probability decays to 90%. */
  stability: number;
  /** 1..10, HIGHER IS HARDER. */
  difficulty: number;
  /** The interval the scheduler last asked for, in days. */
  scheduledDays: number;
  /** Real days between `lastReview` and the review being applied. */
  elapsedDays: number;
  reps: number;
  lapses: number;
  state: SrsState;
  /** `srs_state.reps` at the time this card was read. The CAS token. */
  revision: number;
  /** `null` until the first review. `reps = 0` implies this is null. */
  lastReviewAt: number | null;
}

/** The neutral starting difficulty, matching the column default. */
export const NEW_CARD_DIFFICULTY = 5;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;
/** Ten years. Keeps `dueAt` inside a sane integer range. */
const MAX_SCHEDULED_DAYS = 3650;
/** A lapse comes back in ten minutes, not tomorrow. */
const RELEARN_DELAY_MS = 10 * 60 * 1000;

/** A card for a question the user has never been scheduled on. */
export function newCard(now: number): CardState {
  return {
    dueAt: now,
    stability: 0,
    difficulty: NEW_CARD_DIFFICULTY,
    scheduledDays: 0,
    elapsedDays: 0,
    reps: 0,
    lapses: 0,
    state: 'new',
    revision: 0,
    lastReviewAt: null,
  };
}

/**
 * How each grade moves `difficulty`. Signs are the point: a failed review
 * makes the item HARDER for this user, which SHORTENS the next interval.
 */
const DIFFICULTY_DELTA: Record<SrsGrade, number> = {
  again: 1.2,
  hard: 0.6,
  good: 0,
  easy: -0.6,
};

/** 1..4, as `srs_state.last_rating` stores it. */
export const RATING_BY_GRADE: Record<SrsGrade, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

export const STATE_CODE: Record<SrsState, number> = {
  new: 0,
  learning: 1,
  review: 2,
  relearning: 3,
};

export function stateFromCode(code: number): SrsState {
  switch (code) {
    case 1:
      return 'learning';
    case 2:
      return 'review';
    case 3:
      return 'relearning';
    default:
      // Fail closed on an unrecognised value: 'new' is the state that costs a
      // user the least if it is wrong.
      return 'new';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The interval multiplier for a card in `review`.
 *
 * Derived from `difficulty` so there is one scale and not two: an easy item
 * (difficulty 1) multiplies by 2.5, a neutral one (5) by about 1.7, a
 * maximally hard one (10) by 1.2. Never below 1, because an interval that
 * shrinks on a CORRECT answer is a scheduler bug, not a conservative choice.
 */
function reviewMultiplier(difficulty: number, grade: SrsGrade): number {
  const base = 1.2 + ((MAX_DIFFICULTY - difficulty) / (MAX_DIFFICULTY - MIN_DIFFICULTY)) * 1.3;
  const byGrade = grade === 'hard' ? 0.8 : grade === 'easy' ? 1.3 : 1;
  return Math.max(1, base * byGrade);
}

/**
 * Applies one review.
 *
 * `again` sends the card to relearning with a ten-minute step rather than
 * resetting everything: a lapse on a question answered correctly ten times
 * should cost the interval, not the history. `stability` halves rather than
 * zeroing, for the same reason.
 */
export function review(card: CardState, grade: SrsGrade, now: number): CardState {
  const difficulty = clamp(
    card.difficulty + DIFFICULTY_DELTA[grade],
    MIN_DIFFICULTY,
    MAX_DIFFICULTY,
  );
  const elapsedDays =
    card.lastReviewAt === null ? 0 : Math.max(0, (now - card.lastReviewAt) / DAY);

  let scheduledDays: number;
  let state: SrsState;
  let lapses = card.lapses;
  let stability: number;

  if (grade === 'again') {
    lapses += 1;
    state = 'relearning';
    scheduledDays = 0;
    stability = card.stability / 2;
  } else if (card.state === 'new' || card.reps === 0) {
    state = 'learning';
    scheduledDays = grade === 'easy' ? 3 : 1;
    stability = scheduledDays;
  } else if (card.state === 'learning' || card.state === 'relearning') {
    state = 'review';
    scheduledDays = grade === 'hard' ? 2 : grade === 'good' ? 3 : 5;
    stability = scheduledDays;
  } else {
    state = 'review';
    const previous = Math.max(1, card.scheduledDays);
    scheduledDays = Math.round(previous * reviewMultiplier(difficulty, grade));
    stability = scheduledDays;
  }

  scheduledDays = clamp(Math.round(scheduledDays), 0, MAX_SCHEDULED_DAYS);
  stability = clamp(stability, 0, MAX_SCHEDULED_DAYS);

  const dueAt = grade === 'again' ? now + RELEARN_DELAY_MS : now + scheduledDays * DAY;
  const reps = card.reps + 1;

  return {
    dueAt,
    stability,
    difficulty,
    scheduledDays,
    elapsedDays,
    reps,
    lapses,
    state,
    // `reps` IS the revision: every applied review increments it, so a client
    // holding a stale value names a card that has already moved on.
    revision: reps,
    lastReviewAt: now,
  };
}

/**
 * The grade implied by answering a question in practice or in a mock, so
 * answering a question anywhere feeds the schedule without a second request.
 */
export function gradeFromCorrectness(isCorrect: boolean): SrsGrade {
  return isCorrect ? 'good' : 'again';
}
