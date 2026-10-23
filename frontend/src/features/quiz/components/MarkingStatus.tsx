/**
 * MarkingStatus — what the student sees between committing a practice answer
 * and the server saying whether it was right.
 *
 * This component exists because of one specific way the server-scored practice
 * path could have been worse than the local one. Locally the verdict is
 * instant: the key is already in the tab. Remotely it is a round trip, and a
 * round trip that shows nothing is indistinguishable from a click that did not
 * register — so the student clicks again, or decides the app is broken.
 *
 * So the in-flight state is stated, in a live region, and the failure state is
 * stated too, with the retry next to it. The one thing it never does is show a
 * verdict: there is no optimistic "probably correct" here, because the whole
 * reason the request exists is that this client cannot know.
 *
 * Presentational, and rendered only on the remote path — the local path has
 * nothing to wait for.
 */

import styles from './MarkingStatus.module.css';

export interface MarkingStatusProps {
  /**
   * `checking` — the answer is committed and the server has not replied.
   * `failed`   — it could not be marked; `message` says why.
   */
  state: 'checking' | 'failed';
  /** The server's own message, or the offline note. Shown verbatim. */
  message?: string | null;
  /** Ask again. Same idempotency key, so a request that landed cannot double. */
  onRetry?: () => void;
}

export function MarkingStatus({ state, message, onRetry }: MarkingStatusProps) {
  const checking = state === 'checking';

  return (
    <p
      className={`${styles.row} ${checking ? '' : styles.failed}`}
      // `status`/polite while waiting, `alert`/assertive on failure: the first
      // is an update the student can ignore, the second needs an answer.
      role={checking ? 'status' : 'alert'}
      aria-live={checking ? 'polite' : 'assertive'}
    >
      {checking && <span className={styles.spinner} aria-hidden="true" />}
      <span className={styles.text}>
        {checking ? 'Checking your answer…' : (message ?? 'That answer could not be marked.')}
      </span>
      {!checking && onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Try again
        </button>
      )}
    </p>
  );
}
