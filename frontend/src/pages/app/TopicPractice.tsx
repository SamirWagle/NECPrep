import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getTopic, getQuestionsByTopic, recordQuestionAttempt, addBookmark, removeBookmark, isBookmarked, startStudySession, updateStudySession, endStudySession } from '../../services/api';
import type { Topic, Question } from '../../types/database.types';

// Loading spinner component
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
  
  // Data state
  const [topic, setTopic] = useState<Topic | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Practice state
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [answeredQuestions, setAnsweredQuestions] = useState<number[]>([]);
  const [bookmarkedQuestions, setBookmarkedQuestions] = useState<Set<string>>(new Set());
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Load topic and questions
  useEffect(() => {
    async function loadData() {
      if (!topicId) return;
      
      setLoading(true);
      setError(null);
      
      try {
        // Load topic details
        const topicData = await getTopic(topicId);
        if (!topicData) {
          setError('Topic not found');
          return;
        }
        setTopic(topicData);
        
        // Load questions for this topic (with limit from URL parameter)
        const { questions: questionsData } = await getQuestionsByTopic(topicId, questionCount);
        if (questionsData.length === 0) {
          setError('No questions found for this topic');
          return;
        }
        setQuestions(questionsData);
        
        // Start a study session
        const session = await startStudySession(topicId, 'practice');
        setSessionId(session.id);
        
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Failed to load questions. Please try again.');
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
    
    // End session when leaving
    return () => {
      if (sessionId) {
        endStudySession(sessionId).catch(console.error);
      }
    };
  }, [topicId]);

  // Reset state when topic changes
  useEffect(() => {
    setCurrentQuestionIndex(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    setAnsweredQuestions([]);
    setBookmarkedQuestions(new Set());
  }, [topicId]);

  // Check bookmark status for current question
  useEffect(() => {
    async function checkBookmark() {
      if (questions.length === 0) return;
      const currentQuestion = questions[currentQuestionIndex];
      try {
        const bookmarked = await isBookmarked(currentQuestion.id);
        if (bookmarked) {
          setBookmarkedQuestions(prev => new Set(prev).add(currentQuestion.id));
        }
      } catch (err) {
        // Ignore bookmark check errors
      }
    }
    checkBookmark();
  }, [currentQuestionIndex, questions]);

  if (loading) {
    return <LoadingSpinner />;
  }

  if (error || !topic) {
    return (
      <div className="topic-not-found">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <h2>{error || 'Topic not found'}</h2>
        <p>The topic you're looking for doesn't exist or has no questions.</p>
        <Link to="/app/practice" className="btn-primary">Back to Practice</Link>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const isAnswered = answeredQuestions.includes(currentQuestionIndex);
  const isCurrentBookmarked = bookmarkedQuestions.has(currentQuestion.id);

  const handleAnswerSelect = (index: number) => {
    if (isAnswered) return;
    setSelectedAnswer(index);
  };

  const handleSubmitAnswer = async () => {
    if (selectedAnswer === null || isAnswered) return;
    
    const isCorrect = selectedAnswer === currentQuestion.correct_answer_index;
    
    setAnsweredQuestions([...answeredQuestions, currentQuestionIndex]);
    setShowResult(true);
    
    if (isCorrect) {
      setScore(score + 1);
    }
    
    // Record the attempt in the database
    try {
      await recordQuestionAttempt(currentQuestion.id, topic.id, isCorrect);
      
      // Update study session
      if (sessionId) {
        await updateStudySession(sessionId, answeredQuestions.length + 1, score + (isCorrect ? 1 : 0));
      }
    } catch (err) {
      console.error('Error recording attempt:', err);
    }
  };

  const handleToggleBookmark = async () => {
    try {
      if (isCurrentBookmarked) {
        await removeBookmark(currentQuestion.id);
        setBookmarkedQuestions(prev => {
          const next = new Set(prev);
          next.delete(currentQuestion.id);
          return next;
        });
      } else {
        await addBookmark(currentQuestion.id, topic.id);
        setBookmarkedQuestions(prev => new Set(prev).add(currentQuestion.id));
      }
    } catch (err) {
      console.error('Error toggling bookmark:', err);
    }
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    }
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
      setSelectedAnswer(null);
      setShowResult(answeredQuestions.includes(currentQuestionIndex - 1));
    }
  };

  const getOptionClass = (index: number) => {
    if (!showResult) {
      return selectedAnswer === index ? 'selected' : '';
    }
    
    if (index === currentQuestion.correct_answer_index) {
      return 'correct';
    }
    
    if (selectedAnswer === index && index !== currentQuestion.correct_answer_index) {
      return 'incorrect';
    }
    
    return '';
  };

  // Build options from the question's options array
  const options = currentQuestion.options.map((text, index) => ({
    index,
    text
  }));

  return (
    <div className="topic-practice-page">
      {/* Breadcrumb */}
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/app/practice">Practice</Link>
        <span className="separator">/</span>
        <span className="current">{topic.name}</span>
      </nav>

      {/* Topic header */}
      <header className="topic-header" style={{ borderColor: `${topic.color}40` }}>
        <div className="topic-info">
          <h1>{topic.name}</h1>
          <p>{topic.description}</p>
        </div>
        <div className="topic-stats">
          <div className="stat">
            <span className="value">{currentQuestionIndex + 1}/{questions.length}</span>
            <span className="label">Question</span>
          </div>
          <div className="stat">
            <span className="value">{score}</span>
            <span className="label">Correct</span>
          </div>
          <div className="stat">
            <span className="value">{answeredQuestions.length > 0 ? Math.round((score / answeredQuestions.length) * 100) : 0}%</span>
            <span className="label">Accuracy</span>
          </div>
        </div>
      </header>

      {/* Question card */}
      <div className="question-card">
        <div className="question-header">
          <div className="question-number">
            Question {currentQuestionIndex + 1}
          </div>
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
        <h2 className="question-text">{currentQuestion.question_text}</h2>
        
        <div className="options-list" role="radiogroup" aria-label="Answer options">
          {options.map((option) => (
            <button
              key={option.index}
              className={`option-btn ${getOptionClass(option.index)}`}
              onClick={() => handleAnswerSelect(option.index)}
              disabled={isAnswered}
              role="radio"
              aria-checked={selectedAnswer === option.index}
            >
              <span className="option-letter">{String.fromCharCode(65 + option.index)}</span>
              <span className="option-text">{option.text}</span>
              {showResult && option.index === currentQuestion.correct_answer_index && (
                <svg className="result-icon correct" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {showResult && selectedAnswer === option.index && option.index !== currentQuestion.correct_answer_index && (
                <svg className="result-icon incorrect" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              )}
            </button>
          ))}
        </div>

        {/* Result message */}
        {showResult && (
          <div className={`result-message ${selectedAnswer === currentQuestion.correct_answer_index ? 'correct' : 'incorrect'}`}>
            {selectedAnswer === currentQuestion.correct_answer_index ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <span>Correct! Well done.</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="15" y1="9" x2="9" y2="15"/>
                  <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                <span>Incorrect. The correct answer is {currentQuestion.options[currentQuestion.correct_answer_index]}</span>
              </>
            )}
            {currentQuestion.explanation && (
              <p className="explanation">{currentQuestion.explanation}</p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="question-actions">
          <button 
            className="btn-secondary"
            onClick={handlePreviousQuestion}
            disabled={currentQuestionIndex === 0}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
            Previous
          </button>

          {!isAnswered ? (
            <button 
              className="btn-primary"
              onClick={handleSubmitAnswer}
              disabled={selectedAnswer === null}
            >
              Check Answer
            </button>
          ) : (
            <button 
              className="btn-primary"
              onClick={handleNextQuestion}
              disabled={currentQuestionIndex === questions.length - 1}
            >
              Next Question
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Question navigator */}
      <div className="question-navigator">
        <h3>Questions</h3>
        <div className="navigator-grid">
          {questions.map((_, index) => (
            <button
              key={index}
              className={`nav-dot ${index === currentQuestionIndex ? 'current' : ''} ${answeredQuestions.includes(index) ? 'answered' : ''}`}
              onClick={() => {
                setCurrentQuestionIndex(index);
                setSelectedAnswer(null);
                setShowResult(answeredQuestions.includes(index));
              }}
              aria-label={`Go to question ${index + 1}`}
            >
              {index + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
