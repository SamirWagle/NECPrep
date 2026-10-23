import { forwardRef, useCallback, useState } from 'react';
import type { ButtonHTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cx } from './cx';
import styles from './Switch.module.css';

type NativeSwitchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'role' | 'aria-checked' | 'type' | 'value' | 'children' | 'onChange' | 'disabled'
>;

export interface SwitchBaseProps extends NativeSwitchProps {
  /** Controlled state. */
  checked?: boolean;
  /** Uncontrolled initial state. */
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: 'sm' | 'md';
  /**
   * Unavailable. Rendered as `aria-disabled` rather than the `disabled`
   * attribute so the control stays focusable and its state announceable;
   * activation is blocked in the handlers instead.
   */
  disabled?: boolean;
  /** Visible text rendered next to the track; also names the control. */
  children?: ReactNode;
}

/** A switch needs an accessible name: visible label text, or an ARIA label. */
export type SwitchProps = SwitchBaseProps &
  ({ children: ReactNode } | { 'aria-label': string } | { 'aria-labelledby': string });

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(props, ref) {
  const {
    checked,
    defaultChecked = false,
    onCheckedChange,
    size = 'md',
    className,
    children,
    disabled = false,
    onClick,
    onKeyDown,
    ...rest
  } = props as SwitchBaseProps;

  const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const isChecked = checked !== undefined ? checked : uncontrolledChecked;

  const toggle = useCallback(() => {
    if (disabled) return;
    const next = !isChecked;
    if (!isControlled) setUncontrolledChecked(next);
    onCheckedChange?.(next);
  }, [disabled, isChecked, isControlled, onCheckedChange]);

  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      toggle();
    },
    [onClick, toggle],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key !== 'Enter') return;
      // Enter is not a native activation key for every UA/AT combination on a
      // role-overridden button, so wire it explicitly. Space already
      // activates a <button> natively and does not scroll the page, so it is
      // left to the platform to avoid a double toggle.
      event.preventDefault();
      toggle();
    },
    [onKeyDown, toggle],
  );

  return (
    <button
      ref={ref}
      {...rest}
      type="button"
      role="switch"
      aria-checked={isChecked}
      aria-disabled={disabled || undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cx(
        styles.root,
        size === 'sm' && styles.sm,
        isChecked && styles.checked,
        disabled && styles.inert,
        className,
      )}
    >
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
      {children !== undefined && <span className={styles.label}>{children}</span>}
    </button>
  );
});
