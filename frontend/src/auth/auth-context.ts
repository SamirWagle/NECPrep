/**
 * The auth context, its types, and the hooks that read it.
 *
 * Split from `AuthContext.tsx` because that file exports a component and this
 * one does not. React Fast Refresh can only swap a module whose exports are
 * all components, so mixing the provider with its hooks costs a full reload on
 * every edit — the same reason `context/user-context.ts` is separate from
 * `context/UserContext.tsx`.
 */

import { createContext, useContext } from 'react';
import type { ApiError, SessionUser } from '../services/api';

export type AuthStatus = 'loading' | 'ready' | 'disabled';

export interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  /** Epoch ms the session expires, when the server told us. */
  expiresAt: number | null;
  /** Last failure from a sign-in attempt. Cleared on the next attempt. */
  error: ApiError | null;
  /** True while a sign-in, sign-up or sign-out request is in flight. */
  busy: boolean;
}

export interface AuthActions {
  login(email: string, password: string): Promise<boolean>;
  signup(email: string, password: string, displayName?: string): Promise<boolean>;
  /** Creates a guest identity whose attempts survive a later sign-up. */
  startGuest(): Promise<boolean>;
  /** Turns the CURRENT guest into a full account, keeping its id and history. */
  upgrade(email: string, password: string, displayName?: string): Promise<boolean>;
  logout(): Promise<void>;
  /** Re-reads the session from the server. */
  refresh(): Promise<void>;
  clearError(): void;
}

export type AuthContextValue = AuthState & AuthActions;

export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Read the auth state.
 *
 * Throws outside a provider rather than returning a plausible default: a
 * component that silently believes nobody is signed in is far harder to debug
 * than one that fails on first render.
 */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return value;
}

/**
 * True when the app should behave as a signed-in experience.
 *
 * A guest counts: they have a server-side identity, their attempts are
 * recorded, and they can upgrade in place. `'disabled'` also counts, because a
 * local-only build has no sign-in to offer and must not gate anything.
 */
export function useIsAuthenticated(): boolean {
  const { status, user } = useAuth();
  return status === 'disabled' || user !== null;
}
