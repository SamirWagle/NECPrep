import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/user-context';
import { clearAllData, exportAllData } from '../../services/localData';

const REPO_URL = 'https://github.com/SamirWagle/EngineeringLisenseProject';

export default function Settings() {
  const { name, setName } = useUser();
  const navigate = useNavigate();

  const handleLeave = () => {
    // Clearing storage alone left the context holding the stale name.
    setName('');
    navigate('/');
  };

  const handleResetProgress = () => {
    if (!window.confirm('This will clear all your progress, bookmarks and any in-progress mock test. Are you sure?')) return;
    clearAllData();
    // The dashboard reads storage on render, so navigating there shows the
    // cleared state immediately instead of leaving stale figures on screen.
    navigate('/app');
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(exportAllData(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `necprep-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
            <div className="account-avatar-placeholder">
                {name ? name[0].toUpperCase() : 'U'}
              </div>
            <div className="account-details">
              <span className="account-name">{name || 'User'}</span>
              <span className="account-email">Local session</span>
            </div>
          </div>
          <p className="account-note">
            Your progress is stored locally in this browser.
          </p>
        </div>
      </section>

      {/* Data section */}
      <section className="settings-section">
        <h2>Data & Privacy</h2>
        <div className="settings-list">
          <button className="setting-action" onClick={handleExport}>
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

          <button className="setting-action danger" onClick={handleResetProgress}>
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
          onClick={handleLeave}
        >
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Leave
            </>
        </button>
      </section>

      {/* App info */}
      <footer className="settings-footer">
        <p>NECPrep v1.0.0</p>
        <p className="footer-privacy">
          NECPrep stores everything in this browser. No account, no server, no tracking of your answers.
        </p>
        <div className="footer-links">
          <a href={REPO_URL} target="_blank" rel="noreferrer">Source</a>
          <span>•</span>
          <a href={`${REPO_URL}/issues/new`} target="_blank" rel="noreferrer">Report an issue</a>
          <span>•</span>
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT License</a>
        </div>
      </footer>
    </div>
  );
}
