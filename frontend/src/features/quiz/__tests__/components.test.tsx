import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExplanationPanel } from '../components/ExplanationPanel';
import { OptionList } from '../components/OptionList';
import { QuestionPalette } from '../components/QuestionPalette';
import { QuizToolbar } from '../components/QuizToolbar';
import { ResultSummary } from '../components/ResultSummary';
import { ReviewScreen } from '../components/ReviewScreen';
import { selectPalette } from '../selectors';
import { select, toggleFlag } from '../actions';
import { T0, makeQuestions, run, start } from './factory';

describe('OptionList', () => {
  it('reports the selected option and only reveals the key when told to', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <OptionList
        label="Options"
        options={['Alpha', 'Beta', 'Gamma']}
        value={1}
        correctIndex={2}
        revealed={false}
        onChange={onChange}
      />
    );

    expect(screen.getByRole('radio', { name: /Beta/ })).toBeChecked();
    // The key is index 2, but nothing may say so yet.
    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Gamma/ }));
    expect(onChange).toHaveBeenCalledWith(2);

    rerender(
      <OptionList
        label="Options"
        options={['Alpha', 'Beta', 'Gamma']}
        value={1}
        correctIndex={2}
        revealed
        onChange={onChange}
      />
    );
    // The shared Radio primitive makes the state audible, not colour-only.
    expect(screen.getByText('Correct answer')).toBeInTheDocument();
    expect(screen.getByText('Incorrect answer')).toBeInTheDocument();
  });

  it('shows no key at all for a question the bank cannot grade', () => {
    render(
      <OptionList
        label="Options"
        options={['Alpha', 'Beta']}
        value={0}
        correctIndex={-1}
        revealed
        onChange={vi.fn()}
      />
    );

    expect(screen.queryByText('Correct answer')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Alpha/ })).toBeChecked();
  });

  it('moves the selection with the arrow keys, per the radiogroup pattern', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <OptionList
        label="Options"
        options={['Alpha', 'Beta', 'Gamma']}
        value={0}
        onChange={onChange}
      />
    );

    screen.getByRole('radio', { name: /Alpha/ }).focus();
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenCalledWith(1);

    await user.keyboard('{ArrowUp}');
    // Wraps back round.
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('keeps one tab stop for the whole group', () => {
    render(
      <OptionList label="Options" options={['Alpha', 'Beta']} value={1} onChange={vi.fn()} />
    );
    expect(screen.getByRole('radio', { name: /Beta/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: /Alpha/ })).toHaveAttribute('tabindex', '-1');
  });

  it('locks the answer without removing it from the accessibility tree', () => {
    render(
      <OptionList
        label="Options"
        options={['Alpha', 'Beta']}
        value={1}
        locked
        onChange={vi.fn()}
      />
    );
    const chosen = screen.getByRole('radio', { name: /Beta/ });
    expect(chosen).toHaveAttribute('aria-disabled', 'true');
    expect(chosen).not.toBeDisabled();
  });
});

