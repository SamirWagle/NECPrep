/**
 * Quiz engine — public surface.
 *
 * Pages import from here and nothing else. Everything below is either pure
 * (reducer, selectors, draft, guess, format) or presentational (components);
 * the only module that touches React state is useQuiz.
 */

export { useQuiz } from './useQuiz';
export type { UseQuizOptions, UseQuizResult, QuizCounts } from './useQuiz';

export { useQuizKeyboard, isTextEntryTarget, optionIndexForKey } from './useQuizKeyboard';
export type { UseQuizKeyboardOptions, QuizKeyboardHandlers } from './useQuizKeyboard';

export { quizReducer, createInitialState, defaultFeedbackFor, timeSpentAt } from './reducer';
export type { InitialQuizConfig } from './reducer';

export * from './actions';
export * from './answerKey';
export * from './selectors';
export * from './guess';
export * from './format';

export {
  DRAFT_PREFIX,
  DRAFT_VERSION,
  LEGACY_MOCK_DRAFT_PREFIX,
  clearDraft,
  draftFromState,
  draftStorageKey,
  parseDraft,
  readDraft,
  readLegacyMockDraft,
  writeDraft,
} from './draft';
export type { QuizDraft, DraftOptions } from './draft';

export type {
  FeedbackMode,
  PaletteEntry,
  Question,
  QuizMode,
  QuizPhase,
  QuizState,
  QuizSummary,
  QuizTiming,
  ResponseRecord,
  Verdict,
} from './types';

export { ExplanationPanel } from './components/ExplanationPanel';
export type { ExplanationPanelProps } from './components/ExplanationPanel';
export { OptionList } from './components/OptionList';
export type { OptionListProps } from './components/OptionList';
export { QuestionCard } from './components/QuestionCard';
export type { QuestionCardProps } from './components/QuestionCard';
export { QuestionPalette } from './components/QuestionPalette';
export type { QuestionPaletteProps } from './components/QuestionPalette';
export { QuizActionBar } from './components/QuizActionBar';
export type { QuizActionBarProps } from './components/QuizActionBar';
export { QuizToolbar } from './components/QuizToolbar';
export type { QuizToolbarProps } from './components/QuizToolbar';
export { ResultSummary } from './components/ResultSummary';
export type { ResultSummaryProps } from './components/ResultSummary';
export { ReviewScreen } from './components/ReviewScreen';
export type { ReviewScreenProps } from './components/ReviewScreen';
