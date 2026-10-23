import { describe, expect, it, vi } from 'vitest';
import {
  clearStoredSession,
  newStoredSession,
  readRemoteSession,
  readStoredSession,
  readVerdict,
  refForSelection,
  summaryFromPracticeResult,
  verdictToneFor,
  writeStoredSession,
} from '../practiceSession';
import { KEY_HELD_BY_SERVER } from '../../features/quiz/answerKey';
import type {
  PracticeAnswerResult,
  PracticeFinishResponse,
  PracticeSessionPaper,
} from '../api';

/**
 * This module is the only place a server practice paper becomes engine state,
 * so it is the only place an answer key could be invented. Most of what is
 * tested below is what is NOT produced.
 *
 * Practice differs from the mock in exactly one way that matters here: a key
 * DOES legitimately arrive, per question, after that question's answer is
 * committed. So the tests are about the boundary of that disclosure — what a
 * paper carries, what a verdict carries, and what never leaks between them.
 */

const SERVER_NOW = 1_700_000_000_000;

function paper(overrides: Partial<PracticeSessionPaper> = {}): PracticeSessionPaper {
  return {
    sessionId: 'pse_1',
    mode: 'chapter',
    status: 'in_progress',
    startedAt: SERVER_NOW - 60_000,
    serverNow: SERVER_NOW,
    questionCount: 2,
    questions: [
      {
        // Deliberately out of order, to prove `position` is what orders the
        // paper and not the array the server happened to serialise.
        questionId: 'q2',
        chapterId: 'book-ch5',
        position: 2,
        stem: 'Which layer is TCP?',
        options: [
          { ref: 'r2a', body: 'Physical' },
          { ref: 'r2b', body: 'Transport' },
        ],
      },
      {
        questionId: 'q1',
        chapterId: 'book-ch1',
        position: 1,
        stem: 'What is 2 + 2?',
        options: [
          { ref: 'r1a', body: 'Three' },
          { ref: 'r1b', body: 'Four' },
          { ref: 'r1c', body: 'Five' },
        ],
      },
    ],
    answered: {},
    ...overrides,
  };
}

function answerResult(overrides: Partial<PracticeAnswerResult> = {}): PracticeAnswerResult {
  return {
    questionId: 'q1',
    selectedRef: 'r1a',
    correctRef: 'r1b',
    isCorrect: false,
    explanation: null,
    ...overrides,
  };
}

