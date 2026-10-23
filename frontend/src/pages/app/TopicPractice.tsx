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
 *
 * TWO PATHS, ONE ENGINE
 * ---------------------
 * With `VITE_API_BASE_URL` set, the set comes from `POST /api/practice/start`
 * with `mode: 'chapter'`, each answer is marked by `POST /api/practice/answer`,
 * and the totals come from `POST /api/practice/finish`. The client is handed
 * `AttemptQuestion`s, which have no correct-answer field, so there is no key in
 * the network tab and nothing for this page to score. The key for one question
 * is disclosed in the reply to that question's own answer — which is what
 * practice is for — and never before.
 *
 * With no backend configured — a supported deployment, and the one live today
 * — the paper is drawn from the static chapter JSON through `localData` and the
 * engine scores it in the browser, exactly as before.
 *
 * Both paths run the same engine and the same components. `usePracticeSurface`
 * holds the branching, because there are three of these pages and copying it
 * is what put the four hand-rolled state machines out of step.
 */

import { useCallback, useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
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
import { getTopicById, loadQuestionsSlice, saveQuizResult } from '../../services/localData';
import type { Question, QuizSummary } from '../../features/quiz';
import { usePracticeSurface } from '../../hooks/usePracticeSurface';
import { describeReference } from '../../services/questionReference';

/** The server's bound on `questionCount`. See `MAX_PRACTICE_QUESTIONS`. */
const MAX_SERVER_QUESTIONS = 100;

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

  // Throws on empty, the way MockTestQuiz already does.
  //
  // `loadTopicQuestions` catches a failed fetch and returns [], so a chapter
  // file that 404s is indistinguishable from a chapter with no questions. Both
  // are a dead end for the student, and both deserve the error screen rather
  // than a quiz with nothing in it - or, before the guard order below was
  // fixed, a spinner that never resolves.
  const loadQuestions = useCallback(async (): Promise<Question[]> => {
    if (!topicId) return [];
    const questions = await loadQuestionsSlice(topicId, questionCount);
    if (questions.length === 0) {
      throw new Error('No questions could be loaded for this chapter.');
    }
    return questions;
  }, [topicId, questionCount]);

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

  const chapterIds = useMemo(() => (topicId ? [topicId] : []), [topicId]);

  const surface = usePracticeSurface({
    mode: 'topic',
    remoteMode: 'chapter',
    practiceKey: topicId && topic ? attemptKey : null,
    chapterIds,
    // A count from the query string is unvalidated and the schema caps at 100,
    // so it is clamped for the request rather than letting a typo come back as
    // a 400. The local path keeps its original behaviour.
    questionCount: clampCount(questionCount),
    loadLocalQuestions: loadQuestions,
    localEnabled: Boolean(topicId && topic),
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

  const sourceLabel = useMemo(() => topic?.name, [topic]);

  // A remote session that could not be started or resumed. Deliberately NOT a
  // fallback to local scoring: the two paths record progress in different
  // places, so silently swapping them would make the figures mean two things.
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
  // finishing resolve straight to the server's stored totals — no paper, no
  // engine, and no second session opened to replace the one just finished.
  if (topic && surface.complete) {
    return (
      <div className="quiz-complete">
        <ResultSummary
          summary={surface.summary}
          title={topic.name}
          actions={
            <>
              {/* A restart is a new attempt identity, not a mutation of this
                  one, so it goes through navigation rather than a reset — to
                  the chapter selector, which comes back here with a fresh
                  mount and therefore a fresh session. `discard` runs first so
                  the finished session's handoff record cannot be resumed,
                  which matters when the finish landed but its reply did not. */}
              <Link
                to={`/app/practice/chapter/${topic.id}`}
                className="btn-primary"
                onClick={surface.discard}
              >
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


  // `quiz.error` BEFORE `phase === 'loading'`, deliberately.
  //
  // `useQuiz` sets `error` when the load rejects and leaves `phase` at
  // 'loading' — there is no failure phase. Asking "is it loading?" first
  // therefore makes the error branch below unreachable, and a failed load
  // spins forever with no way out but a reload.
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
  if (quiz.state.phase === 'loading') return <LoadingSpinner />;

  // Remote only: the set is closed and the totals are not in yet. There is
  // deliberately no local score to show in the meantime — the client cannot
  // compute one. Locally, `done` always means `complete`, so this is dead.
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
          // The server's explanation when there is one; otherwise the honest
          // empty state pointing at the chapter rather than inventing a
          // rationale. `context` is 'practice', not 'exam', so a badged AI
          // draft would be allowed to show here.
          <ExplanationPanel
            context="practice"
            explanation={surface.explanation}
            sourceLabel={sourceLabel}
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

function clampCount(count: number): number {
  if (!Number.isFinite(count)) return 30;
  return Math.min(MAX_SERVER_QUESTIONS, Math.max(1, Math.trunc(count)));
}
