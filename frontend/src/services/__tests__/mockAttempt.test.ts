import { describe, expect, it, vi } from 'vitest';
import {
  answersFromSelections,
  clearStoredAttempt,
  newStoredAttempt,
  readRemotePaper,
  readStoredAttempt,
  summaryFromServer,
  writeStoredAttempt,
} from '../mockAttempt';
import { KEY_HELD_BY_SERVER } from '../../features/quiz/answerKey';
import type { MockAttemptPaper, MockSubmitResponse } from '../api';

/**
 * This module is the only place a server paper becomes engine state, so it is
 * the only place an answer key could be invented. The tests below are mostly
 * about what is NOT produced.
 */

const SERVER_NOW = 1_700_000_000_000;

function paper(overrides: Partial<MockAttemptPaper> = {}): MockAttemptPaper {
  return {
    attemptId: 'mat_1',
    templateId: 'full-mock-1',
    status: 'in_progress',
    startedAt: SERVER_NOW - 60_000,
    expiresAt: SERVER_NOW + 7_140_000,
    serverNow: SERVER_NOW,
    durationSeconds: 7200,
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
    savedAnswers: {},
    ...overrides,
  };
}

function submitted(overrides: Partial<MockSubmitResponse> = {}): MockSubmitResponse {
  return {
    attemptId: 'mat_1',
    status: 'submitted',
    score: 1,
    total: 2,
    correct: 1,
    incorrect: 1,
    skipped: 0,
    accuracyPct: 50,
    timing: 'on_time',
    startedAt: SERVER_NOW,
    expiresAt: SERVER_NOW + 7_200_000,
    submittedAt: SERVER_NOW + 600_000,
    scoredAt: SERVER_NOW + 600_000,
    droppedLateAnswers: 0,
    rejectedQuestionIds: [],
    review: [],
    ...overrides,
  };
}

describe('readRemotePaper', () => {
  it('orders the paper by the server position, not by array order', () => {
    const remote = readRemotePaper(paper());
    expect(remote.questions.map((q) => q.id)).toEqual(['q1', 'q2']);
  });

  it('gives every question the server-key sentinel and never a real index', () => {
    const remote = readRemotePaper(paper());
    for (const question of remote.questions) {
      expect(question.correctIndex).toBe(KEY_HELD_BY_SERVER);
      // The sentinel must stay negative: every guard in the engine that
      // refuses to score an unkeyed question is a `>= 0` test.
      expect(question.correctIndex).toBeLessThan(0);
    }
  });

  it('carries no answer key and no option refs on the engine questions', () => {
    const remote = readRemotePaper(paper());
    // Serialising is what the autosave draft does, so this is also a check
    // that nothing scoreable reaches localStorage.
    const serialised = JSON.stringify(remote.questions);
    for (const ref of ['r1a', 'r1b', 'r1c', 'r2a', 'r2b']) {
      expect(serialised).not.toContain(ref);
    }
    expect(serialised).not.toMatch(/correct(?!Index)/i);
    expect(serialised).not.toContain('isCorrect');
    // And the only key-shaped field present is the sentinel.
    expect(serialised).not.toMatch(/"correctIndex":\s*[0-9]/);
  });

  it('keeps only option bodies, in the order the server delivered them', () => {
    const remote = readRemotePaper(paper());
    expect(remote.questions[0].options).toEqual(['Three', 'Four', 'Five']);
    expect(remote.questions[1].options).toEqual(['Physical', 'Transport']);
  });

  it('maps the chapter onto topicId so references and progress still key', () => {
    const remote = readRemotePaper(paper());
    expect(remote.questions.map((q) => q.topicId)).toEqual(['book-ch1', 'book-ch5']);
  });

  it('measures the remaining time on the server clock, not this device', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      // A device an hour behind. The paper still has its true 7,140 seconds.
      expect(readRemotePaper(paper()).remainingMs).toBe(7_140_000);
    } finally {
      now.mockRestore();
    }
  });

  it('clamps a deadline that has already passed to zero rather than negative', () => {
    const remote = readRemotePaper(paper({ expiresAt: SERVER_NOW - 1000 }));
    expect(remote.remainingMs).toBe(0);
  });

  it('turns the server snapshot back into option indexes', () => {
    const remote = readRemotePaper(paper({ savedAnswers: { q1: 'r1c', q2: 'r2a' } }));
    expect(remote.restoredSelections).toEqual({ q1: 2, q2: 0 });
  });

  it('drops a saved answer whose ref is not on this paper', () => {
    // A ref from another attempt is meaningless here; guessing an index would
    // silently answer a question for the candidate.
    const remote = readRemotePaper(paper({ savedAnswers: { q1: 'ref-from-elsewhere' } }));
    expect(remote.restoredSelections).toEqual({});
  });
});

