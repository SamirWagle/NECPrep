import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { PracticeAnswerResponse, PracticeSessionPaper } from '../../../services/api';

/**
 * QuickPractice and CustomPractice against the Worker.
 *
 * `TopicPractice.remote.test.tsx` pins the behaviour of the shared surface —
 * no key before the answer, refs out, the server's verdict, the visible round
 * trip — and all three pages run the same `usePracticeSurface`. What is left to
 * prove for these two is that they are actually WIRED, and wired to the right
 * request: the engine, its components and ninety-odd tests existed for a while
 * before any page imported them, which meant half the features were
 * unreachable by a user.
 *
 * So these tests are about reachability and about the one thing each page
 * decides for itself: which questions to ask the server for.
 */

const mockApi = {
  getChapters: vi.fn(),
  startPractice: vi.fn(),
  getPracticeSession: vi.fn(),
  answerPractice: vi.fn(),
  finishPractice: vi.fn(),
};

let keyCounter = 0;

vi.mock('../../../services/api', () => ({
  api: mockApi,
  isBackendConfigured: () => true,
  apiBaseUrl: () => 'https://api.test',
  newIdempotencyKey: () => `key-${String(++keyCounter)}`,
  enqueue: vi.fn(),
}));

const QuickPractice = (await import('../QuickPractice')).default;
const CustomPractice = (await import('../CustomPractice')).default;

const SERVER_NOW = 1_700_000_000_000;

function serverPaper(): PracticeSessionPaper {
  return {
    sessionId: 'pse_q',
    mode: 'custom',
    status: 'in_progress',
    startedAt: SERVER_NOW,
    serverNow: SERVER_NOW,
    questionCount: 1,
    questions: [
      {
        questionId: 'q1',
        chapterId: 'book-ch1',
        position: 1,
        stem: 'What is 2 + 2?',
        options: [
          { ref: 'opaque-q1-x', body: 'Three' },
          { ref: 'opaque-q1-y', body: 'Four' },
        ],
      },
    ],
    answered: {},
  };
}

function answerResponse(): PracticeAnswerResponse {
  return {
    questionId: 'q1',
    selectedRef: 'opaque-q1-y',
    correctRef: 'opaque-q1-y',
    isCorrect: true,
    explanation: null,
    answeredCount: 1,
    correctCount: 1,
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;

const dataRequests = () =>
  fetchSpy.mock.calls.filter(([url]) => String(url).includes('/data/'));

beforeEach(() => {
  keyCounter = 0;
  for (const fn of Object.values(mockApi)) fn.mockReset();
  mockApi.getChapters.mockResolvedValue({ ok: true, data: { chapters: [] }, replayed: false });
  mockApi.startPractice.mockResolvedValue({ ok: true, data: serverPaper(), replayed: false });
  mockApi.answerPractice.mockResolvedValue({ ok: true, data: answerResponse(), replayed: false });
  mockApi.finishPractice.mockResolvedValue({
    ok: true,
    data: {
      sessionId: 'pse_q',
      total: 1,
      correct: 1,
      incorrect: 0,
      skipped: 0,
      accuracyPct: 100,
      finishedAt: SERVER_NOW + 1000,
    },
    replayed: false,
  });

  fetchSpy = vi.fn(async () => new Response('[]', { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
});

describe('QuickPractice, backend configured', () => {
  function renderQuick(count = 10) {
    return render(
      <MemoryRouter initialEntries={[`/app/practice/quick?count=${String(count)}`]}>
        <Routes>
          <Route path="/app/practice/quick" element={<QuickPractice />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('asks for a mixed set with no chapter named, and reads no local JSON', async () => {
    renderQuick(10);
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    // `custom` with NO chapterIds is how the Worker spells "anywhere in the
    // bank": `drawPracticeQuestions` treats a null chapter list that way. It
    // also leaves `attempts.chapter_id` NULL, which is the honest value for a
    // set that is not about one chapter.
    expect(mockApi.startPractice).toHaveBeenCalledTimes(1);
    expect(mockApi.startPractice).toHaveBeenCalledWith({
      mode: 'custom',
      questionCount: 10,
      idempotencyKey: expect.stringMatching(/^key-\d+$/) as unknown as string,
    });
    expect(dataRequests()).toEqual([]);
  });

  it('marks through the server and shows the server totals', async () => {
    const user = userEvent.setup();
    renderQuick(10);
    await waitFor(() => expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument());

    await user.click(screen.getAllByRole('radio')[1]);
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));

    expect(await screen.findByText(/Correct\. Well done\./)).toBeInTheDocument();
    const [body] = mockApi.answerPractice.mock.calls[0] as [{ optionRef: string }];
    expect(body.optionRef).toBe('opaque-q1-y');

    await user.click(screen.getByRole('button', { name: /^Finish$/ }));
    expect(await screen.findByText(/Attempt complete/i)).toBeInTheDocument();
    expect(screen.getByText('100% accuracy')).toBeInTheDocument();
    expect(mockApi.finishPractice).toHaveBeenCalledTimes(1);
  });
});

describe('CustomPractice, backend configured', () => {
  function renderCustom() {
    return render(
      <MemoryRouter initialEntries={['/app/practice/custom']}>
        <Routes>
          <Route path="/app/practice/custom" element={<CustomPractice />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('opens no session until the config screen is submitted', async () => {
    const user = userEvent.setup();
    renderCustom();

    expect(await screen.findByRole('heading', { name: /custom practice/i })).toBeInTheDocument();
    // A session started at mount would be counted in the study history whether
    // or not the student ever answered a question.
    expect(mockApi.startPractice).not.toHaveBeenCalled();

    // Choosing chapters and a count is not starting anything either.
    await user.click(screen.getByRole('button', { name: /^Clear$/ }));
    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: '30' }));
    expect(mockApi.startPractice).not.toHaveBeenCalled();
  });

  it('asks for exactly the chapters the student chose', async () => {
    const user = userEvent.setup();
    renderCustom();
    await screen.findByRole('heading', { name: /custom practice/i });

    // Start with nothing selected, then pick the first chapter only.
    await user.click(screen.getByRole('button', { name: /^Clear$/ }));
    const chips = screen.getAllByRole('checkbox');
    await user.click(chips[0]);
    await user.click(screen.getByRole('button', { name: /^Start 20 Questions$/ }));

    await waitFor(() => expect(mockApi.startPractice).toHaveBeenCalledTimes(1));
    const [body] = mockApi.startPractice.mock.calls[0] as [
      { mode: string; chapterIds: string[]; questionCount: number },
    ];
    expect(body.mode).toBe('custom');
    expect(body.chapterIds).toHaveLength(1);
    expect(body.questionCount).toBe(20);
    expect(dataRequests()).toEqual([]);
  });

  it('reports a server refusal back to the config screen', async () => {
    const user = userEvent.setup();
    mockApi.startPractice.mockResolvedValue({
      ok: false,
      error: {
        code: 'INSUFFICIENT_CONTENT',
        message: 'No questions are available for that selection.',
      },
    });

    renderCustom();
    await screen.findByRole('heading', { name: /custom practice/i });
    await user.click(screen.getByRole('button', { name: /^Start 20 Questions$/ }));

    expect(
      await screen.findByRole('heading', { name: /no questions are available/i })
    ).toBeInTheDocument();
    // Not a silent fall back to the locally-scored path.
    expect(dataRequests()).toEqual([]);

    await user.click(screen.getByRole('button', { name: /change selection/i }));
    expect(
      await screen.findByRole('heading', { name: /custom practice/i })
    ).toBeInTheDocument();
  });
});
