import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Skeleton.module.css';

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  variant?: 'text' | 'rect' | 'circle';
  width?: number | string;
  height?: number | string;
  /** Number of stacked lines for `variant="text"`. Default 1. */
  lines?: number;
}

function toCssSize(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? `${value}px` : value;
}

/**
 * Loading placeholder. Always `aria-hidden`: a shimmering box has no meaning
 * to a screen reader, and announcing a dozen of them is noise. Announce the
 * loading state once, on the region that owns it (`aria-busy`, or a
 * `role="status"` message).
 */
export const Skeleton = forwardRef<HTMLSpanElement, SkeletonProps>(function Skeleton(
  { variant = 'text', width, height, lines = 1, className, style, ...rest },
  ref,
) {
  const resolvedStyle = {
    width: toCssSize(width) ?? (variant === 'text' ? '100%' : undefined),
    height: toCssSize(height),
    ...style,
  };

  if (variant === 'text' && lines > 1) {
    return (
      <span
        ref={ref}
        {...rest}
        aria-hidden="true"
        className={className}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', ...style }}
      >
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className={cx(styles.skeleton, styles.text)}
            // Ragged last line reads as text rather than a solid block.
            style={{ width: index === lines - 1 ? '65%' : '100%', height: toCssSize(height) }}
          />
        ))}
      </span>
    );
  }

  return (
    <span
      ref={ref}
      {...rest}
      aria-hidden="true"
      className={cx(styles.skeleton, styles[variant], className)}
      style={resolvedStyle}
    />
  );
});
