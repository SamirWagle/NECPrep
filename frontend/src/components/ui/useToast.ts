import { useContext } from 'react';
import { ToastContext } from './toast-context';
import type { ToastContextValue } from './toast-context';

/**
 * Access the toast queue. Throws rather than no-oping when no provider is
 * mounted: a silently swallowed notification is a bug that only surfaces in
 * production.
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast() must be called inside a <ToastProvider>.');
  }
  return context;
}
