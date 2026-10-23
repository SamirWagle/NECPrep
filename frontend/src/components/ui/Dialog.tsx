import { forwardRef, useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react';
import { useComposedRef } from './compose-refs';
import { cx } from './cx';
import { getFocusableElements } from './focusable';
import { IconButton } from './IconButton';
import { lockBodyScroll, unlockBodyScroll } from './scroll-lock';
import styles from './Dialog.module.css';

export type DialogSize = 'sm' | 'md' | 'lg';

export interface DialogProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'title' | 'children'> {
  open: boolean;
  /** Called for Escape, backdrop click and the close button. */
  onClose: () => void;
  /** Accessible name. Wired to the panel through `aria-labelledby`. */
  title: ReactNode;
  /** Optional supporting copy. Wired through `aria-describedby`. */
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: DialogSize;
  /** Where focus should land on open. Defaults to the first tabbable node. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Default true. */
  closeOnEscape?: boolean;
  /** Default true. */
  closeOnBackdropClick?: boolean;
  /** Default true. */
  showCloseButton?: boolean;
  closeLabel?: string;
  className?: string;
  backdropClassName?: string;
  /** Portal host. Defaults to `document.body`. */
  container?: HTMLElement | null;
}

/**
 * Modal dialog implementing the WAI-ARIA dialog (modal) pattern:
 * `role="dialog"` + `aria-modal`, a name from its title, a Tab/Shift+Tab
 * focus trap, initial focus, Escape to dismiss, focus restoration to whatever
 * was focused before opening, and a reference-counted body scroll lock.
 */
export const Dialog = forwardRef<HTMLDivElement, DialogProps>(function Dialog(
  {
    open,
    onClose,
    title,
    description,
    children,
    footer,
    size = 'md',
    initialFocusRef,
    closeOnEscape = true,
    closeOnBackdropClick = true,
    showCloseButton = true,
    closeLabel = 'Close dialog',
    className,
    backdropClassName,
    container,
    onKeyDown,
    ...rest
  },
  forwardedRef,
) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const setPanelRef = useComposedRef(forwardedRef, panelRef);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  // Keep the latest onClose without re-running the focus/scroll effect, which
  // would restore focus mid-interaction every time the parent re-renders.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /**
   * One effect owns the whole open/close lifecycle so the teardown order is
   * guaranteed: unlock scroll, then hand focus back to the opener.
   */
  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    lockBodyScroll();

    const panel = panelRef.current;
    const explicit = initialFocusRef?.current ?? null;
    const target = explicit ?? getFocusableElements(panel)[0] ?? panel;
    target?.focus();

    return () => {
      unlockBodyScroll();
      // Focus restoration: without this, dismissing the dialog drops focus to
      // <body> and keyboard users lose their place on the page.
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    function handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onCloseRef.current();
    }
    // Listen on the document so Escape works even if focus has drifted out.
    document.addEventListener('keydown', handleDocumentKeyDown, true);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown, true);
  }, [open, closeOnEscape]);

  const handlePanelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      const focusables = getFocusableElements(panel);

      if (focusables.length === 0) {
        // Nothing to tab to: keep focus pinned on the panel itself.
        event.preventDefault();
        panel?.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inside = panel ? panel.contains(active) : false;

      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onKeyDown],
  );

  /**
   * Backdrop dismissal is split across mousedown and click on purpose.
   *
   * mousedown records that the press *started* on the backdrop, so a text
   * selection that begins inside the panel and ends outside it does not
   * dismiss the dialog. It also calls `preventDefault()`: the default action
   * of mousedown on a non-focusable element is to move focus to the body,
   * which would land after our dismissal and throw away the focus we just
   * restored to the trigger.
   */
  const backdropPressRef = useRef(false);

  const handleBackdropMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const onBackdrop = closeOnBackdropClick && event.target === event.currentTarget;
      backdropPressRef.current = onBackdrop;
      if (onBackdrop) event.preventDefault();
    },
    [closeOnBackdropClick],
  );

  const handleBackdropClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!backdropPressRef.current) return;
    backdropPressRef.current = false;
    if (event.target !== event.currentTarget) return;
    onCloseRef.current();
  }, []);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const host = container ?? document.body;

  return createPortal(
    <div
      className={cx(styles.backdrop, backdropClassName)}
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        ref={setPanelRef}
        {...rest}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description !== undefined ? descriptionId : rest['aria-describedby']}
        tabIndex={-1}
        onKeyDown={handlePanelKeyDown}
        className={cx(styles.panel, styles[size], className)}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.heading}>
            {title}
          </h2>
          {showCloseButton && (
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={closeLabel}
              onClick={() => onCloseRef.current()}
              icon={<X size={18} aria-hidden="true" />}
            />
          )}
        </div>
        {description !== undefined && (
          <p id={descriptionId} className={styles.description}>
            {description}
          </p>
        )}
        {children !== undefined && <div className={styles.body}>{children}</div>}
        {footer !== undefined && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    host,
  );
});
