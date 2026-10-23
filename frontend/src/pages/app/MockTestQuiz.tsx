/**
 * MockTestQuiz — a full timed paper, scored by the Worker when there is one.
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
 * TWO PATHS, ONE ENGINE
 * ---------------------
 * With `VITE_API_BASE_URL` set, the paper comes from `POST /api/mock/start`,
 * answers autosave to `POST /api/mock/sync`, and the score comes from
 * `POST /api/mock/submit`. The client is handed `AttemptQuestion`s, which have
 * no correct-answer field of any kind, so there is no key in the network tab,
 * no key in memory, and nothing for this page to score. Every question carries
 * `KEY_HELD_BY_SERVER` and the engine's own score selectors return zero for
 * them by construction — the result screen reads `MockSubmitResponse` instead.
 *
 * With no backend configured — a supported deployment, and the one live today
 * — the paper is drawn from the static chapter JSON through `localData` and the
 * engine scores it locally, exactly as before. That path is cheatable by
 * anyone who opens devtools, which is precisely why the other one exists; it
 * is kept because an offline-only install still has to work.
 *
 * Everything else — the deferred feedback, the wall-clock deadline, the
 * autosave and resume, the review screen and the two-step submit confirm — is
 * the engine's and is identical on both paths.
 *
 * The 10-questions-per-page layout is gone. The engine tracks one current
 * index, so a paginated host would have to call `goTo` on every card
 * interaction or every question's elapsed time would land on whichever index
 * happened to be current. One question at a time plus the numbered palette is
 * also closer to the real NEC computer-based test.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  useQuiz,
  useQuizKeyboard,
  optionLetter,
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
import type { MockSubmitResponse } from '../../services/api';
import { summaryFromServer } from '../../services/mockAttempt';
import { useRemoteMock } from '../../hooks/useRemoteMock';
import { fisherYates } from '../../services/optionOrdering';
import { useChapters } from '../../hooks/useChapters';
import { describeReference } from '../../services/questionReference';

/**
 * Trailing debounce on the server autosave.
 *
 * `/api/mock/sync` allows 240 calls an hour per user and a full paper runs 120
 * minutes, so a 15-second debounce would sit exactly on the limit for a
 * student who keeps answering, and anything tighter would start failing
 * mid-exam. 20 seconds leaves headroom; the trailing edge means an idle
 * student costs no requests at all, and the worst case loss from a killed tab
 * is bounded by it — and only on a device whose local draft is also gone,
 * because the engine's own autosave restores the rest.
 */
const SYNC_DEBOUNCE_MS = 20_000;