describe('readRemoteSession', () => {
  it('gives every question the server-keyed sentinel and no index', () => {
    const session = readRemoteSession(paper());

    expect(session.questions.map((q) => q.correctIndex)).toEqual([
      KEY_HELD_BY_SERVER,
      KEY_HELD_BY_SERVER,
    ]);
    // Not -1 either: there IS a key, the client simply does not hold it, and
    // the two cases are treated differently by the score screen.
    expect(session.questions.some((q) => q.correctIndex >= 0)).toBe(false);
  });

  it('carries nothing that could be joined back to a key', () => {
    const session = readRemoteSession(paper());

    // `correctIndex` is the ONLY correctness-shaped field on a fresh remote
    // paper, and it is the sentinel. Whatever a future reader adds to
    // `Question`, a second one appearing here should fail this test.
    const keys = new Set(session.questions.flatMap((q) => Object.keys(q)));
    expect([...keys].sort()).toEqual([
      'correctIndex',
      'id',
      'options',
      'question',
      'topicId',
    ]);
    expect(JSON.stringify(session.questions)).toContain('"correctIndex":-2');
  });

  it('orders the paper by position, not by array order', () => {
    const session = readRemoteSession(paper());
    expect(session.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
    expect(session.questions[0].question).toBe('What is 2 + 2?');
  });

  it('maps chapterId onto the engine topicId so references still resolve', () => {
    const session = readRemoteSession(paper());
    expect(session.questions.map((q) => q.topicId)).toEqual(['book-ch1', 'book-ch5']);
  });

  it('holds the option refs per question, in render order', () => {
    const session = readRemoteSession(paper());
    expect(session.optionRefs.get('q1')).toEqual(['r1a', 'r1b', 'r1c']);
    expect(refForSelection('q1', 2, session.optionRefs)).toBe('r1c');
    expect(refForSelection('q1', null, session.optionRefs)).toBeNull();
    // An index the paper cannot hold names no option rather than the last one.
    expect(refForSelection('q1', 9, session.optionRefs)).toBeNull();
  });

  it('has no verdict for an unanswered question', () => {
    const session = readRemoteSession(paper());
    expect(session.verdicts.size).toBe(0);
    expect(session.restoredSelections).toEqual({});
  });

  it('replays only the verdicts the server recorded', () => {
    const session = readRemoteSession(
      paper({
        answered: {
          q1: answerResult({ selectedRef: 'r1c', correctRef: 'r1b', isCorrect: false }),
        },
      })
    );

    expect([...session.verdicts.keys()]).toEqual(['q1']);
    expect(session.verdicts.get('q1')).toEqual({
      questionId: 'q1',
      selectedIndex: 2,
      correctIndex: 1,
      isCorrect: false,
      explanation: null,
    });
    // q2 was never answered, so resuming discloses nothing about it. This is
    // the property that stops "start a session and reload" being a way to read
    // a whole paper's key.
    expect(session.verdicts.has('q2')).toBe(false);
    expect(session.restoredSelections).toEqual({ q1: 2 });
  });

  it('drops a replayed selection whose ref no longer resolves', () => {
    const session = readRemoteSession(
      paper({ answered: { q1: answerResult({ selectedRef: 'stale-ref' }) } })
    );
    // Guessing an index would be worse than a blank.
    expect(session.restoredSelections).toEqual({});
    expect(session.verdicts.get('q1')?.selectedIndex).toBeNull();
  });
});

describe('readVerdict', () => {
  it('resolves refs to engine indexes', () => {
    const verdict = readVerdict(answerResult({ selectedRef: 'r1a', correctRef: 'r1c' }), [
      'r1a',
      'r1b',
      'r1c',
    ]);
    expect(verdict.selectedIndex).toBe(0);
    expect(verdict.correctIndex).toBe(2);
  });

  it('keeps the server decision verbatim, even when it contradicts the refs', () => {
    // A hostile or buggy pairing: the server says correct while naming an
    // option the student did not pick. `isCorrect` is still reported as sent,
    // because this module does not get a vote on correctness — if it
    // "corrected" the server here it would be scoring the paper locally.
    const verdict = readVerdict(
      answerResult({ selectedRef: 'r1a', correctRef: 'r1b', isCorrect: true }),
      ['r1a', 'r1b', 'r1c']
    );
    expect(verdict.isCorrect).toBe(true);
    expect(verdict.selectedIndex).toBe(0);
    expect(verdict.correctIndex).toBe(1);
  });

  it('records a deliberate skip as a null selection', () => {
    const verdict = readVerdict(answerResult({ selectedRef: null, isCorrect: false }), [
      'r1a',
      'r1b',
    ]);
    expect(verdict.selectedIndex).toBeNull();
    expect(verdictToneFor(verdict)).toBe('unanswered');
  });

  it('reports -1 rather than throwing when the key ref is unknown', () => {
    const verdict = readVerdict(answerResult({ correctRef: 'not-on-this-paper' }), ['r1a']);
    // Negative means "no key to render" everywhere in the engine, so a missing
    // highlight is the failure rather than a highlight on the wrong option.
    expect(verdict.correctIndex).toBe(-1);
  });
});

describe('verdictToneFor', () => {
  it('reads isCorrect and nothing else', () => {
    const base = { questionId: 'q1', explanation: null };
    expect(
      verdictToneFor({ ...base, selectedIndex: 0, correctIndex: 0, isCorrect: false })
    ).toBe('incorrect');
    expect(
      verdictToneFor({ ...base, selectedIndex: 0, correctIndex: 1, isCorrect: true })
    ).toBe('correct');
  });
});

describe('summaryFromPracticeResult', () => {
  const result: PracticeFinishResponse = {
    sessionId: 'pse_1',
    total: 10,
    correct: 6,
    incorrect: 3,
    skipped: 1,
    accuracyPct: 67,
    finishedAt: SERVER_NOW,
  };

  it('reports the server numbers and recomputes none of them', () => {
    const summary = summaryFromPracticeResult(result, 'topic', 90_000);
    expect(summary).toEqual({
      mode: 'topic',
      score: 6,
      total: 10,
      // Every question on a server paper has a key, so the "excluded from the
      // score" note must not appear: gradableTotal has to equal total.
      gradableTotal: 10,
      answered: 9,
      skipped: 1,
      incorrect: 3,
      accuracyPct: 67,
      elapsedMs: 90_000,
      responses: [],
    });
  });

  it('carries the host mode so the right surface is recorded', () => {
    expect(summaryFromPracticeResult(result, 'custom').mode).toBe('custom');
  });

  it('defaults elapsed time to zero rather than guessing it', () => {
    // `finishedAt - startedAt` is wall clock and would count a tab left open
    // overnight as study time. The engine measures the real figure.
    expect(summaryFromPracticeResult(result, 'quick').elapsedMs).toBe(0);
  });
});

describe('the session handoff record', () => {
  it('mints both keys before either request', () => {
    const stored = newStoredSession();
    expect(stored.sessionId).toBeNull();
    expect(stored.startKey).not.toBe(stored.finishKey);
    expect(stored.startKey.length).toBeGreaterThanOrEqual(8);
  });

  it('round-trips through localStorage', () => {
    const stored = { sessionId: 'pse_9', startKey: 'sk', finishKey: 'fk' };
    writeStoredSession('topic:book-ch1:30', stored);
    expect(readStoredSession('topic:book-ch1:30')).toEqual(stored);
    clearStoredSession('topic:book-ch1:30');
    expect(readStoredSession('topic:book-ch1:30')).toBeNull();
  });

  it('refuses a malformed record instead of half-trusting it', () => {
    localStorage.setItem('necprep_practice_session_v1:k', '{"sessionId":42}');
    expect(readStoredSession('k')).toBeNull();
    localStorage.setItem('necprep_practice_session_v1:k', 'not json');
    expect(readStoredSession('k')).toBeNull();
  });

  it('survives storage being unavailable', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      // Private browsing must not take down a study session; it only costs
      // resumability.
      expect(() =>
        writeStoredSession('k', { sessionId: null, startKey: 'a', finishKey: 'b' })
      ).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });
});
