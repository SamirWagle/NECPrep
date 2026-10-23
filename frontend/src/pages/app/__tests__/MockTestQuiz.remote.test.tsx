import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { MockAttemptPaper, MockSubmitResponse } from '../../../services/api';

/**
 * The mock test, running against the Worker.
 *
 * The whole point of the backend is that the answer key never reaches the
 * browser during a paper. These tests assert the three observable consequences
 * of that:
 *
 *  1. The client is given no key, scores nothing, and shows no verdict until
 *     the server has marked the paper.
 *  2. What goes back is OPTION REFS — opaque per-attempt tokens — never an
 *     index or a position, so a harvested payload is useless.
 *  3. Every number on the result screen is the server's.
 *
 * `isBackendConfigured()` reads a build-time constant, so the only way to
 * exercise the configured path is to mock the module — which is also how
 * `auth.test.tsx` and `useChapters.test.tsx` do it.
 */

const mockApi = {
  getChapters: vi.fn(),
  startMock: vi.fn(),
  getMockAttempt: vi.fn(),
  getMockReview: vi.fn(),
  syncMock: vi.fn(),
  submitMock: vi.fn(),
};

let keyCounter = 0;

vi.mock('../../../services/api', () => ({
  api: mockApi,
  isBackendConfigured: () => true,
  apiBaseUrl: () => 'https://api.test',
  newIdempotencyKey: () => `key-${String(++keyCounter)}`,
}));

const MockTestQuiz = (await import('../MockTestQuiz')).default;

const SERVER_NOW = 1_700_000_000_000;

/** Two questions, three options each, refs that are plainly not indexes. */
function serverPaper(overrides: Partial<MockAttemptPaper> = {}): MockAttemptPaper {
  return {
    attemptId: 'mat_abc',
    templateId: 'full-mock-1',
    status: 'in_progress',
    startedAt: SERVER_NOW,
    expiresAt: SERVER_NOW + 7_200_000,
    serverNow: SERVER_NOW,
    durationSeconds: 7200,
    questionCount: 2,
    questions: [
      {
        questionId: 'q1',
        chapterId: 'book-ch1',
        position: 1,
        stem: 'What is 2 + 2?',
        options: [
          { ref: 'opaque-q1-x', body: 'Three' },
          { ref: 'opaque-q1-y', body: 'Four' },
          { ref: 'opaque-q1-z', body: 'Five' },
        ],
      },
      {
        questionId: 'q2',
        chapterId: 'book-ch5',
        position: 2,
        stem: 'What is the capital of Nepal?',
        options: [
          { ref: 'opaque-q2-x', body: 'Pokhara' },
          { ref: 'opaque-q2-y', body: 'Kathmandu' },
          { ref: 'opaque-q2-z', body: 'Lalitpur' },
        ],
      },
    ],
    savedAnswers: {},
    ...overrides,
  };
}

function serverResult(overrides: Partial<MockSubmitResponse> = {}): MockSubmitResponse {
  return {
    attemptId: 'mat_abc',
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
    submittedAt: SERVER_NOW + 300_000,
    scoredAt: SERVER_NOW + 300_000,
    droppedLateAnswers: 0,
    rejectedQuestionIds: [],
    review: [
      {
        questionId: 'q1',
        chapterId: 'book-ch1',
        position: 1,
        stem: 'What is 2 + 2?',
        options: [
          { ref: 'opaque-q1-x', body: 'Three' },
          { ref: 'opaque-q1-y', body: 'Four' },
          { ref: 'opaque-q1-z', body: 'Five' },
        ],
        selectedRef: 'opaque-q1-y',
        correctRef: 'opaque-q1-y',
        isCorrect: true,
        explanation: null,
      },
      {
        questionId: 'q2',
        chapterId: 'book-ch5',
        position: 2,
        stem: 'What is the capital of Nepal?',
        options: [
          { ref: 'opaque-q2-x', body: 'Pokhara' },
          { ref: 'opaque-q2-y', body: 'Kathmandu' },
          { ref: 'opaque-q2-z', body: 'Lalitpur' },
        ],
        selectedRef: 'opaque-q2-x',
        correctRef: 'opaque-q2-y',
        isCorrect: false,
        explanation: null,
      },
    ],
    ...overrides,
  };
}

function renderMock(testId = 'full-mock-1') {
  return render(
    <MemoryRouter initialEntries={[`/app/mock-tests/${testId}/quiz`]}>
      <Routes>
        <Route path="/app/mock-tests/:testId/quiz" element={<MockTestQuiz />} />
      </Routes>
    </MemoryRouter>
  );
}

