import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { ToastContext } from './toast-context';
import type { ToastContextValue, ToastOptions, ToastRecord, ToastTone } from './toast-context';
import styles from './Toast.module.css';

export type ToastPlacement = 'topRight' | 'topCenter' | 'bottomRight' | 'bottomCenter';

const TONE_CLASS: Record<ToastTone, string | undefined> = {
  neutral: undefined,
  success: styles.success,
  warning: styles.warning,
  danger: styles.danger,
  info: styles.info,
};

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  title?: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  action?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}

/**
 * The presentational toast. Rendered inside a live region by
 * `ToastProvider`; exported separately so it can also be used as a static
 * inline notification.
 */
export const Toast = forwardRef<HTMLDivElement, ToastProps>(function Toast(
  {
    title,
    description,
    tone = 'neutral',
    action,
    onDismiss,
    dismissLabel = 'Dismiss notification',
    className,
    ...rest
  },
  ref,
) {
  return (
    <div ref={ref} {...rest} className={cx(styles.toast, TONE_CLASS[tone], className)}>
      <div className={styles.body}>
        {title !== undefined && <span className={styles.title}>{title}</span>}
        {description !== undefined && <span className={styles.description}>{description}</span>}
        {action !== undefined && <span className={styles.action}>{action}</span>}
      </div>
      {onDismiss !== undefined && (
        <IconButton
          variant="ghost"
          size="sm"
          aria-label={dismissLabel}
          onClick={onDismiss}
          icon={<X size={16} aria-hidden="true" />}
        />
      )}
    </div>
  );
});

/** Resume with at least this long on the clock, so a toast is never re-shown for 5ms. */
const MIN_RESUME_MS = 400;

interface ToastItemProps {
  record: ToastRecord;
  onDismiss: (id: string) => void;
  dismissLabel: string;
}

function ToastItem({ record, onDismiss, dismissLabel }: ToastItemProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remainingRef = useRef(record.duration ?? 0);
  const paused = hovered || focused;

  useEffect(() => {
    const remaining = remainingRef.current;
    // duration <= 0 means "sticky": dismissed only by the user.
    if (paused || remaining <= 0) return;

    const startedAt = Date.now();
    const timer = window.setTimeout(() => onDismiss(record.id), remaining);
    return () => {
      window.clearTimeout(timer);
      // Bank the unspent time so hovering pauses rather than restarts.
      const spent = Date.now() - startedAt;
      remainingRef.current = Math.max(MIN_RESUME_MS, remaining - spent);
    };
  }, [paused, onDismiss, record.id]);

  const handleDismiss = useCallback(() => onDismiss(record.id), [onDismiss, record.id]);

  return (
    <Toast
      title={record.title}
      description={record.description}
      tone={record.tone ?? 'neutral'}
      action={record.action}
      onDismiss={handleDismiss}
      dismissLabel={dismissLabel}
      // Pause the auto-dismiss clock whenever the user is reading or
      // keyboard-navigating the toast, so the action never vanishes
      // mid-reach. WCAG 2.2.1 Timing Adjustable.
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

export interface ToastProviderProps {
  children?: ReactNode;
  placement?: ToastPlacement;
  /** Default auto-dismiss in ms. Default 5000. Pass 0 for sticky toasts. */
  duration?: number;
  /** Oldest toasts beyond this are dropped. Default 4. */
  max?: number;
  dismissLabel?: string;
  /** Portal host. Defaults to `document.body`. */
  container?: HTMLElement | null;
}

/**
 * Owns the toast queue and renders the live regions. Two regions are kept
 * permanently mounted (polite and assertive) because a live region has to
 * exist *before* content is inserted into it, otherwise the insertion is not
 * announced.
 */
export function ToastProvider({
  children,
  placement = 'topRight',
  duration = 5000,
  max = 4,
  dismissLabel = 'Dismiss notification',
  container,
}: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const counterRef = useRef(0);

  const toast = useCallback(
    (options: ToastOptions) => {
      counterRef.current += 1;
      const id = `toast-${counterRef.current}`;
      const record: ToastRecord = { duration, politeness: 'polite', ...options, id };
      setToasts((previous) => {
        const next = [...previous, record];
        return next.length > max ? next.slice(next.length - max) : next;
      });
      return id;
    },
    [duration, max],
  );

  const dismiss = useCallback((id: string) => {
    setToasts((previous) => previous.filter((entry) => entry.id !== id));
  }, []);

  const dismissAll = useCallback(() => setToasts([]), []);

  const contextValue = useMemo<ToastContextValue>(
    () => ({ toasts, toast, dismiss, dismissAll }),
    [dismiss, dismissAll, toast, toasts],
  );

  const polite = toasts.filter((entry) => entry.politeness !== 'assertive');
  const assertive = toasts.filter((entry) => entry.politeness === 'assertive');

  const viewport = (
    <div className={cx(styles.viewport, styles[placement])}>
      <div role="status" aria-live="polite" aria-relevant="additions text">
        {polite.map((entry) => (
          <ToastItem
            key={entry.id}
            record={entry}
            onDismiss={dismiss}
            dismissLabel={dismissLabel}
          />
        ))}
      </div>
      <div role="alert" aria-live="assertive">
        {assertive.map((entry) => (
          <ToastItem
            key={entry.id}
            record={entry}
            onDismiss={dismiss}
            dismissLabel={dismissLabel}
          />
        ))}
      </div>
    </div>
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {typeof document !== 'undefined' && createPortal(viewport, container ?? document.body)}
    </ToastContext.Provider>
  );
}
