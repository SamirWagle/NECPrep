import { describe, expect, it } from 'vitest';
import { navigate, select, submitAll, submitQuestion } from '../actions';
import {
  GUESS_FLOOR_MS,
  guessThresholdMs,
  isGuessLatency,
  markGuesses,
  median,
} from '../guess';
import type { ResponseRecord } from '../types';
import { T0, makeQuestions, run, start } from './factory';

function record(timeSpentMs: number, chosenIndex: number | null = 1): ResponseRecord {
  return {
    questionId: `q${timeSpentMs}`,
    topicId: 'book-ch1',
    chosenIndex,
    correct: false,
    timeSpentMs,
    mode: 'topic',
    flaggedGuess: false,
    timestamp: T0,
  };
}

describe('median', () => {
  it('handles odd, even and empty samples without mutating the input', () => {
    const sample = [5, 1, 3];
    expect(median(sample)).toBe(3);
    expect(sample).toEqual([5, 1, 3]);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('guessThresholdMs', () => {
  it('falls back to the absolute floor on a fast session', () => {
    // 35% of a 3s median is 1.05s, which would flag nothing. The floor is what
    // makes the rule useful when every answer is quick.
    expect(guessThresholdMs([3000, 3000, 3000])).toBe(GUESS_FLOOR_MS);
  });

  it('scales with the session once answers are slow', () => {
    // Median 60s -> 21s. A student who normally takes a minute is plainly
    // guessing at eight seconds, which the 4s floor alone would wave through.
    expect(guessThresholdMs([50_000, 60_000, 70_000])).toBe(21_000);
  });

  it('uses the floor when there is no sample at all', () => {
    expect(guessThresholdMs([])).toBe(GUESS_FLOOR_MS);
  });

  it('is strict: an answer exactly at the threshold is not a guess', () => {
    expect(isGuessLatency(4000, [3000])).toBe(false);
    expect(isGuessLatency(3999, [3000])).toBe(true);
    expect(isGuessLatency(20_999, [60_000])).toBe(true);
    expect(isGuessLatency(21_000, [60_000])).toBe(false);
  });
});

describe('markGuesses', () => {
  it('flags only the answers under the threshold', () => {
    const marked = markGuesses([record(1000), record(60_000), record(90_000)]);
    // Median 60s -> threshold 21s.
    expect(marked.map((r) => r.flaggedGuess)).toEqual([true, false, false]);
  });

  it('never flags a blank, and blanks do not drag the median down', () => {
    const marked = markGuesses([record(0, null), record(60_000), record(80_000)]);
    expect(marked[0].flaggedGuess).toBe(false);
    // Median over answers only is 70s -> 24.5s, so the 60s answer is safe.
    expect(marked[1].flaggedGuess).toBe(false);
  });

  it('re-evaluates earlier records as the session median moves', () => {
    const early = markGuesses([record(9000), record(11_000)]);
    // Median 10s -> threshold 4s (the floor), so neither looks like a guess.
    expect(early.every((r) => !r.flaggedGuess)).toBe(true);

    const later = markGuesses([...early, record(120_000), record(140_000)]);
    // Median is now 65.5s -> 22.9s, and the two fast answers are revealed as
    // outliers against how this student actually works.
    expect(later.map((r) => r.flaggedGuess)).toEqual([true, true, false, false]);
  });

  it('returns the same record objects when nothing changed', () => {
    const input = [record(60_000), record(80_000)];
    const marked = markGuesses(input);
    expect(marked[0]).toBe(input[0]);
  });
});

describe('guess detection through the reducer', () => {
  it('flags a fast answer in a slow session', () => {
    const state = run(
      start({ questions: makeQuestions(3, [1, 1, 1]) }),
      // 80 seconds on Q1.
      select(0, 1, T0 + 1000),
      submitQuestion(0, T0 + 80_000),
      navigate(1, T0 + 80_000),
      // 100 seconds on Q2.
      select(1, 1, T0 + 100_000),
      submitQuestion(1, T0 + 180_000),
      navigate(2, T0 + 180_000),
      // 2 seconds on Q3 — a tap to move on.
      select(2, 2, T0 + 181_000),
      submitQuestion(2, T0 + 182_000)
    );

    expect(state.responses.map((r) => r.flaggedGuess)).toEqual([false, false, true]);
  });

  it('flags nothing when every answer took real time', () => {
    const state = run(
      start({ feedback: 'deferred', mode: 'mock', questions: makeQuestions(2, [1, 1]) }),
      select(0, 1, T0 + 1000),
      navigate(1, T0 + 30_000),
      select(1, 1, T0 + 40_000),
      submitAll(T0 + 60_000)
    );

    expect(state.responses.every((r) => !r.flaggedGuess)).toBe(true);
  });
});
