/**
 * Spaced repetition scheduling - a trimmed SM-2.
 *
 * Pure, and the server is the only place it runs: the due queue and the next
 * interval are server state, so a client cannot bring a card forward to farm an
 * easy session, and the schedule survives a cleared browser.
 */

import { DAY } from '../lib/time.ts';
import type { SrsGrade, SrsState } from '../shared/types.ts';

export interface CardState {
  dueAt: number;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  state: SrsState;
  revision: number;
}

export const NEW_CARD_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_EASE = 2.8;
/** Ten years. Keeps `dueAt` inside a sane integer range. */
const MAX_INTERVAL_DAYS = 3650;

/** A card for a question the user has never been scheduled on. */
export function newCard(now: number): CardState {
  return {
    dueAt: now,
    intervalDays: 0,
    ease: NEW_CARD_EASE,
    reps: 0,
    lapses: 0,
    state: 'new',
    revision: 0,
  };
}

const EASE_DELTA: Record<SrsGrade, number> = {
  again: -0.20,
  hard: -0.15,
  good: 0,
  easy: 0.15,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Applies one review.
 *
 * `again` sends the card to relearning with a short step rather than resetting
 * the interval to zero: a lapse on a question answered correctly ten times
 * should not cost the whole history. Intervals are rounded to whole days
 * because the queue is day-granular.
 */
export function review(card: CardState, grade: SrsGrade, now: number): CardState {
  const ease = clamp(card.ease + EASE_DELTA[grade], MIN_EASE, MAX_EASE);

  let intervalDays: number;
  let state: SrsState;
  let lapses = card.lapses;

  if (grade === 'again') {
    lapses += 1;
    state = 'relearning';
    // Same day, ten minutes out: expressed in days so the queue only needs one
    // comparison, and floored to a nonzero fraction so the card is not due
    // again on the very next request.
    intervalDays = 0;
  } else if (card.state === 'new' || card.reps === 0) {
    state = 'learning';
    intervalDays = grade === 'hard' ? 1 : grade === 'good' ? 1 : 3;
  } else if (card.state === 'learning' || card.state === 'relearning') {
    state = 'review';
    intervalDays = grade === 'hard' ? 2 : grade === 'good' ? 3 : 5;
  } else {
    state = 'review';
    const multiplier = grade === 'hard' ? 1.2 : grade === 'good' ? ease : ease * 1.3;
    intervalDays = Math.max(1, Math.round(Math.max(1, card.intervalDays) * multiplier));
  }

  intervalDays = clamp(Math.round(intervalDays), 0, MAX_INTERVAL_DAYS);

  const dueAt =
    grade === 'again'
      ? now + 10 * 60 * 1000
      : now + intervalDays * DAY;

  return {
    dueAt,
    intervalDays,
    ease,
    reps: card.reps + 1,
    lapses,
    state,
    revision: card.revision + 1,
  };
}

/**
 * The grade implied by answering a question in practice or in a mock, so
 * answering a question anywhere feeds the schedule without a second request.
 */
export function gradeFromCorrectness(isCorrect: boolean): SrsGrade {
  return isCorrect ? 'good' : 'again';
}
