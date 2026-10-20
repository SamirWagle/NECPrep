import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AppShell from '../AppShell';

/**
 * Keyboard-path regressions for the app shell:
 *  - there was no skip link, so every page opened with ~10 sidebar tab stops
 *    before any content;
 *  - the mobile drawer toggle carried no aria-expanded/aria-controls, moved no
 *    focus when it opened, ignored Escape and restored nothing on close;
 *  - below 1024px the closed drawer is translated off-canvas but stayed in the
 *    tab sequence.
 */

/** Deterministic matchMedia so the narrow/wide branch is not jsdom-dependent. */
function stubViewport(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <Routes>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<h1>Dashboard</h1>} />
          <Route path="practice" element={<h1>Practice</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppShell skip link', () => {
  it('is the first tab stop and moves focus into <main>', async () => {
    stubViewport(false);
    const user = userEvent.setup();
    renderShell();

    await user.tab();

    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skipLink).toHaveFocus();
    expect(skipLink).toHaveAttribute('href', '#main-content');

    await user.keyboard('{Enter}');

    const main = screen.getByRole('main');
    expect(main).toHaveFocus();
    expect(main).toHaveAttribute('id', 'main-content');
    // tabindex="-1" makes it focusable without adding a tab stop of its own.
    expect(main).toHaveAttribute('tabindex', '-1');
  });
});

describe('AppShell mobile drawer', () => {
  it('announces its state through the toggle', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    renderShell();

    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(toggle).toHaveAttribute('aria-controls', 'app-sidebar');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the closed off-canvas drawer out of the tab sequence on narrow viewports', () => {
    stubViewport(true);
    renderShell();

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    expect(sidebar).toHaveAttribute('id', 'app-sidebar');
    expect(sidebar).toHaveAttribute('inert');
  });

  it('leaves the drawer reachable on wide viewports', () => {
    stubViewport(false);
    renderShell();

    expect(screen.getByRole('complementary', { name: 'Main navigation' }))
      .not.toHaveAttribute('inert');
  });

  it('moves focus into the drawer when it opens', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));

    expect(screen.getByRole('button', { name: 'Close navigation menu' })).toHaveFocus();
    expect(screen.getByRole('complementary', { name: 'Main navigation' }))
      .not.toHaveAttribute('inert');
  });

  it('closes on Escape and restores focus to the toggle', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    renderShell();

    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('restores focus to the toggle when the close button is used', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    renderShell();

    const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Close navigation menu' }));

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('traps Tab inside the open drawer', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    const firstStop = within(sidebar).getByRole('link', { name: 'NECPrep Dashboard' });
    const lastStop = within(sidebar).getByRole('button', { name: 'Leave' });

    lastStop.focus();
    await user.tab();
    expect(firstStop).toHaveFocus();

    await user.tab({ shift: true });
    expect(lastStop).toHaveFocus();
  });
});

describe('AppShell dead controls', () => {
  it('ships no search box and no notifications bell', () => {
    stubViewport(false);
    renderShell();

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /notification/i })).not.toBeInTheDocument();
  });
});

describe('AppShell icon-only controls', () => {
  it('gives every control in the shell an accessible name', () => {
    stubViewport(false);
    renderShell();

    const controls = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('link'),
    ];
    const unnamed = controls.filter(
      (el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() === ''
    );
    expect(unnamed).toHaveLength(0);
  });
});
