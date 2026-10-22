import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { SessionUser } from '../../services/api';

/**
 * The auth layer, which is the gate every other endpoint goes through.
 *
 * The cases below are the ones where getting it wrong is invisible in manual
 * testing but wrong for real users:
 *
 *   * The session is an HttpOnly cookie, so on a fresh load the app has to ASK
 *     the server who this is. A guard that reads "don't know yet" as "signed
 *     out" bounces every signed-in user to the sign-in page on refresh.
 *   * A build with no `VITE_API_BASE_URL` has no session to have. It must not
 *     show a login wall it cannot satisfy.
 *   * Signing out has to reach the server. Clearing local state leaves a live
 *     cookie that the next page load turns back into a signed-in user.
 *   * A guest is a real identity, not a logged-out visitor.
 */

// --- Mock the API client ----------------------------------------------------
//
// `isBackendConfigured()` reads a build-time constant, so the only way to
// exercise both the configured and the local-only paths in one suite is to
// control the module. Everything else is the real code.

const mockApi = {
  getSession: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  startAnonymousSession: vi.fn(),
  upgradeAnonymous: vi.fn(),
  logout: vi.fn(),
};
let backendConfigured = true;

vi.mock('../../services/api', () => ({
  api: mockApi,
  isBackendConfigured: () => backendConfigured,
  apiBaseUrl: () => (backendConfigured ? 'https://api.test' : ''),
  newIdempotencyKey: () => 'test-key',
}));

// Imported after the mock is registered.
const { AuthProvider } = await import('../AuthContext');
const { useAuth } = await import('../auth-context');
const RequireSession = (await import('../RequireSession')).default;
const SignIn = (await import('../../pages/auth/SignIn')).default;

const GUEST: SessionUser = {
  id: 'usr_guest',
  email: null,
  displayName: null,
  role: 'student' as const,
  isAnonymous: true,
  hasPassword: false,
  createdAt: 1,
};

const MEMBER: SessionUser = { ...GUEST, id: 'usr_1', email: 'a@b.test', displayName: 'Asha', isAnonymous: false, hasPassword: true };

const sessionOk = (user: SessionUser | null) => ({
  ok: true as const,
  data: { user, sessionExpiresAt: user ? 2_000 : null, serverNow: 1_000 },
});

const failure = (code: string, message: string) => ({
  ok: false as const,
  error: { code, message },
});

/** Reads the context out so assertions can be made on it directly. */
function Probe() {
  const { status, user, busy, error } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user ? user.id : 'none'}</span>
      <span data-testid="busy">{String(busy)}</span>
      <span data-testid="error">{error ? error.code : 'none'}</span>
    </div>
  );
}

function wrap(children: ReactNode, entries = ['/']) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <AuthProvider>{children}</AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  backendConfigured = true;
  for (const fn of Object.values(mockApi)) fn.mockReset();
  mockApi.getSession.mockResolvedValue(sessionOk(null));
  mockApi.logout.mockResolvedValue({ ok: true, data: { ok: true } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AuthProvider', () => {
  it('probes the server once on mount and reports the answer', async () => {
    mockApi.getSession.mockResolvedValue(sessionOk(MEMBER));
    wrap(<Probe />);

    // Starts as 'loading' — the cookie is HttpOnly, so the answer can only
    // come from the server.
    expect(screen.getByTestId('status')).toHaveTextContent('loading');

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('user')).toHaveTextContent('usr_1');
    expect(mockApi.getSession).toHaveBeenCalledTimes(1);
  });

  it('is disabled, not signed-out, when no backend is configured', async () => {
    backendConfigured = false;
    wrap(<Probe />);

    expect(screen.getByTestId('status')).toHaveTextContent('disabled');
    // And crucially it never asks: a local-only build makes no requests.
    await waitFor(() => expect(mockApi.getSession).not.toHaveBeenCalled());
  });

  it('treats a failed probe as signed-out, not as a sign-in error', async () => {
    mockApi.getSession.mockResolvedValue(failure('NETWORK_UNAVAILABLE', 'Could not reach the server.'));
    wrap(<Probe />);

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    // Showing "could not sign in" to somebody who never tried is wrong.
    expect(screen.getByTestId('error')).toHaveTextContent('none');
  });

  it('surfaces a real sign-in failure as an error', async () => {
    mockApi.login.mockResolvedValue(failure('INVALID_CREDENTIALS', 'Email or password is incorrect.'));

    function LoginButton() {
      const { login } = useAuth();
      return (
        <button type="button" onClick={() => void login('a@b.test', 'password123')}>
          go
        </button>
      );
    }

    const user = userEvent.setup();
    wrap(
      <>
        <Probe />
        <LoginButton />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));

    await user.click(screen.getByRole('button', { name: 'go' }));
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('INVALID_CREDENTIALS'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    // The spinner has to stop even on failure.
    expect(screen.getByTestId('busy')).toHaveTextContent('false');
  });

  it('asks the server to revoke the session on sign-out', async () => {
    mockApi.getSession.mockResolvedValue(sessionOk(MEMBER));

    function LogoutButton() {
      const { logout } = useAuth();
      return (
        <button type="button" onClick={() => void logout()}>
          out
        </button>
      );
    }

    const user = userEvent.setup();
    wrap(
      <>
        <Probe />
        <LogoutButton />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('usr_1'));

    await user.click(screen.getByRole('button', { name: 'out' }));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'));
    // The cookie is HttpOnly: without this call the next probe signs them
    // straight back in.
    expect(mockApi.logout).toHaveBeenCalledTimes(1);
  });
});

