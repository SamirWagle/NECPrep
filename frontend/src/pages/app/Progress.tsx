import { useState, useEffect } from 'react';
import { getTopics, getUserProgress } from '../../services/api';
import type { Topic, UserTopicStats, UserOverallStats } from '../../types/database.types';

export default function Progress() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [overallStats, setOverallStats] = useState<UserOverallStats | null>(null);
  const [topicStats, setTopicStats] = useState<UserTopicStats[]>([]);
  const [_loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [topicsData, progressData] = await Promise.all([
          getTopics(),
          getUserProgress().catch(() => ({ overall: null, topics: [] }))
        ]);
        
        setTopics(topicsData);
        setOverallStats(progressData.overall);
        setTopicStats(progressData.topics);
      } catch (err) {
        console.error('Error loading progress:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Calculate totals
  const totalQuestions = topics.reduce((sum, t) => sum + (t.question_count || 0), 0);
  const questionsAttempted = overallStats?.total_questions_attempted || 0;
  const correctAnswers = overallStats?.total_correct_answers || 0;
  const studyTimeHours = Math.round((overallStats?.total_study_time_seconds || 0) / 3600);
  
  const accuracy = questionsAttempted > 0 ? Math.round((correctAnswers / questionsAttempted) * 100) : 0;
  const completionPercent = totalQuestions > 0 ? Math.round((questionsAttempted / totalQuestions) * 100) : 0;

  // Create map for topic stats lookup
  const topicStatsMap = new Map(topicStats.map(ts => [ts.topic_id, ts]));

  return (
    <div className="progress-page">
      {/* Page header */}
      <header className="page-header">
        <h1>Your Progress</h1>
        <p>Track your learning journey and improvement over time</p>
      </header>

      {/* Overview stats */}
      <section className="overview-stats">
        <div className="stat-card primary">
          <div className="stat-content">
            <span className="stat-value">{completionPercent}%</span>
            <span className="stat-label">Overall Progress</span>
          </div>
          <div className="stat-visual">
            <svg viewBox="0 0 36 36" className="progress-ring">
              <path
                className="ring-bg"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="ring-progress"
                strokeDasharray={`${completionPercent}, 100`}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
          </div>
        </div>

        <div className="stat-card">
          <svg className="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          <div className="stat-content">
            <span className="stat-value">{questionsAttempted}</span>
            <span className="stat-label">Questions Attempted</span>
          </div>
        </div>

        <div className="stat-card">
          <svg className="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <div className="stat-content">
            <span className="stat-value">{accuracy}%</span>
            <span className="stat-label">Accuracy Rate</span>
          </div>
        </div>

        <div className="stat-card">
          <svg className="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <div className="stat-content">
            <span className="stat-value">{studyTimeHours}h</span>
            <span className="stat-label">Study Time</span>
          </div>
        </div>

        <div className="stat-card">
          <svg className="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
          </svg>
          <div className="stat-content">
            <span className="stat-value">{topicStats.length}</span>
            <span className="stat-label">Topics Started</span>
          </div>
        </div>
      </section>

      {/* Topic-wise progress */}
      <section className="topic-progress">
        <h2>Progress by Topic</h2>
        <div className="topics-list">
          {topics.map((topic) => {
            const stats = topicStatsMap.get(topic.id);
            const progress = Math.round(stats?.completion_percentage || 0);
            const attempted = stats?.total_questions_attempted || 0;
            
            return (
              <div key={topic.id} className="topic-progress-card">
                <div className="topic-header">
                  <div className="topic-info">
                    <h3>{topic.name}</h3>
                    <span className="topic-stats">
                      {attempted} / {topic.question_count} questions
                    </span>
                  </div>
                  <span className="progress-percent" style={{ color: topic.color || '#6366f1' }}>
                    {progress}%
                  </span>
                </div>
                <div className="progress-bar-container">
                  <div 
                    className="progress-bar-fill"
                    style={{ width: `${progress}%`, backgroundColor: topic.color || '#6366f1' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Activity chart placeholder */}
      <section className="activity-section">
        <h2>Weekly Activity</h2>
        <div className="activity-chart-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          <p>Activity chart coming soon</p>
          <span>Track your daily practice and study sessions</span>
        </div>
      </section>
    </div>
  );
}
