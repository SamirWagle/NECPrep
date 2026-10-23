import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * Chapter practice with NO backend configured.
 *
 * This is a supported deployment and the one live today: questions from
 * `public/data/*.json`, progress in localStorage, scored in the browser. The
 * point of this file is that moving practice onto the Worker did not quietly
 * make the server a requirement — so it asserts, explicitly, that not one
 * practice endpoint is reached and that the verdict still comes from the local
 * answer key.
 *
 * `TopicPractice.test.tsx` covers the behaviour of this path in depth and runs
 * against the real `services/api` (where `VITE_API_BASE_URL` is unset, so
 * `isBackendConfigured()` is already false). This file mocks the module purely
 * so the endpoints can be spied on.
 */

const mockApi = {
  getChapters: vi.fn(),
  startPractice: vi.fn(),
  getPracticeSession: vi.fn(),
  answerPractice: vi.fn(),
  finishPractice: vi.fn(),
};

vi.mock('../../../services/api', () => ({
  api: mockApi,
  isBackendConfigured: () => false,
  apiBaseUrl: () => '',
  newIdempotencyKey: () => 'key-1',
  enqueue: vi.fn(),
}));

const TopicPractice = (await import('../TopicPractice')).default;

/** Two questions with known, different keys. `correct_option_index` is 1-based. */
const CH_JSON = [
  {
    qsns: 'What is 2 + 2?',
    opt1: 'Three', opt2: 'Four', opt3: 'Five', opt4: 'Six',
    correct_option: 'Four', correct_option_index: 2,
  },
  {
    qsns: 'What is the capital of Nepal?',
    opt1: 'Pokhara', opt2: 'Biratnagar', opt3: 'Kathmandu', opt4: 'Lalitpur',
    correct_option: 'Kathmandu', correct_option_index: 3,
  },
];

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const fn of Object.values(mockApi)) fn.mockReset();
  fetchSpy = vi.fn(
    async () =>
      new Response(JSON.stringify(CH_JSON), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
  );
  vi.stubGlobal('fetch', fetchSpy);
});

function renderPractice(topicId = 'book-ch1') {
  return render(
    <MemoryRouter initialEntries={[`/app/practice/topic/${topicId}?count=2`]}>
      <Routes>
        <Route path="/app/practice/topic/:topicId" element={<TopicPractice />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TopicPractice, no backend configured', () => {
  it('scores in the browser and reaches no practice endpoint', async () => {
    const user = userEvent.setup();
    renderPractice();
    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());

    // The paper came from the static JSON, which is where the key is.
    expect(fetchSpy.mock.calls.filter(([url]) => String(url).includes('/data/'))).not.toEqual([]);

    const stem = screen.getByRole('heading', { level: 2 }).textContent ?? '';
    const correct = stem.includes('2 + 2') ? 'Four' : 'Kathmandu';
    await user.click(screen.getByText(correct));
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));

    // Instant, local, and no round trip: this build has no server to ask.
    expect(screen.getByRole('status')).toHaveTextContent(/Correct/i);
    expect(screen.queryByText(/Checking your answer/i)).not.toBeInTheDocument();
    expect(mockApi.startPractice).not.toHaveBeenCalled();
    expect(mockApi.answerPractice).not.toHaveBeenCalled();
    expect(mockApi.getPracticeSession).not.toHaveBeenCalled();
  });

  it('finishes and scores the set locally, with no finish request', async () => {
    const user = userEvent.setup();
    renderPractice();
    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());

    const answerCurrent = async (right: boolean) => {
      const stem = screen.getByRole('heading', { level: 2 }).textContent ?? '';
      const isFirst = stem.includes('2 + 2');
      const label = right
        ? isFirst
          ? 'Four'
          : 'Kathmandu'
        : isFirst
          ? 'Three'
          : 'Pokhara';
      await user.click(screen.getByText(label));
      await user.click(screen.getByRole('button', { name: /^Submit$/ }));
    };

    await answerCurrent(true);
    await user.click(screen.getByRole('button', { name: /^Next/ }));
    await waitFor(() => expect(screen.getByText('Question 2')).toBeInTheDocument());
    await answerCurrent(false);
    await user.click(screen.getByRole('button', { name: /^Finish$/ }));

    expect(await screen.findByText(/Attempt complete/i)).toBeInTheDocument();
    // One right out of two, counted by the engine's own selectors.
    expect(screen.getByText('/ 2')).toBeInTheDocument();
    expect(screen.getByText('50% accuracy')).toBeInTheDocument();
    expect(mockApi.finishPractice).not.toHaveBeenCalled();

    // And local progress is still written, which is the whole point of this
    // deployment: the remote path leaves it alone because the server owns it.
    const progress = localStorage.getItem('eng_progress');
    expect(progress).not.toBeNull();
    expect(progress).toContain('book-ch1');
  });
});

/**
 * A failed load must show the failure, not spin forever.
 *
 * `useQuiz` sets `error` when the question load rejects and leaves `phase` at
 * 'loading' — there is no failure phase. Every practice page asked "is it
 * loading?" before "did it fail?", which made its own error branch
 * unreachable: a chapter JSON that 404s left a spinner with no way out but a
 * reload.
 *
 * It survived because the remote path has a separate guard above both, so the
 * surface being actively worked on was the one that behaved.
 */
describe('TopicPractice, failed load', () => {
  it('shows the error rather than spinning forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network is down'))),
    );

    // A DIFFERENT chapter from the tests above. `localData` holds a
    // module-level `questionCache` that nothing clears, so re-using book-ch1
    // here would be served from that cache and never reach the stubbed fetch -
    // the test would pass for the wrong reason, or in this case fail for one.
    renderPractice('book-ch7');

    await waitFor(() =>
      expect(screen.getByText(/Failed to load questions/i)).toBeInTheDocument(),
    );
    // The spinner must be gone, not merely covered.
    expect(screen.queryByText(/^Loading/i)).not.toBeInTheDocument();
  });
});