export default function MockTestQuiz() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const chapters = useChapters();
  const test = testId ? getMockTestById(testId) : null;
  const perChapter = test?.questionsPerChapter ?? 10;

  // The Worker's mock template ids ARE these ids — `full-mock-1`,
  // `full-mock-2`, `quick-test` — seeded from the same list
  // (worker/db/seed/generate-reference-sql.mjs). So no mapping table is needed,
  // and a template the server does not know about surfaces as the server's own
  // NOT_FOUND message rather than as a silent fallback to local scoring.
  const remote = useRemoteMock(test?.id ?? null);
  const remotePaper = remote.paper;
  const remoteQuestions = remotePaper?.questions;

  const loadLocalQuestions = useCallback(async (): Promise<Question[]> => {
    const results = await Promise.all(
      chapters.map((chapter) => loadQuestionsSlice(chapter.id, perChapter))
    );
    const combined = fisherYates(results.flat());
    if (combined.length === 0) {
      throw new Error('No questions found. Check that chapter files are available.');
    }
    return combined;
  }, [chapters, perChapter]);

  // The paper is already in hand by the time the engine is enabled; this just
  // hands it over. The composition was decided server-side from the stored
  // blueprint, so there is nothing to shuffle or slice here.
  const loadRemoteQuestions = useCallback(
    async (): Promise<Question[]> => remoteQuestions ?? [],
    [remoteQuestions]
  );

  // Resume resolves ids against the SERVER's paper, never the local bank: the
  // ids are server question ids and the option order is this attempt's
  // permutation, so a local lookup would rebuild a different paper.
  const resolveRemoteQuestions = useCallback(
    async (ids: string[]): Promise<Question[]> => {
      const byId = new Map((remoteQuestions ?? []).map((q) => [q.id, q]));
      return ids.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined);
    },
    [remoteQuestions]
  );

  const onComplete = useCallback(
    (summary: QuizSummary) => {
      // Local path only. A remote attempt's score is the server's, and is
      // written to history when that response lands — see below. Recording
      // `summary.score` here would record zero, because the client holds no key.
      if (!test || remote.active) return;
      saveQuizResult({
        topicId: test.id,
        topicName: test.name,
        score: summary.score,
        total: summary.total,
        date: new Date().toISOString(),
      });
    },
    [test, remote.active]
  );

  const quiz = useQuiz({
    mode: 'mock',
    // Keyed on the ATTEMPT for a remote paper, so a new attempt cannot resume
    // the previous one's draft, and on the test id locally, where the paper is
    // redrawn per attempt anyway.
    attemptKey: remote.active
      ? remotePaper
        ? `mock:${remotePaper.attemptId}`
        : null
      : test
        ? `mock:${test.id}`
        : null,
    // Remote: the time the server says is left, which is also correct for a
    // resumed attempt. Local: duration comes from the mock-test config, which
    // reads it from examBlueprint — 120 minutes, confirmed by the project owner.
    durationMs: remote.active
      ? (remotePaper?.remainingMs ?? null)
      : test
        ? test.duration * 60_000
        : null,
    deadlineFromDuration: remote.active,
    // Migrates an in-flight attempt saved by the pre-engine page rather than
    // destroying someone's part-finished exam on deploy. Local path only: a
    // legacy draft holds local question ids and indexes into the local option
    // order, neither of which means anything on a server paper.
    legacyMockTestId: remote.active ? undefined : test?.id,
    loadQuestions: remote.active ? loadRemoteQuestions : loadLocalQuestions,
    resolveQuestions: remote.active ? resolveRemoteQuestions : undefined,
    // Answers the server already accepted. Fills the gaps a local draft cannot
    // — a different browser, or one whose storage was cleared.
    restoredSelections: remotePaper?.restoredSelections,
    enabled: remote.active ? remotePaper !== null : Boolean(test) && chapters.length > 0,
    // Per-question correctness for a remote attempt is the server's to record.
    // The client's records all read `correct: false` because it has no key, so
    // writing them into local progress would corrupt it.
    persistAttempts: !remote.active,
    onComplete,
  });

  const { active: remoteActive, sync: remoteSync, submit: remoteSubmit } = remote;
  const { phase, selections } = quiz.state;

  // ── Server autosave ────────────────────────────────────────────────────────
  // Keyed on the selections ARRAY, whose identity changes only when an answer
  // changes, so the timer resets when the student answers and at no other time.
  useEffect(() => {
    if (!remoteActive) return;
    if (phase !== 'active' && phase !== 'review') return;
    const id = setTimeout(() => remoteSync(selections), SYNC_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [remoteActive, remoteSync, selections, phase]);

  // Flush on tab hide. This is the moment answers are most likely to be lost —
  // the tab is about to be killed or the phone locked — and it is one request.
  const selectionsRef = useRef(selections);
  useEffect(() => {
    selectionsRef.current = selections;
  }, [selections]);
  useEffect(() => {
    if (!remoteActive) return;
    const onVisibility = () => {
      if (document.hidden) remoteSync(selectionsRef.current);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [remoteActive, remoteSync]);

  // ── Hand the finished paper to the server ─────────────────────────────────
  // `done` is reached by the review screen's confirm OR by the engine's
  // auto-submit at the deadline, and both must post. `submit` posts once.
  useEffect(() => {
    if (!remoteActive || phase !== 'done') return;
    remoteSubmit(selections);
  }, [remoteActive, remoteSubmit, phase, selections]);

  // The server's score goes into local history so the dashboard and progress
  // pages — which still read localStorage — show the attempt. Guarded on the
  // attempt id so a re-render cannot append it twice.
  const recordedRef = useRef<string | null>(null);
  const remoteResult = remote.result;
  useEffect(() => {
    if (!test || remoteResult === null) return;
    if (recordedRef.current === remoteResult.attemptId) return;
    recordedRef.current = remoteResult.attemptId;
    saveQuizResult({
      topicId: test.id,
      topicName: test.name,
      score: remoteResult.correct,
      total: remoteResult.total,
      date: new Date(remoteResult.scoredAt).toISOString(),
    });
  }, [test, remoteResult]);

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

  const restart = useCallback(() => {
    if (!test) return;
    // Clear the finished attempt's draft so returning to the detail page starts
    // a genuinely new paper rather than resuming a completed one, and drop the
    // stored attempt id so the next visit starts a new server attempt. The new
    // attempt is NOT started here — its deadline would start ticking while the
    // student is still reading the detail page.
    quiz.discardDraft();
    remote.discard();
    navigate(`/app/mock-tests/${test.id}`);
  }, [test, quiz, remote, navigate]);

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

  // ── Results, server-scored ────────────────────────────────────────────────
  // Checked before the loading state: a reload after submission resolves
  // straight to the stored review, with no paper and no engine.
  if (remoteResult !== null) {
    return (
      <ServerResults
        result={remoteResult}
        testName={test.name}
        onRetry={restart}
      />
    );
  }

  // A remote attempt that could not be started or resumed. Deliberately NOT a
  // fallback to local scoring: silently downgrading an exam to the cheatable
  // path is worse than telling the student to try again.
  if (remoteActive && remote.error !== null && remotePaper === null) {
    return (
      <div className="topic-not-found">
        <h2>{remote.error}</h2>
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
          {remoteActive
            ? 'Preparing your paper…'
            : `Loading ${String(chapters.length)} chapters × ${String(perChapter)} questions…`}
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
    // Remote: the paper is in, the score is not. There is deliberately no
    // local score to show in the meantime — the client cannot compute one.
    if (remoteActive) {
      return (
        <div className="mock-results-page">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link to="/app/mock-tests">Mock Tests</Link>
            <span className="separator">/</span>
            <span className="current">{test.name}</span>
          </nav>
          {remote.error === null ? (
            <div className="loading-container" role="status" aria-live="polite">
              <div className="loading-spinner" />
              <p>Submitting your paper for marking…</p>
            </div>
          ) : (
            <div className="topic-not-found" role="alert">
              <h2>{remote.error}</h2>
              <p>Your answers are saved on the server. You can send the paper again.</p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => remoteSubmit(selections)}
                disabled={remote.submitting}
              >
                Submit again
              </button>
            </div>
          )}
        </div>
      );
    }

    const { questions, selections: finalSelections } = quiz.state;
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
              <button type="button" className="btn-primary" onClick={restart}>
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
            const sel = finalSelections[i];
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
                        <span className="review-opt-letter">{optionLetter(oi)}</span>
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
        // On a remote paper this is the `KEY_HELD_BY_SERVER` sentinel, so
        // there is no index here to render even if `revealed` were forced true.
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

/**
 * The score screen for a server-marked paper.
 *
 * Every number and every verdict is read from `MockSubmitResponse`; nothing is
 * recomputed. Options are matched by `ref` rather than by position, because
 * position means nothing across two responses and a ref is the only identity
 * the server and the client agree on.
 */
function ServerResults({
  result,
  testName,
  onRetry,
}: {
  result: MockSubmitResponse;
  testName: string;
  onRetry: () => void;
}) {
  const review = [...result.review].sort((a, b) => a.position - b.position);

  return (
    <div className="mock-results-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/app/mock-tests">Mock Tests</Link>
        <span className="separator">/</span>
        <span className="current">{testName} — Results</span>
      </nav>

      {result.timing === 'expired' && (
        <div className="mock-resume-notice" role="status">
          Time ran out before this paper was sent, so it was marked from the
          answers saved before the deadline.
          {result.droppedLateAnswers > 0 &&
            ` ${String(result.droppedLateAnswers)} later answer${
              result.droppedLateAnswers === 1 ? '' : 's'
            } could not be counted.`}
        </div>
      )}

      <ResultSummary
        summary={summaryFromServer(result)}
        title={testName}
        actions={
          <>
            <button type="button" className="btn-primary" onClick={onRetry}>
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
        {review.map((item) => {
          const isSkipped = item.selectedRef === null;
          const status = isSkipped ? 'skipped' : item.isCorrect ? 'correct' : 'incorrect';
          return (
            <div key={item.questionId} className={`review-card ${status}`}>
              <div className="review-q-header">
                <span className="review-q-num">Q{item.position}</span>
                <span className={`review-badge ${status}`}>
                  {isSkipped ? 'Skipped' : item.isCorrect ? 'Correct' : 'Incorrect'}
                </span>
              </div>
              <p className="review-question">{item.stem}</p>
              <div className="review-options">
                {item.options.map((option, oi) => {
                  const isTheCorrect = option.ref === item.correctRef;
                  const isUserWrong = option.ref === item.selectedRef && !item.isCorrect;
                  return (
                    <div
                      key={option.ref}
                      className={`review-opt ${
                        isTheCorrect
                          ? 'review-opt-correct'
                          : isUserWrong
                            ? 'review-opt-wrong'
                            : ''
                      }`}
                    >
                      <span className="review-opt-letter">{optionLetter(oi)}</span>
                      <span className="review-opt-text">{option.body}</span>
                      {isTheCorrect && <span className="review-opt-tag correct">✓ Correct</span>}
                      {isUserWrong && <span className="review-opt-tag wrong">✗ Your answer</span>}
                    </div>
                  );
                })}
              </div>
              {/* The server's explanation when it has one; the derived syllabus
                  reference either way. `review`, not `exam` — the paper is in. */}
              <ExplanationPanel
                context="review"
                explanation={item.explanation}
                reference={describeReference({
                  topicId: item.chapterId,
                  question: item.stem,
                  options: item.options.map((option) => option.body),
                })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
