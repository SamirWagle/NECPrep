import { BrowserRouter as Router } from 'react-router-dom';
import AppRoutes from './routes/AppRoutes';
import { UserProvider } from './context/UserContext';
import { AuthProvider } from './auth/AuthContext';
import UpdatePrompt from './components/UpdatePrompt';
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
          {/* Outside the routes: a waiting service worker is a property of the
              app, not of any page, and the offer must survive navigation.
              Without this the PWA caches a build and never hands over - every
              deploy stays invisible to anyone who has opened the site before.
              See components/UpdatePrompt.tsx. */}
          <UpdatePrompt />
        </AuthProvider>
      </Router>
    </UserProvider>
  );
}

export default App;
