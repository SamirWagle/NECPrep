/**
 * The two halves of a password reset: ask for a link, and redeem one.
 *
 * One component, because which half runs is decided entirely by whether the
 * URL carries a `?token=`. Two routes would mean two layouts and two places to
 * fix the same accessibility bug, for a difference of one field.
 *
 * WHAT IT MUST NOT DO
 * -------------------
 * The request half MUST NOT tell the visitor whether the address has an
 * account. The server deliberately answers identically either way — an
 * endpoint that says "no such account" is an address checker, and for an exam
 * platform the list it returns is a list of named candidates. So this screen
 * reports the same sentence for every outcome, including a failure it was
 * given no detail about.
 *
 * The one exception is a server that says the feature is off. That is not a
 * fact about the address, it is a fact about the deployment, and leaving a
 * student waiting for an email nobody will send is the worse outcome.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, isBackendConfigured } from '../../services/api';
import type { ApiError } from '../../services/api';
import styles from './SignIn.module.css';

/** Matches the Worker's signup floor. This sets a password rather than checking one. */
const MIN_PASSWORD_LENGTH = 8;

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    setError(null);
  }, [token]);

  if (!isBackendConfigured()) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.heading}>Password reset</h1>
          <p className={styles.sub}>
            This build runs without a backend, so there are no accounts and nothing to
            reset.
          </p>
          <Link to="/app" className={styles.guest}>
            Continue to NECPrep
          </Link>
        </div>
      </main>
    );
  }

  async function onRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || email.trim().length < 4) return;
    setBusy(true);
    setError(null);

    const result = await api.requestPasswordReset(email.trim());
    setBusy(false);

    // NOT_FOUND here means the deployment has no email provider — the only
    // failure worth showing, because it is about the server rather than the
    // address. Everything else is reported as success, deliberately.
    if (!result.ok && result.error.code === 'NOT_FOUND') {
      setError(result.error);
      return;
    }
    setSent(true);
  }

  async function onReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token || password.length < MIN_PASSWORD_LENGTH) return;
    setBusy(true);
    setError(null);

    const result = await api.resetPassword({ token, password });
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    // The server signed us in on this device and revoked every other session.
    navigate('/app', { replace: true });
  }

  // ── Redeem ───────────────────────────────────────────────────────────────
  if (token) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <Link to="/" className={styles.brand}>
            NECPrep
          </Link>
          <h1 className={styles.heading}>Choose a new password</h1>

          <form className={styles.form} onSubmit={(e) => void onReset(e)} noValidate>
            <label className={styles.field}>
              <span className={styles.label}>New password</span>
              <input
                className={styles.input}
                type="password"
                name="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby="reset-hint"
              />
            </label>
            <p id="reset-hint" className={styles.hint}>
              At least {MIN_PASSWORD_LENGTH} characters. Setting it signs you out
              everywhere else.
            </p>

            <div className={styles.errorSlot} role="alert" aria-live="assertive">
              {error && <span className={styles.error}>{error.message}</span>}
            </div>

            <button
              type="submit"
              className={styles.guest}
              disabled={busy || password.length < MIN_PASSWORD_LENGTH}
            >
              {busy ? 'Setting your password…' : 'Set password and sign in'}
            </button>
          </form>

          <p className={styles.swap}>
            <Link to="/reset-password">Request a new link</Link>
            {' · '}
            <Link to="/signin">Back to sign in</Link>
          </p>
        </div>
      </main>
    );
  }

  // ── Request ──────────────────────────────────────────────────────────────
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Link to="/" className={styles.brand}>
          NECPrep
        </Link>
        <h1 className={styles.heading}>Reset your password</h1>

        {sent ? (
          // Identical whether or not the address has an account. The wording
          // is conditional on purpose — "we've sent you an email" would be a
          // statement about the address.
          <>
            <p className={styles.sub} role="status">
              If that address has an account, a reset link is on its way. The link works
              once and expires in an hour.
            </p>
            <p className={styles.guestNote}>
              Nothing arrived? Check spam, then try again — and remember that an account
              created with Google has no password to reset.
            </p>
            <Link to="/signin" className={styles.guest}>
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <p className={styles.sub}>
              Enter the email you signed up with and we will send you a link.
            </p>

            <form className={styles.form} onSubmit={(e) => void onRequest(e)} noValidate>
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

              <div className={styles.errorSlot} role="alert" aria-live="assertive">
                {error && <span className={styles.error}>{error.message}</span>}
              </div>

              <button
                type="submit"
                className={styles.guest}
                disabled={busy || email.trim().length < 4}
              >
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <p className={styles.swap}>
              <Link to="/signin">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
