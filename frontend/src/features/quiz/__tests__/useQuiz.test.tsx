import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { draftStorageKey, readDraft } from '../draft';
import { QuestionCard } from '../components/QuestionCard';
import { QuizActionBar } from '../components/QuizActionBar';
import { useQuiz } from '../useQuiz';
import type { FeedbackMode, Question } from '../types';
import { getProgress } from '../../../services/localData';
import { makeQuestions } from './factory';

const QUESTIONS = makeQuestions(3, [1, 2, 3]);

function Harness({
  attemptKey,
  questions = QUESTIONS,
  feedback = 'immediate',
  restoredSelections,
  durationMs = null,
  deadlineFromDuration = false,
}: {
  attemptKey: string;
  questions?: Question[];
  feedback?: FeedbackMode;
  restoredSelections?: Readonly<Record<string, number>>;
  durationMs?: number | null;
  deadlineFromDuration?: boolean;
}) {
  const quiz = useQuiz({
    mode: 'topic',
    feedback,
    attemptKey,
    autosaveDelayMs: 0,
    restoredSelections,
    durationMs,
    deadlineFromDuration,
    loadQuestions: async () => questions,
    resolveQuestions: async (ids) => {
      const byId = new Map(questions.map((q) => [q.id, q]));
      return ids.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined);
    },
  });

  if (quiz.state.phase === 'loading') return <p>Loading…</p>;
  if (quiz.current === undefined) return <p>Empty</p>;

  return (
    <div>
      {quiz.state.resumed && <p>Attempt resumed</p>}
      <p>Score: {quiz.summary.score}</p>
      <p>EndsAt: {String(quiz.state.timing.endsAt)}</p>
      <p>Answered: {quiz.counts.answered}</p>
      <QuestionCard
        index={quiz.state.currentIndex}
        total={quiz.counts.total}
        questionText={quiz.current.question}
        options={quiz.current.options}
        selection={quiz.selection}
        onSelect={quiz.selectOption}
        correctIndex={quiz.current.correctIndex}
        revealed={quiz.isRevealed}
        verdict={quiz.verdict}
        locked={quiz.isSubmitted}
      />
      <QuizActionBar
        onPrev={quiz.prev}
        onNext={quiz.next}
        // Deferred mode has nothing to submit per question, so the primary
        // action stays Next/Finish.
        onSubmit={feedback === 'immediate' ? quiz.submitCurrent : undefined}
        onFinish={quiz.submitAll}
        canPrev={quiz.state.currentIndex > 0}
        canNext={!quiz.isLast}
        canSubmit={quiz.canSubmitCurrent}
        isLast={quiz.isLast}
      />
    </div>
  );
}

async function ready() {
  await waitFor(() => expect(screen.getByRole('radiogroup')).toBeInTheDocument());
}

