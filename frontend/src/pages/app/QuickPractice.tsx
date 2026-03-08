import { Link, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import {
  loadQuestionsSlice,
  recordAttempt,
  addBookmark,
  removeBookmark,
  isBookmarked,
  saveQuizResult,
} from '../../services/localData';
import type { Question } from '../../services/localData';

import { useChapters } from '../../hooks/useChapters';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function QuickPractice() {
  const ALL_SOURCES = useChapters();
  const [searchParams] = useSearchParams();
  const count = Math.min(50, Math.max(5, parseInt(searchParams.get('count') || '10', 10)));

  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const [idx, setIdx]             = useState(0);
  const [selected, setSelected]   = useState<number | null>(null);
  const [revealed, setRevealed]   = useState(false);
  const [score, setScore]         = useState(0);
  const [answered, setAnswered]   = useState<Set<number>>(new Set());
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [done, setDone]           = useState(false);

  useEffect(() => {
    if (ALL_SOURCES.length === 0) return;
    const perTopic = Math.max(1, Math.ceil(count / ALL_SOURCES.length));
    Promise.all(ALL_SOURCES.map(s => loadQuestionsSlice(s.id, perTopic)))
      .then(results => {
        const combined = shuffle(results.flat()).slice(0, count);
        if (combined.length === 0) setError('No questions available.');
        else setQuestions(combined);
      })
      .catch(() => setError('Failed to load questions. Please try again.'))
      .finally(() => setLoading(false));
  }, [ALL_SOURCES.length]);

  useEffect(() => {
    if (questions.length === 0) return;
    const id = questions[idx]?.id;
    if (id && isBookmarked(id)) setBookmarkedIds(p => new Set(p).add(id));
  }, [idx, questions]);

  const handleSelect = (i: number) => {
    if (answered.has(idx)) return;
    setSelected(i);
  };

  const handleSubmit = useCallback(() => {
    if (selected === null || answered.has(idx)) return;
    const q = questions[idx];
    const hasAnswer = q.correctIndex >= 0;
    const correct = hasAnswer && selected === q.correctIndex;
    setRevealed(true);
    setAnswered(p => new Set(p).add(idx));
    if (correct) setScore(s => s + 1);
    if (hasAnswer) recordAttempt(q.id, q.topicId, correct);
  }, [selected, idx, answered, questions]);

  const handleToggleBookmark = () => {
    const id = questions[idx]?.id;
    if (!id) return;
    if (bookmarkedIds.has(id)) {
      removeBookmark(id);
      setBookmarkedIds(p => { const n = new Set(p); n.delete(id); return n; });
    } else {
      addBookmark(id);
      setBookmarkedIds(p => new Set(p).add(id));
    }
  };

  const handleNext = () => {
    if (idx < questions.length - 1) {
      setIdx(i => i + 1);
      setSelected(null);
      setRevealed(false);
    } else if (answered.has(idx)) {
      saveQuizResult({
        topicId:   'quick-practice',
        topicName: 'Quick Practice',
        score,
        total:     questions.length,
        date:      new Date().toISOString(),
      });
      setDone(true);
    }
  };

  const handlePrev = () => {
    if (idx > 0) {
      setIdx(i => i - 1);
      setSelected(null);
      setRevealed(answered.has(idx - 1));
    }
  };

  const optClass = (i: number) => {
    if (!revealed) return selected === i ? 'selected' : '';
    const q = questions[idx];
    if (q.correctIndex < 0) return selected === i ? 'selected' : '';
    if (i === q.correctIndex) return 'correct';
    if (selected === i) return 'incorrect';
    return '';
  };

  if (loading) return (
    <div className="loading-container">
      <div className="loading-spinner" />
      <p>Picking {count} random questions…</p>
    </div>
  );

  if (error) return (
    <div className="topic-not-found">
      <h2>{error}</h2>
      <Link to="/app/practice" className="btn-primary">Back to Practice</Link>
    </div>
  );

  if (done) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="quiz-complete">
        <div className="quiz-complete-card">
          <div className="complete-icon">{pct >= 60 ? '🎉' : '📚'}</div>
          <h2>Quick Practice Done!</h2>
          <div className="complete-score">
            <span className="score-number">{score}</span>
            <span className="score-total">/ {questions.length}</span>
          </div>
          <p className="complete-pct">{pct}% accuracy</p>
          <div className="complete-actions">
            <Link to="/app/practice/quick" className="btn-primary">Try Again</Link>
            <Link to="/app/practice" className="btn-secondary">Back to Practice</Link>
          </div>
        </div>
      </div>
    );
  }

  const q = questions[idx];
  const isAnswered = answered.has(idx);
  const isCurrentBookmarked = bookmarkedIds.has(q.id);

  return (
    <div className="topic-practice-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/app/practice">Practice</Link>
        <span className="separator">/</span>
        <span className="current">Quick Practice</span>
      </nav>

      <header className="topic-header">
        <div className="topic-info">
          <h1>Quick Practice</h1>
          <p>Random questions across all topics</p>
        </div>
        <div className="topic-stats">
          <div className="stat">
            <span className="value">{idx + 1}/{questions.length}</span>
            <span className="label">Question</span>
          </div>
          <div className="stat">
            <span className="value">{score}</span>
            <span className="label">Correct</span>
          </div>
          <div className="stat">
            <span className="value">{answered.size > 0 ? Math.round((score / answered.size) * 100) : 0}%</span>
            <span className="label">Accuracy</span>
          </div>
        </div>
      </header>

      <div className="question-card">
        <div className="question-header">
          <div className="question-number">Question {idx + 1}</div>
          <button
            className={`bookmark-btn ${isCurrentBookmarked ? 'bookmarked' : ''}`}
            onClick={handleToggleBookmark}
            title={isCurrentBookmarked ? 'Remove bookmark' : 'Add bookmark'}
          >
            <svg viewBox="0 0 24 24" fill={isCurrentBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>

        <h2 className="question-text">{q.question}</h2>

        <div className="options-list" role="radiogroup" aria-label="Answer options">
          {q.options.map((opt, i) => (
            <button
              key={i}
              className={`option-btn ${optClass(i)}`}
              onClick={() => handleSelect(i)}
              disabled={isAnswered}
              role="radio"
              aria-checked={selected === i}
            >
              <span className="option-letter">{String.fromCharCode(65 + i)}</span>
              <span className="option-text">{opt}</span>
              {revealed && i === q.correctIndex && q.correctIndex >= 0 && (
                <svg className="result-icon correct" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {revealed && selected === i && i !== q.correctIndex && (
                <svg className="result-icon incorrect" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              )}
            </button>
          ))}
        </div>

        {revealed && (
          <div className={`result-message ${q.correctIndex >= 0 ? (selected === q.correctIndex ? 'correct' : 'incorrect') : 'selected'}`}>
            {q.correctIndex < 0
              ? <p>Answer recorded. No answer key available for this topic yet.</p>
              : selected === q.correctIndex
                ? <p>Correct! Well done.</p>
                : <p>Incorrect. Correct answer: <strong>{String.fromCharCode(65 + q.correctIndex)}</strong></p>
            }
          </div>
        )}

        <div className="question-actions">
          <button className="btn-secondary" onClick={handlePrev} disabled={idx === 0}>Previous</button>
          {!isAnswered
            ? <button className="btn-primary" onClick={handleSubmit} disabled={selected === null}>Submit</button>
            : <button className="btn-primary" onClick={handleNext}>{idx < questions.length - 1 ? 'Next' : 'Finish'}</button>
          }
        </div>
      </div>

      <div className="question-progress-bar">
        <div className="qpb-fill" style={{ width: `${((idx + 1) / questions.length) * 100}%` }} />
      </div>
    </div>
  );
}
