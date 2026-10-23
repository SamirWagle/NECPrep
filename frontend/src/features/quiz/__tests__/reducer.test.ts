import { describe, expect, it } from 'vitest';
import {
  enterReview,
  exitReview,
  hydrate,
  navigate,
  pause,
  resume,
  select,
  submitAll,
  submitQuestion,
  toggleBookmark,
  toggleFlag,
} from '../actions';
import { createInitialState, quizReducer, timeSpentAt } from '../reducer';
import {
  selectAnsweredCount,
  selectFlaggedCount,
  selectFlaggedIndices,
  selectIsRevealed,
  selectPalette,
  selectScore,
  selectSummary,
  selectTimeLeftMs,
  selectUnansweredCount,
  selectUnansweredIndices,
  selectVerdict,
} from '../selectors';
import { T0, makeQuestions, run, start } from './factory';

describe('quizReducer — selection persistence', () => {
  // The bug the three practice pages shipped: navigation reset a scalar
  // `selectedAnswer`, so going back erased the answer and the feedback block
  // compared null against correctIndex and rendered "Incorrect".
  it('keeps a selection when navigating away and back', () => {
    const state = run(
      start(),
      select(0, 2, T0 + 1000),
      navigate(1, T0 + 2000),
      navigate(0, T0 + 3000)
    );

    expect(state.selections[0]).toBe(2);
    expect(state.currentIndex).toBe(0);
  });

  it('restores both the choice and the verdict on a revisited answered question', () => {
    const state = run(
      start({ questions: makeQuestions(2, [1, 1]) }),
      select(0, 1, T0 + 1000),
      submitQuestion(0, T0 + 5000),
      navigate(1, T0 + 6000),
      navigate(0, T0 + 7000)
    );

    expect(state.selections[0]).toBe(1);
    expect(selectIsRevealed(state, 0)).toBe(true);
    expect(selectVerdict(state, 0)).toBe('correct');
  });

  it('keeps a wrong answer reading as incorrect on revisit, not as unanswered', () => {
    const state = run(
      start({ questions: makeQuestions(2, [1, 1]) }),
      select(0, 3, T0 + 1000),
      submitQuestion(0, T0 + 5000),
      navigate(1, T0 + 6000),
      navigate(0, T0 + 7000)
    );

    expect(selectVerdict(state, 0)).toBe('incorrect');
  });

  it('shows no verdict on a forward question that was never answered', () => {
    const state = run(
      start(),
      select(0, 1, T0 + 1000),
      submitQuestion(0, T0 + 5000),
      navigate(1, T0 + 6000)
    );

    expect(selectVerdict(state, 1)).toBe('unanswered');
    expect(selectIsRevealed(state, 1)).toBe(false);
  });

  it('refuses to change a committed answer', () => {
    const state = run(
      start(),
      select(0, 1, T0 + 100),
      submitQuestion(0, T0 + 5000),
      select(0, 3, T0 + 6000)
    );

    expect(state.selections[0]).toBe(1);
  });

  it('clamps navigation to the paper rather than running off the end', () => {
    const base = start({ questions: makeQuestions(3) });
    expect(quizReducer(base, navigate(99, T0 + 10)).currentIndex).toBe(2);
    expect(quizReducer(base, navigate(-5, T0 + 10)).currentIndex).toBe(0);
  });
});

