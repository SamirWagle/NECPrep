import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isTextEntryTarget, optionIndexForKey, useQuizKeyboard } from '../useQuizKeyboard';
import type { QuizKeyboardHandlers } from '../useQuizKeyboard';

function makeHandlers(): QuizKeyboardHandlers {
  return {
    onSelectOption: vi.fn(),
    onSubmitOrAdvance: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onToggleFlag: vi.fn(),
    onToggleBookmark: vi.fn(),
  };
}

function Harness({
  handlers,
  enabled = true,
  optionCount = 4,
}: {
  handlers: QuizKeyboardHandlers;
  enabled?: boolean;
  optionCount?: number;
}) {
  useQuizKeyboard({ ...handlers, enabled, optionCount });
  return (
    <div>
      <input aria-label="search" type="search" />
      <textarea aria-label="notes" />
      <button type="button">a button</button>
      <p>body</p>
    </div>
  );
}

describe('optionIndexForKey', () => {
  it('maps digits and letters, and nothing else', () => {
    expect(optionIndexForKey('1')).toBe(0);
    expect(optionIndexForKey('4')).toBe(3);
    expect(optionIndexForKey('a')).toBe(0);
    expect(optionIndexForKey('D')).toBe(3);
    expect(optionIndexForKey('0')).toBe(-1);
    expect(optionIndexForKey('z')).toBe(-1);
    expect(optionIndexForKey('Enter')).toBe(-1);
  });
});

describe('isTextEntryTarget', () => {
  it('recognises text fields and ignores the rest', () => {
    render(<Harness handlers={makeHandlers()} />);
    expect(isTextEntryTarget(screen.getByLabelText('search'))).toBe(true);
    expect(isTextEntryTarget(screen.getByLabelText('notes'))).toBe(true);
    expect(isTextEntryTarget(screen.getByRole('button'))).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe('useQuizKeyboard', () => {
  it('selects an option from digits and letters', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} />);

    await user.keyboard('3');
    expect(handlers.onSelectOption).toHaveBeenCalledWith(2);

    await user.keyboard('d');
    expect(handlers.onSelectOption).toHaveBeenCalledWith(3);
  });

  it('ignores an option key past the end of the options', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} optionCount={3} />);

    await user.keyboard('4');
    expect(handlers.onSelectOption).not.toHaveBeenCalled();
  });

  it('navigates with the arrow keys and submits with Enter', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} />);

    await user.keyboard('{ArrowRight}');
    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    await user.keyboard('{ArrowLeft}');
    expect(handlers.onPrev).toHaveBeenCalledTimes(1);
    await user.keyboard('{Enter}');
    expect(handlers.onSubmitOrAdvance).toHaveBeenCalledTimes(1);
  });

  it('toggles flag and bookmark', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} />);

    await user.keyboard('f');
    expect(handlers.onToggleFlag).toHaveBeenCalledTimes(1);
    await user.keyboard('b');
    expect(handlers.onToggleBookmark).toHaveBeenCalledTimes(1);
    // "b" is the bookmark key, so it must not also pick option B.
    expect(handlers.onSelectOption).not.toHaveBeenCalled();
  });

  it('stays out of the way while typing in a text field', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} />);

    await user.click(screen.getByLabelText('search'));
    await user.keyboard('bad 1 2 3');

    expect(handlers.onToggleBookmark).not.toHaveBeenCalled();
    expect(handlers.onToggleFlag).not.toHaveBeenCalled();
    expect(handlers.onSelectOption).not.toHaveBeenCalled();
    expect(screen.getByLabelText('search')).toHaveValue('bad 1 2 3');
  });

  it('stays out of the way in a textarea', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} />);

    await user.click(screen.getByLabelText('notes'));
    await user.keyboard('fab');
    expect(handlers.onToggleFlag).not.toHaveBeenCalled();
    expect(handlers.onToggleBookmark).not.toHaveBeenCalled();
  });

  it('leaves Enter to the browser when a button has focus', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} />);

    screen.getByRole('button').focus();
    await user.keyboard('{Enter}');
    // Otherwise the native click and our shortcut would both fire.
    expect(handlers.onSubmitOrAdvance).not.toHaveBeenCalled();
  });

  it('leaves modified keystrokes to the browser', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} />);

    await user.keyboard('{Meta>}1{/Meta}');
    await user.keyboard('{Control>}f{/Control}');
    expect(handlers.onSelectOption).not.toHaveBeenCalled();
    expect(handlers.onToggleFlag).not.toHaveBeenCalled();
  });

  it('does nothing at all when disabled', async () => {
    const user = userEvent.setup();
    const handlers = makeHandlers();
    render(<Harness handlers={handlers} enabled={false} />);

    await user.keyboard('1{ArrowRight}f');
    expect(handlers.onSelectOption).not.toHaveBeenCalled();
    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onToggleFlag).not.toHaveBeenCalled();
  });
});
