import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

interface RequireAuthProps {
  children: React.ReactNode;
}

/**
 * RequireAuth component - Protects routes that require authentication
 * Shows a loading spinner while auth state is being determined
 * Redirects to login page if user is not authenticated
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Show full-screen loading spinner while auth state is being determined
  if (loading) {
    return (
      <div className="auth-loading-screen" role="status" aria-label="Loading authentication">
        <div className="auth-loading-content">
          <div className="auth-loading-spinner" aria-hidden="true">
            <svg viewBox="0 0 50 50" className="spinner-svg">
              <circle
                cx="25"
                cy="25"
                r="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray="31.4 31.4"
              />
            </svg>
          </div>
          <p className="auth-loading-text">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated, preserving the intended destination
  if (!user) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
