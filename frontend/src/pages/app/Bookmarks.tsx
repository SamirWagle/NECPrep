import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getBookmarks, removeBookmark } from '../../services/api';
import type { Bookmark, Question, Topic } from '../../types/database.types';

type BookmarkWithRelations = Bookmark & { question: Question; topic: Topic };

export default function Bookmarks() {
  const [bookmarks, setBookmarks] = useState<BookmarkWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all'); // 'all' or topic_id

  useEffect(() => {
    async function loadBookmarks() {
      setLoading(true);
      try {
        const data = await getBookmarks();
        setBookmarks(data as BookmarkWithRelations[]);
      } catch (err) {
        console.error('Error loading bookmarks:', err);
      } finally {
        setLoading(false);
      }
    }
    loadBookmarks();
  }, []);

  const handleRemoveBookmark = async (questionId: string) => {
    try {
      await removeBookmark(questionId);
      setBookmarks(prev => prev.filter(b => b.question_id !== questionId));
    } catch (err) {
      console.error('Error removing bookmark:', err);
    }
  };

  // Get unique topics for filter
  const topics = Array.from(new Set(bookmarks.map(b => b.topic?.id).filter(Boolean)));
  const topicNames = new Map(bookmarks.map(b => [b.topic?.id, b.topic?.name]));

  const filteredBookmarks = filter === 'all' 
    ? bookmarks 
    : bookmarks.filter(b => b.topic_id === filter);

  if (loading) {
    return (
      <div className="bookmarks-page">
        <header className="page-header">
          <h1>Bookmarks</h1>
          <p>Your saved questions for quick access</p>
        </header>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading bookmarks...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bookmarks-page">
      {/* Page header */}
      <header className="page-header">
        <h1>Bookmarks</h1>
        <p>Your saved questions for quick access</p>
      </header>

      {/* Filter tabs */}
      <div className="filter-tabs" role="tablist">
        <button 
          className={`tab ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
          role="tab"
          aria-selected={filter === 'all'}
        >
          All ({bookmarks.length})
        </button>
        {topics.map(topicId => topicId && (
          <button 
            key={topicId}
            className={`tab ${filter === topicId ? 'active' : ''}`}
            onClick={() => setFilter(topicId)}
            role="tab"
            aria-selected={filter === topicId}
          >
            {topicNames.get(topicId)} ({bookmarks.filter(b => b.topic_id === topicId).length})
          </button>
        ))}
      </div>

      {/* Bookmarks list */}
      {filteredBookmarks.length > 0 ? (
        <div className="bookmarks-list">
          {filteredBookmarks.map((bookmark) => (
            <div key={bookmark.id} className="bookmark-card">
              <div className="bookmark-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              
              <div className="bookmark-content">
                <span className="bookmark-type">question</span>
                <p className="bookmark-text">{bookmark.question?.question_text}</p>
                <div className="bookmark-meta">
                  <span className="topic">{bookmark.topic?.name}</span>
                  <span className="divider">•</span>
                  <span className="date">{new Date(bookmark.created_at).toLocaleDateString()}</span>
                </div>
                {bookmark.notes && (
                  <p className="bookmark-notes">{bookmark.notes}</p>
                )}
              </div>

              <div className="bookmark-actions">
                <Link 
                  to={`/app/practice/topic/${bookmark.topic_id}`}
                  className="action-btn" 
                  aria-label="Practice this topic"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </Link>
                <button 
                  className="action-btn delete" 
                  aria-label="Remove bookmark"
                  onClick={() => handleRemoveBookmark(bookmark.question_id)}
                >
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
          <p>Save questions while practicing to access them here</p>
        </div>
      )}
    </div>
  );
}
