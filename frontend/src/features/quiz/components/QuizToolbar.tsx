/**
 * QuizToolbar — progress counter, timer, flag and bookmark.
 *
 * The timer is handed `timeLeftMs` and renders it; it never counts down on its
 * own. Whatever owns the attempt derives that number from an absolute deadline,
 * which is what makes a reload or a backgrounded tab harmless.
 */

import { VisuallyHidden } from '../../../components/ui/VisuallyHidden';
import { describeClock, formatClock } from '../format';
import styles from './QuizToolbar.module.css';

export interface QuizToolbarProps {
  index: number;
  total: number;
  answered: number;
  /** Null for untimed attempts — the timer is then not rendered at all. */
  timeLeftMs?: number | null;
  /** Below this, the timer takes on its urgent styling. Default 60s. */
  lowTimeMs?: number;
  flagged: boolean;
  onToggleFlag: () => void;
  bookmarked: boolean;
  onToggleBookmark: () => void;
}

export function QuizToolbar({
  index,
  total,
  answered,
  timeLeftMs = null,
  lowTimeMs = 60_000,
  flagged,
  onToggleFlag,
  bookmarked,
  onToggleBookmark,
}: QuizToolbarProps) {
  const low = timeLeftMs !== null && timeLeftMs <= lowTimeMs;

  return (
    <div className={styles.bar}>
      <div className={styles.counter}>
        {/* "3/30" reads as "three slash thirty", so the glyphs are hidden from
            assistive tech and a sentence is provided instead. */}
        <span className={styles.position} aria-hidden="true">{`${index + 1}/${total}`}</span>
        <span className={styles.answered} aria-hidden="true">
          {answered} answered
        </span>
        <VisuallyHidden>{`Question ${index + 1} of ${total}, ${answered} answered`}</VisuallyHidden>
      </div>

      {timeLeftMs !== null && (
        <div
          className={`${styles.timer} ${low ? styles.low : ''}`}
          role="timer"
          // Only nag the screen reader when it matters. An assertive region
          // that updates every second is unusable.
          aria-live={low ? 'assertive' : 'off'}
          aria-label={`Time remaining: ${describeClock(timeLeftMs)}`}
        >
          {formatClock(timeLeftMs)}
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.action} ${flagged ? styles.on : ''}`}
          onClick={onToggleFlag}
          aria-pressed={flagged}
        >
          <span aria-hidden="true">⚑</span>
          <span className={styles.actionLabel}>Flag</span>
          <kbd className={styles.kbd}>F</kbd>
        </button>
        <button
          type="button"
          className={`${styles.action} ${bookmarked ? styles.on : ''}`}
          onClick={onToggleBookmark}
          aria-pressed={bookmarked}
        >
          <span aria-hidden="true">☆</span>
          <span className={styles.actionLabel}>Bookmark</span>
          <kbd className={styles.kbd}>B</kbd>
        </button>
      </div>
    </div>
  );
}
