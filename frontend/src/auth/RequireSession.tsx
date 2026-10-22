/**
 * Route guard for everything behind `/app`.
 *
 * THE BUG THIS IS WRITTEN TO AVOID
 * --------------------------------
 * The session lives in an HttpOnly cookie, so on a fresh page load the app
 * does not yet know who the visitor is — it has to ask the server. A guard
 * that treats "don't know yet" as "signed out" redirects every signed-in user
 * to the sign-in page on every refresh, and then back again once the probe
 * lands. So `status === 'loading'` renders a spinner and decides nothing.
 *
 * A LOCAL-ONLY BUILD IS NOT LOCKED OUT
 * ------------------------------------
 * With `VITE_API_BASE_URL` unset there is no session to have and no sign-in
 * that could succeed, so `status === 'disabled'` passes straight through. That
 * is the deployment that shipped until now and it must keep working.
 *
 * A GUEST COUNTS AS SIGNED IN
 * ---------------------------
 * `useIsAuthenticated()` is true for an anonymous identity, because a guest
 * has a real server-side user whose attempts are recorded and who can upgrade
 * in place. Gating practice behind a full account would throw away the session
 * where the candidate was actually willing to start.
 *
 * THE ATTEMPTED PATH SURVIVES
 * ---------------------------
 * The redirect carries `from` in location state, so a deep link into a mock
 * test comes back to that mock test after signing in rather than dumping the
 * visitor on the dashboard.
 */

import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth, useIsAuthenticated } from './auth-context';

export default function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const authenticated = useIsAuthenticated();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="loading-container" role="status" aria-live="polite">
        <div className="loading-spinner" />
        <p>Checking your session…</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <Navigate
        to="/signin"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return <>{children}</>;
}
