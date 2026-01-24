import { useState } from 'react';

// Mock bookmarked items
const mockBookmarks = [
  {
    id: 1,
    type: 'question' as const,
    content: "Which of the following best describes Ohm's Law?",
    topic: 'Electrical & Electronics',
    addedAt: '2 days ago'
  },
  {
    id: 2,
    type: 'question' as const,
    content: "What is the time complexity of binary search?",
    topic: 'Data Structures & Algorithms',
    addedAt: '3 days ago'
  },
  {
    id: 3,
    type: 'note' as const,
    content: "Remember: TCP is connection-oriented, UDP is connectionless",
    topic: 'Networks & Security',
    addedAt: '5 days ago'
  }
];

export default function Bookmarks() {
  const [filter, setFilter] = useState<'all' | 'question' | 'note'>('all');

  const filteredBookmarks = filter === 'all' 
    ? mockBookmarks 
    : mockBookmarks.filter(b => b.type === filter);

  return (
    <div className="bookmarks-page">
      {/* Page header */}
      <header className="page-header">
        <h1>Bookmarks</h1>
        <p>Your saved questions and notes for quick access</p>
      </header>

      {/* Filter tabs */}
      <div className="filter-tabs" role="tablist">
        <button 
          className={`tab ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
          role="tab"
          aria-selected={filter === 'all'}
        >
          All ({mockBookmarks.length})
        </button>
        <button 
          className={`tab ${filter === 'question' ? 'active' : ''}`}
          onClick={() => setFilter('question')}
          role="tab"
          aria-selected={filter === 'question'}
        >
          Questions ({mockBookmarks.filter(b => b.type === 'question').length})
        </button>
        <button 
          className={`tab ${filter === 'note' ? 'active' : ''}`}
          onClick={() => setFilter('note')}
          role="tab"
          aria-selected={filter === 'note'}
        >
          Notes ({mockBookmarks.filter(b => b.type === 'note').length})
        </button>
      </div>

      {/* Bookmarks list */}
      {filteredBookmarks.length > 0 ? (
        <div className="bookmarks-list">
          {filteredBookmarks.map((bookmark) => (
            <div key={bookmark.id} className="bookmark-card">
              <div className="bookmark-icon">
                {bookmark.type === 'question' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                )}
              </div>
              
              <div className="bookmark-content">
                <span className="bookmark-type">{bookmark.type}</span>
                <p className="bookmark-text">{bookmark.content}</p>
                <div className="bookmark-meta">
                  <span className="topic">{bookmark.topic}</span>
                  <span className="divider">•</span>
                  <span className="date">{bookmark.addedAt}</span>
                </div>
              </div>

              <div className="bookmark-actions">
                <button className="action-btn" aria-label="View bookmark">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
                <button className="action-btn delete" aria-label="Remove bookmark">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
          <h3>No bookmarks yet</h3>
          <p>Save questions and notes while studying to access them here</p>
        </div>
      )}
    </div>
  );
}