/** The static chapter JSON must never be fetched on the configured path. */
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  keyCounter = 0;
  for (const fn of Object.values(mockApi)) fn.mockReset();
  mockApi.getChapters.mockResolvedValue({ ok: true, data: { chapters: [] }, replayed: false });
  mockApi.startMock.mockResolvedValue({ ok: true, data: serverPaper(), replayed: false });
  mockApi.syncMock.mockResolvedValue({
    ok: true,
    data: { accepted: true, serverNow: SERVER_NOW, expiresAt: SERVER_NOW + 1, remainingMs: 1 },
    replayed: false,
  });
  mockApi.submitMock.mockResolvedValue({ ok: true, data: serverResult(), replayed: false });

  fetchSpy = vi.fn(async () => new Response('[]', { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
});

/** Answer both questions, then walk the two-step submit. */
async function answerAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('radio')[1]); // q1 -> "Four"
  await user.click(screen.getByRole('button', { name: /^Question 2,/ }));
  await user.click(screen.getAllByRole('radio')[0]); // q2 -> "Pokhara"
  await user.click(await screen.findByRole('button', { name: /review & submit/i }));
  await user.click(await screen.findByRole('button', { name: /^submit paper$/i }));
  await user.click(await screen.findByRole('button', { name: /yes, submit now/i }));
}

