import { useParams, Link } from 'react-router-dom';
import { getTopicById } from '../../data/topics';

// Mock chapters for study
const mockChapters = [
  { id: 1, title: 'Introduction and Fundamentals', duration: '25 min', completed: true },
  { id: 2, title: 'Core Concepts and Terminology', duration: '35 min', completed: true },
  { id: 3, title: 'Principles and Applications', duration: '40 min', completed: false },
  { id: 4, title: 'Problem Solving Techniques', duration: '45 min', completed: false },
  { id: 5, title: 'Advanced Topics', duration: '50 min', completed: false },
  { id: 6, title: 'Case Studies', duration: '30 min', completed: false },
  { id: 7, title: 'Practice Problems', duration: '60 min', completed: false },
  { id: 8, title: 'Summary and Review', duration: '20 min', completed: false },
];

export default function TopicStudy() {
  const { topicId } = useParams<{ topicId: string }>();
  const topic = topicId ? getTopicById(topicId) : null;

  if (!topic) {
    return (
      <div className="topic-not-found">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h2>Topic not found</h2>
        <p>The topic you're looking for doesn't exist.</p>
        <Link to="/app/study" className="btn-primary">Back to Study</Link>
      </div>
    );
  }

  const completedChapters = mockChapters.filter(c => c.completed).length;
  const progress = (completedChapters / mockChapters.length) * 100;

  return (
    <div className="topic-study-page">
      {/* Breadcrumb */}
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/app/study">Study</Link>
        <span className="separator">/</span>
        <span className="current">{topic.shortName}</span>
      </nav>

      {/* Topic header */}
      <header className="topic-header" style={{ borderColor: `${topic.color}40` }}>
        <div className="topic-info">
          <h1>{topic.name}</h1>
          <p>{topic.description}</p>
        </div>
        <div className="topic-progress-overview">
          <div className="progress-circle" style={{ '--progress': progress, '--color': topic.color } as React.CSSProperties}>
            <svg viewBox="0 0 36 36">
              <path
                className="circle-bg"
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="circle-progress"
                strokeDasharray={`${progress}, 100`}
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
                style={{ stroke: topic.color }}
              />
            </svg>
            <span className="progress-value">{Math.round(progress)}%</span>
          </div>
          <div className="progress-text">
            <span className="completed">{completedChapters} of {mockChapters.length}</span>
            <span className="label">chapters completed</span>
          </div>
        </div>
      </header>

      {/* Chapters list */}
      <section className="chapters-section">
        <h2>Chapters</h2>
        <div className="chapters-list">
          {mockChapters.map((chapter, index) => (
            <div 
              key={chapter.id}
              className={`chapter-card ${chapter.completed ? 'completed' : ''}`}
            >
              <div className="chapter-number" style={{ backgroundColor: chapter.completed ? topic.color : undefined }}>
                {chapter.completed ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                ) : (
                  index + 1
                )}
              </div>
              <div className="chapter-content">
                <h3>{chapter.title}</h3>
                <div className="chapter-meta">
                  <span className="duration">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    {chapter.duration}
                  </span>
                  {chapter.completed && (
                    <span className="completed-badge">Completed</span>
                  )}
                </div>
              </div>
              <button 
                className={`chapter-btn ${chapter.completed ? 'review' : 'start'}`}
                style={{ borderColor: topic.color, color: chapter.completed ? topic.color : undefined }}
              >
                {chapter.completed ? 'Review' : 'Start'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Related actions */}
      <section className="related-actions">
        <h2>Related</h2>
        <div className="actions-grid">
          <Link to={`/app/practice/topic/${topic.id}`} className="action-card">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <span>Practice Questions</span>
          </Link>
          <Link to="/app/flashcards" className="action-card">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="M10 4v4"/>
              <path d="M2 8h20"/>
              <path d="M6 4v4"/>
            </svg>
            <span>Flashcards</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
