import { useParams, Link, useNavigate } from 'react-router-dom';
import { getMockTestById } from '../../data/topics';
import { useState } from 'react';

export default function MockTestDetail() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const test = testId ? getMockTestById(testId) : null;
  const [isStarting, setIsStarting] = useState(false);

  if (!test) {
    return (
      <div className="test-not-found">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h2>Test not found</h2>
        <p>The mock test you're looking for doesn't exist.</p>
        <Link to="/app/practice/mock-tests" className="btn-primary">Back to Mock Tests</Link>
      </div>
    );
  }

  const handleStartTest = () => {
    setIsStarting(true);
    // Simulate loading, then would navigate to actual test session
    setTimeout(() => {
      setIsStarting(false);
      // In production, this would start the test session
      alert('Test would start now. This feature is coming soon!');
    }, 1000);
  };

  return (
    <div className="mock-test-detail-page">
      {/* Breadcrumb */}
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/app/practice">Practice</Link>
        <span className="separator">/</span>
        <Link to="/app/practice/mock-tests">Mock Tests</Link>
        <span className="separator">/</span>
        <span className="current">{test.name}</span>
      </nav>

      {/* Test info card */}
      <div className="test-info-card">
        <div className="test-info-header">
          <h1>{test.name}</h1>
          <p>{test.description}</p>
        </div>

        <div className="test-details">
          <div className="detail-item">
            <div className="detail-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div className="detail-content">
              <span className="detail-value">{test.questionCount}</span>
              <span className="detail-label">Questions</span>
            </div>
          </div>

          <div className="detail-item">
            <div className="detail-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div className="detail-content">
              <span className="detail-value">{test.duration}</span>
              <span className="detail-label">Minutes</span>
            </div>
          </div>

          <div className="detail-item">
            <div className="detail-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              </svg>
            </div>
            <div className="detail-content">
              <span className="detail-value">{test.topics.length}</span>
              <span className="detail-label">Topics</span>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="test-instructions">
          <h3>Instructions</h3>
          <ul>
            <li>This test contains {test.questionCount} multiple-choice questions.</li>
            <li>You have {test.duration} minutes to complete the test.</li>
            <li>Each question carries equal marks.</li>
            <li>There is no negative marking for wrong answers.</li>
            <li>Once started, the timer cannot be paused.</li>
            <li>Make sure you have a stable internet connection.</li>
          </ul>
        </div>

        {/* Actions */}
        <div className="test-actions">
          <button 
            onClick={() => navigate(-1)} 
            className="btn-secondary"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
            Go Back
          </button>
          <button 
            onClick={handleStartTest}
            className="btn-primary btn-start"
            disabled={isStarting}
          >
            {isStarting ? (
              <>
                <span className="btn-spinner" />
                Starting...
              </>
            ) : (
              <>
                Start Test
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