describe('MockTestQuiz, backend configured', () => {
  it('starts the attempt on the server with a single idempotency key', async () => {
    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());

    expect(mockApi.startMock).toHaveBeenCalledTimes(1);
    expect(mockApi.startMock).toHaveBeenCalledWith({
      // The local mock-test id IS the server template id.
      templateId: 'full-mock-1',
      idempotencyKey: expect.stringMatching(/^key-\d+$/) as unknown as string,
    });
  });

  it('never touches the static chapter JSON, so there is no key to read', async () => {
    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());

    // localData's loaders are the only `fetch` on this page, and they are the
    // files that ship `correct_option_index`.
    const dataRequests = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/data/'));
    expect(dataRequests).toEqual([]);
    // The paper is the server's two questions, not 10 chapters x 10.
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('reveals no verdict mid-paper, however the student answers', async () => {
    const user = userEvent.setup();
    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());

    const radios = screen.getAllByRole('radio');
    await user.click(radios[0]);

    expect(screen.queryByText(/^Correct/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Incorrect/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/✓ Correct/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Submit$/ })).not.toBeInTheDocument();

    // Answers stay editable, which is the point of deferring.
    await user.click(radios[2]);
    expect(radios[2]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
  });

  it('submits option refs rather than indexes, under one key', async () => {
    const user = userEvent.setup();
    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());

    await answerAndSubmit(user);

    await waitFor(() => expect(mockApi.submitMock).toHaveBeenCalledTimes(1));
    const [body] = mockApi.submitMock.mock.calls[0] as [
      { attemptId: string; idempotencyKey: string; answers: Record<string, string> },
    ];
    expect(body.attemptId).toBe('mat_abc');
    expect(body.answers).toEqual({ q1: 'opaque-q1-y', q2: 'opaque-q2-x' });
    expect(body.idempotencyKey).toMatch(/^key-\d+$/);
  });

  it('shows the server score and the server verdicts, not a local tally', async () => {
    const user = userEvent.setup();
    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());

    await answerAndSubmit(user);

    expect(await screen.findByText(/Detailed Review/i)).toBeInTheDocument();
    // 1 of 2 at 50% is the server's arithmetic. A client scoring this paper
    // holds no key and would report 0 out of 0.
    expect(screen.getByText('/ 2')).toBeInTheDocument();
    expect(screen.getByText('50% accuracy')).toBeInTheDocument();
    const stat = (label: string) =>
      screen.getAllByRole('term').find((el) => el.textContent === label)?.nextElementSibling;
    expect(stat('Correct')).toHaveTextContent('1');
    expect(stat('Incorrect')).toHaveTextContent('1');
    expect(stat('Skipped')).toHaveTextContent('0');
    // Exactly one right answer is marked per question, matched by ref.
    expect(screen.getAllByText(/✓ Correct/)).toHaveLength(2);
    expect(screen.getAllByText(/✗ Your answer/)).toHaveLength(1);
    // And the no-answer-key note must not appear: every question was gradable.
    expect(screen.queryByText(/no answer key yet/i)).not.toBeInTheDocument();
  });

  it('autosaves to the server as refs when the tab is hidden', async () => {
    const user = userEvent.setup();
    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());

    await user.click(screen.getAllByRole('radio')[1]);

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    try {
      // Hiding the tab also pauses the engine's timing slice, so the dispatch
      // has to be inside `act`.
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await waitFor(() => expect(mockApi.syncMock).toHaveBeenCalled());
    } finally {
      hidden.mockRestore();
    }

    expect(mockApi.syncMock).toHaveBeenCalledWith({
      attemptId: 'mat_abc',
      answers: { q1: 'opaque-q1-y' },
    });
  });

  it('resumes the attempt the server already holds, with its saved answers', async () => {
    localStorage.setItem(
      'necprep_mock_attempt_v1:full-mock-1',
      JSON.stringify({ attemptId: 'mat_abc', startKey: 'sk', submitKey: 'mk' })
    );
    mockApi.getMockAttempt.mockResolvedValue({
      ok: true,
      data: serverPaper({ savedAnswers: { q1: 'opaque-q1-z' } }),
      replayed: false,
    });

    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());

    // No second paper was opened.
    expect(mockApi.startMock).not.toHaveBeenCalled();
    expect(mockApi.getMockAttempt).toHaveBeenCalledWith('mat_abc');
    // The server's snapshot is restored, even with nothing in localStorage.
    expect(screen.getAllByRole('radio')[2]).toBeChecked();
  });

  it('shows the stored review when the resumed attempt is already submitted', async () => {
    localStorage.setItem(
      'necprep_mock_attempt_v1:full-mock-1',
      JSON.stringify({ attemptId: 'mat_abc', startKey: 'sk', submitKey: 'mk' })
    );
    mockApi.getMockAttempt.mockResolvedValue({
      ok: true,
      data: serverPaper({ status: 'submitted' }),
      replayed: false,
    });
    mockApi.getMockReview.mockResolvedValue({ ok: true, data: serverResult(), replayed: false });

    renderMock();

    expect(await screen.findByText(/Detailed Review/i)).toBeInTheDocument();
    // Re-submitting a finished paper is a 409, and starting a new one would
    // lose the result the candidate came back for.
    expect(mockApi.submitMock).not.toHaveBeenCalled();
    expect(mockApi.startMock).not.toHaveBeenCalled();
  });

  it('submits an attempt whose deadline passed while the tab was shut', async () => {
    localStorage.setItem(
      'necprep_mock_attempt_v1:full-mock-1',
      JSON.stringify({ attemptId: 'mat_abc', startKey: 'sk', submitKey: 'mk' })
    );
    mockApi.getMockAttempt.mockResolvedValue({
      ok: true,
      // Still in_progress server-side, but out of time.
      data: serverPaper({ expiresAt: SERVER_NOW - 1 }),
      replayed: false,
    });
    mockApi.submitMock.mockResolvedValue({
      ok: true,
      data: serverResult({ timing: 'expired', droppedLateAnswers: 2 }),
      replayed: false,
    });

    renderMock();

    // An empty payload: the server scores the last snapshot it accepted in
    // time rather than discarding the candidate's work.
    await waitFor(() => expect(mockApi.submitMock).toHaveBeenCalledTimes(1));
    const [body] = mockApi.submitMock.mock.calls[0] as [{ answers: Record<string, string> }];
    expect(body.answers).toEqual({});
    expect(await screen.findByText(/marked from the answers saved before the deadline/i))
      .toBeInTheDocument();
  });

  it('reports a failed start instead of falling back to local scoring', async () => {
    mockApi.startMock.mockResolvedValue({
      ok: false,
      error: { code: 'INSUFFICIENT_CONTENT', message: 'That mock test has no questions configured.' },
    });

    renderMock();

    expect(
      await screen.findByRole('heading', { name: /no questions configured/i })
    ).toBeInTheDocument();
    // Silently downgrading an exam to the cheatable path would be worse than
    // telling the student to try again.
    const dataRequests = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/data/'));
    expect(dataRequests).toEqual([]);
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('does not open a second paper when the resume request cannot reach the server', async () => {
    localStorage.setItem(
      'necprep_mock_attempt_v1:full-mock-1',
      JSON.stringify({ attemptId: 'mat_abc', startKey: 'sk', submitKey: 'mk' })
    );
    mockApi.getMockAttempt.mockResolvedValue({
      ok: false,
      error: { code: 'NETWORK_UNAVAILABLE', message: 'Could not reach the server.' },
    });

    renderMock();

    expect(await screen.findByRole('heading', { name: /could not reach the server/i })).toBeInTheDocument();
    // The attempt already running has a clock on it; starting another would
    // strand it.
    expect(mockApi.startMock).not.toHaveBeenCalled();
  });

  it('recovers the score when the submission already landed', async () => {
    const user = userEvent.setup();
    mockApi.submitMock.mockResolvedValue({
      ok: false,
      error: { code: 'ATTEMPT_NOT_IN_PROGRESS', message: 'This attempt has already been submitted.' },
    });
    mockApi.getMockReview.mockResolvedValue({ ok: true, data: serverResult(), replayed: false });

    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());
    await answerAndSubmit(user);

    expect(await screen.findByText(/Detailed Review/i)).toBeInTheDocument();
    expect(mockApi.getMockReview).toHaveBeenCalledWith('mat_abc');
  });
});
