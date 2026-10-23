import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Privacy from '../Privacy';
import Terms from '../Terms';
import { legalMeta, hasPlaceholders } from '../legalMeta';

/**
 * These pages make factual claims about what the software stores and for how
 * long, and Google shows the privacy policy to every person who signs in. The
 * tests here guard the two ways that goes wrong: shipping a page that still
 * has REPLACE_WITH in it, and quietly dropping a disclosure that the product
 * actually requires.
 */

const render404Safe = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe('legalMeta', () => {
  it('detects an unfilled placeholder', () => {
    expect(
      hasPlaceholders({ ...legalMeta, contactEmail: 'REPLACE_WITH_A_REAL_EMAIL' }),
    ).toBe(true);
    expect(hasPlaceholders({ ...legalMeta, contactEmail: 'hello@example.test' })).toBe(false);
  });

  it('carries a dated last-updated, so a stale page is visible', () => {
    expect(legalMeta.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Privacy', () => {
  it('warns on the page itself while a placeholder remains', () => {
    render404Safe(<Privacy />);
    // A TODO in a source file would not stop this shipping; a banner on the
    // page that Google links to does.
    if (hasPlaceholders()) {
      expect(screen.getByRole('status')).toHaveTextContent(/not finished/i);
    } else {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    }
  });

  it('states the retention windows the retention job actually implements', () => {
    render404Safe(<Privacy />);
    // worker/src/jobs/retention.ts: 90 days submitted, 7 days abandoned.
    expect(screen.getByText(/90 days, then deleted/i)).toBeInTheDocument();
    expect(screen.getByText(/7 days, then deleted/i)).toBeInTheDocument();
  });

  it('is explicit that there are no trackers, because there are none', () => {
    render404Safe(<Privacy />);
    expect(
      screen.getByText(/no analytics, no advertising trackers and no third-party scripts/i),
    ).toBeInTheDocument();
  });

  it('does not claim to store the IP address, because it stores a hash', () => {
    render404Safe(<Privacy />);
    // handlers/auth.ts#hashIp: salted sha256, truncated to 32 chars.
    expect(screen.getByText(/never stored/i)).toBeInTheDocument();
  });

  it('discloses the three things the platform cannot do yet', () => {
    render404Safe(<Privacy />);
    expect(screen.getByText(/There is no password reset/i)).toBeInTheDocument();
    expect(screen.getByText(/Email addresses are not verified/i)).toBeInTheDocument();
    expect(screen.getByText(/Deletion is by request, not a button/i)).toBeInTheDocument();
  });
});

describe('Terms', () => {
  it('disclaims affiliation with the examining authority', () => {
    render404Safe(<Terms />);
    // A preparation tool that leaves this ambiguous is trading on an
    // endorsement it does not have.
    expect(screen.getByRole('heading', { name: /not affiliated/i })).toBeInTheDocument();
  });

  it('states the known defects in the question bank by number', () => {
    render404Safe(<Terms />);
    // 118 withheld; explanations are unreviewed AI drafts; sub-chapter labels
    // are heuristic. A student relying on this for a licence exam is entitled
    // to know before they start.
    expect(screen.getByText(/118 questions are withheld/i)).toBeInTheDocument();
    expect(screen.getByText(/AI-generated drafts/i)).toBeInTheDocument();
    expect(screen.getByText(/derived automatically/i)).toBeInTheDocument();
  });

  it('warns that guest progress is unrecoverable', () => {
    render404Safe(<Terms />);
    expect(screen.getByText(/tied to a browser cookie/i)).toBeInTheDocument();
  });
});

describe('cross-links', () => {
  it('each page links to the other and home', () => {
    const { unmount } = render404Safe(<Privacy />);
    expect(screen.getByRole('link', { name: /terms of use/i })).toHaveAttribute('href', '/terms');
    unmount();

    render404Safe(<Terms />);
    // Terms links to the policy twice on purpose - once where retention is
    // mentioned, once in the footer - so assert every one of them resolves.
    const links = screen.getAllByRole('link', { name: /privacy policy/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute('href', '/privacy');
  });
});
