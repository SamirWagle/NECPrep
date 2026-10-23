import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import type { ButtonBaseProps } from './Button';
import { Button } from './Button';

export interface IconButtonProps
  extends Omit<ButtonBaseProps, 'children' | 'leadingIcon' | 'trailingIcon'> {
  /** The glyph. Rendered `aria-hidden` is unnecessary — the button's name comes from `aria-label`. */
  icon: ReactNode;
  /** Required: an icon has no text, so this is the control's only accessible name. */
  'aria-label': string;
}

/**
 * Thin wrapper over `Button` in icon-only mode. Exists so the 44x44 target
 * and the mandatory `aria-label` cannot be forgotten at the call site.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, 'aria-label': ariaLabel, ...rest },
  ref,
) {
  return (
    <Button ref={ref} {...rest} iconOnly aria-label={ariaLabel}>
      {icon}
    </Button>
  );
});
