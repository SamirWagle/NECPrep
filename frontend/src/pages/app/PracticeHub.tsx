import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getTopics, getMockTests, getUserProgress } from '../../services/api';
import type { Topic, MockTest, UserTopicStats } from '../../types/database.types';

// Loading skeleton component
function LoadingSkeleton() {
  return (
    <div className="loading-skeleton">
      <div className="skeleton-header">
        <div className="skeleton-title"></div>
        <div className="skeleton-subtitle"></div>
      </div>
      <div className="skeleton-grid">
        {[1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} className="skeleton-card"></div>
        ))}
      </div>
    </div>
  );
}

// Topic icon component
function TopicIcon({ icon, color }: { icon: string; color: string }) {
  const icons: Record<string, React.ReactNode> = {
    brain: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a9 9 0 0 1 9 9c0 3.074-1.676 5.59-3.442 7.395a20.194 20.194 0 0 1-2.398 2.064l-.353.256a1.5 1.5 0 0 1-1.614 0l-.353-.256a20.194 20.194 0 0 1-2.398-2.064C8.676 16.59 7 14.074 7 11a9 9 0 0 1 5-8.062"/>
        <circle cx="12" cy="11" r="3"/>
      </svg>
    ),
    cpu: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>
        <rect x="9" y="9" width="6" height="6"/>
        <line x1="9" y1="1" x2="9" y2="4"/>
        <line x1="15" y1="1" x2="15" y2="4"/>
        <line x1="9" y1="20" x2="9" y2="23"/>
        <line x1="15" y1="20" x2="15" y2="23"/>
        <line x1="20" y1="9" x2="23" y2="9"/>
        <line x1="20" y1="14" x2="23" y2="14"/>
        <line x1="1" y1="9" x2="4" y2="9"/>
        <line x1="1" y1="14" x2="4" y2="14"/>
      </svg>
    ),
    chip: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="4" width="16" height="16" rx="2"/>
        <path d="M9 1v3"/>
        <path d="M15 1v3"/>
        <path d="M9 20v3"/>
        <path d="M15 20v3"/>
        <path d="M20 9h3"/>
        <path d="M20 14h3"/>
        <path d="M1 9h3"/>
        <path d="M1 14h3"/>
      </svg>
    ),
    network: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="16" y="16" width="6" height="6" rx="1"/>
        <rect x="2" y="16" width="6" height="6" rx="1"/>
        <rect x="9" y="2" width="6" height="6" rx="1"/>
        <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/>
        <path d="M12 12V8"/>
      </svg>
    ),
    database: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="5" rx="9" ry="3"/>
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
      </svg>
    ),
    code: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
    settings: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
    book: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
    ),
    calculator: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="2" width="16" height="20" rx="2"/>
        <line x1="8" y1="6" x2="16" y2="6"/>
        <line x1="8" y1="10" x2="8" y2="10"/>
        <line x1="12" y1="10" x2="12" y2="10"/>
        <line x1="16" y1="10" x2="16" y2="10"/>
        <line x1="8" y1="14" x2="8" y2="14"/>
        <line x1="12" y1="14" x2="12" y2="14"/>
        <line x1="16" y1="14" x2="16" y2="14"/>
        <line x1="8" y1="18" x2="8" y2="18"/>
        <line x1="12" y1="18" x2="12" y2="18"/>
        <line x1="16" y1="18" x2="16" y2="18"/>
      </svg>
    ),
    monitor: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
    )
  };

  return (
    <div className="topic-icon" style={{ backgroundColor: `${color}15`, color }}>
      {icons[icon] || icons.book}
    </div>
  );
}

