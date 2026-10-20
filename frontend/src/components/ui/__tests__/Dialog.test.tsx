import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from '../Dialog';

/**
 * The app's existing name-entry modal sets `aria-modal` but has no focus
 * trap, no initial focus, no Escape handler and no scroll lock — so Tab
 * walks straight out of the modal into the page behind it, and screen reader
 * users are told the rest of the page is unavailable while their focus sits
 * in it. These tests pin the real behaviour.
 */

function Fixture({
  onClose,
  withInitialFocus = false,
  closeOnEscape = true,
}: {
  onClose?: () => void;
  withInitialFocus?: boolean;
  closeOnEscape?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const secondRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <button type="button">Behind the dialog</button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        closeOnEscape={closeOnEscape}
        title="Enter your name"
        description="We use it to personalise your report."
        initialFocusRef={withInitialFocus ? secondRef : undefined}
        footer={
          <>
            <button type="button">Cancel</button>
            <button type="button">Save</button>
          </>
        }
      >
        <input aria-label="Your name" />
        <button type="button" ref={secondRef}>
          Middle action
        </button>
      </Dialog>
    </div>
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open dialog' }));
  return screen.getByRole('dialog');
}

describe('Dialog — semantics', () => {
  it('renders nothing while closed', () => {
    render(<Fixture />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a modal dialog named by its title and described by its description', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const dialog = await openDialog(user);

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Enter your name');
    expect(dialog).toHaveAccessibleDescription('We use it to personalise your report.');
  });

  it('renders into a portal on document.body, outside the triggering subtree', async () => {
    const user = userEvent.setup();
    const { container } = render(<Fixture />);
    const dialog = await openDialog(user);

    expect(container).not.toContainElement(dialog);
    expect(document.body).toContainElement(dialog);
  });
});

describe('Dialog — initial focus', () => {
  it('focuses the first tabbable element by default', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await openDialog(user);

    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus();
  });

  it('honours initialFocusRef', async () => {
    const user = userEvent.setup();
    render(<Fixture withInitialFocus />);
    await openDialog(user);

    expect(screen.getByRole('button', { name: 'Middle action' })).toHaveFocus();
  });
});

describe('Dialog — focus trap', () => {
  it('wraps Tab from the last tabbable element back to the first', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await openDialog(user);

    const close = screen.getByRole('button', { name: 'Close dialog' });
    const save = screen.getByRole('button', { name: 'Save' });

    save.focus();
    await user.tab();

    expect(save).not.toHaveFocus();
    expect(close).toHaveFocus();
  });

  it('wraps Shift+Tab from the first tabbable element to the last', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await openDialog(user);

    const close = screen.getByRole('button', { name: 'Close dialog' });
    const save = screen.getByRole('button', { name: 'Save' });

    close.focus();
    await user.tab({ shift: true });

    expect(save).toHaveFocus();
  });

  it('never lets Tab reach the page behind the dialog', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const dialog = await openDialog(user);

    const behind = screen.getByRole('button', { name: 'Behind the dialog' });
    for (let step = 0; step < 8; step += 1) {
      await user.tab();
      expect(behind).not.toHaveFocus();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });
});

describe('Dialog — Escape', () => {
  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    await openDialog(user);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('respects closeOnEscape={false}', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} closeOnEscape={false} />);
    await openDialog(user);

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Dialog — focus restoration', () => {
  it('returns focus to the trigger after closing with Escape', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });

    await user.click(trigger);
    expect(trigger).not.toHaveFocus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('returns focus to the trigger after closing with the close button', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));

    expect(trigger).toHaveFocus();
  });

  it('returns focus to the trigger after a backdrop dismissal', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });

    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement as HTMLElement;
    await user.click(backdrop);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('Dialog — scroll lock', () => {
  it('locks body scroll while open and restores it on close', async () => {
    const user = userEvent.setup();
    render(<Fixture />);

    expect(document.body.style.overflow).toBe('');

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });
});
