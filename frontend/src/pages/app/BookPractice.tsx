import { Link } from 'react-router-dom';
import { bookChapters, getTopicProgress } from '../../services/localData';

export default function BookPractice() {
  return (
    <div className="book-practice-page">
      <header className="page-header">
        <h1>Book Practice</h1>
        <p>Practice questions from the Engineering License exam textbook — chapters are added as you upload them.</p>
      </header>

      <div className="book-chapters-grid">
        {bookChapters.map((chapter) => {
          const tp = getTopicProgress(chapter.id);
          const attempted = tp.attempted.length;
          const correct = tp.correct.length;
          const progress = chapter.questionCount > 0
            ? Math.round((attempted / chapter.questionCount) * 100)
            : 0;
          const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;

          return (
            <div key={chapter.id} className="book-chapter-card" style={{ borderColor: chapter.color }}>
              <div className="chapter-card-header" style={{ background: `linear-gradient(135deg, ${chapter.color}22, ${chapter.color}44)` }}>
                <div className="chapter-number-badge" style={{ backgroundColor: chapter.color }}>
                  {chapter.id.replace('book-ch', 'Ch')}
                </div>
                <div className="chapter-stats-top">
                  <span className="q-count">{chapter.questionCount} questions</span>
                  {attempted > 0 && (
                    <span className="accuracy-badge" style={{ color: chapter.color }}>
                      {accuracy}% accuracy
                    </span>
                  )}
                </div>
              </div>

              <div className="chapter-card-body">
                <h2>{chapter.name}</h2>
                <p>{chapter.description}</p>

                <div className="chapter-progress">
                  <div className="progress-label">
                    <span>Progress</span>
                    <span style={{ color: chapter.color }}>{progress}%</span>
                  </div>
                  <div className="progress-bar-container">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${progress}%`, backgroundColor: chapter.color }}
                    />
                  </div>
                  <span className="progress-detail">{attempted} / {chapter.questionCount} attempted</span>
                </div>
              </div>

              <div className="chapter-card-footer">
                <Link
                  to={`/app/practice/chapter/${chapter.id}`}
                  className="chapter-practice-btn"
                  style={{ backgroundColor: chapter.color }}
                >
                  Practice Now
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      <div className="upload-hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12l7-7 7 7" />
        </svg>
        <p>
          More chapters coming soon. Drop new <code>chN.json</code> files in{' '}
          <code>datasets/BooksQuestions/</code> and they'll appear here automatically.
        </p>
      </div>
    </div>
  );
}
