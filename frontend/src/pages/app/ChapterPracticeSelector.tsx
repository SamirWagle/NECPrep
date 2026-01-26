import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getTopic } from '../../services/api';
import type { Topic } from '../../types/database.types';
import ThreeBackground from '../../components/ThreeBackground';
import './ChapterSelector.css';

export default function ChapterPracticeSelector() {
  const { chapterId } = useParams<{ chapterId: string }>();
  const navigate = useNavigate();
  const [chapter, setChapter] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  useEffect(() => {
    async function loadChapter() {
      if (!chapterId) return;
      try {
        const data = await getTopic(chapterId);
        setChapter(data);
      } catch (err) {
        console.error('Error loading chapter:', err);
      } finally {
        setLoading(false);
      }
    }
    loadChapter();
  }, [chapterId]);

  const handleStartPractice = (questionCount: number) => {
    setSelectedOption(questionCount);
    setTimeout(() => {
      navigate(`/app/practice/topic/${chapterId}?count=${questionCount}`);
    }, 300);
  };

  if (loading) {
    return (
      <div className="chapter-selector-container">
        <ThreeBackground />
        <div className="chapter-selector-content">
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Loading chapter...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!chapter) {
    return (
      <div className="chapter-selector-container">
        <ThreeBackground />
        <div className="chapter-selector-content">
          <div className="error-message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <h2>Chapter Not Found</h2>
            <button onClick={() => navigate('/app/practice')} className="btn-primary">
              Return to Chapters
            </button>
          </div>
        </div>
      </div>
    );
  }

  const practiceOptions = [
    {
      count: 10,
      duration: '15 min',
      label: 'Quick Practice',
      description: 'Perfect for a quick review session',
      icon: '⚡',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
    },
    {
      count: 30,
      duration: '45 min',
      label: 'Standard Practice',
      description: 'Recommended for comprehensive learning',
      icon: '🎯',
      gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      recommended: true
    },
    {
      count: 50,
      duration: '75 min',
      label: 'Full Practice',
      description: 'Deep dive into the chapter content',
      icon: '🚀',
      gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
    }
  ];

  return (
    <div className="chapter-selector-container">
      <ThreeBackground />
      
      <div className="chapter-selector-content">
        {/* Header Section */}
        <header className="selector-header-modern">
          <button onClick={() => navigate('/app/practice')} className="back-btn-modern">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            <span>Back</span>
          </button>

          <div className="chapter-hero">
            <div className="chapter-icon-large" style={{ 
              background: `linear-gradient(135deg, ${chapter.color}22 0%, ${chapter.color}44 100%)`,
              boxShadow: `0 8px 32px ${chapter.color}33`
            }}>
              <div className="icon-glow" style={{ backgroundColor: chapter.color }}></div>
              <span style={{ fontSize: '48px' }}>📚</span>
            </div>
            
            <div className="chapter-details">
              <h1 className="chapter-title-modern">{chapter.name}</h1>
              <p className="chapter-desc-modern">{chapter.description}</p>
              
              <div className="chapter-stats">
                <div className="stat-badge" style={{ backgroundColor: `${chapter.color}15`, color: chapter.color }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 11l3 3L22 4"/>
                    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                  </svg>
                  <span>{chapter.question_count} Questions</span>
                </div>
                <div className="stat-badge" style={{ backgroundColor: `${chapter.color}15`, color: chapter.color }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span>Self-Paced</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Practice Options */}
        <section className="practice-section-modern">
          <div className="section-header">
            <h2>Choose Your Practice Mode</h2>
            <p>Select the number of questions for your practice session</p>
          </div>

          <div className="options-grid-modern">
            {practiceOptions.map((option) => (
              <button
                key={option.count}
                className={`practice-card-modern ${selectedOption === option.count ? 'selected' : ''} ${option.recommended ? 'recommended' : ''}`}
                onClick={() => handleStartPractice(option.count)}
                style={{
                  borderColor: selectedOption === option.count ? chapter.color : 'transparent'
                }}
              >
                {option.recommended && (
                  <div className="recommended-badge" style={{ background: chapter.color }}>
                    ⭐ Recommended
                  </div>
                )}
                
                <div className="card-icon" style={{ background: option.gradient }}>
                  <span>{option.icon}</span>
                </div>
                
                <div className="card-count" style={{ color: chapter.color }}>
                  {option.count}
                </div>
                <div className="card-label">Questions</div>
                
                <div className="card-info">
                  <div className="info-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    <span>~{option.duration}</span>
                  </div>
                  <div className="card-description">{option.description}</div>
                </div>

                <div className="card-footer">
                  <span>{option.label}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </div>
              </button>
            ))}
          </div>

          <div className="info-card-modern">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <div>
              <strong>Random Selection:</strong> Questions are randomly picked from {chapter.question_count} available questions to ensure variety in each practice session.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
