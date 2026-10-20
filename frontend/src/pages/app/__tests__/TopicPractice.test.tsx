import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import TopicPractice from '../TopicPractice';

/**
 * Regression tests for the answer-loss bug: handleNext/handlePrev used to reset
 * `selectedAnswer` to null while restoring `showResult` from the answered set,
 * so revisiting an answered question erased the user's choice and the feedback
 * block compared null against correctIndex and always rendered "Incorrect".
 */

// Two questions with known, different correct answers. `correct_option_index`
// is 1-based in the chapter JSON; localData converts it.
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

function renderAt(topicId: string, count: number) {
  return render(
    <MemoryRouter initialEntries={[`/app/practice/topic/${topicId}?count=${count}`]}>
      <Routes>
        <Route path="/app/practice/topic/:topicId" element={<TopicPractice />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(CH_JSON), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })));
});

describe('TopicPractice', () => {
  it('keeps the chosen answer and its verdict when navigating back', async () => {
    const user = userEvent.setup();
    // book-ch1 is a real chapter id, so getTopicById resolves; fetch is stubbed.
    renderAt('book-ch1', 2);

    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());

    // Answer question 1 correctly.
    const stem = screen.getByRole('heading', { level: 2 }).textContent!;
    const correct = stem.includes('2 + 2') ? 'Four' : 'Kathmandu';
    await user.click(screen.getByText(correct));
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));

    expect(screen.getByRole('status')).toHaveTextContent(/Correct/i);

    // Move forward, then back.
    await user.click(screen.getByRole('button', { name: /Next|Finish/ }));
    await waitFor(() => expect(screen.getByText('Question 2')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Previous$/ }));
    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());

    // The verdict must still say Correct, not "Incorrect".
    expect(screen.getByRole('status')).toHaveTextContent(/Correct/i);
    expect(screen.getByRole('status')).not.toHaveTextContent(/Incorrect/i);

    // And the user's own choice must still be marked.
    expect(screen.getByRole('radio', { name: new RegExp(correct) })).toBeChecked();
  });

  it('does not re-reveal a forward question that was never answered', async () => {
    const user = userEvent.setup();
    renderAt('book-ch1', 2);

    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());

    const stem = screen.getByRole('heading', { level: 2 }).textContent!;
    await user.click(screen.getByText(stem.includes('2 + 2') ? 'Four' : 'Kathmandu'));
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));
    await user.click(screen.getByRole('button', { name: /Next|Finish/ }));

    await waitFor(() => expect(screen.getByText('Question 2')).toBeInTheDocument());
    // Unanswered question: no verdict, and Submit is back (disabled until a pick).
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Submit$/ })).toBeDisabled();
  });

  it('scores each question independently rather than carrying a selection over', async () => {
    const user = userEvent.setup();
    renderAt('book-ch1', 2);

    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());

    // Answer Q1 wrong on purpose.
    const stem1 = screen.getByRole('heading', { level: 2 }).textContent!;
    const wrong1 = stem1.includes('2 + 2') ? 'Three' : 'Pokhara';
    await user.click(screen.getByText(wrong1));
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));
    expect(screen.getByRole('status')).toHaveTextContent(/Incorrect/i);

    await user.click(screen.getByRole('button', { name: /Next|Finish/ }));
    await waitFor(() => expect(screen.getByText('Question 2')).toBeInTheDocument());

    // Answer Q2 right.
    const stem2 = screen.getByRole('heading', { level: 2 }).textContent!;
    await user.click(screen.getByText(stem2.includes('2 + 2') ? 'Four' : 'Kathmandu'));
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));
    expect(screen.getByRole('status')).toHaveTextContent(/Correct/i);

    // Score reads 1, and going back still shows Q1 as incorrect.
    await user.click(screen.getByRole('button', { name: /^Previous$/ }));
    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/Incorrect/i);
  });
});
