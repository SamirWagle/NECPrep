/**
 * QuickPractice — a short mixed set drawn from every chapter.
 *
 * Hosts the shared quiz engine; see TopicPractice for why all four quiz pages
 * went from four copies of the state machine to one, and for the two paths
 * (`POST /api/practice/*` with a backend configured, static JSON and local
 * scoring without one) that `usePracticeSurface` branches between.
 *
 * The server mode is `custom` with NO chapter ids rather than `chapter` with
 * all ten: `drawPracticeQuestions` treats a null chapter list as "anywhere in
 * the bank", which is both what quick practice means and a cheaper query than
 * naming every chapter. It also leaves `attempts.chapter_id` NULL, which is
 * the honest value for a set that is not about one chapter.
 */

import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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

export default function QuickPractice() {
  const chapters = useChapters();
  const [searchParams] = useSearchParams();
  const count = Math.min(50, Math.max(5, parseInt(searchParams.get('count') || '10', 10)));

  // The chapter manifest is static, so an empty list means a broken build
  // rather than a transient state — surfaced as a render guard below. It only
  // gates the LOCAL path: the remote one draws from the server's own bank and
  // does not read the manifest at all.
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

  const surface = usePracticeSurface({
    mode: 'quick',
    remoteMode: 'custom',
    practiceKey: `quick:${count}`,
    questionCount: count,
    loadLocalQuestions: loadQuestions,
    localEnabled: !noSources,
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

  // The manifest only matters locally — see `noSources` above.
  if (noSources && !surface.isRemote) {
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

  if (surface.isRemote && surface.error !== null && quiz.state.phase === 'loading') {
    return (
      <div className="topic-not-found">
        <h2>{surface.error}</h2>
        <Link to="/app/practice" className="btn-primary">
          Back to Practice
        </Link>
      </div>
    );
  }

  // ── Results ────────────────────────────────────────────────────────────────
  // Checked before the loading state, which is what makes a reload after
  // finishing resolve straight to the server's stored totals rather than
  // opening a second session to replace the one just finished.
  if (surface.complete) {
    return (
      <div className="quiz-complete">
        <ResultSummary
          summary={surface.summary}
          title="Quick Practice"
          actions={
            <>
              <Link
                to="/app/practice/quick"
                className="btn-primary"
                reloadDocument
                onClick={surface.discard}
              >
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
