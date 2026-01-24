import { Link } from 'react-router-dom';
import { mockTests } from '../../data/topics';

export default function MockTests() {
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
                  <span className="badge badge-questions">{test.questionCount} questions</span>
                  <span className="badge badge-time">{test.duration} min</span>
                </div>
              </div>
              
              <h3>{test.name}</h3>
              <p>{test.description}</p>

              <div className="test-meta">
                <span className="topics-count">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                  </svg>
                  {test.topics.length} topics covered
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
      </section>

      {/* Past attempts section (empty state) */}
      <section className="attempts-section">
        <h2>Your Past Attempts</h2>
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
      </section>
    </div>
  );
}
