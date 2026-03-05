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
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="login-logo-icon" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#4F46E5"/>
              <path d="M16 9 C13 9 10 10 8 11.5 L8 23 C10 21.5 13 21 16 21 C19 21 22 21.5 24 23 L24 11.5 C22 10 19 9 16 9Z" fill="none" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
              <line x1="16" y1="9" x2="16" y2="21" stroke="white" strokeWidth="1.5"/>
              <circle cx="24" cy="24" r="5" fill="#22C55E"/>
              <polyline points="21.5,24 23.2,25.8 26.5,22.5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="login-logo-text">NECPrep</span>
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