describe('quizReducer — feedback modes', () => {
  it('immediate: reveals the submitted question only', () => {
    const state = run(
      start({ feedback: 'immediate' }),
      select(0, 1, T0 + 100),
      submitQuestion(0, T0 + 4000)
    );

    expect(selectIsRevealed(state, 0)).toBe(true);
    expect(selectIsRevealed(state, 1)).toBe(false);
  });

  it('deferred: reveals nothing until the paper is submitted', () => {
    const answering = run(
      start({ feedback: 'deferred', mode: 'mock' }),
      select(0, 1, T0 + 100),
      select(1, 1, T0 + 200)
    );

    expect(selectIsRevealed(answering, 0)).toBe(false);
    // The pick is still visible to the student — "pending", not "correct".
    expect(selectVerdict(answering, 0)).toBe('pending');

    const submitted = quizReducer(answering, submitAll(T0 + 60_000));
    expect(selectIsRevealed(submitted, 0)).toBe(true);
    expect(selectVerdict(submitted, 0)).toBe('correct');
  });

  it('deferred: answers stay editable before the paper goes in', () => {
    const state = run(
      start({ feedback: 'deferred', mode: 'mock' }),
      select(0, 1, T0 + 100),
      select(0, 3, T0 + 200)
    );

    expect(state.selections[0]).toBe(3);
  });

  it('reports unkeyed questions as unkeyed rather than incorrect', () => {
    const state = run(
      start({ questions: makeQuestions(1, [-1]) }),
      select(0, 2, T0 + 100),
      submitQuestion(0, T0 + 9000)
    );

    expect(selectVerdict(state, 0)).toBe('unkeyed');
    expect(selectScore(state)).toBe(0);
    expect(selectSummary(state).gradableTotal).toBe(0);
    expect(selectSummary(state).accuracyPct).toBe(0);
  });
});

describe('quizReducer — derived score', () => {
  it('counts only committed correct answers', () => {
    const state = run(
      start({ questions: makeQuestions(3, [1, 2, 3]) }),
      select(0, 1, T0 + 100),
      submitQuestion(0, T0 + 9000),
      navigate(1, T0 + 9100),
      select(1, 0, T0 + 9200),
      submitQuestion(1, T0 + 18000),
      navigate(2, T0 + 18100),
      select(2, 3, T0 + 18200)
    );

    // Q3 is selected but not committed, so it is not scored yet.
    expect(selectScore(state)).toBe(1);
    expect(quizReducer(state, submitAll(T0 + 30000)).selections[2]).toBe(3);
    expect(selectScore(quizReducer(state, submitAll(T0 + 30000)))).toBe(2);
  });

  it('does not double-count a re-submitted question', () => {
    // The pages did `setScore(s => s + 1)` inside submit; any re-entry inflated
    // the score. Score is derived here, and submitting twice is a no-op.
    const once = run(start(), select(0, 1, T0 + 100), submitQuestion(0, T0 + 9000));
    const twice = run(
      once,
      submitQuestion(0, T0 + 9100),
      submitQuestion(0, T0 + 9200),
      submitQuestion(0, T0 + 9300)
    );

    expect(selectScore(twice)).toBe(1);
    expect(twice.responses).toHaveLength(1);
    expect(twice).toBe(once);
  });

  it('submitAll is idempotent and terminal', () => {
    const done = run(
      start({ questions: makeQuestions(2, [1, 1]) }),
      select(0, 1, T0 + 100),
      submitAll(T0 + 10_000)
    );
    const again = quizReducer(done, submitAll(T0 + 20_000));

    expect(again).toBe(done);
    expect(done.phase).toBe('done');
    expect(selectScore(done)).toBe(1);
    expect(done.responses).toHaveLength(2);
  });

  it('refuses a submit with no selection', () => {
    const state = start();
    expect(quizReducer(state, submitQuestion(0, T0 + 500))).toBe(state);
  });

  it('counts answered, unanswered and skipped consistently', () => {
    const state = run(
      start({ questions: makeQuestions(4) }),
      select(0, 1, T0 + 10),
      select(2, 0, T0 + 20)
    );

    expect(selectAnsweredCount(state)).toBe(2);
    expect(selectUnansweredCount(state)).toBe(2);
    expect(selectUnansweredIndices(state)).toEqual([1, 3]);
    expect(selectSummary(quizReducer(state, submitAll(T0 + 100))).skipped).toBe(2);
  });

  it('separates incorrect from skipped in the summary', () => {
    const state = run(
      start({ questions: makeQuestions(3, [1, 1, 1]) }),
      select(0, 1, T0 + 10),
      select(1, 0, T0 + 20),
      submitAll(T0 + 100)
    );
    const summary = selectSummary(state);

    expect(summary.score).toBe(1);
    expect(summary.incorrect).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.total).toBe(3);
    expect(summary.gradableTotal).toBe(3);
    expect(summary.accuracyPct).toBe(33);
  });
});

