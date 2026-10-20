import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './Separator.module.css';

export interface SeparatorProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role'> {
  orientation?: 'horizontal' | 'vertical';
  /**
   * Default true. A purely visual rule is `role="none"` so it does not add a
   * meaningless stop to screen-reader navigation. Set false when the line
   * genuinely separates groups of content.
   */
  decorative?: boolean;
  /** Text rendered inside the rule, e.g. "or". Forces a meaningful separator. */
  label?: ReactNode;
}

export const Separator = forwardRef<HTMLDivElement, SeparatorProps>(function Separator(
  { orientation = 'horizontal', decorative = true, label, className, ...rest },
  ref,
) {
  if (label !== undefined) {
    return (
      <div
        ref={ref}
        {...rest}
        role="separator"
        aria-orientation="horizontal"
        className={cx(styles.withLabel, className)}
      >
        {label}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      {...rest}
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cx(
        styles.separator,
        orientation === 'vertical' ? styles.vertical : styles.horizontal,
        className,
      )}
    />
  );
});
