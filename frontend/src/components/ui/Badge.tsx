import { forwardRef } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { VisuallyHidden } from './VisuallyHidden';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  /** Leading glyph. Rendered `aria-hidden`. */
  icon?: ReactNode;
  /**
   * Context a sighted user infers from colour or placement but a screen
   * reader would not, e.g. `"Status:"` before a `"Passed"` badge.
   */
  srPrefix?: string;
}

/**
 * Static, non-interactive status label. Colour is never the only carrier of
 * meaning — the badge always contains text, and `srPrefix` adds the context
 * that position or hue would otherwise imply.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', size = 'md', icon, srPrefix, className, children, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      {...rest}
      className={cx(styles.badge, styles[tone], styles[size], className)}
    >
      {srPrefix !== undefined && <VisuallyHidden>{`${srPrefix} `}</VisuallyHidden>}
      {icon !== undefined && (
        <span aria-hidden="true" style={{ display: 'inline-flex' }}>
          {icon}
        </span>
      )}
      {children}
    </span>
  );
});
