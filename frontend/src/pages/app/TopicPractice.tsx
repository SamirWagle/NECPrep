import { useParams, Link } from 'react-router-dom';
import { getTopicById, type Question } from '../../data/topics';
import { useState, useEffect } from 'react';

// Mock questions for demo - in production, these would be loaded from the JSON files
const mockQuestions: Question[] = [
  {
    qsns: "Which of the following best describes Ohm's Law?",
    opt1: "The relationship between voltage and power",
    opt2: "The relationship between current and resistance",
    opt3: "The relationship between voltage and current",
    opt4: "The relationship between resistance and power",
    correct_option: "The relationship between voltage and current",
    correct_option_index: 3
  },
  {
    qsns: "What is the unit of electrical resistance?",
    opt1: "Volt",
    opt2: "Ampere",
    opt3: "Watt",
    opt4: "Ohm",
    correct_option: "Ohm",
    correct_option_index: 4
  },
  {
    qsns: "Which of the following is a correct expression of Ohm's Law?",
    opt1: "I=VR",
    opt2: "R=VI",
    opt3: "V=IR",
    opt4: "R=IV",
    correct_option: "V=IR",
    correct_option_index: 3
  }
];

export default function TopicPractice() {
  const { topicId } = useParams<{ topicId: string }>();
  const topic = topicId ? getTopicById(topicId) : null;
  
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [answeredQuestions, setAnsweredQuestions] = useState<number[]>([]);

  const currentQuestion = mockQuestions[currentQuestionIndex];
  const isAnswered = answeredQuestions.includes(currentQuestionIndex);

  useEffect(() => {
    // Reset state when topic changes
    setCurrentQuestionIndex(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    setAnsweredQuestions([]);
  }, [topicId]);

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
        <Link to="/app/practice" className="btn-primary">Back to Practice</Link>
      </div>
    );
  }

  const handleAnswerSelect = (index: number) => {
    if (isAnswered) return;
    setSelectedAnswer(index);
  };

  const handleSubmitAnswer = () => {
    if (selectedAnswer === null || isAnswered) return;
    
    setAnsweredQuestions([...answeredQuestions, currentQuestionIndex]);
    setShowResult(true);
    
    if (selectedAnswer === currentQuestion.correct_option_index) {
      setScore(score + 1);
    }
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < mockQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    }
  };

  const handlePreviousQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
      setSelectedAnswer(null);
      setShowResult(false);
    }
  };

  const getOptionClass = (index: number) => {
    if (!showResult) {
      return selectedAnswer === index ? 'selected' : '';
    }
    
    if (index === currentQuestion.correct_option_index) {
      return 'correct';
    }
    
    if (selectedAnswer === index && index !== currentQuestion.correct_option_index) {
      return 'incorrect';
    }
    
    return '';
  };

  const options = [
    { index: 1, text: currentQuestion.opt1 },
    { index: 2, text: currentQuestion.opt2 },
    { index: 3, text: currentQuestion.opt3 },
    { index: 4, text: currentQuestion.opt4 },
  ];

  return (
    <div className="topic-practice-page">
      {/* Breadcrumb */}
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/app/practice">Practice</Link>
        <span className="separator">/</span>
        <span className="current">{topic.shortName}</span>
      </nav>

      {/* Topic header */}
      <header className="topic-header" style={{ borderColor: `${topic.color}40` }}>
        <div className="topic-info">
          <h1>{topic.name}</h1>
          <p>{topic.description}</p>
        </div>
        <div className="topic-stats">
          <div className="stat">
            <span className="value">{currentQuestionIndex + 1}/{mockQuestions.length}</span>
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
        <div className="question-number">
          Question {currentQuestionIndex + 1}
        </div>
        <h2 className="question-text">{currentQuestion.qsns}</h2>
        
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
              <span className="option-letter">{String.fromCharCode(64 + option.index)}</span>
              <span className="option-text">{option.text}</span>
              {showResult && option.index === currentQuestion.correct_option_index && (
                <svg className="result-icon correct" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
              {showResult && selectedAnswer === option.index && option.index !== currentQuestion.correct_option_index && (
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
          <div className={`result-message ${selectedAnswer === currentQuestion.correct_option_index ? 'correct' : 'incorrect'}`}>
            {selectedAnswer === currentQuestion.correct_option_index ? (
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
                <span>Incorrect. The correct answer is {currentQuestion.correct_option}</span>
              </>
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
              disabled={currentQuestionIndex === mockQuestions.length - 1}
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
          {mockQuestions.map((_, index) => (
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
