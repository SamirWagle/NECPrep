/**
 * ReviewScreen — the pre-submit summary and confirmation.
 *
 * The mock test submits straight off the last page: one click on "Submit Test"
 * ends a 45-minute exam with no warning and no count of what was left blank.
 * This puts the counts in front of the student and makes submission a
 * two-step: the first press asks, the second commits.
 */

import { useState } from 'react';
import type { PaletteEntry } from '../types';
import { QuestionPalette } from './QuestionPalette';
import styles from './ReviewScreen.module.css';

export interface ReviewScreenProps {
  total: number;
  answered: number;
  unanswered: number;
  flagged: number;
  /** Zero-based indices, rendered as 1-based question numbers. */
  unansweredIndices: readonly number[];
  flaggedIndices: readonly number[];
  entries?: readonly PaletteEntry[];
  /** Jump back to a question. Also used by the palette. */
  onJump: (index: number) => void;
  onBack: () => void;
  onSubmit: () => void;
  /** Hides the "go back" affordance when time has run out. */
  canGoBack?: boolean;
}

function numberList(indices: readonly number[]): string {
  return indices.map((i) => i + 1).join(', ');
}

export function ReviewScreen({
  total,
  answered,
  unanswered,
  flagged,
  unansweredIndices,
  flaggedIndices,
  entries,
  onJump,
  onBack,
  onSubmit,
  canGoBack = true,
}: ReviewScreenProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className={styles.wrap} aria-labelledby="quiz-review-heading">
      <h2 id="quiz-review-heading" className={styles.heading}>
        Before you submit
      </h2>

      <dl className={styles.counts}>
        <div className={styles.count}>
          <dt>Answered</dt>
          <dd>
            {answered} <span className={styles.of}>/ {total}</span>
          </dd>
        </div>
        <div className={`${styles.count} ${unanswered > 0 ? styles.warn : ''}`}>
          <dt>Unanswered</dt>
          <dd>{unanswered}</dd>
        </div>
        <div className={`${styles.count} ${flagged > 0 ? styles.warn : ''}`}>
          <dt>Flagged for review</dt>
          <dd>{flagged}</dd>
        </div>
      </dl>

      {unanswered > 0 && (
        <p className={styles.detail}>
          Unanswered: <strong>{numberList(unansweredIndices)}</strong>
        </p>
      )}
      {flagged > 0 && (
        <p className={styles.detail}>
          Flagged: <strong>{numberList(flaggedIndices)}</strong>
        </p>
      )}

      {entries && entries.length > 0 && (
        <QuestionPalette entries={entries} onJump={onJump} label="Jump to a question" />
      )}

      <div className={styles.actions}>
        {canGoBack && (
          <button type="button" className={styles.secondary} onClick={onBack}>
            Keep working
          </button>
        )}
        {confirming ? (
          <button type="button" className={styles.danger} onClick={onSubmit}>
            Yes, submit {unanswered > 0 ? `with ${unanswered} blank` : 'now'}
          </button>
        ) : (
          <button type="button" className={styles.primary} onClick={() => setConfirming(true)}>
            Submit paper
          </button>
        )}
      </div>

      {confirming && (
        <p className={styles.warning} role="alert">
          Submitting is final — you cannot change your answers afterwards.
        </p>
      )}
    </section>
  );
}
