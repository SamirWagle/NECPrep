import { Link } from 'react-router-dom';
import { bookChapters } from '../../services/localData';

export default function StudyHub() {
  return (
    <div className="study-hub-page">
      {/* Page header */}
      <header className="page-header">
        <h1>Study Materials</h1>
        <p>Access comprehensive study guides and materials for all topics</p>
      </header>

      {/* Study modes */}
      <section className="study-modes" aria-labelledby="modes-title">
        <h2 id="modes-title" className="sr-only">Study Options</h2>
        <div className="modes-grid">
          <Link to="/app/flashcards" className="mode-card mode-flashcard">
            <div className="mode-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M10 4v4"/>
                <path d="M2 8h20"/>
                <path d="M6 4v4"/>
              </svg>
            </div>
            <div className="mode-content">
              <h3>Flashcards</h3>
              <p>Quick revision with interactive flashcards</p>
            </div>
          </Link>

          <Link to="/app/bookmarks" className="mode-card mode-bookmark">
            <div className="mode-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div className="mode-content">
              <h3>Bookmarks</h3>
              <p>Review your saved questions and notes</p>
            </div>
          </Link>

          <div className="mode-card mode-notes">
            <div className="mode-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <div className="mode-content">
              <h3>My Notes</h3>
              <p>Access your personal study notes</p>
            </div>
            <span className="coming-soon-badge">Coming Soon</span>
          </div>
        </div>
      </section>

      {/* Topics grid */}
      <section className="study-topics" aria-labelledby="topics-title">
        <h2 id="topics-title">Study by Topic</h2>
        <div className="topics-grid">
          {bookChapters.map((topic) => (
            <Link
              to={`/app/study/topic/${topic.id}`}
              key={topic.id}
              className="topic-card"
            >
              <div className="topic-icon" style={{ backgroundColor: `${topic.color || '#6366f1'}15`, color: topic.color || '#6366f1' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                </svg>
              </div>
              <div className="topic-content">
                <h3>{topic.name}</h3>
                <p>{topic.description}</p>
                <div className="topic-meta">
                  <span className="chapter-count">{topic.questionCount} questions</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

