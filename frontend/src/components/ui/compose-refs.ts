import { useCallback } from 'react';
import type { Ref, RefCallback, RefObject } from 'react';

function assignRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(node);
    return;
  }
  // `RefObject.current` is readonly in the public types but React itself
  // writes through it; this is the standard escape hatch.
  (ref as { current: T | null }).current = node;
}

/**
 * Lets a component keep its own internal ref (needed for DOM measurement or
 * focus management) while still honouring a forwarded ref.
 *
 * The `Ref` name suffixes are load-bearing: `react-hooks/immutability` uses
 * them to recognise these arguments as refs rather than plain props.
 */
export function useComposedRef<T>(
  forwardedRef: Ref<T> | undefined,
  localRef: RefObject<T | null>,
): RefCallback<T> {
  return useCallback(
    (node: T | null) => {
      localRef.current = node;
      assignRef(forwardedRef, node);
    },
    [forwardedRef, localRef],
  );
}
