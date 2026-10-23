// Topic & MockTest type definitions and mock test configuration.

import { examFormat, readConfirmed } from './examBlueprint';
// Book chapter data lives in bookChapters.generated.ts (auto-generated).

export interface Question {
  qsns: string;
  opt1: string;
  opt2: string;
  opt3: string;
  opt4: string;
  correct_option: string;
  correct_option_index: number;
}

export interface Topic {
  id: string;
  name: string;
  shortName: string;
  description: string;
  questionCount: number;
  icon: 'cpu' | 'code' | 'network' | 'database' | 'brain' | 'chip' | 'settings' | 'book' | 'calculator' | 'monitor';
  color: string;
  dataFile: string;
}

// Mock tests configuration
export interface MockTest {
  id: string;
  name: string;
  description: string;
  questionsPerChapter: number; // questions drawn from each book chapter
  duration: number;            // total time in minutes
}

// A full mock mirrors the real paper: 10 chapters x 10 questions = 100
// questions in 120 minutes, which is 72 seconds per question. The duration is
// read from examBlueprint rather than restated here - it shipped as 45 minutes
// against a 120-minute exam, a 2.7x error in every pace figure the app showed.
const FULL_MOCK_DURATION = readConfirmed(examFormat.durationMinutes);
const FULL_MOCK_PER_CHAPTER = 10;

// The short assessment keeps the real exam's seconds-per-question so its pace
// feedback stays comparable, rather than being its own arbitrary number.
const QUICK_PER_CHAPTER = 5;
const QUICK_DURATION = Math.round(
  (FULL_MOCK_DURATION * QUICK_PER_CHAPTER) / FULL_MOCK_PER_CHAPTER
);

export const mockTests: MockTest[] = [
  {
    id: 'full-mock-1',
    name: 'Full Mock Test 1',
    description:
      'Full NEC format: 100 questions in ' + FULL_MOCK_DURATION + ' minutes, drawn fresh each time',
    questionsPerChapter: FULL_MOCK_PER_CHAPTER,
    duration: FULL_MOCK_DURATION,
  },
  {
    id: 'full-mock-2',
    // NOTE: this draws from the same pool with the same unseeded shuffle as
    // Mock 1, so it is not a distinct paper. Its description used to claim a
    // "different selection", which was not true. Real non-repetition across
    // attempts needs per-learner history, which lives in the backend.
    name: 'Full Mock Test 2',
    description:
      'Another full-format paper: 100 questions in ' + FULL_MOCK_DURATION + ' minutes',
    questionsPerChapter: FULL_MOCK_PER_CHAPTER,
    duration: FULL_MOCK_DURATION,
  },
  {
    id: 'quick-test',
    name: 'Quick Assessment',
    description:
      '50 questions in ' + QUICK_DURATION + ' minutes — half a paper, at real exam pace',
    questionsPerChapter: QUICK_PER_CHAPTER,
    duration: QUICK_DURATION,
  },
];

// Helper to get mock test by ID
export function getMockTestById(id: string): MockTest | undefined {
  return mockTests.find(test => test.id === id);
}
