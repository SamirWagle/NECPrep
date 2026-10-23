/**
 * MockTestQuiz — a full timed paper.
 *
 * Hosts the shared quiz engine; see TopicPractice for why all four quiz pages
 * went from four copies of the state machine to one. Three things change for
 * this page specifically:
 *
 *  1. Feedback is DEFERRED. Nothing is revealed until the whole paper is
 *     submitted, which is what `mode: 'mock'` selects by default.
 *
 *  2. It is TIMED against an absolute deadline, so closing the tab does not
 *     pause the clock and a refresh does not hand back a fresh timer. The
 *     engine auto-submits on expiry with whatever was answered.
 *
 *  3. There is a PRE-SUBMIT REVIEW SCREEN. The old page submitted straight off
 *     the last page with no warning and no count of what was left blank.
 *
 * The 10-questions-per-page layout is gone. The engine tracks one current
 * index, so a paginated host would have to call `goTo` on every card
 * interaction or every question's elapsed time would land on whichever index
 * happened to be current. One question at a time plus the numbered palette is
 * also closer to the real NEC computer-based test.
 */

import { useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useQuiz,
  useQuizKeyboard,
  QuestionCard,
  QuestionPalette,
  QuizActionBar,
  QuizToolbar,
  ResultSummary,
  ReviewScreen,
  ExplanationPanel,
} from '../../features/quiz';
import {
  getMockTestById,
  loadQuestionsSlice,
  saveQuizResult,
} from '../../services/localData';
import type { Question, QuizSummary } from '../../features/quiz';
import { fisherYates } from '../../services/optionOrdering';
import { useChapters } from '../../hooks/useChapters';
import { describeReference } from '../../services/questionReference';

