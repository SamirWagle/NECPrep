// Topic & MockTest type definitions and mock test configuration.
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

export const mockTests: MockTest[] = [
  {
    id: 'full-mock-1',
    name: 'Full Mock Test 1',
    description: '10 random questions from every chapter — a fresh set each time',
    questionsPerChapter: 10,
    duration: 45,
  },
  {
    id: 'full-mock-2',
    name: 'Full Mock Test 2',
    description: '10 random questions per chapter — different selection to Mock 1',
    questionsPerChapter: 10,
    duration: 45,
  },
  {
    id: 'quick-test',
    name: 'Quick Assessment',
    description: '5 questions per chapter for a fast readiness check',
    questionsPerChapter: 5,
    duration: 20,
  },
];

// Helper to get mock test by ID
export function getMockTestById(id: string): MockTest | undefined {
  return mockTests.find(test => test.id === id);
}
