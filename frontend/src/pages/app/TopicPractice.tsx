/**
 * TopicPractice — practise one chapter.
 *
 * This page used to carry its own copy of the quiz state machine, as did
 * QuickPractice, CustomPractice and MockTestQuiz: four near-identical
 * implementations of the same thing, which is how the same answer-loss bug
 * shipped in three of them at once. All of that now lives in
 * `features/quiz`, and this file is a host: it decides what the paper is and
 * how the page is laid out, and the engine owns everything about running it.
 *
 * What the engine brings that this page could not do before: flag-for-review, a
 * numbered question palette, keyboard shortcuts, per-question timing, autosave
 * with resume, and an explanation panel that is honest about not having an
 * explanation.
 */

import { useCallback, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
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
import { getTopicById, loadQuestionsSlice, saveQuizResult } from '../../services/localData';
import type { QuizSummary } from '../../features/quiz';

function LoadingSpinner() {
  return (
    <div className="loading-container" role="status" aria-live="polite">
      <div className="loading-spinner"></div>
      <p>Loading questions...</p>
    </div>
  );
}

export default function TopicPractice() {
  const { topicId } = useParams<{ topicId: string }>();
  const [searchParams] = useSearchParams();
  const questionCount = parseInt(searchParams.get('count') || '30', 10);

  const topic = topicId ? getTopicById(topicId) : undefined;

  // Changing this abandons the current attempt and starts a new one, which is
  // exactly what should happen when the chapter or the requested count changes.
  const attemptKey = topicId ? `topic:${topicId}:${questionCount}` : null;

  const loadQuestions = useCallback(
    () => (topicId ? loadQuestionsSlice(topicId, questionCount) : Promise.resolve([])),
    [topicId, questionCount]
  );

  const onComplete = useCallback(
    (summary: QuizSummary) => {
      if (!topic) return;
      saveQuizResult({
        topicId: topic.id,
        topicName: topic.name,
        score: summary.score,
        total: summary.total,
        date: new Date().toISOString(),
      });
    },
    [topic]
  );

  const quiz = useQuiz({
    mode: 'topic',
    attemptKey,
    loadQuestions,
    enabled: Boolean(topicId && topic),
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

  const sourceLabel = useMemo(() => topic?.name, [topic]);

  if (quiz.state.phase === 'loading') return <LoadingSpinner />;

  if (quiz.error || !topic) {
    return (
      <div className="topic-not-found">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <h2>{quiz.error || 'Topic not found'}</h2>
        <p>The topic you are looking for does not exist or has no questions.</p>
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
          title={topic.name}
          actions={
            <>
              {/* A restart is a new attempt identity, not a mutation of this
                  one, so it goes through navigation rather than a reset. */}
              <Link to={`/app/practice/chapter/${topic.id}`} className="btn-primary">
                Practice Again
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
  if (!current) return <LoadingSpinner />;

  return (
    <div className="topic-practice-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/app/practice">Practice</Link>
        <span className="separator">/</span>
        <span className="current">{topic.name}</span>
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
        {quiz.isRevealed && (
          // No question in the bank carries an explanation yet, so this renders
          // the honest empty state pointing at the chapter rather than
          // inventing a rationale. `context` is 'practice', not 'exam', so a
          // badged AI draft would be allowed to show here once one exists.
          <ExplanationPanel context="practice" sourceLabel={sourceLabel} />
        )}
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
