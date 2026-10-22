import { BrowserRouter as Router } from 'react-router-dom';
import AppRoutes from './routes/AppRoutes';
import { UserProvider } from './context/UserContext';
import { AuthProvider } from './auth/AuthContext';
import './App.css';

/**
 * `AuthProvider` sits inside the Router because the sign-in flow navigates,
 * and outside the routes because the guard on `/app` reads it.
 *
 * It does NOT replace `UserProvider`, which holds only a locally-stored
 * display name used for the dashboard greeting. The two answer different
 * questions — "what shall we call you" versus "who are you to the server" —
 * and the local one still works in a build with no backend configured. The
 * server's `displayName` wins where both exist; see AppShell.
 */
function App() {
  return (
    <UserProvider>
      <Router>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </Router>
    </UserProvider>
  );
}

export default App;