describe('quizReducer — flags and bookmarks', () => {
  it('toggles a flag on and off', () => {
    const on = quizReducer(start(), toggleFlag(1));
    expect(selectFlaggedCount(on)).toBe(1);
    expect(selectFlaggedIndices(on)).toEqual([1]);

    const off = quizReducer(on, toggleFlag(1));
    expect(selectFlaggedCount(off)).toBe(0);
  });

  it('ignores a flag outside the paper', () => {
    const state = start({ questions: makeQuestions(2) });
    expect(quizReducer(state, toggleFlag(7))).toBe(state);
  });

  it('keeps flags through navigation and submission', () => {
    const state = run(
      start(),
      toggleFlag(0),
      select(0, 1, T0 + 10),
      submitQuestion(0, T0 + 5000),
      navigate(2, T0 + 5100)
    );

    expect(state.flagged.has(0)).toBe(true);
  });

  it('toggles bookmarks by question id', () => {
    const state = start();
    const id = state.questions[0].id;
    const on = quizReducer(state, toggleBookmark(id));
    expect(on.bookmarked.has(id)).toBe(true);
    expect(quizReducer(on, toggleBookmark(id)).bookmarked.has(id)).toBe(false);
  });

  it('reports a palette with overlapping states', () => {
    const state = run(start({ questions: makeQuestions(3) }), select(0, 1, T0 + 10), toggleFlag(0));
    const palette = selectPalette(state);

    expect(palette[0]).toMatchObject({ answered: true, flagged: true, current: true });
    expect(palette[1]).toMatchObject({ answered: false, flagged: false, current: false });
  });
});

describe('quizReducer — timing', () => {
  it('accrues per-question time and banks it on navigation', () => {
    const state = run(start(), navigate(1, T0 + 7000), navigate(2, T0 + 9500));

    expect(state.timing.accumulatedMs[0]).toBe(7000);
    expect(state.timing.accumulatedMs[1]).toBe(2500);
    expect(state.timing.accumulatedMs[2]).toBe(0);
    expect(timeSpentAt(state, 2, T0 + 10_500)).toBe(1000);
  });

  it('records the banked time on the response', () => {
    const state = run(start(), select(0, 1, T0 + 1000), submitQuestion(0, T0 + 12_000));
    expect(state.responses[0].timeSpentMs).toBe(12_000);
  });

  it('stops the clock while the tab is hidden', () => {
    const state = run(
      start(),
      pause(T0 + 3000),
      resume(T0 + 100_000),
      select(0, 1, T0 + 100_500),
      submitQuestion(0, T0 + 104_000)
    );

    // 3s before hiding plus 4s after returning. The 97s the tab spent in the
    // background is not study time.
    expect(state.responses[0].timeSpentMs).toBe(7000);
    expect(state.timing.paused).toBe(false);
  });

  it('ignores a resume that was not preceded by a pause', () => {
    const state = start();
    expect(quizReducer(state, resume(T0 + 500))).toBe(state);
  });

  it('never lets a stale timestamp run the clock backwards', () => {
    const state = run(start(), navigate(1, T0 - 50_000));
    expect(state.timing.accumulatedMs[0]).toBe(0);
  });

  it('banks and stops the clock on the review screen, and restarts on exit', () => {
    const reviewing = run(start(), enterReview(T0 + 4000));
    expect(reviewing.phase).toBe('review');
    expect(reviewing.timing.accumulatedMs[0]).toBe(4000);
    expect(reviewing.timing.viewStartedAt).toBeNull();

    const back = quizReducer(reviewing, exitReview(T0 + 30_000));
    expect(back.phase).toBe('active');
    expect(back.timing.viewStartedAt).toBe(T0 + 30_000);
    // Thirty seconds on the review screen is not thirty seconds on question 1.
    expect(back.timing.accumulatedMs[0]).toBe(4000);
  });

  it('derives time left from the absolute deadline', () => {
    const state = start({ durationMs: 45 * 60_000 });
    expect(selectTimeLeftMs(state, T0)).toBe(2_700_000);
    expect(selectTimeLeftMs(state, T0 + 2_700_001)).toBe(0);
    expect(selectTimeLeftMs(start(), T0)).toBeNull();
  });
});

