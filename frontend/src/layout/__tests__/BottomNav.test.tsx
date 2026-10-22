import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import BottomNav from '../BottomNav';

/**
 * The bottom bar is the only navigation a phone user gets without opening a
 * drawer, so the things asserted here are the ones that make it usable rather
 * than merely present: that the current section is announced and not only
 * coloured, that "More" is a button wired to the drawer rather than a dead
 * link, and that Mock Tests is actually on it.
 *
 * Visibility is a media query and is therefore NOT tested here — jsdom has no
 * layout. `BottomNav.module.css` and `AppShell.module.css` share the 640px
 * boundary deliberately; a test that stubbed `matchMedia` would assert the
 * stub, not the CSS.
 */

function renderNav(path = '/app', onOpenMore = vi.fn(), moreOpen = false) {
  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav onOpenMore={onOpenMore} moreOpen={moreOpen} />
      <Routes>
        <Route path="/app" element={<h1>Home page</h1>} />
        <Route path="/app/practice" element={<h1>Practice page</h1>} />
        <Route path="/app/mock-tests" element={<h1>Mock tests page</h1>} />
        <Route path="/app/progress" element={<h1>Progress page</h1>} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...result, onOpenMore };
}

describe('BottomNav', () => {
  it('is a labelled landmark, because the shell has two navs', () => {
    renderNav();
    expect(screen.getByRole('navigation', { name: /main sections/i })).toBeInTheDocument();
  });

  it('puts the mock test on the bar', () => {
    renderNav();
    // The product is the full 120-minute paper. It was missing from the
    // sidebar entirely and reachable only from two pages.
    expect(screen.getByRole('link', { name: /mocks/i })).toHaveAttribute(
      'href',
      '/app/mock-tests',
    );
  });

  it('keeps the bar to five targets', () => {
    renderNav();
    const links = screen.getAllByRole('link');
    const buttons = screen.getAllByRole('button');
    // Eight destinations at phone width would mean ~40px targets. Four plus a
    // door to the rest is the trade.
    expect(links.length + buttons.length).toBe(5);
  });

  it('announces the current section rather than only colouring it', () => {
    renderNav('/app/practice');
    // Colour alone fails WCAG 1.4.1 and says nothing to a screen reader.
    const current = screen.getAllByRole('link').find((el) => el.querySelector('[aria-current="page"]'));
    expect(current).toBeDefined();
    expect(current).toHaveAttribute('href', '/app/practice');
  });

  it('does not mark Home current on a deeper route', () => {
    // `end` on the index link; without it '/app' matches every child path and
    // two items look current at once.
    renderNav('/app/progress');
    const home = screen.getByRole('link', { name: /home/i });
    expect(home.querySelector('[aria-current="page"]')).toBeNull();
  });

  it('navigates on tap', async () => {
    const user = userEvent.setup();
    renderNav('/app');
    await user.click(screen.getByRole('link', { name: /mocks/i }));
    await waitFor(() => expect(screen.getByText('Mock tests page')).toBeInTheDocument());
  });

  it('opens the drawer from More, and says so', async () => {
    const user = userEvent.setup();
    const { onOpenMore } = renderNav('/app');

    const more = screen.getByRole('button', { name: /more/i });
    // A button, not a link: it opens a drawer rather than navigating, and it
    // has to report its state and what it controls.
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveAttribute('aria-controls', 'app-sidebar');

    await user.click(more);
    expect(onOpenMore).toHaveBeenCalledTimes(1);
  });

  it('reflects the drawer being open', () => {
    renderNav('/app', vi.fn(), true);
    expect(screen.getByRole('button', { name: /more/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
