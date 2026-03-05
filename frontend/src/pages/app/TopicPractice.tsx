import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import {
  loadQuestionsSlice,
  getTopicById,
  recordAttempt,
  addBookmark,
  removeBookmark,
  isBookmarked,
  saveQuizResult,
} from '../../services/localData';
import type { Question } from '../../services/localData';

function LoadingSpinner() {
  return (
    <div className="loading-container">
      <div className="loading-spinner"></div>
      <p>Loading questions...</p>
    </div>
  );
}

export default function TopicPractice() {
  const { topicId } = useParams<{ topicId: string }>();
  const [searchParams] = useSearchParams();
  const questionCount = parseInt(searchParams.get('count') || '30', 10);

  const topic = topicId ? getTopicById(topicId) : undefined;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [answeredSet, setAnsweredSet] = useState<Set<number>>(new Set());
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const [quizDone, setQuizDone] = useState(false);

  useEffect(() => {
    if (!topicId) return;
    setLoading(true);
    setError(null);
    loadQuestionsSlice(topicId, questionCount)
      .then((qs) => {
        if (qs.length === 0) setError('No questions found for this topic.');
        else setQuestions(qs);
      })
      .catch(() => setError('Failed to load questions. Please try again.'))
      .finally(() => setLoading(false));
  }, [topicId, questionCount]);

  useEffect(() => {
    setCurrentIdx(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    setAnsweredSet(new Set());
    setBookmarkedIds(new Set());
    setQuizDone(false);
  }, [topicId]);

  useEffect(() => {
    if (questions.length === 0) return;
    const id = questions[currentIdx]?.id;
    if (id && isBookmarked(id)) setBookmarkedIds(prev => new Set(prev).add(id));
  }, [currentIdx, questions]);

  const handleAnswerSelect = (index: number) => {
    if (answeredSet.has(currentIdx)) return;
    setSelectedAnswer(index);
  };

  const handleSubmit = useCallback(() => {
    if (selectedAnswer === null || answeredSet.has(currentIdx)) return;
    const q = questions[currentIdx];
    const hasAnswer = q.correctIndex >= 0;
    const correct = hasAnswer && selectedAnswer === q.correctIndex;
    setShowResult(true);
    setAnsweredSet(prev => new Set(prev).add(currentIdx));
    if (correct) setScore(s => s + 1);
    if (hasAnswer) recordAttempt(q.id, q.topicId, correct);
  }, [selectedAnswer, currentIdx, answeredSet, questions]);

  const handleToggleBookmark = () => {
    const id = questions[currentIdx]?.id;
    if (!id) return;
    if (bookmarkedIds.has(id)) {
      removeBookmark(id);
      setBookmarkedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    } else {
      addBookmark(id);
      setBookmarkedIds(prev => new Set(prev).add(id));
    }
  };

  const handleNext = () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(i => i + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    } else if (answeredSet.has(currentIdx)) {
      // quiz finished
      // correct answer already counted above
      if (topic) {
        saveQuizResult({
          topicId: topic.id,
          topicName: topic.name,
          score,
          total: questions.length,
          date: new Date().toISOString(),
        });
      }
      setQuizDone(true);
    }
  };

  const handlePrev = () => {
    if (currentIdx > 0) {
      setCurrentIdx(i => i - 1);
      setSelectedAnswer(null);
      setShowResult(answeredSet.has(currentIdx - 1));
    }
  };

  const getOptionClass = (index: number) => {
    if (!showResult) return selectedAnswer === index ? 'selected' : '';
    const q = questions[currentIdx];
    if (q.correctIndex < 0) return selectedAnswer === index ? 'selected' : ''; // no answer key
    if (index === q.correctIndex) return 'correct';
    if (selectedAnswer === index) return 'incorrect';
    return '';
  };

  if (loading) return <LoadingSpinner />;

  if (error || !topic) {
    return (
      <div className="topic-not-found">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h2>{error || 'Topic not found'}</h2>
        <p>The topic you are looking for does not exist or has no questions.</p>
        <Link to="/app/practice" className="btn-primary">Back to Practice</Link>
      </div>
    );
  }

  if (quizDone) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="quiz-complete">
        <div className="quiz-complete-card">
          <div className="complete-icon" style={{ color: pct >= 60 ? '#22c55e' : '#ef4444' }}>
            {pct >= 60 ? '🎉' : '📚'}
          </div>
          <h2>Quiz Complete!</h2>
          <p className="complete-topic">{topic.name}</p>
          <div className="complete-score">
            <span className="score-number">{score}</span>
            <span className="score-total">/ {questions.length}</span>
          </div>
          <p className="complete-pct">{pct}% accuracy</p>
          <div className="complete-actions">
            <Link to={`/app/practice/chapter/${topic.id}`} className="btn-primary">Practice Again</Link>
            <Link to="/app/practice" className="btn-secondary">Back to Practice</Link>
          </div>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentIdx];
  const isAnswered = answeredSet.has(currentIdx);
  const isCurrentBookmarked = bookmarkedIds.has(currentQuestion.id);

  return (
    <div className="topic-practice-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/app/practice">Practice</Link>
        <span className="separator">/</span>
        <span className="current">{topic.name}</span>
      </nav>

      <header className="topic-header" style={{ borderColor: `${topic.color}40` }}>
        <div className="topic-info">
          <h1>{topic.name}</h1>
          <p>{topic.description}</p>
        </div>
        <div className="topic-stats">
          <div className="stat">
            <span className="value">{currentIdx + 1}/{questions.length}</span>
            <span className="label">Question</span>
          </div>
          <div className="stat">
            <span className="value">{score}</span>
            <span className="label">Correct</span>
          </div>
          <div className="stat">
            <span className="value">{answeredSet.size > 0 ? Math.round((score / answeredSet.size) * 100) : 0}%</span>
            <span className="label">Accuracy</span>
          </div>
        </div>
      </header>

      <div className="question-card">
        <div className="question-header">
          <div className="question-number">Question {currentIdx + 1}</div>
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
        <h2 className="question-text">{currentQuestion.question}</h2>

        <div className="options-list" role="radiogroup" aria-label="Answer options">
          {currentQuestion.options.map((optText, index) => (
            <button
              key={index}
              className={`option-btn ${getOptionClass(index)}`}
              onClick={() => handleAnswerSelect(index)}
              disabled={isAnswered}
              role="radio"
              aria-checked={selectedAnswer === index}
            >
              <span className="option-letter">{String.fromCharCode(65 + index)}</span>
              <span className="option-text">{optText}</span>
              {showResult && index === currentQuestion.correctIndex && currentQuestion.correctIndex >= 0 && (
                <svg className="result-icon correct" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {showResult && selectedAnswer === index && index !== currentQuestion.correctIndex && (
                <svg className="result-icon incorrect" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              )}
            </button>
          ))}
        </div>

        {showResult && (
          <div className={`result-message ${currentQuestion.correctIndex >= 0 ? (selectedAnswer === currentQuestion.correctIndex ? 'correct' : 'incorrect') : 'selected'}`}>
            {currentQuestion.correctIndex < 0 ? (
              <p>Answer recorded. No answer key available for this topic yet.</p>
            ) : selectedAnswer === currentQuestion.correctIndex ? (
              <p>Correct! Well done.</p>
            ) : (
              <p>Incorrect. The correct answer is <strong>{String.fromCharCode(65 + currentQuestion.correctIndex)}</strong>.</p>
            )}
          </div>
        )}

        <div className="question-actions">
          <button className="btn-secondary" onClick={handlePrev} disabled={currentIdx === 0}>Previous</button>
          {!isAnswered ? (
            <button className="btn-primary" onClick={handleSubmit} disabled={selectedAnswer === null}>Submit</button>
          ) : (
            <button className="btn-primary" onClick={handleNext}>
              {currentIdx < questions.length - 1 ? 'Next' : 'Finish'}
            </button>
          )}
        </div>
      </div>

      <div className="question-progress-bar">
        <div className="qpb-fill" style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }} />
      </div>
    </div>
  );
}
