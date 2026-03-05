import { Link } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import {
  bookChapters,
  loadQuestionsSlice,
  recordAttempt,
  addBookmark,
  removeBookmark,
  isBookmarked,
  saveQuizResult,
} from '../../services/localData';
import type { Topic, Question } from '../../services/localData';

// Only use book chapters — exam topic JSONs have no answer data
const ALL_SOURCES: Topic[] = [...bookChapters];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Phase = 'config' | 'quiz' | 'done';

export default function CustomPractice() {
  const [phase, setPhase] = useState<Phase>('config');

  // ── Config state ───────────────────────────────────────────────────────────
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(
    new Set(ALL_SOURCES.map(t => t.id))
  );
  const [count, setCount] = useState(20);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Quiz state ─────────────────────────────────────────────────────────────
  const [questions, setQuestions] = useState<Question[]>([]);
  const [idx, setIdx]             = useState(0);
  const [answer, setAnswer]       = useState<number | null>(null);
  const [revealed, setRevealed]   = useState(false);
  const [score, setScore]         = useState(0);
  const [answered, setAnswered]   = useState<Set<number>>(new Set());
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (questions.length === 0) return;
    const id = questions[idx]?.id;
    if (id && isBookmarked(id)) setBookmarkedIds(p => new Set(p).add(id));
  }, [idx, questions]);

  // ── Config helpers ─────────────────────────────────────────────────────────
  const toggleTopic = (id: string) => {
    setSelectedTopics(p => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleStart = async () => {
    if (selectedTopics.size === 0) {
      setConfigError('Please select at least one topic.');
      return;
    }
    setLoading(true);
    setConfigError(null);
    const sources = ALL_SOURCES.filter(s => selectedTopics.has(s.id));
    const perTopic = Math.max(1, Math.ceil(count / sources.length));
    try {
      const results = await Promise.all(sources.map(s => loadQuestionsSlice(s.id, perTopic)));
      const combined = shuffle(results.flat()).slice(0, count);
      if (combined.length === 0) {
        setConfigError('No questions found for the selected topics.');
        setLoading(false);
        return;
      }
      setQuestions(combined);
      setIdx(0);
      setAnswer(null);
      setRevealed(false);
      setScore(0);
      setAnswered(new Set());
      setBookmarkedIds(new Set());
      setPhase('quiz');
    } catch {
      setConfigError('Failed to load questions. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Quiz helpers ───────────────────────────────────────────────────────────
  const handleSelect = (i: number) => {
    if (answered.has(idx)) return;
    setAnswer(i);
  };

  const handleSubmit = useCallback(() => {
    if (answer === null || answered.has(idx)) return;
    const q = questions[idx];
    const hasAnswer = q.correctIndex >= 0;
    const correct = hasAnswer && answer === q.correctIndex;
    setRevealed(true);
    setAnswered(p => new Set(p).add(idx));
    if (correct) setScore(s => s + 1);
    if (hasAnswer) recordAttempt(q.id, q.topicId, correct);
  }, [answer, idx, answered, questions]);

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
      setAnswer(null);
      setRevealed(false);
    } else if (answered.has(idx)) {
      saveQuizResult({
        topicId:   'custom-practice',
        topicName: 'Custom Practice',
        score,
        total:     questions.length,
        date:      new Date().toISOString(),
      });
      setPhase('done');
    }
  };

  const handlePrev = () => {
    if (idx > 0) {
      setIdx(i => i - 1);
      setAnswer(null);
      setRevealed(answered.has(idx - 1));
    }
  };

  const optClass = (i: number) => {
    if (!revealed) return answer === i ? 'selected' : '';
    const q = questions[idx];
    if (q.correctIndex < 0) return answer === i ? 'selected' : '';
    if (i === q.correctIndex) return 'correct';
    if (answer === i) return 'incorrect';
    return '';
  };

  // ── Config screen ──────────────────────────────────────────────────────────
  if (phase === 'config') {
    return (
      <div className="custom-practice-config">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/app/practice">Practice</Link>
          <span className="separator">/</span>
          <span className="current">Custom Practice</span>
        </nav>

        <div className="config-card">
          <h1>Custom Practice</h1>
          <p className="config-subtitle">Pick your topics and how many questions you want.</p>

          <div className="config-section">
            <div className="config-section-header">
              <h3>Topics</h3>
              <div className="config-select-all">
                <button className="text-btn" onClick={() => setSelectedTopics(new Set(ALL_SOURCES.map(t => t.id)))}>Select All</button>
                <span>·</span>
                <button className="text-btn" onClick={() => setSelectedTopics(new Set())}>Clear</button>
              </div>
            </div>
            <div className="config-topics-grid">
              {ALL_SOURCES.map(t => (
                <label
                  key={t.id}
                  className={`config-topic-chip ${selectedTopics.has(t.id) ? 'active' : ''}`}
                  style={{ '--chip-color': t.color } as React.CSSProperties}
                >
                  <input
                    type="checkbox"
                    checked={selectedTopics.has(t.id)}
                    onChange={() => toggleTopic(t.id)}
                  />
                  {t.shortName}
                </label>
              ))}
            </div>
          </div>

          <div className="config-section">
            <h3>Number of Questions</h3>
            <div className="config-count-row">
              {[10, 20, 30, 50].map(n => (
                <button
                  key={n}
                  className={`count-btn ${count === n ? 'active' : ''}`}
                  onClick={() => setCount(n)}
                >
                  {n}
                </button>
              ))}
              <input
                type="number"
                className="count-input"
                min={5}
                max={100}
                value={count}
                onChange={e => setCount(Math.min(100, Math.max(5, parseInt(e.target.value) || 5)))}
              />
            </div>
          </div>

          {configError && <p className="config-error">{configError}</p>}

          <div className="config-actions">
            <Link to="/app/practice" className="btn-secondary">Cancel</Link>
            <button
              className="btn-primary"
              onClick={handleStart}
              disabled={selectedTopics.size === 0 || loading}
            >
              {loading ? 'Loading…' : `Start ${count} Questions`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Done screen ────────────────────────────────────────────────────────────
  if (phase === 'done') {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="quiz-complete">
        <div className="quiz-complete-card">
          <div className="complete-icon">{pct >= 60 ? '🎉' : '📚'}</div>
          <h2>Custom Practice Done!</h2>
          <div className="complete-score">
            <span className="score-number">{score}</span>
            <span className="score-total">/ {questions.length}</span>
          </div>
          <p className="complete-pct">{pct}% accuracy</p>
          <div className="complete-actions">
            <button className="btn-primary" onClick={() => setPhase('config')}>Configure Again</button>
            <Link to="/app/practice" className="btn-secondary">Back to Practice</Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Quiz screen ────────────────────────────────────────────────────────────
  const q = questions[idx];
  const isAnswered = answered.has(idx);
  const isCurrentBookmarked = bookmarkedIds.has(q.id);

  return (
    <div className="topic-practice-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/app/practice">Practice</Link>
        <span className="separator">/</span>
        <span className="current">Custom Practice</span>
      </nav>

      <header className="topic-header">
        <div className="topic-info">
          <h1>Custom Practice</h1>
          <p>{selectedTopics.size} topic{selectedTopics.size !== 1 ? 's' : ''} · {questions.length} questions</p>
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
              aria-checked={answer === i}
            >
              <span className="option-letter">{String.fromCharCode(65 + i)}</span>
              <span className="option-text">{opt}</span>
              {revealed && i === q.correctIndex && q.correctIndex >= 0 && (
                <svg className="result-icon correct" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {revealed && answer === i && i !== q.correctIndex && (
                <svg className="result-icon incorrect" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              )}
            </button>
          ))}
        </div>

        {revealed && (
          <div className={`result-message ${q.correctIndex >= 0 ? (answer === q.correctIndex ? 'correct' : 'incorrect') : 'selected'}`}>
            {q.correctIndex < 0
              ? <p>Answer recorded. No answer key available for this topic yet.</p>
              : answer === q.correctIndex
                ? <p>Correct! Well done.</p>
                : <p>Incorrect. Correct answer: <strong>{String.fromCharCode(65 + q.correctIndex)}</strong></p>
            }
          </div>
        )}

        <div className="question-actions">
          <button className="btn-secondary" onClick={handlePrev} disabled={idx === 0}>Previous</button>
          {!isAnswered
            ? <button className="btn-primary" onClick={handleSubmit} disabled={answer === null}>Submit</button>
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