describe('RequireSession', () => {
  const guarded = (
    <Routes>
      <Route
        path="/app"
        element={
          <RequireSession>
            <h1>Protected</h1>
          </RequireSession>
        }
      />
      <Route path="/signin" element={<h1>Sign in page</h1>} />
    </Routes>
  );

  it('waits for the probe instead of redirecting a signed-in user', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    mockApi.getSession.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    wrap(guarded, ['/app']);

    // Mid-probe: neither the protected page nor a redirect. This is the bug
    // the three-state status exists to prevent — a refresh must not bounce a
    // signed-in user to the sign-in page.
    expect(screen.getByText(/Checking your session/i)).toBeInTheDocument();
    expect(screen.queryByText('Sign in page')).not.toBeInTheDocument();

    resolve?.(sessionOk(MEMBER));
    await waitFor(() => expect(screen.getByText('Protected')).toBeInTheDocument());
  });

  it('redirects to sign-in once the probe says nobody is signed in', async () => {
    mockApi.getSession.mockResolvedValue(sessionOk(null));
    wrap(guarded, ['/app']);
    await waitFor(() => expect(screen.getByText('Sign in page')).toBeInTheDocument());
  });

  it('lets a guest through, because a guest is a real identity', async () => {
    mockApi.getSession.mockResolvedValue(sessionOk(GUEST));
    wrap(guarded, ['/app']);
    await waitFor(() => expect(screen.getByText('Protected')).toBeInTheDocument());
  });

  it('lets everyone through when no backend is configured', async () => {
    backendConfigured = false;
    wrap(guarded, ['/app']);
    // No wall in a build that has no sign-in to offer.
    expect(screen.getByText('Protected')).toBeInTheDocument();
    expect(mockApi.getSession).not.toHaveBeenCalled();
  });
});

describe('SignIn', () => {
  const page = (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignIn initialMode="signup" />} />
      <Route path="/app" element={<h1>App</h1>} />
    </Routes>
  );

  it('offers the guest path as the primary action', async () => {
    mockApi.startAnonymousSession.mockResolvedValue(sessionOk(GUEST));
    const user = userEvent.setup();
    wrap(page, ['/signin']);
    await waitFor(() => expect(screen.getByRole('button', { name: /continue as guest/i })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: /continue as guest/i }));
    await waitFor(() => expect(screen.getByText('App')).toBeInTheDocument());
    expect(mockApi.startAnonymousSession).toHaveBeenCalledTimes(1);
  });

  it('enforces the password minimum when creating an account', async () => {
    const user = userEvent.setup();
    wrap(page, ['/signup']);
    await waitFor(() => expect(screen.getByRole('heading', { name: /create an account/i })).toBeInTheDocument());

    await user.type(screen.getByLabelText(/email/i), 'a@b.test');
    await user.type(screen.getByLabelText(/password/i), 'short');
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/password/i), 'enough');
    expect(screen.getByRole('button', { name: /create account/i })).toBeEnabled();
  });

  it('does NOT impose a length minimum on sign-in', async () => {
    // The server's login schema has no minimum on purpose: rejecting a short
    // password would tell an attacker their guess was too short to be
    // anyone's. A client-side minimum would reintroduce that signal and lock
    // out any account whose password predates the current rule.
    const user = userEvent.setup();
    wrap(page, ['/signin']);
    await waitFor(() => expect(screen.getByRole('heading', { name: /^sign in$/i })).toBeInTheDocument());

    await user.type(screen.getByLabelText(/email/i), 'a@b.test');
    await user.type(screen.getByLabelText(/password/i), 'abc');
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled();
  });

  it('clears a stale failure when switching mode', async () => {
    mockApi.login.mockResolvedValue(failure('INVALID_CREDENTIALS', 'Email or password is incorrect.'));
    const user = userEvent.setup();
    wrap(page, ['/signin']);
    await waitFor(() => expect(screen.getByRole('heading', { name: /^sign in$/i })).toBeInTheDocument());

    await user.type(screen.getByLabelText(/email/i), 'a@b.test');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/incorrect/i));

    // "Email or password is incorrect" under a "Create an account" heading
    // reads as though the account already exists.
    await user.click(screen.getByRole('button', { name: /create one/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeEmptyDOMElement());
  });

  it('sends an already-signed-in visitor straight on', async () => {
    mockApi.getSession.mockResolvedValue(sessionOk(MEMBER));
    wrap(page, ['/signin']);
    await waitFor(() => expect(screen.getByText('App')).toBeInTheDocument());
  });
});
