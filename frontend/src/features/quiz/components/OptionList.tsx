/**
 * OptionList — the answer options for one question.
 *
 * Presentational: it is told what is selected, whether the key may be shown,
 * and what the key is. It never decides whether to reveal.
 *
 * Built on the shared `RadioGroup`/`Radio` primitives, which own the real
 * WAI-ARIA radiogroup pattern (roving tabindex, arrow/Home/End navigation,
 * `aria-disabled` rather than `disabled` so a revealed answer stays readable).
 *
 * One interaction note: inside the group, Left/Right move the selection,
 * because that is what the radiogroup pattern requires. The quiz-wide
 * Left/Right question navigation in `useQuizKeyboard` bows out whenever the
 * group has already handled the key — it checks `defaultPrevented` — so the
 * two bindings coexist instead of fighting.
 */

import { Radio, RadioGroup } from '../../../components/ui/RadioGroup';
import type { RadioVisualState } from '../../../components/ui/RadioGroup';
import { optionLetter } from '../format';
import styles from './OptionList.module.css';

export interface OptionListProps {
  options: readonly string[];
  /** Chosen option index, or null. */
  value: number | null;
  onChange: (index: number) => void;
  /** Index of the right answer, or null/-1 when the bank has no key. */
  correctIndex?: number | null;
  /** When false, the key must not be visible, whatever `correctIndex` says. */
  revealed?: boolean;
  /** Locks the answer. Options stay focusable so they can still be read. */
  locked?: boolean;
  /** Accessible name for the group. */
  label: string;
}

function optionState(
  index: number,
  value: number | null,
  correctIndex: number,
  revealed: boolean
): RadioVisualState {
  if (!revealed || correctIndex < 0) return value === index ? 'selected' : 'neutral';
  if (index === correctIndex) return 'correct';
  if (value === index) return 'incorrect';
  return 'neutral';
}

export function OptionList({
  options,
  value,
  onChange,
  correctIndex = null,
  revealed = false,
  locked = false,
  label,
}: OptionListProps) {
  const key = correctIndex ?? -1;

  return (
    <RadioGroup
      aria-label={label}
      className={styles.group}
      value={value === null ? null : String(value)}
      onValueChange={(next) => onChange(Number(next))}
      readOnly={locked}
    >
      {options.map((text, index) => (
        <Radio
          key={index}
          value={String(index)}
          className={styles.option}
          state={optionState(index, value, key, revealed)}
          // Options are lettered A-D, which is both the visual convention and
          // what the 1-4 / a-d shortcuts refer to, so the bullet is redundant.
          showIndicator={false}
        >
          <span className={styles.row}>
            <span className={styles.letter} aria-hidden="true">
              {optionLetter(index)}
            </span>
            <span className={styles.text}>{text}</span>
          </span>
        </Radio>
      ))}
    </RadioGroup>
  );
}
