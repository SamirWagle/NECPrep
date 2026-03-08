import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import {
  getMockTestById,
  loadQuestionsSlice,
  recordAttempt,
  saveQuizResult,
} from '../../services/localData';
import type { Question } from '../../services/localData';
import { useChapters } from '../../hooks/useChapters';

const PAGE_SIZE = 10;

function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function MockTestQuiz() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const bookChapters = useChapters();
  const test = testId ? getMockTestById(testId) : null;
  const qPerChapter = test?.questionsPerChapter ?? 10;

  // ── Loading ────────────────────────────────────────────────────────────────
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading]     = useState(true);
  const [loadErr, setLoadErr]     = useState<string | null>(null);

  useEffect(() => {
    if (!test || bookChapters.length === 0) return;
    Promise.all(bookChapters.map(ch => loadQuestionsSlice(ch.id, qPerChapter)))
      .then(results => {
        const combined: Question[] = [];
        for (const chQs of results) combined.push(...chQs);
        if (combined.length === 0) {
          setLoadErr('No questions found. Check that chapter files are available.');
        } else {
          setQuestions(shuffle(combined));
        }
      })
      .catch(() => setLoadErr('Failed to load questions. Please try again.'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Quiz state ─────────────────────────────────────────────────────────────
  // answers[i] = chosen option index (0-based), null if unanswered. Editable anytime before submit.
  const [answers, setAnswers]   = useState<(number | null)[]>([]);
  const [page, setPage]         = useState(0);
  const [done, setDone]         = useState(false);
  const [finalScore, setFinalScore] = useState(0);

  useEffect(() => {
    if (questions.length > 0) setAnswers(new Array(questions.length).fill(null));
  }, [questions.length]);

  // ── Timer ──────────────────────────────────────────────────────────────────
  const [timeLeft, setTimeLeft] = useState((test?.duration ?? 45) * 60);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (loading || questions.length === 0 || done) return;
    timerRef.current = setInterval(() => setTimeLeft(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(timerRef.current!);
  }, [loading, questions.length, done]);

  // Auto-submit when timer hits zero
  const savedRef = useRef(false);
  useEffect(() => {
    if (timeLeft === 0 && !done && questions.length > 0 && !savedRef.current) {
      doSubmit(answers);
    }
  }, [timeLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Submit ─────────────────────────────────────────────────────────────────
  const doSubmit = (currentAnswers: (number | null)[]) => {
    if (savedRef.current) return;
    savedRef.current = true;
    clearInterval(timerRef.current!);
    let score = 0;
    questions.forEach((q, i) => {
      const sel = currentAnswers[i];
      const correct = sel !== null && sel === q.correctIndex;
      if (correct) score++;
      if (sel !== null) recordAttempt(q.id, q.topicId, correct);
    });
    setFinalScore(score);
    saveQuizResult({
      topicId:   test!.id,
      topicName: test!.name,
      score,
      total:     questions.length,
      date:      new Date().toISOString(),
    });
    setDone(true);
  };

  // ── Pagination helpers ─────────────────────────────────────────────────────
  const totalPages   = Math.max(1, Math.ceil(questions.length / PAGE_SIZE));
  const pageStart    = page * PAGE_SIZE;
  const pageQs       = questions.slice(pageStart, pageStart + PAGE_SIZE);
  const answeredCount = answers.filter(a => a !== null).length;
  const isLowTime    = timeLeft < 60;

  // ── Guard renders ──────────────────────────────────────────────────────────
  if (!test) return (
    <div className="topic-not-found">
      <h2>Test not found</h2>
      <Link to="/app/mock-tests" className="btn-primary">Back to Mock Tests</Link>
    </div>
  );

  if (loading) return (
    <div className="loading-container">
      <div className="loading-spinner" />
      <p>Loading {bookChapters.length} chapters &times; {qPerChapter} questions…</p>
    </div>
  );

  if (loadErr) return (
    <div className="topic-not-found">
      <h2>{loadErr}</h2>
      <Link to="/app/mock-tests" className="btn-primary">Back to Mock Tests</Link>
    </div>
  );

  // ── Results screen ─────────────────────────────────────────────────────────
  if (done) {
    const pct      = Math.round((finalScore / questions.length) * 100);
    const skipped  = answers.filter(a => a === null).length;
    const wrong    = questions.length - finalScore - skipped;

    return (
      <div className="mock-results-page">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/app/mock-tests">Mock Tests</Link>
          <span className="separator">/</span>
          <span className="current">{test.name} — Results</span>
        </nav>

        <div className="results-summary-card">
          <div className="complete-icon">{pct >= 60 ? '🎉' : '📚'}</div>
          <h2>Test Complete!</h2>
          <p className="complete-topic">{test.name}</p>
          <div className="complete-score">
            <span className="score-number">{finalScore}</span>
            <span className="score-total">/ {questions.length}</span>
          </div>
          <p className="complete-pct">{pct}% accuracy</p>
          <div className="results-stats-row">
            <div className="rs-stat correct"><span>{finalScore}</span>Correct</div>
            <div className="rs-stat incorrect"><span>{wrong}</span>Incorrect</div>
            <div className="rs-stat skipped"><span>{skipped}</span>Skipped</div>
          </div>
          <div className="complete-actions">
            <button className="btn-primary" onClick={() => navigate(`/app/mock-tests/${test.id}`)}>
              Try Again
            </button>
            <Link to="/app/mock-tests" className="btn-secondary">All Tests</Link>
          </div>
        </div>

        <h3 className="detailed-review-heading">Detailed Review</h3>
        <div className="detailed-review-list">
          {questions.map((q, i) => {
            const sel       = answers[i];
            const isCorrect = sel !== null && sel === q.correctIndex;
            const isSkipped = sel === null;
            const status    = isSkipped ? 'skipped' : isCorrect ? 'correct' : 'incorrect';
            return (
              <div key={q.id} className={`review-card ${status}`}>
                <div className="review-q-header">
                  <span className="review-q-num">Q{i + 1}</span>
                  <span className={`review-badge ${status}`}>
                    {isSkipped ? 'Skipped' : isCorrect ? 'Correct' : 'Incorrect'}
                  </span>
                </div>
                <p className="review-question">{q.question}</p>
                <div className="review-options">
                  {q.options.map((opt, oi) => {
                    const isTheCorrect = oi === q.correctIndex;
                    const isUserWrong  = oi === sel && !isCorrect;
                    return (
                      <div
                        key={oi}
                        className={`review-opt ${isTheCorrect ? 'review-opt-correct' : isUserWrong ? 'review-opt-wrong' : ''}`}
                      >
                        <span className="review-opt-letter">{String.fromCharCode(65 + oi)}</span>
                        <span className="review-opt-text">{opt}</span>
                        {isTheCorrect && <span className="review-opt-tag correct">✓ Correct</span>}
                        {isUserWrong  && <span className="review-opt-tag wrong">✗ Your answer</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Quiz screen — paginated ────────────────────────────────────────────────
  return (
    <div className="mock-quiz-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/app/mock-tests">Mock Tests</Link>
        <span className="separator">/</span>
        <span className="current">{test.name}</span>
      </nav>

      <header className="mock-quiz-header">
        <div className="quiz-header-info">
          <h1>{test.name}</h1>
          <p className="quiz-meta">
            Page {page + 1} of {totalPages}&nbsp;&nbsp;·&nbsp;&nbsp;{answeredCount} / {questions.length} answered
          </p>
        </div>
        <div className={`quiz-timer ${isLowTime ? 'low' : ''}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          {fmt(timeLeft)}
        </div>
      </header>

      <div className="mock-questions-list">
        {pageQs.map((q, localIdx) => {
          const globalIdx = pageStart + localIdx;
          const sel       = answers[globalIdx] ?? null;
          return (
            <div key={q.id} className="mock-question-card">
              <div className="mock-q-header">
                <span className="mock-q-num">Question {globalIdx + 1}</span>
                {sel !== null && <span className="mock-q-answered-badge">Answered</span>}
              </div>
              <p className="mock-q-text">{q.question}</p>
              <div className="mock-options" role="radiogroup" aria-label={`Options for question ${globalIdx + 1}`}>
                {q.options.map((opt, oi) => (
                  <button
                    key={oi}
                    className={`mock-opt-btn ${sel === oi ? 'selected' : ''}`}
                    onClick={() => {
                      const next = [...answers];
                      next[globalIdx] = oi;
                      setAnswers(next);
                    }}
                    role="radio"
                    aria-checked={sel === oi}
                  >
                    <span className="option-letter">{String.fromCharCode(65 + oi)}</span>
                    <span className="option-text">{opt}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mock-page-nav">
        <button
          className="btn-secondary"
          onClick={() => setPage(p => p - 1)}
          disabled={page === 0}
        >
          ← Previous
        </button>

        <div className="mock-page-dots">
          {Array.from({ length: totalPages }, (_, i) => {
            const start      = i * PAGE_SIZE;
            const pageAll    = questions.slice(start, start + PAGE_SIZE);
            const allDone    = pageAll.length > 0 && pageAll.every((_, li) => answers[start + li] !== null);
            return (
              <button
                key={i}
                className={`page-dot ${page === i ? 'active' : ''} ${allDone ? 'done' : ''}`}
                onClick={() => setPage(i)}
                title={`Page ${i + 1}`}
                aria-label={`Go to page ${i + 1}`}
              />
            );
          })}
        </div>

        {page < totalPages - 1 ? (
          <button className="btn-primary" onClick={() => setPage(p => p + 1)}>
            Next →
          </button>
        ) : (
          <button className="btn-submit" onClick={() => doSubmit(answers)}>
            Submit Test
          </button>
        )}
      </div>
    </div>
  );
}
