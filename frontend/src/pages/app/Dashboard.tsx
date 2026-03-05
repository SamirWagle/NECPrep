import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { bookChapters, getOverallStats, getProgress, getQuizHistory } from '../../services/localData';

function StatCard({ icon, value, label, color }: { icon: React.ReactNode; value: string | number; label: string; color: string }) {
  return (
    <div className="dashboard-stat-card">
      <div className="stat-icon" style={{ backgroundColor: `${color}20`, color }}>{icon}</div>
      <div className="stat-content">
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
      </div>
    </div>
  );
}

function QuickActionCard({ to, icon, title, description, color }: { to: string; icon: React.ReactNode; title: string; description: string; color: string }) {
  return (
    <Link to={to} className="quick-action-card" style={{ borderColor: `${color}40` }}>
      <div className="action-icon" style={{ backgroundColor: `${color}15`, color }}>{icon}</div>
      <div className="action-content"><h3>{title}</h3><p>{description}</p></div>
      <svg className="action-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
    </Link>
  );
}

export default function Dashboard() {
  const { name } = useUser();
  const firstName = (name || 'Student').split(' ')[0];
  const [stats, setStats] = useState({ attempted: 0, correct: 0, totalAvailable: 0 });
  const [recentHistory, setRecentHistory] = useState<{ topicId: string; topicName: string; score: number; total: number; date: string }[]>([]);
  const progress = getProgress();
  const topicsStarted = Object.keys(progress).length;

  useEffect(() => {
    setStats(getOverallStats());
    setRecentHistory(getQuizHistory().slice(0, 5));
  }, []);

  const accuracy = stats.attempted > 0 ? Math.round((stats.correct / stats.attempted) * 100) : 0;

  return (
    <div className="dashboard-page">
      <section className="dashboard-welcome">
        <div className="welcome-text">
          <h1>Welcome back, {firstName}! ??</h1>
          <p>Continue your engineering license exam preparation</p>
        </div>
        <div className="welcome-date">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        </div>
      </section>

      <section className="dashboard-stats">
        <StatCard icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>} value={stats.attempted} label="Questions Attempted" color="#6366f1" />
        <StatCard icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>} value={`${accuracy}%`} label="Accuracy Rate" color="#22c55e" />
        <StatCard icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>} value={topicsStarted} label="Topics Started" color="#f59e0b" />
        <StatCard icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/></svg>} value={stats.totalAvailable} label="Total Questions" color="#ec4899" />
      </section>

      <section className="dashboard-quick-actions">
        <h2>Quick Actions</h2>
        <div className="actions-grid">
          <QuickActionCard to="/app/practice" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>} title="Practice Questions" description={`${stats.totalAvailable.toLocaleString()}+ questions across 10 subjects`} color="#06b6d4" />
          <QuickActionCard to="/app/study" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>} title="Study Topics" description="Browse all subjects and study materials" color="#6366f1" />
          <QuickActionCard to="/app/mock-tests" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>} title="Mock Tests" description="Simulate the real exam experience" color="#f59e0b" />
          <QuickActionCard to="/app/flashcards" icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/></svg>} title="Flashcards" description="Quick revision with flashcards" color="#8b5cf6" />
        </div>
      </section>

      <section className="dashboard-progress">
        <div className="section-header">
          <h2>Topics Overview</h2>
          <Link to="/app/progress" className="view-all-link">View all</Link>
        </div>
        <div className="progress-grid">
          {bookChapters.slice(0, 6).map((topic) => {
            const tp = progress[topic.id];
            const attempted = tp?.attempted.length ?? 0;
            const pct = topic.questionCount > 0 ? Math.round((attempted / topic.questionCount) * 100) : 0;
            return (
              <Link to={`/app/practice/chapter/${topic.id}`} key={topic.id} className="progress-card">
                <div className="progress-card-header">
                  <span className="topic-name">{topic.shortName}</span>
                  <span className="topic-questions">{topic.questionCount} q</span>
                </div>
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" style={{ width: `${pct}%`, backgroundColor: topic.color }} />
                </div>
                <span className="progress-percent">{pct}% done</span>
              </Link>
            );
          })}
        </div>
      </section>

      {recentHistory.length > 0 && (
        <section className="dashboard-activity">
          <h2>Recent Quizzes</h2>
          <div className="activity-list">
            {recentHistory.map((item, i) => (
              <div key={i} className="activity-item">
                <div className="activity-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                  </svg>
                </div>
                <div className="activity-content">
                  <span className="activity-title">{item.topicName}</span>
                  <span className="activity-detail">{item.score}/{item.total} correct � {Math.round((item.score / item.total) * 100)}%</span>
                </div>
                <span className="activity-time">{new Date(item.date).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
