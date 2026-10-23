/**
 * QuizActionBar — previous / submit / next, pinned to the bottom on phones.
 *
 * Under 768px this fixes to the bottom of the viewport. A quiz is read
 * top-down and answered bottom-up: on a phone the controls were below a stem
 * plus four options, so every question ended with a scroll to reach the
 * button. Pinned, the primary action is always under the thumb.
 */

import styles from './QuizActionBar.module.css';

export interface QuizActionBarProps {
  onPrev: () => void;
  onNext: () => void;
  /** Commit the current question (immediate feedback). Omit in deferred mode. */
  onSubmit?: () => void;
  /** Open the pre-submit review screen, or finish. */
  onFinish?: () => void;
  canPrev: boolean;
  canNext: boolean;
  canSubmit: boolean;
  /** True on the last question, which turns "Next" into the finish action. */
  isLast: boolean;
  /** Label for the terminal action. */
  finishLabel?: string;
}

export function QuizActionBar({
  onPrev,
  onNext,
  onSubmit,
  onFinish,
  canPrev,
  canNext,
  canSubmit,
  isLast,
  finishLabel = 'Finish',
}: QuizActionBarProps) {
  // Submit takes the primary slot while the current answer is uncommitted;
  // otherwise it is advance, and on the last question, finish.
  const showSubmit = onSubmit !== undefined && canSubmit;

  return (
    <>
      {/* Reserves the height the fixed bar takes out of the viewport on
          phones, so the last option is never trapped underneath it. */}
      <div className={styles.spacer} aria-hidden="true" />
      <div className={styles.bar}>
      <button type="button" className={styles.secondary} onClick={onPrev} disabled={!canPrev}>
        <span aria-hidden="true">←</span> Previous
      </button>

      {showSubmit ? (
        <button type="button" className={styles.primary} onClick={onSubmit}>
          Submit
        </button>
      ) : isLast ? (
        <button
          type="button"
          className={styles.primary}
          onClick={onFinish}
          disabled={onFinish === undefined}
        >
          {finishLabel}
        </button>
      ) : (
        <button type="button" className={styles.primary} onClick={onNext} disabled={!canNext}>
          Next <span aria-hidden="true">→</span>
        </button>
      )}
      </div>
    </>
  );
}
