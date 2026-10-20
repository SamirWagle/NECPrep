import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PracticeHub from '../app/PracticeHub';

/**
 * The Quick Practice and Custom Practice mode cards were
 * `<div onClick style={{cursor:'pointer'}}>` with no role, no tabIndex and no
 * key handler, so both features were unreachable by keyboard. Each also nested
 * a <button> inside the clickable div, which is invalid.
 */

function renderHub() {
  return render(
    <MemoryRouter initialEntries={['/app/practice']}>
      <Routes>
        <Route path="/app/practice" element={<PracticeHub />} />
        <Route path="/app/practice/quick" element={<h1>Quick Practice page</h1>} />
        <Route path="/app/practice/custom" element={<h1>Custom Practice page</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PracticeHub mode cards', () => {
  it('exposes Quick Practice as a link and activates it from the keyboard', async () => {
    const user = userEvent.setup();
    renderHub();

    const quick = screen.getByRole('link', { name: /Quick Practice/ });
    expect(quick).toHaveAttribute('href', '/app/practice/quick');

    quick.focus();
    expect(quick).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Quick Practice page' })).toBeInTheDocument();
  });

  it('exposes Custom Practice as a link and activates it from the keyboard', async () => {
    const user = userEvent.setup();
    renderHub();

    const custom = screen.getByRole('link', { name: /Custom Practice/ });
    expect(custom).toHaveAttribute('href', '/app/practice/custom');

    custom.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Custom Practice page' })).toBeInTheDocument();
  });

  it('reaches both mode cards by tabbing, in document order', async () => {
    const user = userEvent.setup();
    renderHub();

    const mock = screen.getByRole('link', { name: /Mock Tests/ });
    mock.focus();

    await user.tab();
    expect(screen.getByRole('link', { name: /Quick Practice/ })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('link', { name: /Custom Practice/ })).toHaveFocus();
  });

  it('nests no interactive element inside a mode card', () => {
    renderHub();

    for (const name of [/Mock Tests/, /Quick Practice/, /Custom Practice/]) {
      const card = screen.getByRole('link', { name });
      expect(card.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
    }
  });
});

describe('PracticeHub heading hierarchy', () => {
  it('declares exactly one h1', () => {
    renderHub();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('never skips a heading level', () => {
    renderHub();

    const levels = screen
      .getAllByRole('heading')
      .map((heading) => Number(heading.tagName.slice(1)));

    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
    // The "Practice Modes" h2 used to be .sr-only, leaving the visible outline
    // jumping h1 -> h3 over the mode cards.
    const modesHeading = screen.getByRole('heading', { name: 'Practice Modes' });
    expect(modesHeading.tagName).toBe('H2');
    expect(modesHeading.className).not.toContain('sr-only');
  });
});
