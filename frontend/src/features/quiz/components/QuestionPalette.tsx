/**
 * QuestionPalette — the numbered grid for jumping around a paper.
 *
 * `App.css` has carried unused `.navigator-grid` / `.nav-dot` rules for a while:
 * someone designed this and it was never built, so a 100-question mock could
 * only be walked page by page. This is that component, with the flagged state
 * the original stylesheet lacked.
 */

import type { PaletteEntry } from '../types';
import styles from './QuestionPalette.module.css';

export interface QuestionPaletteProps {
  entries: readonly PaletteEntry[];
  onJump: (index: number) => void;
  /** Optional heading; omit inside a panel that already has one. */
  label?: string;
}

function describe(entry: PaletteEntry): string {
  const parts = [entry.answered ? 'answered' : 'unanswered'];
  if (entry.flagged) parts.push('flagged for review');
  if (entry.current) parts.push('current');
  return `Question ${entry.index + 1}, ${parts.join(', ')}`;
}

export function QuestionPalette({ entries, onJump, label }: QuestionPaletteProps) {
  return (
    <nav className={styles.wrap} aria-label={label ?? 'Question navigator'}>
      {label && <h3 className={styles.heading}>{label}</h3>}
      <ol className={styles.grid}>
        {entries.map((entry) => (
          <li key={entry.questionId}>
            <button
              type="button"
              className={[
                styles.dot,
                entry.answered ? styles.answered : styles.unanswered,
                entry.flagged ? styles.flagged : '',
                entry.current ? styles.current : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onJump(entry.index)}
              aria-current={entry.current ? 'true' : undefined}
              aria-label={describe(entry)}
            >
              {entry.index + 1}
              {entry.flagged && (
                <span className={styles.pin} aria-hidden="true">
                  ⚑
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>
      <ul className={styles.legend}>
        <li>
          <span className={`${styles.swatch} ${styles.answered}`} aria-hidden="true" /> Answered
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.unanswered}`} aria-hidden="true" /> Unanswered
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.flagged}`} aria-hidden="true" /> Flagged
        </li>
      </ul>
    </nav>
  );
}