describe('useQuiz', () => {
  it('loads a paper and answers a question', async () => {
    const user = userEvent.setup();
    render(<Harness attemptKey="topic:ch1:3" />);
    await ready();

    await user.click(screen.getByRole('radio', { name: /^B/ }));
    expect(screen.getByRole('radio', { name: /^B/ })).toBeChecked();
    expect(screen.getByText('Answered: 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByRole('status')).toHaveTextContent(/Correct/);
    expect(screen.getByText('Score: 1')).toBeInTheDocument();
  });

  it('keeps the answer and the verdict across navigation', async () => {
    const user = userEvent.setup();
    render(<Harness attemptKey="topic:ch1:3" />);
    await ready();

    await user.click(screen.getByRole('radio', { name: /^B/ }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(screen.getByRole('button', { name: /Next/ }));

    // A forward, unanswered question shows no verdict.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Previous/ }));
    expect(screen.getByRole('status')).toHaveTextContent(/Correct/);
    expect(screen.getByRole('status')).not.toHaveTextContent(/Incorrect/);
    expect(screen.getByRole('radio', { name: /^B/ })).toBeChecked();
  });

  it('does not inflate the score when submit is pressed repeatedly', async () => {
    const user = userEvent.setup();
    render(<Harness attemptKey="topic:ch1:3" />);
    await ready();

    await user.click(screen.getByRole('radio', { name: /^B/ }));
    const submit = screen.getByRole('button', { name: 'Submit' });
    await user.tripleClick(submit);

    expect(screen.getByText('Score: 1')).toBeInTheDocument();
  });

  it('autosaves the attempt and resumes it on a remount', async () => {
    const user = userEvent.setup();
    const key = 'topic:ch1:3';
    const first = render(<Harness attemptKey={key} />);
    await ready();

    await user.click(screen.getByRole('radio', { name: /^C/ }));
    await waitFor(() => expect(localStorage.getItem(draftStorageKey(key))).not.toBeNull());
    expect(readDraft(key)?.selections).toEqual([2, null, null]);

    first.unmount();
    render(<Harness attemptKey={key} />);
    await ready();

    await waitFor(() => expect(screen.getByText('Attempt resumed')).toBeInTheDocument());
    expect(screen.getByRole('radio', { name: /^C/ })).toBeChecked();
  });

  it('discards a draft whose questions no longer resolve', async () => {
    const user = userEvent.setup();
    const key = 'topic:ch1:3';
    const first = render(<Harness attemptKey={key} />);
    await ready();
    await user.click(screen.getByRole('radio', { name: /^C/ }));
    await waitFor(() => expect(localStorage.getItem(draftStorageKey(key))).not.toBeNull());
    first.unmount();

    // The chapter data changed under us: only one of the three ids resolves.
    render(<Harness attemptKey={key} questions={[QUESTIONS[0]]} />);
    await ready();

    expect(screen.queryByText('Attempt resumed')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^C/ })).not.toBeChecked();
    // The unusable draft was replaced by one describing the paper we can build.
    await waitFor(() => expect(readDraft(key)?.questionIds).toEqual([QUESTIONS[0].id]));
  });

  it('writes answers through to per-topic progress exactly once', async () => {
    const user = userEvent.setup();
    render(<Harness attemptKey="topic:ch1:3" />);
    await ready();

    await user.click(screen.getByRole('radio', { name: /^B/ }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      const entry = getProgress()['book-ch1'];
      expect(entry.attempted).toEqual(['book-ch1_0']);
      expect(entry.correct).toEqual(['book-ch1_0']);
    });
  });

  /**
   * `restoredSelections` is the remote mock's resume path: the Worker returns
   * the answers it has already accepted, so an attempt survives a device whose
   * localStorage was never written or was cleared.
   */
  it('restores answers an authoritative store holds, with no local draft', async () => {
    render(<Harness attemptKey="mock:m1" restoredSelections={{ 'book-ch1_1': 2 }} />);
    await ready();

    expect(screen.getByText('Answered: 1')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByRole('radio', { name: /^C/ })).toBeChecked();
  });

  it('lets a newer local draft win over the remote snapshot', async () => {
    const user = userEvent.setup();
    const key = 'mock:m1';
    const first = render(<Harness attemptKey={key} />);
    await ready();
    await user.click(screen.getByRole('radio', { name: /^D/ }));
    await waitFor(() => expect(readDraft(key)?.selections).toEqual([3, null, null]));
    first.unmount();

    // The draft is written on every answer, the server snapshot only every
    // autosave, so the draft can legitimately be newer. It wins where it has a
    // value; the server fills only the gaps.
    render(
      <Harness
        attemptKey={key}
        restoredSelections={{ 'book-ch1_0': 0, 'book-ch1_2': 1 }}
      />
    );
    await ready();

    expect(screen.getByRole('radio', { name: /^D/ })).toBeChecked();
    expect(screen.getByText('Answered: 2')).toBeInTheDocument();
  });

  it('ignores a restored index the paper cannot hold', async () => {
    render(<Harness attemptKey="mock:m1" restoredSelections={{ 'book-ch1_0': 9 }} />);
    await ready();
    expect(screen.getByText('Answered: 0')).toBeInTheDocument();
  });

  it('prefers an authoritative duration over a resumed draft deadline', async () => {
    const user = userEvent.setup();
    const key = 'mock:m1';
    const first = render(<Harness attemptKey={key} durationMs={60_000} />);
    await ready();
    await user.click(screen.getByRole('radio', { name: /^B/ }));
    const stored = await waitFor(() => {
      const draft = readDraft(key);
      expect(draft?.endsAt).not.toBeNull();
      return draft;
    });
    first.unmount();

    // Resumed WITHOUT the flag: the draft's own deadline governs, which is what
    // every local attempt wants.
    const second = render(<Harness attemptKey={key} durationMs={7_200_000} />);
    await ready();
    expect(screen.getByText(`EndsAt: ${String(stored?.endsAt)}`)).toBeInTheDocument();
    second.unmount();

    // Resumed WITH it: the deadline is recomputed from the duration, because on
    // a remote paper that duration is the server's remaining time and the
    // stored instant was written against this device's clock.
    render(<Harness attemptKey={key} durationMs={7_200_000} deadlineFromDuration />);
    await ready();
    expect(screen.queryByText(`EndsAt: ${String(stored?.endsAt)}`)).not.toBeInTheDocument();
    expect(Number(screen.getByText(/^EndsAt: /).textContent?.slice(8))).toBeGreaterThan(
      Date.now() + 7_000_000
    );
  });

  it('defers the verdict in deferred mode until the paper is submitted', async () => {
    const user = userEvent.setup();
    render(<Harness attemptKey="mock:m1" feedback="deferred" />);
    await ready();

    await user.click(screen.getByRole('radio', { name: /^B/ }));
    // Still editable, and no verdict yet.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Score: 0')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(screen.getByRole('button', { name: 'Finish' }));

    expect(screen.getByText('Score: 1')).toBeInTheDocument();
    // The draft is gone — a finished attempt must not be resumable.
    await waitFor(() => expect(localStorage.getItem(draftStorageKey('mock:m1'))).toBeNull());
  });
});
