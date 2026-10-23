import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type {
  PracticeAnswerResponse,
  PracticeFinishResponse,
  PracticeSessionPaper,
} from '../../../services/api';

/**
 * Chapter practice, running against the Worker.
 *
 * Practice is the awkward surface to move server-side, because the student is
 * owed a verdict per question — so unlike a mock, the API does disclose the key
 * mid-session. These tests pin the boundary of that disclosure and the latency
 * it buys:
 *
 *  1. The paper arrives with NO key. Nothing is revealed and nothing is marked
 *     until the server has been asked about that one question.
 *  2. What goes back is an OPTION REF — an opaque per-session token — never an
 *     index or a position, so a harvested payload is useless.
 *  3. The verdict the student reads is the SERVER's `isCorrect`, not a local
 *     comparison dressed up as one.
 *  4. The round trip is visible. A student who clicks Submit is told something
 *     is happening rather than left with an unchanged screen.
 *
 * `isBackendConfigured()` reads a build-time constant, so the only way to
 * exercise the configured path is to mock the module — which is also how
 * `MockTestQuiz.remote.test.tsx` and `useChapters.test.tsx` do it.
 */

const mockApi = {
  getChapters: vi.fn(),
  startPractice: vi.fn(),
  getPracticeSession: vi.fn(),
  answerPractice: vi.fn(),
  finishPractice: vi.fn(),
};

const enqueued: Array<{ kind: string; body: unknown }> = [];
let keyCounter = 0;

vi.mock('../../../services/api', () => ({
  api: mockApi,
  isBackendConfigured: () => true,
  apiBaseUrl: () => 'https://api.test',
  newIdempotencyKey: () => `key-${String(++keyCounter)}`,
  enqueue: (entry: { kind: string; body: unknown }) => {
    enqueued.push(entry);
    return { localId: 'local', entry, enqueuedAt: 0, attempts: 0, lastError: null };
  },
}));

const TopicPractice = (await import('../TopicPractice')).default;

const SERVER_NOW = 1_700_000_000_000;

/** Two questions, three options each, refs that are plainly not indexes. */
function serverPaper(overrides: Partial<PracticeSessionPaper> = {}): PracticeSessionPaper {
  return {
    sessionId: 'pse_abc',
    mode: 'chapter',
    status: 'in_progress',
    startedAt: SERVER_NOW,
    serverNow: SERVER_NOW,
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
        chapterId: 'book-ch1',
        position: 2,
        stem: 'What is the capital of Nepal?',
        options: [
          { ref: 'opaque-q2-x', body: 'Pokhara' },
          { ref: 'opaque-q2-y', body: 'Kathmandu' },
          { ref: 'opaque-q2-z', body: 'Lalitpur' },
        ],
      },
    ],
    answered: {},
    ...overrides,
  };
}

function answerResponse(overrides: Partial<PracticeAnswerResponse> = {}): PracticeAnswerResponse {
  return {
    questionId: 'q1',
    selectedRef: 'opaque-q1-x',
    correctRef: 'opaque-q1-y',
    isCorrect: false,
    explanation: null,
    answeredCount: 1,
    correctCount: 0,
    ...overrides,
  };
}

function finishResponse(overrides: Partial<PracticeFinishResponse> = {}): PracticeFinishResponse {
  return {
    sessionId: 'pse_abc',
    total: 2,
    correct: 1,
    incorrect: 1,
    skipped: 0,
    accuracyPct: 50,
    finishedAt: SERVER_NOW + 120_000,
    ...overrides,
  };
}

function renderPractice(topicId = 'book-ch1', count = 2) {
  return render(
    <MemoryRouter initialEntries={[`/app/practice/topic/${topicId}?count=${String(count)}`]}>
      <Routes>
        <Route path="/app/practice/topic/:topicId" element={<TopicPractice />} />
      </Routes>
    </MemoryRouter>
  );
}

/** The static chapter JSON must never be fetched on the configured path. */
let fetchSpy: ReturnType<typeof vi.fn>;

const dataRequests = () =>
  fetchSpy.mock.calls.filter(([url]) => String(url).includes('/data/'));

