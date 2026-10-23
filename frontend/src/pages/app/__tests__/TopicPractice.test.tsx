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

    // The bug this guards: a forward question that was never answered must not
    // inherit the previous question's verdict.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // On an unanswered question the primary action is Next, not a disabled
    // Submit. The quiz engine hides Submit until something is selected, because
    // skipping is legitimate in practice and required in a timed mock — the
    // page's old behaviour was a permanently-disabled Submit that implied
    // otherwise. Selecting an option brings Submit back.
    expect(screen.queryByRole('button', { name: /^Submit$/ })).not.toBeInTheDocument();

    const stem2 = screen.getByRole('heading', { level: 2 }).textContent!;
    await user.click(screen.getByText(stem2.includes('2 + 2') ? 'Four' : 'Kathmandu'));
    expect(screen.getByRole('button', { name: /^Submit$/ })).toBeEnabled();
    // Still no verdict — selecting is not committing.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
  // --- Proof the engine is actually wired in -------------------------------
  //
  // The engine, its components and 96 of its tests existed for a while before
  // any page imported it, which meant flagging, the palette, keyboard shortcuts
  // and autosave were all unreachable by a user. These assert reachability
  // through the real page, not through the engine in isolation.

  it('exposes flag-for-review, and the palette reflects it', async () => {
    const user = userEvent.setup();
    renderAt('book-ch1', 2);
    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());

    const flag = screen.getByRole('button', { name: /flag/i });
    expect(flag).toHaveAttribute('aria-pressed', 'false');

    await user.click(flag);
    expect(flag).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: /Question 1,.*flagged for review/i })
    ).toBeInTheDocument();
  });

  it('exposes the question palette and jumps on click', async () => {
    const user = userEvent.setup();
    renderAt('book-ch1', 2);
    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());

    expect(screen.getByRole('navigation', { name: /question navigator/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Question 2,/i }));
    await waitFor(() => expect(screen.getByText('Question 2')).toBeInTheDocument());
  });

  it('answers by keyboard: a number key selects and Enter commits', async () => {
    const user = userEvent.setup();
    renderAt('book-ch1', 2);
    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());

    const stem = screen.getByRole('heading', { level: 2 }).textContent!;
    const correct = stem.includes('2 + 2') ? 'Four' : 'Kathmandu';
    // Option order is randomised per question by orderOptions, so find the
    // correct option's 1-based position rather than assuming it.
    const radios = screen.getAllByRole('radio');
    const position = radios.findIndex((r) => r.textContent?.includes(correct)) + 1;

    await user.keyboard(String(position));
    expect(screen.getByRole('radio', { name: new RegExp(correct) })).toBeChecked();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent(/Correct/i);
  });

  it('restores an in-progress attempt from the saved draft', async () => {
    const user = userEvent.setup();
    const first = renderAt('book-ch1', 2);
    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());

    const stem = screen.getByRole('heading', { level: 2 }).textContent!;
    const correct = stem.includes('2 + 2') ? 'Four' : 'Kathmandu';
    await user.click(screen.getByText(correct));
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));
    expect(screen.getByRole('status')).toHaveTextContent(/Correct/i);

    // Autosave is debounced, so wait for the draft to actually exist rather
    // than assuming the write is synchronous — unmounting first would test
    // nothing.
    await waitFor(() =>
      expect(localStorage.getItem('eng_quiz_draft_v1:topic:book-ch1:2')).not.toBeNull()
    );

    // Unmount and remount, which is what a refresh looks like to the page.
    first.unmount();
    renderAt('book-ch1', 2);

    await waitFor(() =>
      expect(screen.getByText(/Attempt resumed/i)).toBeInTheDocument()
    );
    // The committed answer and its verdict survive, not just the question list.
    expect(screen.getByRole('radio', { name: new RegExp(correct) })).toBeChecked();
    // The resume notice is also a live region, so target the verdict by content
    // rather than assuming there is exactly one status on the page.
    const verdicts = screen
      .getAllByRole('status')
      .filter((el) => /correct/i.test(el.textContent ?? ''));
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).not.toHaveTextContent(/Incorrect/i);
  });

  it('reaches the explanation panel, which is honest about having none', async () => {
    const user = userEvent.setup();
    renderAt('book-ch1', 2);
    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());

    const stem = screen.getByRole('heading', { level: 2 }).textContent!;
    await user.click(screen.getByText(stem.includes('2 + 2') ? 'Four' : 'Kathmandu'));
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));

    // No question in the bank has an explanation, so the panel must say so
    // rather than render blank or invent one.
    expect(screen.getByText(/No explanation has been written/i)).toBeInTheDocument();
  });

  it('points at the syllabus even though no explanation exists', async () => {
    const user = userEvent.setup();
    renderAt('book-ch1', 2);
    await waitFor(() => expect(screen.getByText('Question 1')).toBeInTheDocument());

    const stem = screen.getByRole('heading', { level: 2 }).textContent!;
    await user.click(screen.getByText(stem.includes('2 + 2') ? 'Four' : 'Kathmandu'));
    await user.click(screen.getByRole('button', { name: /^Submit$/ }));

    // "Incorrect" with nothing else is a dead end. The derived reference is
    // what a student without an explanation actually has to revise from.
    expect(screen.getByText(/Syllabus reference/i)).toBeInTheDocument();

    // These stub questions carry none of chapter 1's vocabulary, so the
    // classifier must decline and fall back to the chapter — which is always
    // exact — rather than inventing a sub-chapter.
    expect(
      screen.getByText(/Chapter 1: Concept of Basic Electrical and Electronics Engineering/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/^1\.\d /)).not.toBeInTheDocument();
  });
});
