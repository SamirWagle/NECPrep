// Topic data based on the datasets/BooksQuestions JSON format
// This maps to the extracted_questions folder structure

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

export const topics: Topic[] = [
  {
    id: 'artificial-intelligence-and-neural-networks',
    name: 'Artificial Intelligence and Neural Networks',
    shortName: 'AI & Neural Networks',
    description: 'Machine learning, neural networks, expert systems, and AI fundamentals',
    questionCount: 150,
    icon: 'brain',
    color: '#8b5cf6',
    dataFile: 'artificial-intelligence-and-neural-networks.json'
  },
  {
    id: 'computer-organization-and-embedded-system',
    name: 'Computer Organization and Embedded System',
    shortName: 'Computer Organization',
    description: 'CPU architecture, memory systems, and embedded systems design',
    questionCount: 120,
    icon: 'cpu',
    color: '#06b6d4',
    dataFile: 'computer-organization-and-embedded-system.json'
  },
  {
    id: 'concept-of-basic-electrical-and-electronics-engineering',
    name: 'Basic Electrical and Electronics Engineering',
    shortName: 'Electrical & Electronics',
    description: 'Circuit analysis, electronic components, and electrical fundamentals',
    questionCount: 100,
    icon: 'chip',
    color: '#f59e0b',
    dataFile: 'concept-of-basic-electrical-and-electronics-engineering.json'
  },
  {
    id: 'concept-of-computer-network-and-network-security-system',
    name: 'Computer Network and Network Security',
    shortName: 'Networks & Security',
    description: 'Network protocols, security concepts, and system administration',
    questionCount: 130,
    icon: 'network',
    color: '#10b981',
    dataFile: 'concept-of-computer-network-and-network-security-system.json'
  },
  {
    id: 'data-structures-and-algorithm-database-system-and-operating-system',
    name: 'Data Structures, Algorithms, Database & OS',
    shortName: 'DSA, Database & OS',
    description: 'Data structures, algorithms, DBMS concepts, and operating systems',
    questionCount: 180,
    icon: 'database',
    color: '#ec4899',
    dataFile: 'data-structures-and-algorithm-database-system-and-operating-system.json'
  },
  {
    id: 'digital-logic-and-microprocessor',
    name: 'Digital Logic and Microprocessor',
    shortName: 'Digital Logic',
    description: 'Boolean algebra, logic gates, and microprocessor architecture',
    questionCount: 110,
    icon: 'chip',
    color: '#6366f1',
    dataFile: 'digital-logic-and-microprocessor.json'
  },
  {
    id: 'programming-language-and-its-application',
    name: 'Programming Language and Its Application',
    shortName: 'Programming',
    description: 'C, C++, Python programming concepts and applications',
    questionCount: 200,
    icon: 'code',
    color: '#22c55e',
    dataFile: 'programming-language-and-its-application.json'
  },
  {
    id: 'project-planning-design-and-implementation',
    name: 'Project Planning, Design and Implementation',
    shortName: 'Project Management',
    description: 'Software project management, planning, and implementation',
    questionCount: 90,
    icon: 'settings',
    color: '#f97316',
    dataFile: 'project-planning-design-and-implementation.json'
  },
  {
    id: 'software-engineering-and-object-oriented-analysis-and-design',
    name: 'Software Engineering and OOAD',
    shortName: 'Software Engineering',
    description: 'SDLC, UML, design patterns, and software engineering principles',
    questionCount: 140,
    icon: 'book',
    color: '#3b82f6',
    dataFile: 'software-engineering-and-object-oriented-analysis-and-design.json'
  },
  {
    id: 'theory-of-computation-and-computer-graphics',
    name: 'Theory of Computation and Computer Graphics',
    shortName: 'TOC & Graphics',
    description: 'Automata theory, formal languages, and graphics fundamentals',
    questionCount: 160,
    icon: 'monitor',
    color: '#a855f7',
    dataFile: 'theory-of-computation-and-computer-graphics.json'
  }
];

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

// Helper to get topic by ID (exam topics only)
// localData.ts extends this to also search bookChapters
export function getTopicById(id: string): Topic | undefined {
  return topics.find(topic => topic.id === id);
}

// Helper to get mock test by ID
export function getMockTestById(id: string): MockTest | undefined {
  return mockTests.find(test => test.id === id);
}

// Calculate total questions
export const totalQuestions = topics.reduce((sum, topic) => sum + topic.questionCount, 0);
