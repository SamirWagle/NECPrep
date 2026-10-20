/**
 * ExplanationPanel — why the right answer is right.
 *
 * No question in the bank carries an explanation today, so `explanation` is
 * optional and the empty state says so plainly. It does not invent one: a
 * fabricated rationale on an engineering-licence question is worse than no
 * rationale, because the student has no way to tell which they are reading.
 */

import styles from './ExplanationPanel.module.css';

export interface ExplanationPanelProps {
  /** Authored explanation. Undefined or blank renders the empty state. */
  explanation?: string | null;
  /** Hide entirely until the answer is revealed. */
  revealed?: boolean;
  /** Reference the student can follow instead, e.g. a chapter name. */
  sourceLabel?: string;
}

export function ExplanationPanel({
  explanation,
  revealed = true,
  sourceLabel,
}: ExplanationPanelProps) {
  if (!revealed) return null;

  const text = explanation?.trim();

  return (
    <section className={styles.panel} aria-label="Explanation">
      <h3 className={styles.heading}>Explanation</h3>
      {text ? (
        <p className={styles.body}>{text}</p>
      ) : (
        <p className={styles.empty}>
          No explanation has been written for this question yet.
          {sourceLabel ? ` Refer to ${sourceLabel}.` : ''}
        </p>
      )}
    </section>
  );
}
