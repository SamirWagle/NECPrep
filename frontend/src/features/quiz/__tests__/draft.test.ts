import { describe, expect, it } from 'vitest';
import { hydrate, navigate, select, submitAll, submitQuestion, toggleFlag } from '../actions';
import {
  DRAFT_PREFIX,
  LEGACY_MOCK_DRAFT_PREFIX,
  clearDraft,
  draftFromState,
  draftStorageKey,
  parseDraft,
  readDraft,
  readLegacyMockDraft,
  writeDraft,
} from '../draft';
import { createInitialState, quizReducer } from '../reducer';
import { selectScore, selectSummary } from '../selectors';
import type { QuizDraft } from '../draft';
import { T0, makeQuestions, run, start } from './factory';

const KEY = 'mock:mock-1';

function liveAttempt() {
  return run(
    start({
      attemptKey: KEY,
      mode: 'mock',
      feedback: 'deferred',
      questions: makeQuestions(4, [1, 1, 1, 1]),
      durationMs: 45 * 60_000,
    }),
    select(0, 1, T0 + 1000),
    navigate(1, T0 + 20_000),
    select(1, 3, T0 + 25_000),
    toggleFlag(1)
  );
}

describe('draftFromState', () => {
  it('snapshots an in-progress attempt', () => {
    const draft = draftFromState(liveAttempt(), KEY, T0 + 30_000);

    expect(draft).not.toBeNull();
    expect(draft).toMatchObject({
      v: 1,
      key: KEY,
      mode: 'mock',
      feedback: 'deferred',
      questionIds: ['book-ch1_0', 'book-ch1_1', 'book-ch1_2', 'book-ch1_3'],
      selections: [1, 3, null, null],
      flagged: [1],
      currentIndex: 1,
      startedAt: T0,
      endsAt: T0 + 2_700_000,
    });
  });

  it('stores an absolute deadline, not a remaining-time counter', () => {
    const draft = draftFromState(liveAttempt(), KEY, T0 + 30_000);
    // Stored once at T0 and never touched again: a reload three minutes later
    // still ends the exam at the same wall-clock moment.
    expect(draft?.endsAt).toBe(T0 + 45 * 60_000);
  });

  it('banks only committed time, so a closed tab earns nothing', () => {
    const draft = draftFromState(liveAttempt(), KEY, T0 + 30_000);
    expect(draft?.accumulatedMs).toEqual([20_000, 0, 0, 0]);
  });

  it('refuses to snapshot a finished or unloaded attempt', () => {
    const loading = createInitialState({ mode: 'mock', feedback: 'deferred', attemptKey: KEY });
    expect(draftFromState(loading, KEY, T0)).toBeNull();

    const done = quizReducer(liveAttempt(), submitAll(T0 + 40_000));
    expect(draftFromState(done, KEY, T0 + 40_000)).toBeNull();
  });
});

describe('draft storage round-trip', () => {
  it('writes and reads back an identical draft', () => {
    const draft = draftFromState(liveAttempt(), KEY, T0 + 30_000);
    expect(draft).not.toBeNull();
    writeDraft(draft as QuizDraft);

    expect(localStorage.getItem(draftStorageKey(KEY))).not.toBeNull();
    expect(readDraft(KEY)).toEqual(draft);
  });

  it('clears a draft', () => {
    writeDraft(draftFromState(liveAttempt(), KEY, T0) as QuizDraft);
    clearDraft(KEY);
    expect(readDraft(KEY)).toBeNull();
  });

  it('rejects a draft stored under a different key', () => {
    const draft = draftFromState(liveAttempt(), KEY, T0) as QuizDraft;
    localStorage.setItem(draftStorageKey('other'), JSON.stringify(draft));
    expect(readDraft('other')).toBeNull();
  });

  it('rejects corrupt, truncated and mismatched payloads', () => {
    const good = draftFromState(liveAttempt(), KEY, T0) as QuizDraft;

    localStorage.setItem(draftStorageKey(KEY), '{not json');
    expect(readDraft(KEY)).toBeNull();

    expect(parseDraft({ ...good, v: 99 }, KEY)).toBeNull();
    expect(parseDraft({ ...good, selections: [1, 3] }, KEY)).toBeNull();
    expect(parseDraft({ ...good, accumulatedMs: ['x', 1, 2, 3] }, KEY)).toBeNull();
    expect(parseDraft({ ...good, questionIds: [] }, KEY)).toBeNull();
    expect(parseDraft({ ...good, mode: 'telepathy' }, KEY)).toBeNull();
    expect(parseDraft({ ...good, startedAt: 'soon' }, KEY)).toBeNull();
    expect(parseDraft({ ...good, endsAt: 'later' }, KEY)).toBeNull();
    expect(parseDraft(null, KEY)).toBeNull();
    expect(parseDraft('a string', KEY)).toBeNull();
  });

  it('accepts a null deadline for untimed practice', () => {
    const good = draftFromState(
      run(start({ attemptKey: 'topic:book-ch1:30' }), select(0, 2, T0 + 500)),
      'topic:book-ch1:30',
      T0 + 500
    ) as QuizDraft;
    expect(good.endsAt).toBeNull();
    expect(parseDraft(good, 'topic:book-ch1:30')).not.toBeNull();
  });

  it('drops out-of-range submitted and flagged indices', () => {
    const good = draftFromState(liveAttempt(), KEY, T0) as QuizDraft;
    const parsed = parseDraft({ ...good, submitted: [0, 99], flagged: [-1, 2] }, KEY);
    expect(parsed?.submitted).toEqual([0]);
    expect(parsed?.flagged).toEqual([2]);
  });
});

