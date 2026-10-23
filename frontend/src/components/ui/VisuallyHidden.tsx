import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './VisuallyHidden.module.css';

export type VisuallyHiddenProps = HTMLAttributes<HTMLSpanElement>;

/**
 * Renders text that is invisible on screen but announced by screen readers.
 * Use it for the accessible name of an icon-only control, or to narrate a
 * state change that is otherwise communicated with colour alone.
 */
export const VisuallyHidden = forwardRef<HTMLSpanElement, VisuallyHiddenProps>(
  function VisuallyHidden({ className, ...rest }, ref) {
    return <span ref={ref} className={cx(styles.visuallyHidden, className)} {...rest} />;
  },
);
