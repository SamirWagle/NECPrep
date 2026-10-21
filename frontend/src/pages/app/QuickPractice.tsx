/**
 * QuickPractice — a short mixed set drawn from every chapter.
 *
 * Hosts the shared quiz engine; see TopicPractice for why all four quiz pages
 * went from four copies of the state machine to one.
 */

import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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

export default function QuickPractice() {
  const chapters = useChapters();
  const [searchParams] = useSearchParams();
  const count = Math.min(50, Math.max(5, parseInt(searchParams.get('count') || '10', 10)));

  // The chapter manifest is static, so an empty list means a broken build
  // rather than a transient state — surfaced as a render guard below.
  const noSources = chapters.length === 0;

  const loadQuestions = useCallback(async (): Promise<Question[]> => {
    const perChapter = Math.max(1, Math.ceil(count / chapters.length));
    const results = await Promise.all(
      chapters.map((chapter) => loadQuestionsSlice(chapter.id, perChapter))
    );
    return fisherYates(results.flat()).slice(0, count);
  }, [chapters, count]);

  const onComplete = useCallback((summary: QuizSummary) => {
    saveQuizResult({
      topicId: 'quick-practice',
      topicName: 'Quick Practice',
      score: summary.score,
      total: summary.total,
      date: new Date().toISOString(),
    });
  }, []);

  const quiz = useQuiz({
    mode: 'quick',
    attemptKey: `quick:${count}`,
    loadQuestions,
    enabled: !noSources,
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

  if (noSources) {
    return (
      <div className="topic-not-found">
        <h2>No question sources available</h2>
        <p>The chapter manifest is empty. Try rebuilding the app.</p>
        <Link to="/app/practice" className="btn-primary">
          Back to Practice
        </Link>
      </div>
    );
  }

  if (quiz.state.phase === 'loading') {
    return (
      <div className="loading-container" role="status" aria-live="polite">
        <div className="loading-spinner" />
        <p>Picking {count} random questions…</p>
      </div>
    );
  }

  if (quiz.error) {
    return (
      <div className="topic-not-found">
        <h2>{quiz.error}</h2>
        <Link to="/app/practice" className="btn-primary">
          Back to Practice
        </Link>
      </div>
    );
  }

  if (quiz.state.phase === 'done') {
    return (
      <div className="quiz-complete">
        <ResultSummary
          summary={quiz.summary}
          title="Quick Practice"
          actions={
            <>
              <Link to="/app/practice/quick" className="btn-primary" reloadDocument>
                Another {count}
              </Link>
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
        <span className="current">Quick Practice</span>
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
