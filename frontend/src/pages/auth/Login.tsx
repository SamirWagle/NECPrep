import { Link, useLocation } from 'react-router-dom';

export default function Login() {
  const location = useLocation();
  const name = ((location.state as { name?: string })?.name ?? '').trim();
  const greeting = name ? `Nice to meet you, ${name}!` : 'Welcome back'

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
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

          <div className="login-header">
            <h1>{greeting}</h1>
            <p>
              We are polishing the login experience. For now the landing page is fully functional and ready to showcase.
            </p>
          </div>

          <p className="login-description">
            The authentication flow will be live soon. Until then you can safely browse the material samples and return later.
          </p>

          <div className="login-actions">
            <Link to="/" className="btn-secondary">
              Return to home
            </Link>
          </div>

          <Link to="/" className="login-back-link">
            <span>Back to the landing page</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
