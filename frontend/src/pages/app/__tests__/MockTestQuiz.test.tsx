import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import MockTestQuiz from '../MockTestQuiz';
import { examFormat, readConfirmed } from '../../../data/examBlueprint';
import { isBackendConfigured } from '../../../services/api';

/**
 * A mock test is the one place where revealing an answer mid-paper is a real
 * harm, and where submitting blind off the last question loses marks. Both were
 * true of this page before it was moved onto the shared quiz engine: feedback
 * was shown per question in some paths, and the submit button went straight to
 * scoring with no count of what had been left blank.
 *
 * THIS FILE IS THE NO-BACKEND BUILD. Nothing here mocks `services/api`, so
 * `VITE_API_BASE_URL` is unset and `isBackendConfigured()` is false — the
 * static-JSON-plus-localStorage deployment that is live today. The server-scored
 * path is covered in `MockTestQuiz.remote.test.tsx`; everything asserted here
 * must keep working without it.
 */

const CH_JSON = [
  {
    qsns: 'What is 2 + 2?',
    opt1: 'Three',
    opt2: 'Four',
    opt3: 'Five',
    opt4: 'Six',
    correct_option: 'Four',
    correct_option_index: 2,
  },
  {
    qsns: 'What is the capital of Nepal?',
    opt1: 'Pokhara',
    opt2: 'Biratnagar',
    opt3: 'Kathmandu',
    opt4: 'Lalitpur',
    correct_option: 'Kathmandu',
    correct_option_index: 3,
  },
];

function renderMock(testId = 'full-mock-1') {
  return render(
    <MemoryRouter initialEntries={[`/app/mock-tests/${testId}/quiz`]}>
      <Routes>
        <Route path="/app/mock-tests/:testId/quiz" element={<MockTestQuiz />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(CH_JSON), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
  );
});

describe('MockTestQuiz', () => {
  it('runs on the local path, with no backend configured', async () => {
    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());

    // The premise of every other assertion in this file.
    expect(isBackendConfigured()).toBe(false);
    // Every request went to the static question bank; no absolute API origin
    // was contacted, so the quiz is scoring locally by design.
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) =>
      String(url)
    );
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith('/data/'))).toBe(true);
  });

  it('runs the paper at the owner-confirmed 120-minute duration', async () => {
    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());

    // The clock is driven from examBlueprint via topics.ts, not from a literal
    // on this page — the page shipped 45 minutes against a 120-minute exam.
    expect(readConfirmed(examFormat.durationMinutes)).toBe(120);
    // The clock counts down from the blueprint value, so it reads just under
    // 120 minutes on the first tick.
    expect(screen.getByRole('timer')).toHaveAccessibleName(
      /Time remaining: (119|120) minutes/
    );
  });

  it('reveals nothing mid-paper, however the student navigates', async () => {
    const user = userEvent.setup();
    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());

    const radios = screen.getAllByRole('radio');
    await user.click(radios[0]);

    // Deferred feedback: no verdict, and crucially no per-question Submit that
    // would commit and reveal one.
    expect(screen.queryByText(/^Correct/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Incorrect/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Submit$/ })).not.toBeInTheDocument();

    // Answers stay editable, which is the point of deferring.
    expect(radios[0]).toBeChecked();
    await user.click(radios[1]);
    expect(radios[1]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
  });

  it('shows no explanation during the paper, even though one would be allowed in review', async () => {
    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());
    // The panel renders nothing in an exam context, so neither the empty state
    // nor an AI-draft badge can appear mid-paper.
    expect(screen.queryByText(/No explanation has been written/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/AI draft/i)).not.toBeInTheDocument();
  });

  it('routes the last question through a review screen that counts what is blank', async () => {
    const user = userEvent.setup();
    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());

    // Answer the first question only, then jump to the last via the palette.
    await user.click(screen.getAllByRole('radio')[0]);
    const paletteButtons = screen.getAllByRole('button', { name: /^Question \d+,/ });
    await user.click(paletteButtons[paletteButtons.length - 1]);

    // The last question's primary action opens review rather than submitting.
    const finish = await screen.findByRole('button', { name: /review & submit/i });
    await user.click(finish);

    // The review screen must state what is unanswered — the old page submitted
    // with no such warning at all. "unanswered" also appears on every palette
    // button, so assert the review screen's own summary term rather than any
    // match for the word.
    expect(await screen.findByRole('heading', { name: /before you submit/i })).toBeInTheDocument();
    const unansweredTerm = screen
      .getAllByRole('term')
      .find((el) => el.textContent === 'Unanswered');
    expect(unansweredTerm).toBeDefined();
    // 10 chapters x 2 stubbed questions = 20, of which exactly one is answered.
    expect(unansweredTerm?.nextElementSibling).toHaveTextContent('19');

    // And it must be escapable, so a student can go back and fill the gaps.
    await user.click(screen.getByRole('button', { name: /keep working/i }));
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());
  });

  it('scores server-independently and only reveals answers after submission', async () => {
    const user = userEvent.setup();
    renderMock();
    await waitFor(() => expect(screen.getByRole('timer')).toBeInTheDocument());

    await user.click(screen.getAllByRole('radio')[0]);
    const paletteButtons = screen.getAllByRole('button', { name: /^Question \d+,/ });
    await user.click(paletteButtons[paletteButtons.length - 1]);
    await user.click(await screen.findByRole('button', { name: /review & submit/i }));

    // Submitting is two deliberate steps: the review screen asks, then
    // confirms, and the confirm button names how many are still blank. A single
    // misplaced click cannot end a 120-minute paper.
    await user.click(await screen.findByRole('button', { name: /^submit paper$/i }));
    const confirm = await screen.findByRole('button', { name: /yes, submit with 19 blank/i });
    await user.click(confirm);

    // Only now does the detailed review appear, with the key disclosed.
    expect(await screen.findByText(/Detailed Review/i)).toBeInTheDocument();
    expect(screen.getAllByText(/✓ Correct/).length).toBeGreaterThan(0);
  });
});
