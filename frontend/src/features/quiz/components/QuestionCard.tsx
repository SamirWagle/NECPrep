/**
 * QuestionCard — one question: number, stem, options, verdict.
 *
 * The ~90 lines of near-identical card markup copied across TopicPractice,
 * QuickPractice and CustomPractice collapse to this. Presentational only: it
 * takes a verdict and a reveal flag and renders them.
 */

import type { ReactNode } from 'react';
import { verdictMessage, verdictTone } from '../format';
import type { Verdict } from '../types';
import { OptionList } from './OptionList';
import styles from './QuestionCard.module.css';

export interface QuestionCardProps {
  /** Zero-based position in the paper. */
  index: number;
  total: number;
  questionText: string;
  options: readonly string[];
  selection: number | null;
  onSelect: (optionIndex: number) => void;
  /** -1 when the bank has no key for this question. */
  correctIndex: number;
  revealed: boolean;
  verdict: Verdict;
  /** Locks the options — a committed answer in immediate-feedback mode. */
  locked?: boolean;
  /** Slot under the verdict, for ExplanationPanel or anything else. */
  children?: ReactNode;
}

export function QuestionCard({
  index,
  total,
  questionText,
  options,
  selection,
  onSelect,
  correctIndex,
  revealed,
  verdict,
  locked = false,
  children,
}: QuestionCardProps) {
  const showVerdict = revealed && verdict !== 'unanswered';

  return (
    <article className={styles.card} aria-label={`Question ${index + 1} of ${total}`}>
      <header className={styles.header}>
        <p className={styles.number}>
          Question {index + 1}
          <span className={styles.of}> of {total}</span>
        </p>
      </header>

      <h2 className={styles.stem}>{questionText}</h2>

      <OptionList
        label={`Answer options for question ${index + 1}`}
        options={options}
        value={selection}
        onChange={onSelect}
        correctIndex={correctIndex}
        revealed={revealed}
        locked={locked}
      />

      {showVerdict && (
        <p
          className={`${styles.verdict} ${styles[verdictTone(verdict)]}`}
          role="status"
          aria-live="polite"
        >
          {verdictMessage(verdict, correctIndex)}
        </p>
      )}

      {children}
    </article>
  );
}
