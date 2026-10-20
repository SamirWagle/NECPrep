/**
 * Guess detection.
 *
 * An answer that lands far faster than the student normally answers is almost
 * never reading-plus-reasoning; it is a tap to move on. Marking those lets
 * later analytics separate "knows it" from "got lucky", which a raw score
 * cannot do.
 *
 * Threshold: `max(4000ms, 0.35 x median latency of this session)`.
 *
 * The absolute floor matters because the relative part collapses on a session
 * where every answer was fast — 35% of a 3-second median is 1 second, which
 * would flag nothing. The relative part matters because a student who takes 60
 * seconds per question is plainly guessing at 8 seconds, which the floor alone
 * would wave through.
 *
 * All functions here are pure; nothing reads the clock.
 */

import type { ResponseRecord } from './types';

/** Nobody reads a four-option question and reasons about it in under 4s. */
export const GUESS_FLOOR_MS = 4000;

/** Fraction of the session median below which an answer reads as a guess. */
export const GUESS_MEDIAN_FRACTION = 0.35;

/** Median of a sample. Returns 0 for an empty sample. Does not mutate the input. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The latency under which an answer counts as a guess, given the session sample. */
export function guessThresholdMs(latencies: readonly number[]): number {
  return Math.max(GUESS_FLOOR_MS, GUESS_MEDIAN_FRACTION * median(latencies));
}

/** Strictly under the threshold — an answer exactly at the threshold is not flagged. */
export function isGuessLatency(timeSpentMs: number, latencies: readonly number[]): boolean {
  return timeSpentMs < guessThresholdMs(latencies);
}

/**
 * Recomputes `flaggedGuess` across every record in the attempt.
 *
 * Called on each submit rather than deciding once at insert time: the median is
 * a property of the whole session, so the twelfth answer changes whether the
 * second one looked like a guess. Recomputing keeps the set self-consistent,
 * and at a few hundred records the cost is irrelevant.
 *
 * Only records with a chosen answer contribute to the median, and only those
 * can be flagged — a blank is a skip, not a guess.
 */
export function markGuesses(records: readonly ResponseRecord[]): ResponseRecord[] {
  const latencies = records
    .filter((r) => r.chosenIndex !== null)
    .map((r) => r.timeSpentMs);
  const threshold = guessThresholdMs(latencies);
  return records.map((r) => {
    const flaggedGuess = r.chosenIndex !== null && r.timeSpentMs < threshold;
    return flaggedGuess === r.flaggedGuess ? r : { ...r, flaggedGuess };
  });
}
