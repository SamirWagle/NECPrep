/**
 * ResultSummary — the score screen.
 *
 * Reports against `gradableTotal`, not the paper length. Part of the bank has
 * `correctIndex === -1` (no answer key), and counting those as wrong would
 * quietly understate every score that includes one.
 */

import type { ReactNode } from 'react';
import { describeClock } from '../format';
import type { QuizSummary } from '../types';
import styles from './ResultSummary.module.css';

export interface ResultSummaryProps {
  summary: QuizSummary;
  /** Shown above the score, e.g. the chapter or test name. */
  title?: string;
  /** Pass threshold as a percentage. Default 60. */
  passPct?: number;
  /** Action buttons/links — the host owns routing. */
  actions?: ReactNode;
}

export function ResultSummary({ summary, title, passPct = 60, actions }: ResultSummaryProps) {
  const { score, gradableTotal, total, answered, skipped, incorrect, accuracyPct, elapsedMs } =
    summary;
  const passed = accuracyPct >= passPct;
  const ungraded = total - gradableTotal;

  return (
    <section className={styles.wrap} aria-labelledby="quiz-result-heading">
      <h2 id="quiz-result-heading" className={styles.heading}>
        Attempt complete
      </h2>
      {title && <p className={styles.title}>{title}</p>}

      <p className={`${styles.score} ${passed ? styles.pass : styles.fail}`}>
        <span className={styles.scoreValue}>{score}</span>
        <span className={styles.scoreTotal}>/ {gradableTotal}</span>
      </p>
      <p className={styles.accuracy}>{accuracyPct}% accuracy</p>

      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dt>Correct</dt>
          <dd>{score}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Incorrect</dt>
          <dd>{incorrect}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Skipped</dt>
          <dd>{skipped}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Time on task</dt>
          <dd className={styles.small}>{describeClock(elapsedMs)}</dd>
        </div>
      </dl>

      {ungraded > 0 && (
        <p className={styles.note}>
          {ungraded} question{ungraded === 1 ? '' : 's'} in this set {ungraded === 1 ? 'has' : 'have'}{' '}
          no answer key yet, so {ungraded === 1 ? 'it is' : 'they are'} excluded from the score.
        </p>
      )}
      {answered < total && (
        <p className={styles.note}>
          You answered {answered} of {total} questions.
        </p>
      )}

      {actions && <div className={styles.actions}>{actions}</div>}
    </section>
  );
}
