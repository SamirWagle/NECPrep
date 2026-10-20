import { createContext } from 'react';
import type { ReactNode } from 'react';

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface ToastOptions {
  title?: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  /** Auto-dismiss delay in ms. `0` or a negative value means "stay until dismissed". */
  duration?: number;
  /** Optional action, usually a `Button`. */
  action?: ReactNode;
  /**
   * `polite` (default) waits for a pause in speech; `assertive` interrupts.
   * Reserve `assertive` for errors that block the user.
   */
  politeness?: 'polite' | 'assertive';
}

export interface ToastRecord extends ToastOptions {
  id: string;
}

export interface ToastContextValue {
  toasts: readonly ToastRecord[];
  /** Queues a toast and returns its id. */
  toast: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