export default function PracticeHub() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [mockTests, setMockTests] = useState<MockTest[]>([]);
  const [topicProgress, setTopicProgress] = useState<Map<string, UserTopicStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [totalQuestions, setTotalQuestions] = useState(0);

  useEffect(() => {
    let isMounted = true;
    
    async function loadData() {
      console.log('🔄 Loading practice data...');
      if (!isMounted) return;
      
      setLoading(true);
      try {
        console.log('📡 Calling getTopics()...');
        const topicsData = await getTopics();
        if (!isMounted) return;
        console.log('✅ Topics loaded:', topicsData);
        
        console.log('📡 Calling getMockTests()...');
        const mockTestsData = await getMockTests();
        if (!isMounted) return;
        console.log('✅ Mock tests loaded:', mockTestsData);
        
        console.log('📡 Calling getUserProgress()...');
        const progressData = await getUserProgress().catch((err) => {
          console.warn('⚠️ Progress data failed (non-critical):', err);
          return { overall: null, topics: [] };
        });
        if (!isMounted) return;
        console.log('✅ Progress loaded:', progressData);
        
        setTopics(topicsData);
        setMockTests(mockTestsData);
        
        // Calculate total questions
        const total = topicsData.reduce((sum, t) => sum + (t.question_count || 0), 0);
        setTotalQuestions(total);
        console.log('📊 Total questions:', total);
        
        // Create progress map for easy lookup
        const progressMap = new Map<string, UserTopicStats>();
        progressData.topics.forEach(tp => {
          progressMap.set(tp.topic_id, tp);
        });
        setTopicProgress(progressMap);
        
        console.log('✅ All data loaded successfully!');
      } catch (err) {
        console.error('❌ Error loading practice data:', err);
        if (!isMounted) return;
        
        // Show user-friendly error
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        alert(`Failed to load practice data:\n\n${errorMessage}\n\nPlease:\n1. Check your internet connection\n2. Make sure you've run setup_chapters.sql in Supabase\n3. Refresh the page`);
      } finally {
        if (isMounted) {
          console.log('🏁 Setting loading to false');
          setLoading(false);
        }
      }
    }
    
    loadData();
    
    return () => {
      isMounted = false;
    };
  }, []);

  console.log('🎨 Rendering PracticeHub - loading:', loading, 'topics:', topics.length);

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (topics.length === 0) {
    return (
      <div className="practice-hub-page">
        <header className="page-header">
          <h1>Practice Questions</h1>
          <p>No topics found. Please check your database.</p>
        </header>
      </div>
    );
  }

  return (
    <div className="practice-hub-page">
      {/* Page header */}
      <header className="page-header">
        <h1>Practice Questions</h1>
        <p>Test your knowledge with {totalQuestions.toLocaleString()}+ questions across all topics</p>
      </header>

      {/* Practice modes */}
      <section className="practice-modes" aria-labelledby="modes-title">
        <h2 id="modes-title" className="sr-only">Practice Modes</h2>
        <div className="modes-grid">
          <Link to="/app/practice/mock-tests" className="mode-card mode-mock">
            <div className="mode-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 6v6l4 2"/>
              </svg>
            </div>
            <div className="mode-content">
              <h3>Mock Tests</h3>
              <p>Simulate the real exam with timed full-length tests</p>
            </div>
            <span className="mode-badge">{mockTests.length} tests</span>
          </Link>

          <div className="mode-card mode-quick">
            <div className="mode-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
            </div>
            <div className="mode-content">
              <h3>Quick Practice</h3>
              <p>10 random questions across all topics</p>
            </div>
            <button className="mode-btn">Start</button>
          </div>

          <div className="mode-card mode-custom">
            <div className="mode-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </div>
            <div className="mode-content">
              <h3>Custom Practice</h3>
              <p>Choose topics and number of questions</p>
            </div>
            <button className="mode-btn">Configure</button>
          </div>
        </div>
      </section>

      {/* Chapters grid */}
      <section className="practice-topics" aria-labelledby="topics-title">
        <h2 id="topics-title">Practice by Chapter</h2>
        <p className="section-subtitle">Select a chapter to practice. Questions are randomly selected from our dataset.</p>
        <div className="topics-grid">
          {topics.map((topic) => {
            const stats = topicProgress.get(topic.id);
            const progress = stats?.completion_percentage || 0;
            const questionsAnswered = stats?.total_questions_attempted || 0;
            const isAvailable = topic.question_count > 0;
            
            // If chapter is available, make it a link. Otherwise, render as disabled div
            const CardWrapper = isAvailable ? Link : 'div';
            const cardProps = isAvailable 
              ? { to: `/app/practice/chapter/${topic.id}` }
              : {};
            
            return (
              <CardWrapper
                key={topic.id}
                className={`topic-card ${!isAvailable ? 'disabled' : ''}`}
                {...cardProps}
              >
                <TopicIcon icon={topic.icon || 'Brain'} color={topic.color || '#6366f1'} />
                <div className="topic-content">
                  <h3>{topic.name}</h3>
                  <p>{topic.description}</p>
                  <div className="topic-meta">
                    {isAvailable ? (
                      <>
                        <span className="question-count">{topic.question_count} questions</span>
                        {questionsAnswered > 0 && (
                          <span className="progress-badge" style={{ color: topic.color || '#6366f1' }}>
                            {Math.round(progress)}% complete
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="coming-soon-badge">Coming Soon</span>
                    )}
                  </div>
                  {isAvailable && questionsAnswered > 0 && (
                    <div className="progress-bar-container">
                      <div 
                        className="progress-bar-fill" 
                        style={{ width: `${progress}%`, backgroundColor: topic.color || '#6366f1' }}
                      />
                    </div>
                  )}
                </div>
              </CardWrapper>
            );
          })}
        </div>
      </section>
    </div>
  );
}
