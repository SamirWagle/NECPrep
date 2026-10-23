import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Landing from '../Landing';

/**
 * The landing page is the only route a visitor arrives on, so it is the only
 * place a way in can be missing from — and it was. Nothing here linked to
 * /signin, and the single call to action opened a modal that collected a
 * display name into localStorage and navigated to /app, where the session
 * guard then asked for a sign-in anyway. Two identity prompts in a row, the
 * first of which decided nothing.
 *
 * The modal is gone and /signin does the job properly: guest, Google, or email
 * and password. These tests cover the ways in, because a login page nobody can
 * find is the same as no login page.
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
        <Route path="/signin" element={<h1>Sign-in page</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Landing sign-in entry points', () => {
  it('offers Sign in from the navigation', () => {
    renderLanding();
    // This link did not exist. /signin was reachable only by typing the URL.
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/signin',
    );
  });

  it('sends the primary call to action to /signin, not straight into the app', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByRole('button', { name: /Get Started Free/i }));
    // /signin is where the three real ways in live. It also redirects to /app
    // on a build with no backend configured, so this works in both modes.
    expect(await screen.findByText('Sign-in page')).toBeInTheDocument();
  });

  it('sends the closing call to action to the same place', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByRole('button', { name: /Start Preparing Now/i }));
    expect(await screen.findByText('Sign-in page')).toBeInTheDocument();
  });

  it('no longer asks for a name before letting anyone in', () => {
    renderLanding();
    // The modal promised "no account needed" and then demanded an identity
    // that decided nothing.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/your name/i)).not.toBeInTheDocument();
  });

  it('still promises a guest route, because /signin provides one', () => {
    renderLanding();
    expect(screen.getByText(/continue as a guest/i)).toBeInTheDocument();
  });

  it('links to the privacy policy and terms', () => {
    renderLanding();
    // Google's consent screen links to /privacy; it has to be findable from
    // the site too.
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('link', { name: /terms of use/i })).toHaveAttribute(
      'href',
      '/terms',
    );
  });

  it('states it is not affiliated with the examining authority', () => {
    renderLanding();
    expect(screen.getByText(/not affiliated with/i)).toBeInTheDocument();
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
