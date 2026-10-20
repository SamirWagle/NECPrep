import { forwardRef } from 'react';
import type { CSSProperties, HTMLAttributes } from 'react';
import { cx } from './cx';
import { VisuallyHidden } from './VisuallyHidden';
import styles from './Spinner.module.css';

export interface SpinnerProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Diameter in px. Default 16. */
  size?: number;
  /** Stroke width in px. Default 2. */
  thickness?: number;
  /**
   * When set, the spinner becomes a `role="status"` live region announcing
   * this text. When omitted the spinner is purely decorative
   * (`aria-hidden="true"`) — the right choice when a surrounding control
   * already carries `aria-busy`, which is how `Button` uses it.
   */
  label?: string;
}

export const Spinner = forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { size = 16, thickness = 2, label, className, style, ...rest },
  ref,
) {
  const circleStyle: CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    borderWidth: `${thickness}px`,
  };

  if (!label) {
    return (
      <span
        ref={ref}
        {...rest}
        className={cx(styles.spinner, className)}
        style={{ ...circleStyle, ...style }}
        aria-hidden="true"
      />
    );
  }

  return (
    <span ref={ref} {...rest} className={className} style={style} role="status">
      <span className={styles.spinner} style={circleStyle} aria-hidden="true" />
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
});
