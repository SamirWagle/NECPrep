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
  /**
   * The committed answer is being marked elsewhere — a server-scored practice
   * session waiting on `POST /api/practice/answer`.
   *
   * It KEEPS the submit button in the primary slot while it is true, disabled
   * and relabelled, rather than letting the slot fall through to Next. The
   * alternative was tried and is worse: the button the student just pressed
   * vanishes and is replaced by a different one, which reads as "that worked,
   * move on" at the exact moment nothing is known yet. Holding the slot with
   * `aria-busy` says "still working" to a screen reader too.
   */
  submitBusy?: boolean;
  /** What the submit button says while `submitBusy`. */
  submitBusyLabel?: string;
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
  submitBusy = false,
  submitBusyLabel = 'Checking…',
}: QuizActionBarProps) {
  // Submit takes the primary slot while the current answer is uncommitted, or
  // while a committed one is still being marked; otherwise it is advance, and
  // on the last question, finish.
  const showSubmit = onSubmit !== undefined && (canSubmit || submitBusy);

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
        <button
          type="button"
          className={styles.primary}
          onClick={onSubmit}
          disabled={submitBusy}
          aria-busy={submitBusy || undefined}
        >
          {submitBusy ? submitBusyLabel : 'Submit'}
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
