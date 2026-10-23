/**
 * Who the current visitor is.
 *
 * Every endpoint on the Worker except the content reads needs a session, so
 * this is the gate the rest of the integration goes through. It is also the
 * one piece that has to work when there is NO backend: the app has shipped
 * local-only until now, and a build with `VITE_API_BASE_URL` unset must keep
 * working rather than show a login wall it cannot satisfy.
 *
 * THREE STATES, NOT TWO
 * ---------------------
 * `status` distinguishes them because conflating any two produces a bug:
 *
 *   'loading'  -- the session probe is in flight. Route guards must WAIT here,
 *                 not redirect: treating it as signed-out bounces a
 *                 signed-in user to the sign-in page on every refresh.
 *   'ready'    -- the probe finished. `user` is the answer, and `null` means
 *                 genuinely signed out.
 *   'disabled' -- no backend is configured. Not an error and not signed-out:
 *                 the app runs on local data and nothing should prompt for
 *                 credentials.
 *
 * THE SESSION IS AN HttpOnly COOKIE
 * ---------------------------------
 * There is no token in JavaScript, so there is nothing here to persist, and
 * nothing for XSS to read. `user` is a cache of what the server last said, not
 * the credential. That is why sign-out calls the server rather than clearing
 * local state: clearing a cache the browser can refill from a still-valid
 * cookie would log nobody out.
 *
 * ANONYMOUS IS A REAL IDENTITY
 * ----------------------------
 * `startGuest()` creates a server-side user whose id survives being upgraded
 * in place (`upgrade()`), so a candidate can sit a paper, then sign up, and
 * keep that attempt. The alternative - making them sign up first - throws away
 * the only session where they were actually willing to start.
 *
 * The context, its types and the hooks live in `auth-context.ts`; this file
 * exports only the provider so Fast Refresh can swap it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, isBackendConfigured } from '../services/api';
import type { ApiError, SessionUser } from '../services/api';
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context';

/**
 * The state before anything has been asked.
 *
 * A function rather than a module-level constant. `isBackendConfigured()`
 * reads a build-time value in production, so either would behave identically
 * there — but freezing it at module scope means the status is decided by
 * whenever this file first happened to be imported, which is both arbitrary
 * and untestable. Reading it when the provider actually mounts is the honest
 * version, and it still settles before the first paint, so a local-only build
 * shows no flash of 'loading'.
 */
function initialState(): AuthState {
  return {
    status: isBackendConfigured() ? 'loading' : 'disabled',
    user: null,
    expiresAt: null,
    error: null,
    busy: false,
  };
}

/** What the four session-establishing endpoints have in common. */
type SessionAttempt =
  | { ok: true; data: { user: SessionUser | null; sessionExpiresAt: number | null } }
  | { ok: false; error: ApiError };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  // Guards against a response landing after unmount.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const applySession = useCallback((user: SessionUser | null, expiresAt: number | null) => {
    if (!alive.current) return;
    setState((prev) => ({ ...prev, status: 'ready', user, expiresAt, busy: false }));
  }, []);

  const refresh = useCallback(async () => {
    if (!isBackendConfigured()) return;
    const result = await api.getSession();
    if (!alive.current) return;
    if (result.ok) {
      applySession(result.data.user, result.data.sessionExpiresAt);
      return;
    }
    // A failed probe is not a failed sign-in: it means we do not know who this
    // is. Reporting it as an auth error would show "could not sign in" to
    // someone who never tried. The app degrades to signed-out.
    setState((prev) => ({ ...prev, status: 'ready', user: null, expiresAt: null, busy: false }));
  }, [applySession]);

  // One probe on mount. The cookie travels automatically, so this is how a
  // refreshed tab discovers it is still signed in.
  //
  // The work is deferred into a promise rather than called straight from the
  // effect body: a synchronous setState during an effect cascades an extra
  // render pass, and here it would also mean the very first paint could not
  // show the 'loading' state the route guard depends on.
  useEffect(() => {
    if (!isBackendConfigured()) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      await refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const attempt = useCallback(
    async (run: () => Promise<SessionAttempt>): Promise<boolean> => {
      setState((prev) => ({ ...prev, busy: true, error: null }));
      const result = await run();
      if (!alive.current) return false;
      if (!result.ok) {
        setState((prev) => ({ ...prev, busy: false, error: result.error }));
        return false;
      }
      applySession(result.data.user, result.data.sessionExpiresAt);
      return true;
    },
    [applySession],
  );

  const login = useCallback(
    (email: string, password: string) => attempt(() => api.login({ email, password })),
    [attempt],
  );

  const signup = useCallback(
    (email: string, password: string, displayName?: string) =>
      attempt(() => api.signup({ email, password, displayName })),
    [attempt],
  );

  const startGuest = useCallback(() => attempt(() => api.startAnonymousSession()), [attempt]);

  const upgrade = useCallback(
    (email: string, password: string, displayName?: string) =>
      attempt(() => api.upgradeAnonymous({ email, password, displayName })),
    [attempt],
  );

  const logout = useCallback(async () => {
    setState((prev) => ({ ...prev, busy: true, error: null }));
    // The server revokes the session and clears the cookie. Dropping `user`
    // locally without this would leave a live cookie that the next probe
    // happily restores.
    await api.logout();
    if (!alive.current) return;
    setState((prev) => ({ ...prev, status: 'ready', user: null, expiresAt: null, busy: false }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => (prev.error === null ? prev : { ...prev, error: null }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, signup, startGuest, upgrade, logout, refresh, clearError }),
    [state, login, signup, startGuest, upgrade, logout, refresh, clearError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
