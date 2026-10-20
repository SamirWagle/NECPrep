import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { useComposedRef } from './compose-refs';
import { cx } from './cx';
import { VisuallyHidden } from './VisuallyHidden';
import styles from './RadioGroup.module.css';

export type RadioVisualState = 'neutral' | 'selected' | 'correct' | 'incorrect';

interface RadioGroupContextValue {
  value: string | null;
  readOnly: boolean;
  groupDisabled: boolean;
  select: (value: string) => void;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

/**
 * Options in document order. The group reads the DOM rather than keeping a
 * registry so arrow-key order always matches visual order, even when options
 * are wrapped, reordered or conditionally rendered.
 */
function getRadios(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>('[role="radio"]'));
}

type NativeGroupProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'role' | 'onChange' | 'aria-label' | 'aria-labelledby' | 'defaultValue'
>;

export interface RadioGroupBaseProps extends NativeGroupProps {
  /** Controlled selection. `null` means "nothing chosen yet". */
  value?: string | null;
  /** Uncontrolled initial selection. */
  defaultValue?: string | null;
  onValueChange?: (value: string) => void;
  /** Emits a hidden input so the group can participate in form submission. */
  name?: string;
  orientation?: 'horizontal' | 'vertical';
  /**
   * Review mode. Options stay focusable and in the accessibility tree
   * (`aria-disabled`, never `disabled`) but selection no longer changes, so a
   * revealed correct answer can still be reached and read.
   */
  readOnly?: boolean;
  /** Whole group unavailable. Still uses `aria-disabled`, not `disabled`. */
  disabled?: boolean;
  required?: boolean;
  children?: ReactNode;
}

/** A radiogroup must be named. One of the two ARIA labelling props is required. */
export type RadioGroupProps = RadioGroupBaseProps &
  (
    | { 'aria-label': string; 'aria-labelledby'?: undefined }
    | { 'aria-labelledby': string; 'aria-label'?: undefined }
  );

type ResolvedRadioGroupProps = RadioGroupBaseProps & {
  'aria-label'?: string;
  'aria-labelledby'?: string;
};

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
  function RadioGroup(props, forwardedRef) {
    const {
      value,
      defaultValue = null,
      onValueChange,
      name,
      orientation = 'vertical',
      readOnly = false,
      disabled = false,
      required = false,
      className,
      children,
      onKeyDown,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      ...rest
    } = props as ResolvedRadioGroupProps;

    const groupRef = useRef<HTMLDivElement | null>(null);
    const setRef = useComposedRef(forwardedRef, groupRef);

    const [uncontrolledValue, setUncontrolledValue] = useState<string | null>(defaultValue);
    const isControlled = value !== undefined;
    const currentValue = value !== undefined ? value : uncontrolledValue;

    const select = useCallback(
      (next: string) => {
        if (!isControlled) setUncontrolledValue(next);
        onValueChange?.(next);
      },
      [isControlled, onValueChange],
    );

    /**
     * Roving tabindex. Exactly one option is tabbable: the selected one, or
     * the first option when nothing is selected yet. Options always *render*
     * `tabIndex={-1}` (a constant, so React never patches the attribute
     * afterwards) and this effect owns the single `0`.
     */
    useLayoutEffect(() => {
      const radios = getRadios(groupRef.current);
      if (radios.length === 0) return;
      let activeIndex = radios.findIndex((radio) => radio.dataset.value === currentValue);
      if (activeIndex < 0) activeIndex = 0;
      radios.forEach((radio, index) => {
        radio.tabIndex = index === activeIndex ? 0 : -1;
      });
    });

    const moveTo = useCallback(
      (radios: HTMLElement[], index: number) => {
        const target = radios[index];
        if (!target) return;
        target.focus();
        // Arrow keys both move and select, per the WAI-ARIA radiogroup
        // pattern — except in review/disabled mode where focus may move but
        // the answer is locked.
        if (readOnly || disabled) return;
        if (target.getAttribute('aria-disabled') === 'true') return;
        const nextValue = target.dataset.value;
        if (nextValue !== undefined) select(nextValue);
      },
      [disabled, readOnly, select],
    );

    const handleKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        const radios = getRadios(groupRef.current);
        if (radios.length === 0) return;

        const active = document.activeElement;
        const currentIndex = radios.findIndex(
          (radio) => radio === active || radio.contains(active),
        );

        let nextIndex: number;
        switch (event.key) {
          case 'ArrowDown':
          case 'ArrowRight':
            nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % radios.length;
            break;
          case 'ArrowUp':
          case 'ArrowLeft':
            nextIndex =
              currentIndex < 0
                ? radios.length - 1
                : (currentIndex - 1 + radios.length) % radios.length;
            break;
          case 'Home':
            nextIndex = 0;
            break;
          case 'End':
            nextIndex = radios.length - 1;
            break;
          default:
            return;
        }

        // Stop the arrow keys from scrolling the page.
        event.preventDefault();
        moveTo(radios, nextIndex);
      },
      [moveTo, onKeyDown],
    );

    const contextValue = useMemo<RadioGroupContextValue>(
      () => ({ value: currentValue, readOnly, groupDisabled: disabled, select }),
      [currentValue, disabled, readOnly, select],
    );

    return (
      <div
        ref={setRef}
        {...rest}
        role="radiogroup"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-orientation={orientation}
        aria-required={required || undefined}
        aria-readonly={readOnly || undefined}
        aria-disabled={disabled || undefined}
        onKeyDown={handleKeyDown}
        className={cx(styles.group, orientation === 'horizontal' && styles.horizontal, className)}
      >
        <RadioGroupContext.Provider value={contextValue}>{children}</RadioGroupContext.Provider>
        {name !== undefined && <input type="hidden" name={name} value={currentValue ?? ''} />}
      </div>
    );
  },
);

type NativeRadioProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'value' | 'type' | 'disabled' | 'role' | 'aria-checked' | 'tabIndex'
>;

export interface RadioProps extends NativeRadioProps {
  /** Stable identity of this option. Also mirrored to `data-value` for navigation. */
  value: string;
  /** This option alone is unavailable. Rendered with `aria-disabled`. */
  disabled?: boolean;
  /**
   * Visual state. Defaults to `selected` when checked and `neutral`
   * otherwise. Pass `correct`/`incorrect` for post-answer review.
   */
  state?: RadioVisualState;
  /**
   * Visually hidden text that makes `correct`/`incorrect` audible rather than
   * colour-only. Defaults to "Correct answer" / "Incorrect answer"; pass
   * `null` to suppress.
   */
  stateLabel?: string | null;
  /** Secondary line under the option label. */
  description?: ReactNode;
  /** Set false to drop the leading radio bullet (e.g. for lettered options). */
  showIndicator?: boolean;
  children?: ReactNode;
}

const DEFAULT_STATE_LABELS: Record<RadioVisualState, string | null> = {
  neutral: null,
  selected: null,
  correct: 'Correct answer',
  incorrect: 'Incorrect answer',
};

const INDICATOR_GLYPH: Record<RadioVisualState, string> = {
  neutral: '',
  selected: '•',
  correct: '✓',
  incorrect: '✕',
};

export const Radio = forwardRef<HTMLButtonElement, RadioProps>(function Radio(
  {
    value,
    disabled = false,
    state,
    stateLabel,
    description,
    showIndicator = true,
    className,
    children,
    onClick,
    ...rest
  },
  ref,
) {
  const group = useContext(RadioGroupContext);
  if (!group) {
    throw new Error('<Radio> must be rendered inside a <RadioGroup>.');
  }

  const checked = group.value === value;
  const optionDisabled = disabled || group.groupDisabled;
  // `inert` means "not actionable". It never becomes the `disabled`
  // attribute, which would strip the option from the accessibility tree.
  const inert = optionDisabled || group.readOnly;
  const visualState: RadioVisualState = state ?? (checked ? 'selected' : 'neutral');
  const resolvedStateLabel =
    stateLabel === undefined ? DEFAULT_STATE_LABELS[visualState] : stateLabel;

  return (
    <button
      ref={ref}
      {...rest}
      type="button"
      role="radio"
      aria-checked={checked}
      aria-disabled={inert || undefined}
      data-value={value}
      data-state={visualState}
      tabIndex={-1}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (inert) return;
        group.select(value);
      }}
      className={cx(
        styles.radio,
        styles[visualState],
        inert && styles.inert,
        optionDisabled && styles.disabledOption,
        className,
      )}
    >
      {showIndicator && (
        <span className={styles.indicator} aria-hidden="true">
          {INDICATOR_GLYPH[visualState]}
        </span>
      )}
      <span className={styles.content}>
        <span>{children}</span>
        {description !== undefined && <span className={styles.description}>{description}</span>}
      </span>
      {resolvedStateLabel !== null && <VisuallyHidden>{resolvedStateLabel}</VisuallyHidden>}
    </button>
  );
});
