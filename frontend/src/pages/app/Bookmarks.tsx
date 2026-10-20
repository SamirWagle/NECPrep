import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { loadBookmarkedQuestions, removeBookmark, getTopicById } from '../../services/localData';
import type { Question } from '../../services/localData';
import styles from './Bookmarks.module.css';

const ALL_FILTER = 'all';

export default function Bookmarks() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>(ALL_FILTER);

  useEffect(() => {
    loadBookmarkedQuestions().then(setQuestions).finally(() => setLoading(false));
  }, []);

  const handleRemove = (id: string) => {
    removeBookmark(id);
    setQuestions(prev => prev.filter(q => q.id !== id));
  };

  const topicIds = Array.from(new Set(questions.map(q => q.topicId)));
  const filtered = filter === ALL_FILTER ? questions : questions.filter(q => q.topicId === filter);

  // Removing the last bookmark of the chapter currently filtered on would
  // otherwise leave the page stuck on a filter whose button no longer exists.
  // Adjusted during render rather than in an effect.
  if (filter !== ALL_FILTER && !loading && !topicIds.includes(filter)) {
    setFilter(ALL_FILTER);
  }

  const filterOptions = [
    { id: ALL_FILTER, label: 'All', count: questions.length },
    ...topicIds.map(tid => ({
      id: tid,
      label: getTopicById(tid)?.shortName ?? tid,
      count: questions.filter(q => q.topicId === tid).length,
    })),
  ];

  return (
    <div className={`bookmarks-page ${styles.page}`}>
      <header className="page-header">
        <h1>Bookmarks</h1>
        <p>Your saved questions for quick access</p>
      </header>

      {loading ? (
        <div className="loading-container" role="status">
          <div className="loading-spinner" />
          <p>Loading...</p>
        </div>
      ) : (
        <>
          {/* Deliberately NOT role="tablist".
           *
           * The previous markup claimed role="tablist" while providing no
           * role="tab", no aria-selected, no aria-controls, no tabpanel and no
           * arrow-key navigation, so screen readers announced "tab 1 of 1" over
           * plain buttons. Implementing the real tabs pattern would be wrong
           * here too: these are not swappable panels, they are a filter applied
           * to one list that keeps its own identity, and the set is generated
           * per-chapter so it can be anything from one to a dozen entries.
           * ARIA tabs also take the whole strip out of the tab sequence behind
           * a roving tabindex, which for a wide scrolling filter bar makes
           * discovery worse, not better. These are toggle buttons, labelled as
           * toggle buttons: a group with aria-pressed, each one its own tab
           * stop, Enter and Space from the native button.
           */}
          <div
            className={`filter-tabs ${styles.filterBar}`}
            role="group"
            aria-label="Filter saved questions by chapter"
          >
            {filterOptions.map(option => {
              const isActive = filter === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`tab ${isActive ? 'active' : ''} ${styles.filterButton}`}
                  aria-pressed={isActive}
                  aria-controls="bookmarks-results"
                  onClick={() => setFilter(option.id)}
                >
                  {option.label} ({option.count})
                </button>
              );
            })}
          </div>

          {/* aria-label rather than a visually hidden heading: the region needs
           * a name, but a heading nobody can see would make the visible outline
           * and the screen-reader outline disagree. */}
          <section id="bookmarks-results" aria-label="Saved questions">
            <p className="sr-only" role="status">
              Showing {filtered.length} of {questions.length} saved questions
            </p>

            {filtered.length > 0 ? (
              <div className="bookmarks-list">
                {filtered.map(q => {
                  const topic = getTopicById(q.topicId);
                  const topicLabel = topic?.name ?? q.topicId;
                  return (
                    <div key={q.id} className="bookmark-card">
                      <div className="bookmark-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                          <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                      </div>
                      <div className="bookmark-content">
                        <span className="bookmark-type">question</span>
                        <p className="bookmark-text">{q.question}</p>
                        <div className="bookmark-meta">
                          <span className="topic">{topicLabel}</span>
                        </div>
                      </div>
                      <div className="bookmark-actions">
                        <Link
                          to={`/app/practice/topic/${q.topicId}`}
                          className={`action-btn ${styles.actionButton}`}
                          aria-label={`Practice ${topicLabel}`}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                          </svg>
                        </Link>
                        <button
                          type="button"
                          className={`action-btn delete ${styles.actionButton}`}
                          aria-label={`Remove bookmark: ${q.question}`}
                          onClick={() => handleRemove(q.id)}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Was an <h3>, one level below the page <h1> with no h2 between. */
              <div className="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
                <h2 className={styles.emptyStateTitle}>No bookmarks yet</h2>
                <p>Save questions while practising to access them here</p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
