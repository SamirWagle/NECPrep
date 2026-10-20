import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Bookmarks from '../app/Bookmarks';
import { loadBookmarkedQuestions, removeBookmark, getTopicById } from '../../services/localData';
import type { Question } from '../../services/localData';
import type { Topic } from '../../data/topics';

/**
 * The filter strip declared role="tablist" while providing no role="tab", no
 * aria-selected, no aria-controls, no tabpanel and no arrow-key navigation, so
 * screen readers announced a tab widget that did not exist. It is now a group
 * of aria-pressed toggle buttons — see the comment in Bookmarks.tsx for why
 * that, and not the full ARIA tabs pattern, is the honest shape here.
 */

vi.mock('../../services/localData', () => ({
  loadBookmarkedQuestions: vi.fn(),
  removeBookmark: vi.fn(),
  getTopicById: vi.fn(),
}));

function topic(id: string, shortName: string, name: string): Topic {
  return {
    id,
    name,
    shortName,
    description: '',
    questionCount: 10,
    icon: 'book',
    color: '#6366f1',
    dataFile: `${id}.json`,
  };
}

const TOPICS: Record<string, Topic> = {
  'book-ch1': topic('book-ch1', 'Ch1', 'Chapter 1: Basic Electrical'),
  'book-ch2': topic('book-ch2', 'Ch2', 'Chapter 2: Digital Logic'),
};

function question(id: string, topicId: string, text: string): Question {
  return { id, topicId, question: text, options: ['a', 'b', 'c', 'd'], correctIndex: 0 };
}

const SAVED: Question[] = [
  question('book-ch1_0', 'book-ch1', 'What is Ohm’s law?'),
  question('book-ch1_1', 'book-ch1', 'Define reactance.'),
  question('book-ch2_0', 'book-ch2', 'Convert 1010 to decimal.'),
];

beforeEach(() => {
  vi.mocked(getTopicById).mockImplementation((id: string) => TOPICS[id]);
  vi.mocked(removeBookmark).mockReset();
  vi.mocked(loadBookmarkedQuestions).mockResolvedValue(SAVED);
});

async function renderBookmarks() {
  render(
    <MemoryRouter initialEntries={['/app/bookmarks']}>
      <Bookmarks />
    </MemoryRouter>
  );
  // Wait out the async bookmark load.
  await screen.findByRole('group', { name: 'Filter saved questions by chapter' });
}

const filterGroup = () => screen.getByRole('group', { name: 'Filter saved questions by chapter' });
const removeButtons = () => screen.getAllByRole('button', { name: /^Remove bookmark:/ });

describe('Bookmarks filters', () => {
  it('does not claim to be a tab widget', async () => {
    await renderBookmarks();

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryAllByRole('tabpanel')).toHaveLength(0);
  });

  it('reports the selected filter through aria-pressed', async () => {
    await renderBookmarks();

    const buttons = within(filterGroup()).getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'All (3)',
      'Ch1 (2)',
      'Ch2 (1)',
    ]);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    for (const button of buttons) {
      expect(button).toHaveAttribute('aria-controls', 'bookmarks-results');
    }
  });

  it('is operable with Tab and Enter', async () => {
    const user = userEvent.setup();
    await renderBookmarks();

    const all = within(filterGroup()).getByRole('button', { name: 'All (3)' });
    const ch1 = within(filterGroup()).getByRole('button', { name: 'Ch1 (2)' });

    all.focus();
    await user.tab();
    expect(ch1).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(ch1).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(removeButtons()).toHaveLength(2);
  });

  it('is operable with Space', async () => {
    const user = userEvent.setup();
    await renderBookmarks();

    const ch2 = within(filterGroup()).getByRole('button', { name: 'Ch2 (1)' });
    ch2.focus();
    await user.keyboard(' ');

    expect(ch2).toHaveAttribute('aria-pressed', 'true');
    expect(removeButtons()).toHaveLength(1);
  });

  it('every filter is its own tab stop', async () => {
    const user = userEvent.setup();
    await renderBookmarks();

    const buttons = within(filterGroup()).getAllByRole('button');
    buttons[0].focus();
    for (let i = 1; i < buttons.length; i += 1) {
      await user.tab();
      expect(buttons[i]).toHaveFocus();
    }
  });

  it('announces how many of the saved questions are showing', async () => {
    const user = userEvent.setup();
    await renderBookmarks();

    expect(screen.getByRole('status')).toHaveTextContent('Showing 3 of 3 saved questions');

    await user.click(within(filterGroup()).getByRole('button', { name: 'Ch2 (1)' }));
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 3 saved questions');
  });

  it('falls back to All when the filtered chapter runs out of bookmarks', async () => {
    const user = userEvent.setup();
    await renderBookmarks();

    await user.click(within(filterGroup()).getByRole('button', { name: 'Ch2 (1)' }));
    await user.click(screen.getByRole('button', { name: 'Remove bookmark: Convert 1010 to decimal.' }));

    expect(removeBookmark).toHaveBeenCalledWith('book-ch2_0');
    const all = within(filterGroup()).getByRole('button', { name: 'All (2)' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(removeButtons()).toHaveLength(2);
  });
});

describe('Bookmarks icon-only actions', () => {
  it('gives each one a unique accessible name', async () => {
    await renderBookmarks();

    const names = removeButtons().map((b) => b.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Remove bookmark: Define reactance.');

    expect(
      screen.getAllByRole('link', { name: 'Practice Chapter 1: Basic Electrical' })
    ).toHaveLength(2);
  });
});

describe('Bookmarks heading hierarchy', () => {
  it('never skips a heading level when there are results', async () => {
    await renderBookmarks();

    const tags = screen.getAllByRole('heading').map((h) => h.tagName);
    expect(tags).toEqual(['H1']);
  });

  it('uses an h2, not an h3, for the empty state', async () => {
    vi.mocked(loadBookmarkedQuestions).mockResolvedValue([]);
    await renderBookmarks();

    const tags = screen.getAllByRole('heading').map((h) => h.tagName);
    expect(tags).toEqual(['H1', 'H2']);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('No bookmarks yet');
  });
});
