import { forwardRef, useId } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './Progress.module.css';

export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger' | 'info';

function clampFraction(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const fraction = (value - min) / (max - min);
  if (Number.isNaN(fraction)) return 0;
  return Math.min(1, Math.max(0, fraction));
}

interface ProgressSharedProps {
  /** Current value. Ignored when `indeterminate`. */
  value?: number;
  min?: number;
  max?: number;
  tone?: ProgressTone;
  /**
   * Work is happening but the amount is unknown. Drops `aria-valuenow`, which
   * is how assistive tech recognises an indeterminate progressbar.
   */
  indeterminate?: boolean;
  /**
   * The accessible text alternative, exposed as `aria-valuetext`. Defaults to
   * a percentage, or `"<value> of <max>"` when the range is not 0-100.
   */
  valueText?: string;
}

function defaultValueText(value: number, min: number, max: number, indeterminate: boolean): string {
  if (indeterminate) return 'In progress';
  if (min === 0 && max === 100) return `${Math.round(value)}%`;
  return `${value} of ${max}`;
}

type NativeBarProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'role' | 'children' | 'aria-valuenow' | 'aria-valuemin' | 'aria-valuemax' | 'aria-valuetext'
>;

export interface ProgressBarBaseProps extends NativeBarProps, ProgressSharedProps {
  /** Visible label above the track. Also names the progressbar. */
  label?: ReactNode;
  /** Visible text on the right of the label row, e.g. `"12 / 40"`. */
  hint?: ReactNode;
  /** Track thickness in px. Default 8. */
  thickness?: number;
}

/**
 * A progressbar has no implicit accessible name. Supply visible `label` text,
 * or an ARIA label when surrounding content already explains what is
 * progressing.
 */
export type ProgressBarProps = ProgressBarBaseProps &
  ({ label: ReactNode } | { 'aria-label': string } | { 'aria-labelledby': string });

export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
  function ProgressBar(props, ref) {
    const {
      value = 0,
      min = 0,
      max = 100,
      tone = 'accent',
      indeterminate = false,
      valueText,
      label,
      hint,
      thickness = 8,
      className,
      style,
      ...rest
    } = props as ProgressBarBaseProps;

    const generatedId = useId();
    const labelId = `${generatedId}-label`;
    const fraction = clampFraction(value, min, max);
    const spoken = valueText ?? defaultValueText(value, min, max, indeterminate);

    return (
      <div className={cx(styles.barRoot, className)}>
        {(label !== undefined || hint !== undefined) && (
          <div className={styles.barHeader}>
            {label !== undefined && (
              <span id={labelId} className={styles.barLabel}>
                {label}
              </span>
            )}
            {hint !== undefined && <span>{hint}</span>}
          </div>
        )}
        <div
          ref={ref}
          {...rest}
          role="progressbar"
          aria-valuenow={indeterminate ? undefined : value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={spoken}
          aria-labelledby={
            rest['aria-labelledby'] ??
            (label !== undefined && rest['aria-label'] === undefined ? labelId : undefined)
          }
          className={cx(styles.barTrack, styles[tone], indeterminate && styles.indeterminate)}
          style={{ height: `${thickness}px`, ...style }}
        >
          {/* progressbar is "children presentational" in ARIA, so this fill is
              invisible to assistive tech either way. */}
          <div
            className={styles.barFill}
            style={indeterminate ? undefined : { width: `${fraction * 100}%` }}
          />
        </div>
      </div>
    );
  },
);

type NativeRingProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'role' | 'aria-valuenow' | 'aria-valuemin' | 'aria-valuemax' | 'aria-valuetext'
>;

export interface ProgressRingBaseProps extends NativeRingProps, ProgressSharedProps {
  /** Outer diameter in px. Default 56. */
  size?: number;
  /** Stroke width in px. Default 6. */
  thickness?: number;
  /**
   * Content in the middle of the ring. Rendered `aria-hidden`; the spoken
   * value comes from `aria-valuetext`.
   */
  children?: ReactNode;
}

/** Same naming requirement as `ProgressBar`. */
export type ProgressRingProps = ProgressRingBaseProps &
  ({ 'aria-label': string } | { 'aria-labelledby': string });

export const ProgressRing = forwardRef<HTMLDivElement, ProgressRingProps>(
  function ProgressRing(props, ref) {
    const {
      value = 0,
      min = 0,
      max = 100,
      tone = 'accent',
      indeterminate = false,
      valueText,
      size = 56,
      thickness = 6,
      className,
      style,
      children,
      ...rest
    } = props as ProgressRingBaseProps;

    const fraction = clampFraction(value, min, max);
    const spoken = valueText ?? defaultValueText(value, min, max, indeterminate);
    const radius = (size - thickness) / 2;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = indeterminate ? circumference * 0.75 : circumference * (1 - fraction);

    return (
      <div
        ref={ref}
        {...rest}
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={spoken}
        className={cx(styles.ringRoot, styles[tone], className)}
        style={{ width: `${size}px`, height: `${size}px`, ...style }}
      >
        <svg
          className={cx(styles.ringSvg, indeterminate && styles.ringSpin)}
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
          focusable="false"
        >
          <circle
            className={styles.ringTrack}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={thickness}
          />
          <circle
            className={styles.ringFill}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        {children !== undefined && (
          <span className={styles.ringCenter} aria-hidden="true">
            {children}
          </span>
        )}
      </div>
    );
  },
);
