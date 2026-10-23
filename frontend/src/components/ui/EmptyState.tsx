import { createElement, forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './EmptyState.module.css';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Decorative glyph. Rendered inside an `aria-hidden` wrapper. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Usually a `Button`. */
  action?: ReactNode;
  /**
   * Heading level for `title`. Must fit the surrounding document outline —
   * skipping levels breaks heading navigation. Default 3.
   */
  headingLevel?: 2 | 3 | 4 | 5;
  compact?: boolean;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  {
    icon,
    title,
    description,
    action,
    headingLevel = 3,
    compact = false,
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <div ref={ref} {...rest} className={cx(styles.root, compact && styles.compact, className)}>
      {icon !== undefined && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      {createElement(`h${headingLevel}`, { className: styles.title }, title)}
      {description !== undefined && <p className={styles.description}>{description}</p>}
      {children}
      {action !== undefined && <div className={styles.actions}>{action}</div>}
    </div>
  );
});
