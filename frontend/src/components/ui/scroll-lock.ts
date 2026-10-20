let lockCount = 0;
let previousOverflow = '';
let previousPaddingRight = '';

/**
 * Reference-counted body scroll lock so nested/stacked overlays do not
 * restore the page scroll while another overlay is still open.
 */
export function lockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  lockCount += 1;
  if (lockCount > 1) return;

  const { body, documentElement } = document;
  previousOverflow = body.style.overflow;
  previousPaddingRight = body.style.paddingRight;

  const scrollbarWidth = window.innerWidth - documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${scrollbarWidth}px`;
  }
}

export function unlockBodyScroll(): void {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount > 0) return;

  document.body.style.overflow = previousOverflow;
  document.body.style.paddingRight = previousPaddingRight;
}
