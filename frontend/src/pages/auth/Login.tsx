import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';

export default function Login() {
  const { user, loading, error, signInWithGoogle, signInWithGoogleRedirect, clearError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showRedirectOption, setShowRedirectOption] = useState(false);

  // Get the intended destination from state, default to /app
  const from = (location.state as { from?: Location })?.from?.pathname || '/app';

  // Redirect if already signed in
  useEffect(() => {
    if (user && !loading) {
      navigate(from, { replace: true });
    }
  }, [user, loading, navigate, from]);

  // Clear error when component unmounts
  useEffect(() => {
    return () => clearError();
  }, [clearError]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    clearError();
    
    try {
      await signInWithGoogle();
    } catch {
      // If popup was blocked, show redirect option
      setShowRedirectOption(true);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGoogleRedirect = async () => {
    setIsSigningIn(true);
    clearError();
    await signInWithGoogleRedirect();
  };

  // Show loading while checking auth state
  if (loading) {
    return (
      <div className="login-page">
        <div className="login-loading">
          <div className="login-spinner" aria-label="Loading" />
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          {/* Logo */}
          <Link to="/" className="login-logo" aria-label="Go to homepage">
            <svg 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
              className="login-logo-icon"
              aria-hidden="true"
            >
              <path d="M12 2a9 9 0 0 1 9 9c0 3.074-1.676 5.59-3.442 7.395a20.194 20.194 0 0 1-2.398 2.064l-.353.256a1.5 1.5 0 0 1-1.614 0l-.353-.256a20.194 20.194 0 0 1-2.398-2.064C8.676 16.59 7 14.074 7 11a9 9 0 0 1 5-8.062"/>
              <circle cx="12" cy="11" r="3"/>
            </svg>
            <span className="login-logo-text">EngLicense</span>
          </Link>

          {/* Welcome Text */}
          <div className="login-header">
            <h1>Welcome back</h1>
            <p>Sign in to continue your exam preparation</p>
          </div>

          {/* Error Banner */}
          {error && (
            <div 
              className={`login-error login-error--${error.type}`}
              role="alert"
              aria-live="polite"
            >
              <svg 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
                className="login-error-icon"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{error.message}</span>
              <button 
                onClick={clearError} 
                className="login-error-dismiss"
                aria-label="Dismiss error"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          )}

          {/* Google Sign In Button */}
          <button
            className="login-btn-google"
            onClick={handleGoogleSignIn}
            disabled={isSigningIn}
            aria-busy={isSigningIn}
          >
            {isSigningIn ? (
              <div className="login-btn-spinner" aria-hidden="true" />
            ) : (
              <svg className="login-google-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
            )}
            <span>{isSigningIn ? 'Signing in...' : 'Continue with Google'}</span>
          </button>

          {/* Redirect fallback option */}
          {showRedirectOption && (
            <button
              className="login-btn-redirect"
              onClick={handleGoogleRedirect}
              disabled={isSigningIn}
            >
              Try alternative sign-in method
            </button>
          )}

          {/* Security Note */}
          <div className="login-security-note">
            <svg 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
              className="login-security-icon"
              aria-hidden="true"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span>Secure authentication powered by Google</span>
          </div>

          {/* Legal Links */}
          <div className="login-legal">
            <p>
              By continuing, you agree to our{' '}
              <a href="/terms" className="login-legal-link">Terms of Service</a>
              {' '}and{' '}
              <a href="/privacy" className="login-legal-link">Privacy Policy</a>
            </p>
          </div>

          {/* Back Link */}
          <Link to="/" className="login-back-link">
            <svg 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
              aria-hidden="true"
            >
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
            <span>Back to home</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