describe('quizReducer — hydrate', () => {
  it('restores selections, flags, index and banked time', () => {
    const questions = makeQuestions(3, [1, 1, 1]);
    const state = quizReducer(
      createInitialState({ mode: 'topic', feedback: 'immediate', attemptKey: 'k' }),
      hydrate({
        attemptKey: 'k',
        questions,
        at: T0 + 500,
        startedAt: T0,
        endsAt: null,
        selections: [1, null, 3],
        submitted: [0],
        flagged: [2],
        accumulatedMs: [4000, 0, 1200],
        currentIndex: 2,
        resumed: true,
      })
    );

    expect(state.phase).toBe('active');
    expect(state.selections).toEqual([1, null, 3]);
    expect(state.submitted.has(0)).toBe(true);
    expect(state.flagged.has(2)).toBe(true);
    expect(state.currentIndex).toBe(2);
    expect(state.timing.accumulatedMs).toEqual([4000, 0, 1200]);
    expect(state.resumed).toBe(true);
    expect(selectScore(state)).toBe(1);
  });

  it('discards restored arrays that describe a different-length paper', () => {
    const state = quizReducer(
      createInitialState({ mode: 'mock', feedback: 'deferred', attemptKey: 'k' }),
      hydrate({
        attemptKey: 'k',
        questions: makeQuestions(3),
        at: T0,
        startedAt: T0,
        endsAt: null,
        selections: [1, 2],
        accumulatedMs: [1, 2, 3, 4],
      })
    );

    expect(state.selections).toEqual([null, null, null]);
    expect(state.timing.accumulatedMs).toEqual([0, 0, 0]);
  });

  it('finishes immediately when the restored deadline has already passed', () => {
    const state = quizReducer(
      createInitialState({ mode: 'mock', feedback: 'deferred', attemptKey: 'k' }),
      hydrate({
        attemptKey: 'k',
        questions: makeQuestions(3, [1, 1, 1]),
        at: T0 + 10_000,
        startedAt: T0 - 2_700_000,
        endsAt: T0 - 1000,
        selections: [1, 0, null],
        accumulatedMs: [5000, 5000, 0],
      })
    );

    expect(state.phase).toBe('done');
    expect(selectScore(state)).toBe(1);
    expect(selectSummary(state).skipped).toBe(1);
    // No extra time is credited for the stretch after the deadline.
    expect(state.timing.accumulatedMs).toEqual([5000, 5000, 0]);
  });

  it('ignores an empty paper', () => {
    const initial = createInitialState({ mode: 'quick', feedback: 'immediate' });
    const state = quizReducer(
      initial,
      hydrate({ attemptKey: null, questions: [], at: T0, startedAt: T0, endsAt: null })
    );
    expect(state).toBe(initial);
    expect(state.phase).toBe('loading');
  });

  it('clamps a restored index that is past the end of the paper', () => {
    const state = quizReducer(
      createInitialState({ mode: 'topic', feedback: 'immediate', attemptKey: 'k' }),
      hydrate({
        attemptKey: 'k',
        questions: makeQuestions(2),
        at: T0,
        startedAt: T0,
        endsAt: null,
        currentIndex: 99,
      })
    );
    expect(state.currentIndex).toBe(1);
  });
});

describe('quizReducer — response records', () => {
  it('emits the analytics shape for each answer', () => {
    const state = run(
      start({ mode: 'quick', questions: makeQuestions(1, [1]) }),
      select(0, 1, T0 + 1000),
      submitQuestion(0, T0 + 11_000)
    );

    expect(state.responses[0]).toEqual({
      questionId: 'book-ch1_0',
      topicId: 'book-ch1',
      chosenIndex: 1,
      correct: true,
      timeSpentMs: 11_000,
      mode: 'quick',
      flaggedGuess: false,
      timestamp: T0 + 11_000,
    });
  });

  it('records a blank for a question that was never answered', () => {
    const state = run(
      start({ questions: makeQuestions(2, [1, 1]) }),
      select(0, 1, T0 + 100),
      submitAll(T0 + 20_000)
    );
    const blank = state.responses.find((r) => r.questionId === 'book-ch1_1');

    expect(blank).toMatchObject({ chosenIndex: null, correct: false, flaggedGuess: false });
  });
});
