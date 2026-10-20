import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Landing from '../Landing';

/**
 * The name-entry modal declared role="dialog" aria-modal="true" and then did
 * none of the work that claim implies: no initial focus, no focus trap, no
 * Escape handler, no background scroll lock and no focus restoration — Tab
 * walked straight out into the page behind it.
 */

// framer-motion's `whileInView` needs IntersectionObserver, which jsdom does not
// implement. Local stub rather than a change to the shared test setup.
class StubIntersectionObserver implements IntersectionObserver {
  readonly root: Document | Element | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);
});

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<h1>Dashboard</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

const openers = () => screen.getByRole('button', { name: /Get Started Free/i });

afterEach(() => {
  document.body.style.overflow = '';
});

describe('Landing name dialog', () => {
  it('names itself from its heading and takes initial focus on the input', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(openers());

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Nice to meet you!');
    expect(screen.getByLabelText('Full name')).toHaveFocus();
  });

  it('locks background scroll while open and releases it on close', async () => {
    const user = userEvent.setup();
    renderLanding();

    expect(document.body.style.overflow).toBe('');

    await user.click(openers());
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('traps Tab and Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(openers());

    const closeButton = screen.getByRole('button', { name: 'Close' });
    const input = screen.getByLabelText('Full name');
    const submit = screen.getByRole('button', { name: /Start studying/i });

    expect(input).toHaveFocus();

    await user.tab();
    expect(submit).toHaveFocus();

    // Past the last control the trap must wrap to the first, not escape into
    // the page behind the overlay.
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(submit).toHaveFocus();
  });

  it('closes on Escape and restores focus to the control that opened it', async () => {
    const user = userEvent.setup();
    renderLanding();

    const trigger = openers();
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('restores focus to whichever trigger opened it', async () => {
    const user = userEvent.setup();
    renderLanding();

    // The page has two openers; focus must go back to the one that was used.
    const ctaTrigger = screen.getByRole('button', { name: /Start Preparing Now/i });
    await user.click(ctaTrigger);
    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(ctaTrigger).toHaveFocus();
  });

  it('wires its validation message to the input', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(openers());
    await user.click(screen.getByRole('button', { name: /Start studying/i }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Please enter your name/i);
    const input = screen.getByLabelText('Full name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', alert.id);
  });

  it('still submits and navigates from the keyboard', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(openers());
    await user.keyboard('Samir{Enter}');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    // The scroll lock must not survive the navigation that unmounts the page.
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Landing hero heading', () => {
  it('keeps the whole title readable and limits the gradient to one short word', () => {
    renderLanding();

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Master Your NEC License Exam');

    // Exactly one accent span, and it covers a single short word rather than
    // two thirds of the largest text on the page.
    const accents = heading.querySelectorAll('span');
    expect(accents).toHaveLength(1);
    expect(accents[0].textContent).toBe('NEC');
    expect(accents[0].className).not.toContain('gradient-text');
  });
});
