/**
 * Bottom navigation, phones only.
 *
 * WHY
 * ---
 * Licence-exam preparation is something people do on a phone, in gaps — on a
 * bus, between lectures. Until now the only navigation below 1024px was a
 * hamburger that opens an off-canvas drawer, so every move between Practice,
 * Mock Tests and Progress cost two taps and hid the page behind an overlay.
 * A bottom bar makes the four journeys that matter one thumb-reach away.
 *
 * It complements the drawer rather than replacing it: the drawer still holds
 * the full list, and "More" opens it.
 *
 * WHY THESE FOUR
 * --------------
 * The sidebar carries eight destinations. A bottom bar with eight items has
 * 40px targets and is unusable, so this is the shortest list that covers what
 * a candidate actually came to do, plus a door to the rest.
 *
 * Mock Tests earns a slot because it is the product: a full 100-question,
 * 120-minute rehearsal of the real paper. It was reachable only from the
 * dashboard and the practice hub, and was missing from the sidebar entirely.
 *
 * Books, Study, Flashcards and Bookmarks live behind More. They are browsing,
 * not the main loop.
 *
 * TOUCH AND SAFE AREAS
 * --------------------
 * Targets are at least 44px tall before padding, and the bar adds
 * `env(safe-area-inset-bottom)` so the last row of labels is not under an
 * iPhone's home indicator. `AppShell` reserves matching space at the bottom of
 * `<main>`, so a bar that floats over content cannot hide the last question of
 * a paper.
 *
 * DURING A TIMED PAPER
 * --------------------
 * The bar stays. A stray tap out of a mock test is survivable by design: the
 * attempt autosaves, the deadline is an absolute wall-clock instant rather
 * than a countdown that pauses, and returning restores both. Hiding navigation
 * to protect an exam would trap someone who genuinely needs to leave.
 */

import { NavLink } from 'react-router-dom';
import styles from './BottomNav.module.css';

interface BottomNavProps {
  /** Opens the drawer that holds everything not on the bar. */
  onOpenMore: () => void;
  /** Mirrors the drawer's state so "More" reads correctly to a screen reader. */
  moreOpen: boolean;
}

/**
 * Inline SVGs, matching `AppShell`'s own icon set. A sprite or an icon package
 * would be a second asset to load for five glyphs on the critical path.
 */
const Icons = {
  Dashboard: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  Practice: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  Mock: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2" />
      <path d="M5 3 7 5" />
      <path d="M19 3l-2 2" />
    </svg>
  ),
  Progress: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  ),
  More: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
};

const items = [
  { path: '/app', label: 'Home', icon: Icons.Dashboard, end: true },
  { path: '/app/practice', label: 'Practice', icon: Icons.Practice, end: false },
  { path: '/app/mock-tests', label: 'Mocks', icon: Icons.Mock, end: false },
  { path: '/app/progress', label: 'Progress', icon: Icons.Progress, end: false },
];

export default function BottomNav({ onOpenMore, moreOpen }: BottomNavProps) {
  return (
    // `aria-label` rather than a heading: there are two navigation landmarks in
    // the shell and a screen reader's landmark list has to tell them apart.
    <nav className={styles.bar} aria-label="Main sections">
      <ul className={styles.list}>
        {items.map(({ path, label, icon: Icon, end }) => (
          <li key={path} className={styles.item}>
            <NavLink
              to={path}
              end={end}
              className={({ isActive }) =>
                `${styles.link} ${isActive ? styles.active : ''}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={styles.icon}>
                    <Icon />
                  </span>
                  <span className={styles.label}>{label}</span>
                  {/* `aria-current` is what actually announces the current
                      page; the colour change alone says nothing. */}
                  {isActive && <span className="sr-only" aria-current="page" />}
                </>
              )}
            </NavLink>
          </li>
        ))}
        <li className={styles.item}>
          <button
            type="button"
            className={styles.link}
            onClick={onOpenMore}
            aria-expanded={moreOpen}
            aria-controls="app-sidebar"
          >
            <span className={styles.icon}>
              <Icons.More />
            </span>
            <span className={styles.label}>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