export default function MockTestQuiz() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const chapters = useChapters();
  const test = testId ? getMockTestById(testId) : null;
  const perChapter = test?.questionsPerChapter ?? 10;

  const loadQuestions = useCallback(async (): Promise<Question[]> => {
    const results = await Promise.all(
      chapters.map((chapter) => loadQuestionsSlice(chapter.id, perChapter))
    );
    const combined = fisherYates(results.flat());
    if (combined.length === 0) {
      throw new Error('No questions found. Check that chapter files are available.');
    }
    return combined;
  }, [chapters, perChapter]);

  const onComplete = useCallback(
    (summary: QuizSummary) => {
      if (!test) return;
      saveQuizResult({
        topicId: test.id,
        topicName: test.name,
        score: summary.score,
        total: summary.total,
        date: new Date().toISOString(),
      });
    },
    [test]
  );

  const quiz = useQuiz({
    mode: 'mock',
    attemptKey: test ? `mock:${test.id}` : null,
    // Duration comes from the mock-test config, which reads it from
    // examBlueprint — 120 minutes, confirmed by the project owner.
    durationMs: test ? test.duration * 60_000 : null,
    // Migrates an in-flight attempt saved by the pre-engine page rather than
    // destroying someone's part-finished exam on deploy.
    legacyMockTestId: test?.id,
    loadQuestions,
    enabled: Boolean(test) && chapters.length > 0,
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

  if (!test) {
    return (
      <div className="topic-not-found">
        <h2>Test not found</h2>
        <Link to="/app/mock-tests" className="btn-primary">
          Back to Mock Tests
        </Link>
      </div>
    );
  }

  if (quiz.state.phase === 'loading') {
    return (
      <div className="loading-container" role="status" aria-live="polite">
        <div className="loading-spinner" />
        <p>
          Loading {chapters.length} chapters &times; {perChapter} questions…
        </p>
      </div>
    );
  }

  if (quiz.error) {
    return (
      <div className="topic-not-found">
        <h2>{quiz.error}</h2>
        <Link to="/app/mock-tests" className="btn-primary">
          Back to Mock Tests
        </Link>
      </div>
    );
  }

  // ── Results ────────────────────────────────────────────────────────────────
  if (quiz.state.phase === 'done') {
    const { questions, selections } = quiz.state;
    return (
      <div className="mock-results-page">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to="/app/mock-tests">Mock Tests</Link>
          <span className="separator">/</span>
          <span className="current">{test.name} — Results</span>
        </nav>

        <ResultSummary
          summary={quiz.summary}
          title={test.name}
          actions={
            <>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  // Clear the finished attempt's draft so returning to the
                  // detail page starts a genuinely new paper rather than
                  // resuming a completed one.
                  quiz.discardDraft();
                  navigate(`/app/mock-tests/${test.id}`);
                }}
              >
                Try Again
              </button>
              <Link to="/app/mock-tests" className="btn-secondary">
                All Tests
              </Link>
            </>
          }
        />

        <h3 className="detailed-review-heading">Detailed Review</h3>
        <div className="detailed-review-list">
          {questions.map((q, i) => {
            const sel = selections[i];
            const isCorrect = sel !== null && sel === q.correctIndex;
            const isSkipped = sel === null;
            const status = isSkipped ? 'skipped' : isCorrect ? 'correct' : 'incorrect';
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
                    const isUserWrong = oi === sel && !isCorrect;
                    return (
                      <div
                        key={oi}
                        className={`review-opt ${
                          isTheCorrect
                            ? 'review-opt-correct'
                            : isUserWrong
                              ? 'review-opt-wrong'
                              : ''
                        }`}
                      >
                        <span className="review-opt-letter">{String.fromCharCode(65 + oi)}</span>
                        <span className="review-opt-text">{opt}</span>
                        {isTheCorrect && <span className="review-opt-tag correct">✓ Correct</span>}
                        {isUserWrong && <span className="review-opt-tag wrong">✗ Your answer</span>}
                      </div>
                    );
                  })}
                </div>
                {/* Post-exam review is the one place in a mock where an
                    explanation may appear — context is 'review', not 'exam'. */}
                <ExplanationPanel context="review" reference={describeReference(q)} />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Pre-submit review ──────────────────────────────────────────────────────
  if (quiz.state.phase === 'review') {
    return (
      <div className="mock-quiz-page">
        <ReviewScreen
          total={quiz.counts.total}
          answered={quiz.counts.answered}
          unanswered={quiz.counts.unanswered}
          flagged={quiz.counts.flagged}
          unansweredIndices={quiz.unansweredIndices}
          flaggedIndices={quiz.palette.filter((p) => p.flagged).map((p) => p.index)}
          entries={quiz.palette}
          onJump={quiz.goTo}
          onBack={quiz.exitReview}
          onSubmit={quiz.submitAll}
        />
      </div>
    );
  }

  const current = quiz.current;
  if (!current) return null;

  return (
    <div className="mock-quiz-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/app/mock-tests">Mock Tests</Link>
        <span className="separator">/</span>
        <span className="current">{test.name}</span>
      </nav>

      {quiz.state.resumed && (
        <div className="mock-resume-notice" role="status">
          Attempt resumed — your answers and the original deadline were restored.
        </div>
      )}

      <QuizToolbar
        index={quiz.state.currentIndex}
        total={quiz.counts.total}
        answered={quiz.counts.answered}
        timeLeftMs={quiz.timeLeftMs}
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
        // Deferred feedback: nothing is revealed mid-paper, and the engine
        // enforces that rather than trusting this prop.
        revealed={quiz.isRevealed}
        verdict={quiz.verdict}
      />

      <QuizActionBar
        onPrev={quiz.prev}
        onNext={quiz.next}
        // No per-question submit in a mock — answers stay editable until the
        // whole paper goes in. The last question's primary action opens the
        // review screen instead of submitting blind.
        onFinish={quiz.enterReview}
        canPrev={quiz.state.currentIndex > 0}
        canNext={!quiz.isLast}
        canSubmit={false}
        isLast={quiz.isLast}
        finishLabel="Review & submit"
      />

      <QuestionPalette entries={quiz.palette} onJump={quiz.goTo} />
    </div>
  );
}