describe('answersFromSelections', () => {
  const remote = readRemotePaper(paper());

  it('posts option refs, never indexes', () => {
    const answers = answersFromSelections(remote.questions, [1, 0], remote.optionRefs);
    expect(answers).toEqual({ q1: 'r1b', q2: 'r2a' });
    // Nothing numeric escapes: the server has no index to interpret.
    for (const value of Object.values(answers)) {
      expect(typeof value).toBe('string');
      expect(Number.isNaN(Number(value))).toBe(true);
    }
  });

  it('omits unanswered questions rather than sending a blank', () => {
    const answers = answersFromSelections(remote.questions, [null, 1], remote.optionRefs);
    expect(answers).toEqual({ q2: 'r2b' });
    expect(Object.hasOwn(answers, 'q1')).toBe(false);
  });

  it('omits a selection the paper cannot hold', () => {
    // q2 has two options; index 7 resolves to no ref at all.
    expect(answersFromSelections(remote.questions, [0, 7], remote.optionRefs)).toEqual({
      q1: 'r1a',
    });
  });

  it('produces an empty map for an untouched paper', () => {
    expect(answersFromSelections(remote.questions, [null, null], remote.optionRefs)).toEqual({});
  });
});

describe('summaryFromServer', () => {
  it('reports the server numbers and nothing derived', () => {
    const summary = summaryFromServer(submitted());
    expect(summary.score).toBe(1);
    expect(summary.total).toBe(2);
    expect(summary.incorrect).toBe(1);
    expect(summary.accuracyPct).toBe(50);
    expect(summary.elapsedMs).toBe(600_000);
  });

  it('treats every question as gradable, so the no-key note cannot appear', () => {
    const summary = summaryFromServer(submitted());
    expect(summary.gradableTotal).toBe(summary.total);
  });

  it('counts answered as total minus skipped', () => {
    expect(summaryFromServer(submitted({ skipped: 2, correct: 0, incorrect: 0 })).answered).toBe(0);
  });

  it('carries no per-question records, because the client graded none', () => {
    expect(summaryFromServer(submitted()).responses).toEqual([]);
  });
});

describe('attempt handoff storage', () => {
  it('round-trips an attempt record', () => {
    const record = { attemptId: 'mat_9', startKey: 'a', submitKey: 'b' };
    writeStoredAttempt('full-mock-1', record);
    expect(readStoredAttempt('full-mock-1')).toEqual(record);
    clearStoredAttempt('full-mock-1');
    expect(readStoredAttempt('full-mock-1')).toBeNull();
  });

  it('rejects a malformed record rather than half-trusting it', () => {
    localStorage.setItem('necprep_mock_attempt_v1:full-mock-1', '{"startKey":1}');
    expect(readStoredAttempt('full-mock-1')).toBeNull();
    localStorage.setItem('necprep_mock_attempt_v1:full-mock-1', 'not json');
    expect(readStoredAttempt('full-mock-1')).toBeNull();
  });

  it('mints distinct start and submit keys up front', () => {
    const record = newStoredAttempt();
    expect(record.attemptId).toBeNull();
    expect(record.startKey).not.toBe(record.submitKey);
    // The Worker's validator accepts 8-80 chars of [A-Za-z0-9_.:-].
    expect(record.startKey).toMatch(/^[A-Za-z0-9_.:-]{8,80}$/);
    expect(record.submitKey).toMatch(/^[A-Za-z0-9_.:-]{8,80}$/);
  });
});