describe('legacy mock draft migration', () => {
  it('lifts an in-flight pre-engine exam into the new shape', () => {
    localStorage.setItem(
      `${LEGACY_MOCK_DRAFT_PREFIX}mock-1`,
      JSON.stringify({
        testId: 'mock-1',
        questionIds: ['book-ch1_0', 'book-ch1_1'],
        answers: [2, null],
        endsAt: T0 + 600_000,
        startedAt: T0,
      })
    );

    const migrated = readDraft(KEY, { legacyMockTestId: 'mock-1' });
    expect(migrated).toMatchObject({
      key: KEY,
      mode: 'mock',
      feedback: 'deferred',
      questionIds: ['book-ch1_0', 'book-ch1_1'],
      selections: [2, null],
      endsAt: T0 + 600_000,
      startedAt: T0,
      submitted: [],
    });
  });

  it('prefers a current draft over the legacy one', () => {
    const current = draftFromState(liveAttempt(), KEY, T0) as QuizDraft;
    writeDraft(current);
    localStorage.setItem(
      `${LEGACY_MOCK_DRAFT_PREFIX}mock-1`,
      JSON.stringify({
        testId: 'mock-1',
        questionIds: ['stale_0'],
        answers: [0],
        endsAt: T0 + 1,
        startedAt: T0,
      })
    );

    expect(readDraft(KEY, { legacyMockTestId: 'mock-1' })?.questionIds).toHaveLength(4);
  });

  it('clears the legacy key alongside the new one', () => {
    localStorage.setItem(`${LEGACY_MOCK_DRAFT_PREFIX}mock-1`, '{}');
    writeDraft(draftFromState(liveAttempt(), KEY, T0) as QuizDraft);
    clearDraft(KEY, { legacyMockTestId: 'mock-1' });

    expect(localStorage.getItem(`${DRAFT_PREFIX}${KEY}`)).toBeNull();
    expect(localStorage.getItem(`${LEGACY_MOCK_DRAFT_PREFIX}mock-1`)).toBeNull();
  });

  it('rejects a legacy draft whose answers do not match its paper', () => {
    localStorage.setItem(
      `${LEGACY_MOCK_DRAFT_PREFIX}mock-1`,
      JSON.stringify({
        testId: 'mock-1',
        questionIds: ['a', 'b', 'c'],
        answers: [1],
        endsAt: T0,
        startedAt: T0,
      })
    );
    expect(readLegacyMockDraft('mock-1', KEY)).toBeNull();
  });
});

describe('resuming a draft', () => {
  const questions = makeQuestions(4, [1, 1, 1, 1]);

  function resume(draft: QuizDraft, at: number) {
    return quizReducer(
      createInitialState({ mode: draft.mode, feedback: draft.feedback, attemptKey: draft.key }),
      hydrate({
        attemptKey: draft.key,
        questions,
        at,
        startedAt: draft.startedAt,
        endsAt: draft.endsAt,
        resumed: true,
        selections: draft.selections,
        submitted: draft.submitted,
        flagged: draft.flagged,
        accumulatedMs: draft.accumulatedMs,
        currentIndex: draft.currentIndex,
      })
    );
  }

  it('restores every answer, flag and position', () => {
    writeDraft(draftFromState(liveAttempt(), KEY, T0 + 30_000) as QuizDraft);
    const state = resume(readDraft(KEY) as QuizDraft, T0 + 120_000);

    expect(state.phase).toBe('active');
    expect(state.resumed).toBe(true);
    expect(state.selections).toEqual([1, 3, null, null]);
    expect(state.flagged.has(1)).toBe(true);
    expect(state.currentIndex).toBe(1);
    // Deadline unchanged by the reload: still 45 minutes after the original
    // start, not 45 minutes from now.
    expect(state.timing.endsAt).toBe(T0 + 2_700_000);
  });

  it('scores an expired attempt instead of handing back a fresh timer', () => {
    writeDraft(draftFromState(liveAttempt(), KEY, T0 + 30_000) as QuizDraft);
    // The student closed the tab and came back an hour later.
    const state = resume(readDraft(KEY) as QuizDraft, T0 + 3_600_000);

    expect(state.phase).toBe('done');
    expect(state.timing.endsAt).toBe(T0 + 2_700_000);
    expect(selectScore(state)).toBe(1);
    expect(selectSummary(state).skipped).toBe(2);
    expect(state.responses).toHaveLength(4);
  });

  it('keeps committed practice answers committed across a resume', () => {
    const key = 'topic:book-ch1:4';
    const practice = run(
      start({ attemptKey: key, questions, feedback: 'immediate' }),
      select(0, 1, T0 + 1000),
      submitQuestion(0, T0 + 8000)
    );
    writeDraft(draftFromState(practice, key, T0 + 8000) as QuizDraft);

    const restored = resume(readDraft(key) as QuizDraft, T0 + 9000);
    expect(restored.submitted.has(0)).toBe(true);
    expect(selectScore(restored)).toBe(1);
  });
});