describe('QuizToolbar', () => {
  it('renders the counter and hides the timer for untimed practice', () => {
    render(
      <QuizToolbar
        index={2}
        total={30}
        answered={5}
        flagged={false}
        onToggleFlag={vi.fn()}
        bookmarked={false}
        onToggleBookmark={vi.fn()}
      />
    );

    expect(screen.getByText('3/30')).toBeInTheDocument();
    expect(screen.getByText('5 answered')).toBeInTheDocument();
    // The glyph counter is hidden from assistive tech; a sentence replaces it.
    expect(screen.getByText('Question 3 of 30, 5 answered')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('formats the deadline it is handed and escalates when time is short', () => {
    const { rerender } = render(
      <QuizToolbar
        index={0}
        total={10}
        answered={0}
        timeLeftMs={2_700_000}
        flagged={false}
        onToggleFlag={vi.fn()}
        bookmarked={false}
        onToggleBookmark={vi.fn()}
      />
    );
    expect(screen.getByRole('timer')).toHaveTextContent('45:00');
    expect(screen.getByRole('timer')).toHaveAttribute('aria-live', 'off');

    rerender(
      <QuizToolbar
        index={0}
        total={10}
        answered={0}
        timeLeftMs={30_000}
        flagged={false}
        onToggleFlag={vi.fn()}
        bookmarked={false}
        onToggleBookmark={vi.fn()}
      />
    );
    expect(screen.getByRole('timer')).toHaveTextContent('00:30');
    expect(screen.getByRole('timer')).toHaveAttribute('aria-live', 'assertive');
  });

  it('exposes flag and bookmark as toggle buttons', async () => {
    const user = userEvent.setup();
    const onToggleFlag = vi.fn();
    const onToggleBookmark = vi.fn();
    render(
      <QuizToolbar
        index={0}
        total={10}
        answered={0}
        flagged
        onToggleFlag={onToggleFlag}
        bookmarked={false}
        onToggleBookmark={onToggleBookmark}
      />
    );

    expect(screen.getByRole('button', { name: /Flag/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Bookmark/ }));
    expect(onToggleBookmark).toHaveBeenCalledTimes(1);
  });
});

describe('QuestionPalette', () => {
  it('describes each question state and jumps on click', async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    const state = run(start({ questions: makeQuestions(3) }), select(0, 1, T0), toggleFlag(2));

    render(<QuestionPalette entries={selectPalette(state)} onJump={onJump} />);

    expect(
      screen.getByRole('button', { name: 'Question 1, answered, current' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Question 2, unanswered' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Question 3, unanswered, flagged for review' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Question 3/ }));
    expect(onJump).toHaveBeenCalledWith(2);
  });
});

describe('ReviewScreen', () => {
  it('lists what is unanswered and flagged', () => {
    render(
      <ReviewScreen
        total={10}
        answered={7}
        unanswered={3}
        flagged={2}
        unansweredIndices={[3, 7, 9]}
        flaggedIndices={[1, 4]}
        onJump={vi.fn()}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText('4, 8, 10')).toBeInTheDocument();
    expect(screen.getByText('2, 5')).toBeInTheDocument();
  });

  it('requires a second press to submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ReviewScreen
        total={10}
        answered={7}
        unanswered={3}
        flagged={0}
        unansweredIndices={[3, 7, 9]}
        flaggedIndices={[]}
        onJump={vi.fn()}
        onBack={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Submit paper' }));
    // The first press only asks — the mock test used to end here.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot change your answers/i);

    await user.click(screen.getByRole('button', { name: /Yes, submit with 3 blank/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('ResultSummary', () => {
  it('scores against the gradable total and says so', () => {
    render(
      <ResultSummary
        summary={{
          mode: 'topic',
          score: 6,
          total: 10,
          gradableTotal: 8,
          answered: 9,
          skipped: 1,
          incorrect: 2,
          accuracyPct: 75,
          elapsedMs: 260_000,
          responses: [],
        }}
        title="Chapter 1"
      />
    );

    expect(screen.getAllByText('6')).toHaveLength(2);
    expect(screen.getByText('/ 8')).toBeInTheDocument();
    expect(screen.getByText('75% accuracy')).toBeInTheDocument();
    expect(screen.getByText(/no answer key yet/)).toBeInTheDocument();
    expect(screen.getByText('4 minutes 20 seconds')).toBeInTheDocument();
  });
});

describe('ExplanationPanel', () => {
  it('renders an authored explanation', () => {
    render(<ExplanationPanel explanation="Ohm's law gives V = IR." />);
    expect(screen.getByText(/Ohm/)).toBeInTheDocument();
  });

  it('states plainly that there is none rather than inventing one', () => {
    render(<ExplanationPanel sourceLabel="Chapter 3" />);
    expect(screen.getByText(/No explanation has been written/)).toBeInTheDocument();
    expect(screen.getByText(/Refer to Chapter 3/)).toBeInTheDocument();
  });

  it('stays hidden until the answer is revealed', () => {
    render(<ExplanationPanel explanation="Because." revealed={false} />);
    expect(screen.queryByText('Because.')).not.toBeInTheDocument();
  });
});