beforeEach(() => {
  keyCounter = 0;
  enqueued.length = 0;
  for (const fn of Object.values(mockApi)) fn.mockReset();
  mockApi.getChapters.mockResolvedValue({ ok: true, data: { chapters: [] }, replayed: false });
  mockApi.startPractice.mockResolvedValue({ ok: true, data: serverPaper(), replayed: false });
  mockApi.answerPractice.mockResolvedValue({ ok: true, data: answerResponse(), replayed: false });
  mockApi.finishPractice.mockResolvedValue({ ok: true, data: finishResponse(), replayed: false });

  fetchSpy = vi.fn(async () => new Response('[]', { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
});

/** A deferred so a test can hold the answer request open and inspect the wait. */
function deferred<T>() {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe('TopicPractice, backend configured', () => {
  it('starts the session on the server with one idempotency key', async () => {
    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    expect(mockApi.startPractice).toHaveBeenCalledTimes(1);
    expect(mockApi.startPractice).toHaveBeenCalledWith({
      mode: 'chapter',
      chapterIds: ['book-ch1'],
      questionCount: 2,
      idempotencyKey: expect.stringMatching(/^key-\d+$/) as unknown as string,
    });
  });

  it('never touches the static chapter JSON, so there is no key to read', async () => {
    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    // localData's loaders are the only `fetch` on this page, and they are the
    // files that ship `correct_option_index`.
    expect(dataRequests()).toEqual([]);
    // The paper is the server's, three options and all.
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('receives no answer key, so nothing is marked before the answer is sent', async () => {
    const user = userEvent.setup();
    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    // Selecting is not committing, and committing is the only thing that can
    // earn a verdict.
    await user.click(screen.getAllByRole('radio')[1]);

    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument();
    expect(screen.queryByText('Incorrect answer')).not.toBeInTheDocument();
    expect(screen.queryByText(/Correct\. Well done\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Incorrect\./)).not.toBeInTheDocument();
    // No option carries a revealed state of any kind.
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.dataset.state === 'correct' || radio.dataset.state === 'incorrect').toBe(
        false
      );
    }
    expect(mockApi.answerPractice).not.toHaveBeenCalled();
  });

  it('sends an option ref rather than an index, under one key per question', async () => {
    const user = userEvent.setup();
    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    await user.click(screen.getAllByRole('radio')[1]); // "Four"
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));

    await waitFor(() => expect(mockApi.answerPractice).toHaveBeenCalledTimes(1));
    const [body] = mockApi.answerPractice.mock.calls[0] as [
      {
        sessionId: string;
        questionId: string;
        optionRef: string;
        idempotencyKey: string;
        latencyMs: number;
      },
    ];
    expect(body.sessionId).toBe('pse_abc');
    expect(body.questionId).toBe('q1');
    // The ref, not `1`. A payload harvested from here is meaningless in the
    // next session, because the ref mixes in that session's option seed.
    expect(body.optionRef).toBe('opaque-q1-y');
    expect(body.idempotencyKey).toMatch(/^key-\d+$/);
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('shows the verdict the server sent, not one it worked out locally', async () => {
    const user = userEvent.setup();
    // The contrived case that separates the two: the student picks "Three",
    // the server names "Four" as the key AND says the answer was correct. A
    // client comparing the two indexes would print "Incorrect"; a client
    // reading `isCorrect` prints "Correct". Only the second is the server's
    // verdict, and the server is the only thing that marked anything.
    mockApi.answerPractice.mockResolvedValue({
      ok: true,
      data: answerResponse({
        selectedRef: 'opaque-q1-x',
        correctRef: 'opaque-q1-y',
        isCorrect: true,
      }),
      replayed: false,
    });

    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    await user.click(screen.getAllByRole('radio')[0]); // "Three"
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));

    expect(await screen.findByText(/Correct\. Well done\./)).toBeInTheDocument();
  });

  it('reveals the key for the answered question and for no other', async () => {
    const user = userEvent.setup();
    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    await user.click(screen.getAllByRole('radio')[0]); // "Three", which is wrong
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));

    // The server said q1's key is "Four" and that the answer was wrong.
    expect(await screen.findByText(/^Incorrect\. The correct answer is B\./)).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios[1].dataset.state).toBe('correct');
    expect(radios[0].dataset.state).toBe('incorrect');

    // Move to q2, which has not been answered. Nothing about it was disclosed.
    await user.click(screen.getByRole('button', { name: /^Question 2,/ }));
    await waitFor(() => expect(screen.getByText('What is the capital of Nepal?')).toBeInTheDocument());
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.dataset.state).toBe('neutral');
    }
    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument();
  });

  it('says the answer is being checked while the request is in flight', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: true; data: PracticeAnswerResponse; replayed: boolean }>();
    mockApi.answerPractice.mockReturnValue(pending.promise);

    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    await user.click(screen.getAllByRole('radio')[1]);
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));

    // The whole point: a round trip the student can see. Leaving the screen
    // unchanged is indistinguishable from a click that did not register.
    expect(await screen.findByText(/Checking your answer/i)).toBeInTheDocument();
    const busy = screen.getByRole('button', { name: /checking/i });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    // And still no verdict, because there is nothing to say yet.
    expect(screen.queryByText(/Correct\. Well done\./)).not.toBeInTheDocument();
    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument();

    pending.settle({ ok: true, data: answerResponse(), replayed: false });

    expect(await screen.findByText(/^Incorrect\./)).toBeInTheDocument();
    expect(screen.queryByText(/Checking your answer/i)).not.toBeInTheDocument();
  });

  it('shows the server explanation when there is one', async () => {
    const user = userEvent.setup();
    mockApi.answerPractice.mockResolvedValue({
      ok: true,
      data: answerResponse({ explanation: 'Two plus two is four.' }),
      replayed: false,
    });

    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    await user.click(screen.getAllByRole('radio')[0]);
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));

    expect(await screen.findByText('Two plus two is four.')).toBeInTheDocument();
    // Still labelled as an unreviewed draft, which is the panel's standing rule.
    expect(screen.getByText(/not yet reviewed/i)).toBeInTheDocument();
    // And the derived syllabus reference survives the move to the server.
    expect(screen.getByText(/Syllabus reference/i)).toBeInTheDocument();
  });

  it('keeps the answer and lets it be retried when the server refuses it', async () => {
    const user = userEvent.setup();
    mockApi.answerPractice.mockResolvedValueOnce({
      ok: false,
      error: { code: 'RATE_LIMITED', message: 'Too many answers too quickly.' },
    });

    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    await user.click(screen.getAllByRole('radio')[1]);
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));

    // Said out loud, never silently swallowed, and never faked as a verdict.
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be marked/i);
    expect(screen.queryByText(/Correct\. Well done\./)).not.toBeInTheDocument();
    // Queued so the answer is still recorded when the limit clears, under the
    // key it was first sent with.
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].kind).toBe('practice.answer');

    const firstKey = (
      mockApi.answerPractice.mock.calls[0] as [{ idempotencyKey: string }]
    )[0].idempotencyKey;

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(/^Incorrect\./)).toBeInTheDocument();
    // The SAME key: a retry of a request that actually landed must converge,
    // not count the answer twice.
    const retryKey = (
      mockApi.answerPractice.mock.calls[1] as [{ idempotencyKey: string }]
    )[0].idempotencyKey;
    expect(retryKey).toBe(firstKey);
  });

  it('finishes on the server and shows the server totals', async () => {
    const user = userEvent.setup();
    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    await user.click(screen.getAllByRole('radio')[1]);
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));
    await screen.findByText(/^Incorrect\./);
    await user.click(screen.getByRole('button', { name: /^Next/ }));
    await waitFor(() => expect(screen.getByText('What is the capital of Nepal?')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Finish$/ }));

    await waitFor(() => expect(mockApi.finishPractice).toHaveBeenCalledTimes(1));
    expect(mockApi.finishPractice).toHaveBeenCalledWith({
      sessionId: 'pse_abc',
      idempotencyKey: expect.stringMatching(/^key-\d+$/) as unknown as string,
    });

    expect(await screen.findByText(/Attempt complete/i)).toBeInTheDocument();
    // 1 of 2 at 50% is the server's arithmetic. A client scoring this set holds
    // no key and would report 0 out of 0.
    expect(screen.getByText('/ 2')).toBeInTheDocument();
    expect(screen.getByText('50% accuracy')).toBeInTheDocument();
    const stat = (label: string) =>
      screen.getAllByRole('term').find((el) => el.textContent === label)?.nextElementSibling;
    expect(stat('Correct')).toHaveTextContent('1');
    expect(stat('Incorrect')).toHaveTextContent('1');
    expect(stat('Skipped')).toHaveTextContent('0');
    // The no-answer-key note must not appear: every question was gradable.
    expect(screen.queryByText(/no answer key yet/i)).not.toBeInTheDocument();
  });

  it('says it is saving rather than showing a score it cannot compute', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ ok: true; data: PracticeFinishResponse; replayed: boolean }>();
    mockApi.finishPractice.mockReturnValue(pending.promise);

    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Question 2,/ }));
    await user.click(screen.getByRole('button', { name: /^Finish$/ }));

    expect(await screen.findByText(/Saving your session/i)).toBeInTheDocument();
    // Zero out of zero is what the engine's selectors would honestly report
    // for a server-keyed paper, and it must never be shown as a result.
    expect(screen.queryByText('/ 0')).not.toBeInTheDocument();
    expect(screen.queryByText(/Attempt complete/i)).not.toBeInTheDocument();

    pending.settle({ ok: true, data: finishResponse(), replayed: false });
    expect(await screen.findByText(/Attempt complete/i)).toBeInTheDocument();
  });

  it('resumes the session the server already holds, with its revealed keys', async () => {
    localStorage.setItem(
      'necprep_practice_session_v1:topic:book-ch1:2',
      JSON.stringify({ sessionId: 'pse_abc', startKey: 'sk', finishKey: 'fk' })
    );
    mockApi.getPracticeSession.mockResolvedValue({
      ok: true,
      data: serverPaper({
        answered: {
          q1: {
            questionId: 'q1',
            selectedRef: 'opaque-q1-z',
            correctRef: 'opaque-q1-y',
            isCorrect: false,
            explanation: null,
          },
        },
      }),
      replayed: false,
    });

    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    // No second session was opened.
    expect(mockApi.startPractice).not.toHaveBeenCalled();
    expect(mockApi.getPracticeSession).toHaveBeenCalledWith('pse_abc');
    // The server's snapshot is restored even with no local draft at all: the
    // selection, the verdict and the key the student had already earned.
    const radios = screen.getAllByRole('radio');
    expect(radios[2]).toBeChecked();
    expect(radios[1].dataset.state).toBe('correct');
    expect(screen.getByText(/^Incorrect\. The correct answer is B\./)).toBeInTheDocument();
  });

  it('reads back the totals of a session the server already finished', async () => {
    localStorage.setItem(
      'necprep_practice_session_v1:topic:book-ch1:2',
      JSON.stringify({ sessionId: 'pse_abc', startKey: 'sk', finishKey: 'fk' })
    );
    mockApi.getPracticeSession.mockResolvedValue({
      ok: true,
      data: serverPaper({ status: 'submitted' }),
      replayed: false,
    });

    renderPractice();

    // The finish is replayed under the STORED key, which is how the totals are
    // recovered without a second endpoint and without inventing a number.
    expect(await screen.findByText(/Attempt complete/i)).toBeInTheDocument();
    expect(mockApi.finishPractice).toHaveBeenCalledWith({
      sessionId: 'pse_abc',
      idempotencyKey: 'fk',
    });
    expect(mockApi.startPractice).not.toHaveBeenCalled();
    expect(screen.getByText('50% accuracy')).toBeInTheDocument();
  });

  it('reports a failed start instead of falling back to local scoring', async () => {
    mockApi.startPractice.mockResolvedValue({
      ok: false,
      error: {
        code: 'INSUFFICIENT_CONTENT',
        message: 'No questions are available for that selection.',
      },
    });

    renderPractice();

    expect(
      await screen.findByRole('heading', { name: /no questions are available/i })
    ).toBeInTheDocument();
    // Silently downgrading to the cheatable, locally-scored path would make
    // the progress figures mean two different things.
    expect(dataRequests()).toEqual([]);
  });

  it('does not open a second session when the resume request cannot be reached', async () => {
    localStorage.setItem(
      'necprep_practice_session_v1:topic:book-ch1:2',
      JSON.stringify({ sessionId: 'pse_abc', startKey: 'sk', finishKey: 'fk' })
    );
    mockApi.getPracticeSession.mockResolvedValue({
      ok: false,
      error: { code: 'NETWORK_UNAVAILABLE', message: 'Could not reach the server.' },
    });

    renderPractice();

    expect(
      await screen.findByRole('heading', { name: /could not reach the server/i })
    ).toBeInTheDocument();
    expect(mockApi.startPractice).not.toHaveBeenCalled();
  });

  it('keeps flag-for-review and the palette on the server path', async () => {
    const user = userEvent.setup();
    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    const flag = screen.getByRole('button', { name: /flag/i });
    await user.click(flag);
    expect(flag).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: /Question 1,.*flagged for review/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /question navigator/i })).toBeInTheDocument();
  });

  it('answers by keyboard: a number key selects and Enter posts', async () => {
    const user = userEvent.setup();
    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    // No prior click: `useQuizKeyboard` hands Enter back to a focused button,
    // so the shortcut is exercised from the page's own resting focus, which is
    // what a student typing rather than clicking actually has.
    await user.keyboard('2');
    expect(screen.getAllByRole('radio')[1]).toBeChecked();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(mockApi.answerPractice).toHaveBeenCalledTimes(1));
    const [body] = mockApi.answerPractice.mock.calls[0] as [{ optionRef: string }];
    // Committed through the server, not scored in the tab.
    expect(body.optionRef).toBe('opaque-q1-y');
  });

  it('does not write server-keyed questions into local progress', async () => {
    const user = userEvent.setup();
    renderPractice();
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    await user.click(screen.getAllByRole('radio')[1]);
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));
    await screen.findByText(/^Incorrect\./);

    // The client's own response records all read `correct: false`, because it
    // holds no key. Writing them to `eng_progress` would corrupt it; the
    // server maintains the real per-chapter stats.
    expect(localStorage.getItem('eng_progress')).toBeNull();
  });
});
