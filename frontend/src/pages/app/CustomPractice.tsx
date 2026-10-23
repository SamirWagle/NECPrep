/**
 * CustomPractice — pick chapters and a question count, then practise.
 *
 * Hosts the shared quiz engine; see TopicPractice for why all four quiz pages
 * went from four copies of the state machine to one, and for the two paths
 * (`POST /api/practice/*` with a backend configured, static JSON and local
 * scoring without one) that `usePracticeSurface` branches between.
 *
 * The config screen stays local to this page: it is this page's whole reason to
 * exist, and the engine has nothing to say about it. Everything is held back
 * until the config is submitted — `practiceKey` is null until then, so no
 * paper is loaded, no draft is written, and no server session is opened while
 * the user is still choosing. That last part matters: a session started at
 * mount would be counted in the study history whether or not the student ever
 * answered a question.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useQuizKeyboard,
  MarkingStatus,
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
import { usePracticeSurface } from '../../hooks/usePracticeSurface';
import { describeReference } from '../../services/questionReference';

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

  // The chapters the student picked, as the server wants them. A stable
  // identity so the session-start effect does not re-run on every render.
  const chapterIds = useMemo(() => started?.topics ?? [], [started]);

  const surface = usePracticeSurface({
    mode: 'custom',
    // `custom` and not `chapter`, even for a single-chapter selection: the
    // server reads `chapterIds` the same way for both, and `chapter` carries a
    // "pick at least one" guard that a multi-chapter set has no use for.
    remoteMode: 'custom',
    practiceKey: attemptKey,
    chapterIds,
    questionCount: started?.count ?? 0,
    loadLocalQuestions: loadQuestions,
    onComplete,
  });
  const { quiz } = surface;

  useQuizKeyboard({
    optionCount: quiz.current?.options.length ?? 0,
    onSelectOption: quiz.selectOption,
    onSubmitOrAdvance: surface.submitOrAdvance,
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

  // ── Results ────────────────────────────────────────────────────────────────
  // Checked before the loading state, so a finish whose reply arrived after a
  // reload resolves to the server's stored totals rather than to a new set.
  if (surface.complete) {
    return (
      <div className="quiz-complete">
        <ResultSummary
          summary={surface.summary}
          title="Custom Practice"
          actions={
            <>
              {/* Back to the config screen, which nulls the practice key and
                  so abandons this run. `discard` first, so the finished
                  session's handoff record cannot be resumed by a later run
                  that happens to choose the same chapters and count. */}
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  surface.discard();
                  setStarted(null);
                }}
              >
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

  // A remote session that could not be started. Deliberately NOT a fallback to
  // local scoring, and routed back to the config screen because the commonest
  // cause is a selection the server has too little published content for.
  if (surface.isRemote && surface.error !== null && quiz.state.phase === 'loading') {
    return (
      <div className="topic-not-found">
        <h2>{surface.error}</h2>
        <button type="button" className="btn-primary" onClick={() => setStarted(null)}>
          Change selection
        </button>
      </div>
    );
  }


  // `quiz.error` BEFORE `phase === 'loading'`, deliberately.
  //
  // `useQuiz` sets `error` when the load rejects and leaves `phase` at
  // 'loading' — there is no failure phase. Asking "is it loading?" first
  // therefore makes the error branch below unreachable, and a failed load
  // spins forever with no way out but a reload.
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
  if (quiz.state.phase === 'loading') {
    return (
      <div className="loading-container" role="status" aria-live="polite">
        <div className="loading-spinner" />
        <p>Building your {started.count}-question set…</p>
      </div>
    );
  }

  // Remote only: the set is closed and the totals are not in yet. Locally,
  // `done` always means `complete`, so this is dead.
  if (quiz.state.phase === 'done') {
    return (
      <div className="quiz-complete">
        {surface.error === null ? (
          <div className="loading-container" role="status" aria-live="polite">
            <div className="loading-spinner" />
            <p>Saving your session…</p>
          </div>
        ) : (
          <div className="topic-not-found" role="alert">
            <h2>{surface.error}</h2>
            <p>Your answers are recorded on the server. You can ask for the totals again.</p>
            <button
              type="button"
              className="btn-primary"
              onClick={surface.retryFinish}
              disabled={surface.finishing}
            >
              Try again
            </button>
          </div>
        )}
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
        correctIndex={surface.card.correctIndex}
        revealed={surface.card.revealed}
        verdict={surface.card.verdict}
        locked={surface.card.locked}
      >
        {surface.awaiting && <MarkingStatus state="checking" />}
        {surface.answerError !== null && (
          <MarkingStatus
            state="failed"
            message={surface.answerError}
            onRetry={surface.retryAnswer}
          />
        )}
        {surface.card.revealed && (
          <ExplanationPanel
            context="practice"
            explanation={surface.explanation}
            reference={describeReference(current)}
          />
        )}
      </QuestionCard>

      <QuizActionBar
        onPrev={quiz.prev}
        onNext={quiz.next}
        onSubmit={surface.commitCurrent}
        onFinish={quiz.submitAll}
        canPrev={quiz.state.currentIndex > 0}
        canNext={!quiz.isLast}
        canSubmit={quiz.canSubmitCurrent}
        isLast={quiz.isLast}
        finishLabel="Finish"
        submitBusy={surface.awaiting}
      />

      <QuestionPalette entries={quiz.palette} onJump={quiz.goTo} />
    </div>
  );
}
