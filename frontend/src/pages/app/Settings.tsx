import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Settings state
  const [settings, setSettings] = useState({
    emailNotifications: true,
    darkMode: true,
    soundEffects: false,
    autoAdvance: true
  });

  const handleSettingChange = (key: keyof typeof settings) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      navigate('/');
    } catch (error) {
      console.error('Logout failed:', error);
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="settings-page">
      {/* Page header */}
      <header className="page-header">
        <h1>Settings</h1>
        <p>Customize your learning experience</p>
      </header>

      {/* Account section */}
      <section className="settings-section">
        <h2>Account</h2>
        <div className="settings-card">
          <div className="account-info">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="" className="account-avatar" />
            ) : (
              <div className="account-avatar-placeholder">
                {user?.displayName?.[0] || user?.email?.[0] || 'U'}
              </div>
            )}
            <div className="account-details">
              <span className="account-name">{user?.displayName || 'User'}</span>
              <span className="account-email">{user?.email}</span>
            </div>
          </div>
          <p className="account-note">
            Signed in with Google. To change your profile photo or name, update your Google account.
          </p>
        </div>
      </section>

      {/* Preferences section */}
      <section className="settings-section">
        <h2>Preferences</h2>
        <div className="settings-list">
          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-name">Email Notifications</span>
              <span className="setting-desc">Receive progress reports and reminders</span>
            </div>
            <button 
              className={`toggle ${settings.emailNotifications ? 'on' : ''}`}
              onClick={() => handleSettingChange('emailNotifications')}
              role="switch"
              aria-checked={settings.emailNotifications}
            >
              <span className="toggle-slider" />
            </button>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-name">Dark Mode</span>
              <span className="setting-desc">Use dark theme throughout the app</span>
            </div>
            <button 
              className={`toggle ${settings.darkMode ? 'on' : ''}`}
              onClick={() => handleSettingChange('darkMode')}
              role="switch"
              aria-checked={settings.darkMode}
            >
              <span className="toggle-slider" />
            </button>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-name">Sound Effects</span>
              <span className="setting-desc">Play sounds for correct/incorrect answers</span>
            </div>
            <button 
              className={`toggle ${settings.soundEffects ? 'on' : ''}`}
              onClick={() => handleSettingChange('soundEffects')}
              role="switch"
              aria-checked={settings.soundEffects}
            >
              <span className="toggle-slider" />
            </button>
          </div>

          <div className="setting-item">
            <div className="setting-info">
              <span className="setting-name">Auto-Advance Questions</span>
              <span className="setting-desc">Automatically move to next question after answering</span>
            </div>
            <button 
              className={`toggle ${settings.autoAdvance ? 'on' : ''}`}
              onClick={() => handleSettingChange('autoAdvance')}
              role="switch"
              aria-checked={settings.autoAdvance}
            >
              <span className="toggle-slider" />
            </button>
          </div>
        </div>
      </section>

      {/* Data section */}
      <section className="settings-section">
        <h2>Data & Privacy</h2>
        <div className="settings-list">
          <button className="setting-action">
            <div className="setting-info">
              <span className="setting-name">Export Your Data</span>
              <span className="setting-desc">Download all your progress and data</span>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>

          <button className="setting-action danger">
            <div className="setting-info">
              <span className="setting-name">Reset Progress</span>
              <span className="setting-desc">Clear all your learning progress</span>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
          </button>
        </div>
      </section>

      {/* Sign out section */}
      <section className="settings-section">
        <h2>Session</h2>
        <button 
          className="logout-btn"
          onClick={handleLogout}
          disabled={isLoggingOut}
        >
          {isLoggingOut ? (
            <>
              <span className="btn-spinner" />
              Signing out...
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign out
            </>
          )}
        </button>
      </section>

      {/* App info */}
      <footer className="settings-footer">
        <p>EngLicense v1.0.0</p>
        <div className="footer-links">
          <a href="/terms">Terms of Service</a>
          <span>•</span>
          <a href="/privacy">Privacy Policy</a>
          <span>•</span>
          <a href="/support">Support</a>
        </div>
      </footer>
    </div>
  );
}
