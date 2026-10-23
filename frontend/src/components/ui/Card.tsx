import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Card.module.css';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CardVariant = 'outlined' | 'raised' | 'flat';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  variant?: CardVariant;
  /**
   * Adds hover/focus affordance styling only. The card still has to *be* a
   * real control: render the whole card as a `<button>`/`<a>` via `asChild`
   * patterns in the consumer, or put a focusable control inside it. A
   * clickable `<div>` is not keyboard reachable and this prop does not make
   * one.
   */
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = 'md', variant = 'outlined', interactive = false, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      {...rest}
      className={cx(
        styles.card,
        styles[padding],
        variant !== 'outlined' && styles[variant],
        interactive && styles.interactive,
        className,
      )}
    />
  );
});
