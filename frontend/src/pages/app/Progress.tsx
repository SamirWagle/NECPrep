import { Link } from 'react-router-dom';
import { bookChapters, getOverallStats, getTopicProgress } from '../../services/localData';

export default function Progress() {
  const overall = getOverallStats();
  const totalQuestions = overall.totalAvailable;
  const questionsAttempted = overall.attempted;
  const correctAnswers = overall.correct;
  const accuracy = questionsAttempted > 0 ? Math.round((correctAnswers / questionsAttempted) * 100) : 0;
  const completionPercent = totalQuestions > 0 ? Math.round((questionsAttempted / totalQuestions) * 100) : 0;

  return (
    <div className="progress-page">
      <header className="page-header">
        <h1>Your Progress</h1>
        <p>Track your learning journey and improvement over time</p>
      </header>

      <section className="overview-stats">
        <div className="stat-card primary">
          <div className="stat-content">
            <span className="stat-value">{completionPercent}%</span>
            <span className="stat-label">Overall Progress</span>
          </div>
          <div className="stat-visual">
            <svg viewBox="0 0 36 36" className="progress-ring">
              <path className="ring-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              <path className="ring-progress" strokeDasharray={`${completionPercent}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            </svg>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-content">
            <span className="stat-value">{questionsAttempted}</span>
            <span className="stat-label">Questions Attempted</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-content">
            <span className="stat-value">{accuracy}%</span>
            <span className="stat-label">Accuracy Rate</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-content">
            <span className="stat-value">{correctAnswers}</span>
            <span className="stat-label">Correct Answers</span>
          </div>
        </div>
      </section>

      <section className="topic-progress">
        <div className="section-header">
          <h2>Progress by Topic</h2>
        </div>
        <div className="topic-progress-list">
          {bookChapters.map((topic) => {
            const tp = getTopicProgress(topic.id);
            const attempted = tp.attempted.length;
            const correct = tp.correct.length;
            const progress = topic.questionCount > 0 ? Math.round((attempted / topic.questionCount) * 100) : 0;
            const topicAccuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
            return (
              <div key={topic.id} className="topic-progress-card">
                <div className="topic-header">
                  <div className="topic-info">
                    <h3>{topic.name}</h3>
                    <span className="topic-stats">
                      {attempted} / {topic.questionCount} questions
                    </span>
                  </div>
                  <span className="progress-percent" style={{ color: topic.color || '#6366f1' }}>
                    {progress}%
                  </span>
                </div>
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" style={{ width: `${progress}%`, backgroundColor: topic.color || '#6366f1' }} />
                </div>
                <div className="topic-footer">
                  <span>{topicAccuracy}% accuracy</span>
                  <Link to={`/app/practice/chapter/${topic.id}`} className="practice-link">Practice</Link>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

