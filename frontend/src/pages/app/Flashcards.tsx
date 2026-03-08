import { useState, useEffect, useCallback, useRef } from 'react';
import { loadTopicQuestions } from '../../services/localData';
import { useChapters } from '../../hooks/useChapters';
import type { Question } from '../../services/localData';

interface Flashcard {
  id: string;
  front: string;
  back: string;
}

function questionsToFlashcards(questions: Question[]): Flashcard[] {
  return questions
    .filter(q => q.correctIndex >= 0 && q.options[q.correctIndex])
    .map(q => ({
      id: q.id,
      front: q.question,
      back: q.options[q.correctIndex],
    }));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Flashcards() {
  const bookChapters = useChapters();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState('');
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedChapter) {
      setFlashcards([]);
      return;
    }
    setLoading(true);
    setCurrentIndex(0);
    setIsFlipped(false);
    loadTopicQuestions(selectedChapter).then(questions => {
      setFlashcards(shuffle(questionsToFlashcards(questions)));
      setLoading(false);
    });
  }, [selectedChapter]);

  const currentCard = flashcards[currentIndex];

  const lastFlipTime = useRef(0);

  const handleFlip = useCallback((e?: React.SyntheticEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    // Prevent double-firing ghost clicks by enforcing a 400ms cooldown
    const now = Date.now();
    if (now - lastFlipTime.current < 400) {
      return;
    }
    lastFlipTime.current = now;

    setIsFlipped(f => !f);
  }, []);

  const handleNext = () => {
    if (currentIndex < flashcards.length - 1) {
      setCurrentIndex(i => i + 1);
      setIsFlipped(false);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1);
      setIsFlipped(false);
    }
  };

  const handleShuffle = () => {
    setFlashcards(prev => shuffle([...prev]));
    setCurrentIndex(0);
    setIsFlipped(false);
  };

  return (
    <div className="flashcards-page">
      {/* Page header */}
      <header className="page-header">
        <h1>Flashcards</h1>
        <p>Quick revision — select a chapter to get randomly shuffled questions</p>
      </header>

      {/* Chapter selector */}
      <div className="topic-filter">
        <label htmlFor="topic-select" className="sr-only">Select chapter</label>
        <select
          id="topic-select"
          value={selectedChapter}
          onChange={e => setSelectedChapter(e.target.value)}
          className="topic-select"
        >
          <option value="">— Select a chapter —</option>
          {bookChapters.map(ch => (
            <option key={ch.id} value={ch.id}>{ch.shortName}</option>
          ))}
        </select>
        {flashcards.length > 0 && (
          <span className="card-count">{flashcards.length} cards</span>
        )}
        {flashcards.length > 0 && (
          <button className="shuffle-btn" onClick={handleShuffle} aria-label="Shuffle cards">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="16 3 21 3 21 8"/>
              <line x1="4" y1="20" x2="21" y2="3"/>
              <polyline points="21 16 21 21 16 21"/>
              <line x1="15" y1="15" x2="21" y2="21"/>
            </svg>
            Shuffle
          </button>
        )}
      </div>

      {/* Initial prompt */}
      {!selectedChapter && (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="M10 4v4"/>
            <path d="M2 8h20"/>
            <path d="M6 4v4"/>
          </svg>
          <h3>Select a chapter to begin</h3>
          <p>Choose a chapter from the dropdown above to load randomly shuffled flashcards</p>
        </div>
      )}

      {/* Loading */}
      {selectedChapter && loading && (
        <div className="flashcard-loading">
          <div className="loading-spinner" />
          <p>Loading flashcards…</p>
        </div>
      )}

      {/* Cards */}
      {selectedChapter && !loading && flashcards.length > 0 && (
        <>
          <div className="flashcard-container">
            <div
              className={`flashcard ${isFlipped ? 'flipped' : ''}`}
              onClick={handleFlip}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && handleFlip()}
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
            <span className="card-progress">{currentIndex + 1} / {flashcards.length}</span>
            <button
              className="nav-btn"
              onClick={handleNext}
              disabled={currentIndex === flashcards.length - 1}
              aria-label="Next card"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>

          {/* Actions */}
          <div className="flashcard-actions">
            <button className="action-btn know" onClick={handleNext}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              I know this
            </button>
            <button className="action-btn review" onClick={handleNext}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2.5 2v6h6M21.5 22v-6h-6"/>
                <path d="M22 11.5A10 10 0 0 0 3.2 7.2M2 12.5a10 10 0 0 0 18.8 4.2"/>
              </svg>
              Review later
            </button>
          </div>
        </>
      )}

      {/* No cards after load */}
      {selectedChapter && !loading && flashcards.length === 0 && (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="M10 4v4"/>
            <path d="M2 8h20"/>
            <path d="M6 4v4"/>
          </svg>
          <h3>No flashcards available</h3>
          <p>This chapter has no questions with answer data yet</p>
        </div>
      )}
    </div>
  );
}
