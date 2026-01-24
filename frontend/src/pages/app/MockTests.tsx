import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getMockTests, getMockTestHistory } from '../../services/api';
import type { MockTest, MockTestAttempt } from '../../types/database.types';

export default function MockTests() {
  const [mockTests, setMockTests] = useState<MockTest[]>([]);
  const [attempts, setAttempts] = useState<(MockTestAttempt & { mock_test: MockTest })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [testsData, attemptsData] = await Promise.all([
          getMockTests(),
          getMockTestHistory().catch(() => [])
        ]);
        setMockTests(testsData);
        setAttempts(attemptsData);
      } catch (err) {
        console.error('Error loading mock tests:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  return (
    <div className="mock-tests-page">
      {/* Page header */}
      <header className="page-header">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/app/practice">Practice</Link>
          <span className="separator">/</span>
          <span className="current">Mock Tests</span>
        </nav>
        <h1>Mock Tests</h1>
        <p>Simulate the real exam experience with timed full-length tests</p>
      </header>

      {/* Info banner */}
      <div className="info-banner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
        <div className="info-content">
          <h3>About Mock Tests</h3>
          <p>
            Mock tests simulate the actual exam environment with a fixed number of questions and time limit.
            Your progress will be saved, and you can review your answers after completing the test.
          </p>
        </div>
      </div>

      {/* Tests grid */}
      <section className="tests-section">
        <h2>Available Tests</h2>
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading tests...</p>
          </div>
        ) : (
          <div className="tests-grid">
            {mockTests.map((test) => (
              <div key={test.id} className="test-card">
                <div className="test-header">
                  <div className="test-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </div>
                  <div className="test-badges">
                    <span className="badge badge-questions">{test.question_count} questions</span>
                    <span className="badge badge-time">{test.time_limit_minutes} min</span>
                  </div>
                </div>
                
                <h3>{test.title}</h3>
                <p>{test.description}</p>

                <div className="test-meta">
                  <span className="topics-count">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                      <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    Pass: {test.passing_score}%
                  </span>
                </div>

                <div className="test-actions">
                  <Link to={`/app/practice/mock-tests/${test.id}`} className="btn-start-test">
                    Start Test
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Past attempts section */}
      <section className="attempts-section">
        <h2>Your Past Attempts</h2>
        {attempts.length > 0 ? (
          <div className="attempts-list">
            {attempts.map((attempt) => (
              <div key={attempt.id} className={`attempt-card ${attempt.is_passed ? 'passed' : 'failed'}`}>
                <div className="attempt-info">
                  <h4>{attempt.mock_test?.title}</h4>
                  <span className="attempt-date">{new Date(attempt.started_at).toLocaleDateString()}</span>
                </div>
                <div className="attempt-stats">
                  <span className="score">{attempt.score}%</span>
                  <span className={`status ${attempt.is_passed ? 'passed' : 'failed'}`}>
                    {attempt.is_passed ? 'Passed' : 'Failed'}
                  </span>
                </div>
                <div className="attempt-details">
                  <span>{attempt.correct_answers}/{attempt.total_questions} correct</span>
                  {attempt.time_taken_seconds && (
                    <span>{Math.round(attempt.time_taken_seconds / 60)} min</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <line x1="10" y1="9" x2="8" y2="9"/>
            </svg>
            <h3>No attempts yet</h3>
            <p>Start a mock test to see your results here</p>
          </div>
        )}
      </section>
    </div>
  );
}
