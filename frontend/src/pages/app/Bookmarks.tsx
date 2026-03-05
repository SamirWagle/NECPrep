import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { loadBookmarkedQuestions, removeBookmark, getTopicById } from '../../services/localData';
import type { Question } from '../../services/localData';

export default function Bookmarks() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    loadBookmarkedQuestions().then(setQuestions).finally(() => setLoading(false));
  }, []);

  const handleRemove = (id: string) => {
    removeBookmark(id);
    setQuestions(prev => prev.filter(q => q.id !== id));
  };

  const topicIds = Array.from(new Set(questions.map(q => q.topicId)));
  const filtered = filter === 'all' ? questions : questions.filter(q => q.topicId === filter);

  return (
    <div className="bookmarks-page">
      <header className="page-header">
        <h1>Bookmarks</h1>
        <p>Your saved questions for quick access</p>
      </header>

      {loading ? (
        <div className="loading-container"><div className="loading-spinner"/><p>Loading...</p></div>
      ) : (
        <>
          <div className="filter-tabs" role="tablist">
            <button className={`tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
              All ({questions.length})
            </button>
            {topicIds.map(tid => {
              const topic = getTopicById(tid);
              const count = questions.filter(q => q.topicId === tid).length;
              return (
                <button key={tid} className={`tab ${filter === tid ? 'active' : ''}`} onClick={() => setFilter(tid)}>
                  {topic?.shortName ?? tid} ({count})
                </button>
              );
            })}
          </div>

          {filtered.length > 0 ? (
            <div className="bookmarks-list">
              {filtered.map(q => {
                const topic = getTopicById(q.topicId);
                return (
                  <div key={q.id} className="bookmark-card">
                    <div className="bookmark-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                        <line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                    </div>
                    <div className="bookmark-content">
                      <span className="bookmark-type">question</span>
                      <p className="bookmark-text">{q.question}</p>
                      <div className="bookmark-meta">
                        <span className="topic">{topic?.name}</span>
                      </div>
                    </div>
                    <div className="bookmark-actions">
                      <Link to={`/app/practice/topic/${q.topicId}`} className="action-btn" aria-label="Practice this topic">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      </Link>
                      <button className="action-btn delete" aria-label="Remove bookmark" onClick={() => handleRemove(q.id)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
            <div className="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
              <h3>No bookmarks yet</h3>
              <p>Save questions while practicing to access them here</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}