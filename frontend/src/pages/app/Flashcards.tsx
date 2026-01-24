import { useState } from 'react';
import { topics } from '../../data/topics';

// Mock flashcard data
const mockFlashcards = [
  { id: 1, front: "What is Ohm's Law?", back: "V = IR (Voltage = Current × Resistance)", topicId: 'concept-of-basic-electrical-and-electronics-engineering' },
  { id: 2, front: "What is the time complexity of binary search?", back: "O(log n)", topicId: 'data-structures-and-algorithm-database-system-and-operating-system' },
  { id: 3, front: "What is TCP?", back: "Transmission Control Protocol - A connection-oriented protocol that provides reliable, ordered delivery of data", topicId: 'concept-of-computer-network-and-network-security-system' },
  { id: 4, front: "What is a pointer in C?", back: "A variable that stores the memory address of another variable", topicId: 'programming-language-and-its-application' },
  { id: 5, front: "What is SDLC?", back: "Software Development Life Cycle - A process used for planning, creating, testing, and deploying software", topicId: 'software-engineering-and-object-oriented-analysis-and-design' },
];

export default function Flashcards() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);

  const filteredCards = selectedTopic 
    ? mockFlashcards.filter(c => c.topicId === selectedTopic)
    : mockFlashcards;

  const currentCard = filteredCards[currentIndex];

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  const handleNext = () => {
    if (currentIndex < filteredCards.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setIsFlipped(false);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setIsFlipped(false);
    }
  };

  const handleTopicChange = (topicId: string | null) => {
    setSelectedTopic(topicId);
    setCurrentIndex(0);
    setIsFlipped(false);
  };

  return (
    <div className="flashcards-page">
      {/* Page header */}
      <header className="page-header">
        <h1>Flashcards</h1>
        <p>Quick revision with interactive flashcards</p>
      </header>

      {/* Topic filter */}
      <div className="topic-filter">
        <label htmlFor="topic-select" className="sr-only">Filter by topic</label>
        <select 
          id="topic-select"
          value={selectedTopic || ''}
          onChange={(e) => handleTopicChange(e.target.value || null)}
          className="topic-select"
        >
          <option value="">All Topics</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>{topic.shortName}</option>
          ))}
        </select>
        <span className="card-count">{filteredCards.length} cards</span>
      </div>

      {/* Flashcard area */}
      {filteredCards.length > 0 ? (
        <>
          <div className="flashcard-container">
            <div 
              className={`flashcard ${isFlipped ? 'flipped' : ''}`}
              onClick={handleFlip}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleFlip()}
              aria-label={isFlipped ? 'Click to see question' : 'Click to see answer'}
            >
              <div className="flashcard-inner">
                <div className="flashcard-front">
                  <span className="card-label">Question</span>
                  <p>{currentCard?.front}</p>
                  <span className="flip-hint">Click to reveal answer</span>
                </div>
                <div className="flashcard-back">
                  <span className="card-label">Answer</span>
                  <p>{currentCard?.back}</p>
                  <span className="flip-hint">Click to see question</span>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div className="flashcard-nav">
            <button 
              className="nav-btn"
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              aria-label="Previous card"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            
            <span className="card-progress">
              {currentIndex + 1} / {filteredCards.length}
            </span>
            
            <button 
              className="nav-btn"
              onClick={handleNext}
              disabled={currentIndex === filteredCards.length - 1}
              aria-label="Next card"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>

          {/* Actions */}
          <div className="flashcard-actions">
            <button className="action-btn know">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              I know this
            </button>
            <button className="action-btn review">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2.5 2v6h6M21.5 22v-6h-6"/>
                <path d="M22 11.5A10 10 0 0 0 3.2 7.2M2 12.5a10 10 0 0 0 18.8 4.2"/>
              </svg>
              Review later
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="M10 4v4"/>
            <path d="M2 8h20"/>
            <path d="M6 4v4"/>
          </svg>
          <h3>No flashcards available</h3>
          <p>No flashcards found for the selected topic</p>
        </div>
      )}
    </div>
  );
}
