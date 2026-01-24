import { useAuth } from '../../auth/AuthProvider';
import { getUserDisplayName, getUserAvatarUrl, getUserInitial } from '../../types/database.types';

export default function Profile() {
  const { user } = useAuth();

  const stats = {
    questionsAttempted: 234,
    accuracy: 76,
    studyTime: '18h 30m',
    streak: 5,
    rank: 'Advanced',
    memberSince: 'January 2026'
  };

  return (
    <div className="profile-page">
      {/* Page header */}
      <header className="page-header">
        <h1>Profile</h1>
        <p>Manage your account and view your achievements</p>
      </header>

      {/* Profile card */}
      <div className="profile-card">
        <div className="profile-header">
          {getUserAvatarUrl(user) ? (
            <img src={getUserAvatarUrl(user)!} alt="" className="profile-avatar" />
          ) : (
            <div className="profile-avatar-placeholder">
              {getUserInitial(user)}
            </div>
          )}
          <div className="profile-info">
            <h2>{getUserDisplayName(user)}</h2>
            <p>{user?.email}</p>
            <span className="member-since">Member since {stats.memberSince}</span>
          </div>
        </div>

        <div className="profile-badges">
          <div className="badge rank">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="7"/>
              <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
            </svg>
            <span>{stats.rank}</span>
          </div>
          <div className="badge streak">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
            </svg>
            <span>{stats.streak} day streak</span>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <section className="profile-stats">
        <h3>Your Statistics</h3>
        <div className="stats-grid">
          <div className="stat-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <div className="stat-content">
              <span className="value">{stats.questionsAttempted}</span>
              <span className="label">Questions Attempted</span>
            </div>
          </div>

          <div className="stat-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <div className="stat-content">
              <span className="value">{stats.accuracy}%</span>
              <span className="label">Accuracy Rate</span>
            </div>
          </div>

          <div className="stat-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <div className="stat-content">
              <span className="value">{stats.studyTime}</span>
              <span className="label">Total Study Time</span>
            </div>
          </div>

          <div className="stat-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="20" x2="12" y2="10"/>
              <line x1="18" y1="20" x2="18" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="16"/>
            </svg>
            <div className="stat-content">
              <span className="value">Top 15%</span>
              <span className="label">Leaderboard</span>
            </div>
          </div>
        </div>
      </section>

      {/* Achievements */}
      <section className="achievements-section">
        <h3>Achievements</h3>
        <div className="achievements-grid">
          <div className="achievement unlocked">
            <div className="achievement-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </div>
            <span className="achievement-name">First Steps</span>
            <span className="achievement-desc">Complete your first question</span>
          </div>

          <div className="achievement unlocked">
            <div className="achievement-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
              </svg>
            </div>
            <span className="achievement-name">On Fire</span>
            <span className="achievement-desc">5 day streak</span>
          </div>

          <div className="achievement locked">
            <div className="achievement-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="8" r="7"/>
                <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
              </svg>
            </div>
            <span className="achievement-name">Master</span>
            <span className="achievement-desc">Complete 1000 questions</span>
          </div>

          <div className="achievement locked">
            <div className="achievement-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <span className="achievement-name">Perfectionist</span>
            <span className="achievement-desc">Score 100% in a mock test</span>
          </div>
        </div>
      </section>
    </div>
  );
}
