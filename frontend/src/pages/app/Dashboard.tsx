import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { topics, totalQuestions } from '../../data/topics';

// Skeleton loader component
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

// Stat card component
function StatCard({ 
  icon, 
  value, 
  label, 
  color 
}: { 
  icon: React.ReactNode; 
  value: string | number; 
  label: string;
  color: string;
}) {
  return (
    <div className="dashboard-stat-card">
      <div className="stat-icon" style={{ backgroundColor: `${color}20`, color }}>
        {icon}
      </div>
      <div className="stat-content">
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
      </div>
    </div>
  );
}

// Quick action card component
function QuickActionCard({
  to,
  icon,
  title,
  description,
  color
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
}) {
  return (
    <Link to={to} className="quick-action-card" style={{ borderColor: `${color}40` }}>
      <div className="action-icon" style={{ backgroundColor: `${color}15`, color }}>
        {icon}
      </div>
      <div className="action-content">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <svg className="action-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </Link>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const firstName = user?.displayName?.split(' ')[0] || 'Engineer';

  // Mock stats - in a real app these would come from a database
  const stats = {
    questionsAttempted: 234,
    accuracy: 76,
    studyTime: 18,
    topicsStarted: 6
  };

  return (
    <div className="dashboard-page">
      {/* Welcome section */}
      <section className="dashboard-welcome">
        <div className="welcome-text">
          <h1>Welcome back, {firstName}</h1>
          <p>Continue your exam preparation journey</p>
        </div>
        <div className="welcome-date">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span>{new Date().toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric' 
          })}</span>
        </div>
      </section>

      {/* Stats grid */}
      <section className="dashboard-stats" aria-label="Your statistics">
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
          }
          value={stats.questionsAttempted}
          label="Questions Attempted"
          color="#6366f1"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
              <polyline points="17 6 23 6 23 12"/>
            </svg>
          }
          value={`${stats.accuracy}%`}
          label="Accuracy Rate"
          color="#22c55e"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          }
          value={`${stats.studyTime}h`}
          label="Study Time"
          color="#f59e0b"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          }
          value={stats.topicsStarted}
          label="Topics Started"
          color="#ec4899"
        />
      </section>

      {/* Quick actions */}
      <section className="dashboard-quick-actions" aria-labelledby="quick-actions-title">
        <h2 id="quick-actions-title">Quick Actions</h2>
        <div className="actions-grid">
          <QuickActionCard
            to="/app/practice"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            }
            title="Practice Questions"
            description={`Test yourself with ${totalQuestions.toLocaleString()}+ questions`}
            color="#06b6d4"
          />
          <QuickActionCard
            to="/app/study"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            }
            title="Study Materials"
            description="Review concepts and learn new topics"
            color="#6366f1"
          />
          <QuickActionCard
            to="/app/practice/mock-tests"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            }
            title="Mock Tests"
            description="Simulate the real exam experience"
            color="#f59e0b"
          />
          <QuickActionCard
            to="/app/flashcards"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M10 4v4"/>
                <path d="M2 8h20"/>
                <path d="M6 4v4"/>
              </svg>
            }
            title="Flashcards"
            description="Quick revision with flashcards"
            color="#8b5cf6"
          />
        </div>
      </section>

      {/* Progress overview */}
      <section className="dashboard-progress" aria-labelledby="progress-title">
        <div className="section-header">
          <h2 id="progress-title">Progress by Topic</h2>
          <Link to="/app/progress" className="view-all-link">View all</Link>
        </div>
        <div className="progress-grid">
          {topics.slice(0, 4).map((topic) => {
            // Mock progress - in real app this would come from user data
            const progress = Math.floor(Math.random() * 60) + 10;
            return (
              <Link 
                to={`/app/practice/topic/${topic.id}`} 
                key={topic.id}
                className="progress-card"
              >
                <div className="progress-card-header">
                  <span className="topic-name">{topic.shortName}</span>
                  <span className="topic-questions">{topic.questionCount} questions</span>
                </div>
                <div className="progress-bar-container">
                  <div 
                    className="progress-bar-fill" 
                    style={{ 
                      width: `${progress}%`,
                      backgroundColor: topic.color 
                    }}
                  />
                </div>
                <span className="progress-percent">{progress}% complete</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Recent activity */}
      <section className="dashboard-activity" aria-labelledby="activity-title">
        <h2 id="activity-title">Recent Activity</h2>
        <div className="activity-list">
          <div className="activity-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
            <p>No recent activity</p>
            <span>Start practicing to see your activity here</span>
          </div>
        </div>
      </section>
    </div>
  );
}
