/**
 * CustomPractice — pick chapters and a question count, then practise.
 *
 * Hosts the shared quiz engine; see TopicPractice for why all four quiz pages
 * went from four copies of the state machine to one.
 *
 * The config screen stays local to this page: it is this page's whole reason to
 * exist, and the engine has nothing to say about it. The engine is held back
 * with `enabled: false` until the config is submitted, so nothing loads and no
 * draft is written while the user is still choosing.
 */

import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useQuiz,
  useQuizKeyboard,
  QuestionCard,
  QuestionPalette,
  QuizActionBar,
  QuizToolbar,
  ResultSummary,
  ExplanationPanel,
} from '../../features/quiz';
import { loadQuestionsSlice, saveQuizResult } from '../../services/localData';
import type { Question, QuizSummary } from '../../features/quiz';
import { fisherYates } from '../../services/optionOrdering';
import { useChapters } from '../../hooks/useChapters';

export default function CustomPractice() {
  const chapters = useChapters();

  // All chapters start selected. The manifest is static, so this is a lazy
  // initializer rather than a set-state-in-effect round trip.
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(
    () => new Set(chapters.map((t) => t.id))
  );
  const [count, setCount] = useState(20);
  const [configError, setConfigError] = useState<string | null>(null);

  /**
   * The submitted config. Null means the config screen is still open.
   *
   * This is the attempt's identity: starting a new run with different choices
   * produces a different key, which is what makes the engine abandon the old
   * attempt instead of mutating it.
   */
  const [started, setStarted] = useState<{ topics: string[]; count: number } | null>(null);

  const attemptKey = started ? `custom:${started.topics.join(',')}:${started.count}` : null;

  const loadQuestions = useCallback(async (): Promise<Question[]> => {
    if (!started) return [];
    const sources = chapters.filter((c) => started.topics.includes(c.id));
    const perChapter = Math.max(1, Math.ceil(started.count / sources.length));
    const results = await Promise.all(
      sources.map((source) => loadQuestionsSlice(source.id, perChapter))
    );
    return fisherYates(results.flat()).slice(0, started.count);
  }, [started, chapters]);

  const onComplete = useCallback((summary: QuizSummary) => {
    saveQuizResult({
      topicId: 'custom-practice',
      topicName: 'Custom Practice',
      score: summary.score,
      total: summary.total,
      date: new Date().toISOString(),
    });
  }, []);

  const quiz = useQuiz({
    mode: 'custom',
    attemptKey,
    loadQuestions,
    enabled: started !== null,
    onComplete,
  });

  useQuizKeyboard({
    optionCount: quiz.current?.options.length ?? 0,
    onSelectOption: quiz.selectOption,
    onSubmitOrAdvance: quiz.submitOrAdvance,
    onPrev: quiz.prev,
    onNext: quiz.next,
    onToggleFlag: quiz.toggleFlag,
    onToggleBookmark: quiz.toggleBookmark,
    enabled: quiz.state.phase === 'active',
  });

  const toggleTopic = (id: string) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStart = () => {
    if (selectedTopics.size === 0) {
      setConfigError('Please select at least one topic.');
      return;
    }
    setConfigError(null);
    setStarted({ topics: [...selectedTopics].sort(), count });
  };

  // ── Config screen ──────────────────────────────────────────────────────────
  if (started === null) {
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
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => setSelectedTopics(new Set(chapters.map((t) => t.id)))}
                >
                  Select All
                </button>
                <span>·</span>
                <button type="button" className="text-btn" onClick={() => setSelectedTopics(new Set())}>
                  Clear
                </button>
              </div>
            </div>
            <div className="config-topics-grid">
              {chapters.map((t) => (
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
              {[10, 20, 30, 50].map((n) => (
                <button
                  key={n}
                  type="button"
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
                aria-label="Number of questions"
                value={count}
                onChange={(e) =>
                  setCount(Math.min(100, Math.max(5, parseInt(e.target.value) || 5)))
                }
              />
            </div>
          </div>

          {configError && (
            <p className="config-error" role="alert">
              {configError}
            </p>
          )}

          <div className="config-actions">
            <Link to="/app/practice" className="btn-secondary">
              Cancel
            </Link>
            <button
              type="button"
              className="btn-primary"
              onClick={handleStart}
              disabled={selectedTopics.size === 0}
            >
              Start {count} Questions
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (quiz.state.phase === 'loading') {
    return (
      <div className="loading-container" role="status" aria-live="polite">
        <div className="loading-spinner" />
        <p>Building your {started.count}-question set…</p>
      </div>
    );
  }

  if (quiz.error) {
    return (
      <div className="topic-not-found">
        <h2>{quiz.error}</h2>
        <button type="button" className="btn-primary" onClick={() => setStarted(null)}>
          Change selection
        </button>
      </div>
    );
  }

  if (quiz.state.phase === 'done') {
    return (
      <div className="quiz-complete">
        <ResultSummary
          summary={quiz.summary}
          title="Custom Practice"
          actions={
            <>
              <button type="button" className="btn-primary" onClick={() => setStarted(null)}>
                Build Another
              </button>
              <Link to="/app/practice" className="btn-secondary">
                Back to Practice
              </Link>
            </>
          }
        />
      </div>
    );
  }

  const current = quiz.current;
  if (!current) return null;

  return (
    <div className="topic-practice-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/app/practice">Practice</Link>
        <span className="separator">/</span>
        <span className="current">Custom Practice</span>
      </nav>

      {quiz.state.resumed && (
        <div className="mock-resume-notice" role="status">
          Attempt resumed — your answers were restored.
        </div>
      )}

      <QuizToolbar
        index={quiz.state.currentIndex}
        total={quiz.counts.total}
        answered={quiz.counts.answered}
        flagged={quiz.isFlagged}
        onToggleFlag={() => quiz.toggleFlag()}
        bookmarked={quiz.isBookmarked}
        onToggleBookmark={() => quiz.toggleBookmark()}
      />

      <QuestionCard
        index={quiz.state.currentIndex}
        total={quiz.counts.total}
        questionText={current.question}
        options={current.options}
        selection={quiz.selection}
        onSelect={quiz.selectOption}
        correctIndex={current.correctIndex}
        revealed={quiz.isRevealed}
        verdict={quiz.verdict}
        locked={quiz.isSubmitted}
      >
        {quiz.isRevealed && <ExplanationPanel context="practice" />}
      </QuestionCard>

      <QuizActionBar
        onPrev={quiz.prev}
        onNext={quiz.next}
        onSubmit={quiz.submitCurrent}
        onFinish={quiz.submitAll}
        canPrev={quiz.state.currentIndex > 0}
        canNext={!quiz.isLast}
        canSubmit={quiz.canSubmitCurrent}
        isLast={quiz.isLast}
        finishLabel="Finish"
      />

      <QuestionPalette entries={quiz.palette} onJump={quiz.goTo} />
    </div>
  );
}
