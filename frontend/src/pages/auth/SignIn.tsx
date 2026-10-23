/**
 * Sign in, sign up, or start as a guest — one page, three doors.
 *
 * WHY THE GUEST DOOR IS FIRST
 * ---------------------------
 * The thing a visitor came to do is sit a practice paper. A sign-up wall in
 * front of that loses the people who were willing to start, and this platform
 * does not need an email address to be useful: `POST /api/auth/anonymous`
 * creates a real server-side identity whose id SURVIVES being upgraded in
 * place, so a candidate can sit a mock, then sign up, and keep that attempt.
 *
 * So the primary action is "Continue as guest", and the account form is the
 * alternative rather than the toll gate.
 *
 * WHY ONE PAGE AND NOT TWO ROUTES
 * -------------------------------
 * Sign-in and sign-up differ by one field and one endpoint. Two routes means
 * two layouts, two sets of validation and two places to fix an accessibility
 * bug. The mode is local state, the heading and the submit label follow it, and
 * `/signin` and `/signup` both land here with the right mode preselected so
 * the URLs still mean what they say.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not validate password strength beyond the length the server
 * enforces, and it does not tell a visitor whether an email is already
 * registered. The server deliberately returns the same failure for "no such
 * account" and "wrong password"; mirroring that here keeps the page from
 * becoming an account-existence oracle.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/auth-context';
import { api, isBackendConfigured } from '../../services/api';
import styles from './SignIn.module.css';

type Mode = 'signin' | 'signup';

/**
 * The Worker's signup minimum (`validation/schemas.ts`), so the first failure
 * is not a round trip.
 *
 * It is applied ONLY when creating an account. The server's LOGIN schema has
 * no minimum at all, deliberately — rejecting a short password there would
 * tell an attacker their guess was too short to be anyone's password. A
 * client-side minimum on sign-in would reintroduce exactly that signal, and
 * would also lock out any account whose password predates the current rule.
 */
const MIN_PASSWORD_LENGTH = 8;

export default function SignIn({ initialMode = 'signin' }: { initialMode?: Mode }) {
  const { user, status, busy, error, login, signup, startGuest, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Where to land after signing in. A guard sends the attempted path through,
  // so a deep link survives the detour through this page.
  const from = (location.state as { from?: string } | null)?.from ?? params.get('next') ?? '/app';

  // Switching mode must not carry a failure across: "incorrect password" under
  // a "Create account" heading reads as though the account already exists.
  useEffect(() => {
    clearError();
  }, [mode, clearError]);

  // A local-only build has no sign-in to offer, so this page is not reachable
  // in a meaningful sense. Send the visitor to the app rather than showing a
  // form whose submit button cannot work.
  if (!isBackendConfigured()) {
    return <Navigate to="/app" replace />;
  }

  // Already signed in — including as a guest. Nothing to do here.
  if (status === 'ready' && user) {
    return <Navigate to={from} replace />;
  }

  const passwordLongEnough =
    mode === 'signup' ? password.length >= MIN_PASSWORD_LENGTH : password.length > 0;
  const canSubmit = email.trim().length > 3 && passwordLongEnough && !busy;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const ok =
      mode === 'signin'
        ? await login(email.trim(), password)
        : await signup(email.trim(), password, displayName.trim() || undefined);
    if (ok) navigate(from, { replace: true });
  }

  async function onGuest() {
    if (await startGuest()) navigate(from, { replace: true });
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Link to="/" className={styles.brand}>
          NECPrep
        </Link>

        <h1 className={styles.heading}>
          {mode === 'signin' ? 'Sign in' : 'Create an account'}
        </h1>
        <p className={styles.sub}>
          Nepal Engineering Council licence preparation — Computer Engineering.
        </p>

        {/* The primary path. Deliberately above the form. */}
        <button
          type="button"
          className={styles.guest}
          onClick={() => void onGuest()}
          disabled={busy}
        >
          Continue as guest
        </button>
        <p className={styles.guestNote}>
          Start practising straight away. You can create an account later and keep
          everything you have done.
        </p>

        {/* A full-page navigation, not fetch: the OAuth flow leaves this
            origin for accounts.google.com and comes back to the Worker's
            callback, which sets the session cookie and redirects. An anchor
            says that honestly, and works with middle-click and Back.

            It is rendered unconditionally. Whether Google is configured is a
            server-side fact the client cannot read without an extra request on
            the critical path, and the route answers honestly either way: 404
            when the feature is off, 500 when it is half-configured. */}
        <a className={styles.google} href={api.googleSignInUrl(from)}>
          <svg viewBox="0 0 18 18" aria-hidden="true" className={styles.googleMark}>
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"/>
            <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.42 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"/>
          </svg>
          Continue with Google
        </a>

        <div className={styles.divider}>
          <span>or</span>
        </div>

        <form className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
          {mode === 'signup' && (
            <label className={styles.field}>
              <span className={styles.label}>Name</span>
              <input
                className={styles.input}
                type="text"
                name="name"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Optional"
              />
            </label>
          )}

          <label className={styles.field}>
            <span className={styles.label}>Email</span>
            <input
              className={styles.input}
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Password</span>
            <input
              className={styles.input}
              type="password"
              name="password"
              // The browser needs to know which it is, or it offers to save a
              // sign-in as a new password and vice versa.
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              // No `minLength` on sign-in; see MIN_PASSWORD_LENGTH.
              minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={mode === 'signup' ? 'password-hint' : undefined}
            />
          </label>
          {mode === 'signup' && (
            <p id="password-hint" className={styles.hint}>
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}

          {/* A live region, so a screen reader hears the failure without the
              focus having to move into it. */}
          <div className={styles.errorSlot} role="alert" aria-live="assertive">
            {error && <span className={styles.error}>{error.message}</span>}
          </div>

          <button type="submit" className={styles.submit} disabled={!canSubmit}>
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

          {/* Only on sign-in. Offering it while creating an account invites
              someone to reset a password they have not set yet. */}
          {mode === 'signin' && (
            <p className={styles.swap}>
              <Link to="/reset-password">Forgot your password?</Link>
            </p>
          )}
        </form>

        <p className={styles.swap}>
          {mode === 'signin' ? (
            <>
              No account?{' '}
              <button type="button" className={styles.link} onClick={() => setMode('signup')}>
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" className={styles.link} onClick={() => setMode('signin')}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
