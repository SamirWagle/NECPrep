import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { cx } from './cx';
import { Spinner } from './Spinner';
import { VisuallyHidden } from './VisuallyHidden';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
>;

export interface ButtonBaseProps extends NativeButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Busy state. Implemented with `aria-busy` + `aria-disabled` rather than
   * the `disabled` attribute so the button keeps focus while the request is
   * in flight — a `disabled` button drops out of the tab order and silently
   * throws focus to `<body>`.
   */
  loading?: boolean;
  /** Visually hidden text announced while `loading`. */
  loadingLabel?: string;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children?: ReactNode;
}

/**
 * Icon-only buttons have no text to name them, so the type system requires an
 * `aria-label`. `<Button iconOnly><X /></Button>` is a compile error.
 */
export type ButtonProps = ButtonBaseProps &
  (
    | { iconOnly: true; 'aria-label': string }
    | { iconOnly?: false | undefined; 'aria-label'?: string }
  );

type ResolvedButtonProps = ButtonBaseProps & {
  iconOnly?: boolean;
  'aria-label'?: string;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel,
    fullWidth = false,
    iconOnly = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled = false,
    type = 'button',
    onClick,
    ...rest
  } = props as ResolvedButtonProps;

  const inert = disabled || loading;
  const spinnerSize = size === 'lg' ? 20 : size === 'sm' ? 14 : 16;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      // aria-disabled does not block activation the way [disabled] does.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      ref={ref}
      {...rest}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      className={cx(
        styles.button,
        styles[variant],
        styles[size],
        iconOnly && styles.iconOnly,
        fullWidth && styles.fullWidth,
        inert && styles.inert,
        loading && styles.loading,
        className,
      )}
    >
      {loading ? (
        <span className={styles.icon}>
          <Spinner size={spinnerSize} />
        </span>
      ) : (
        leadingIcon !== undefined && <span className={styles.icon}>{leadingIcon}</span>
      )}
      {iconOnly ? (
        loading ? null : (
          <span className={styles.icon}>{children}</span>
        )
      ) : (
        children !== undefined && <span className={styles.label}>{children}</span>
      )}
      {!iconOnly && trailingIcon !== undefined && (
        <span className={styles.icon}>{trailingIcon}</span>
      )}
      {loading && loadingLabel !== undefined && <VisuallyHidden>{loadingLabel}</VisuallyHidden>}
    </button>
  );
});
