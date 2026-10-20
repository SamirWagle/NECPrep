/**
 * The official Nepal Engineering Council (NEC) licence-exam syllabus for the
 * Computer Engineering stream (stream code `ACtE`), modelled as typed data.
 *
 * SOURCE OF TRUTH
 * ---------------
 * Chapter and sub-chapter titles are lifted verbatim from the hardcoded
 * `SYLLABUS` constant in `src/pages/app/BookPractice.tsx`, which in turn
 * transcribes the official NEC syllabus PDF. Nothing here is invented.
 *
 * STRUCTURE
 * ---------
 * The official syllabus is exactly 10 chapters x exactly 6 sub-chapters = 60
 * coded sub-chapters. Chapter code prefixes are *not* uniform — chapters 1-2
 * are the shared electrical/electronics core (`AExE`), chapters 3-9 are the
 * Computer Engineering stream (`ACtE`), and chapter 10 is common to every
 * engineering stream (`AALL`):
 *
 *   ch1  AExE01    ch4  ACtE04    ch7  ACtE07    ch10 AALL10
 *   ch2  AExE02    ch5  ACtE05    ch8  ACtE08
 *   ch3  ACtE03    ch6  ACtE06    ch9  ACtE09
 *
 * A sub-chapter code is its chapter code plus a zero-padded 1-based index,
 * e.g. `ACtE03` -> `ACtE0301` .. `ACtE0306`.
 *
 * COMPILE-TIME GUARANTEES
 * -----------------------
 * `SYLLABUS_SOURCE` is declared `as const satisfies Tuple10<ChapterSource>`
 * where `ChapterSource.subchapters` is `Tuple6<SubchapterSource>`. Adding or
 * removing a chapter or a sub-chapter is therefore a type error, not a silent
 * data drift. `SyllabusHasTenChapters` / `EverySyllabusChapterHasSixSubchapters`
 * below restate those invariants as explicit type-level assertions, and
 * `__tests__/syllabus.test.ts` re-checks them at runtime.
 */

/** Exactly six of `T`. */
type Tuple6<T> = readonly [T, T, T, T, T, T];

/** Exactly ten of `T`. */
type Tuple10<T> = readonly [T, T, T, T, T, T, T, T, T, T];

interface SubchapterSource {
  readonly code: string;
  readonly title: string;
}

interface ChapterSource {
  readonly number: number;
  readonly code: string;
  readonly title: string;
  /** The shipped question-bank chapter this syllabus chapter maps onto. */
  readonly bookChapterId: string;
  readonly subchapters: Tuple6<SubchapterSource>;
}

const SYLLABUS_SOURCE = [
  {
    number: 1,
    code: 'AExE01',
    title: 'Concept of Basic Electrical and Electronics Engineering',
    bookChapterId: 'book-ch1',
    subchapters: [
      { code: 'AExE0101', title: 'Basic Concept' },
      { code: 'AExE0102', title: 'Network Theorems' },
      { code: 'AExE0103', title: 'Alternating Current Fundamentals' },
      { code: 'AExE0104', title: 'Semiconductor Devices' },
      { code: 'AExE0105', title: 'Signal Generators' },
      { code: 'AExE0106', title: 'Amplifiers' },
    ],
  },
  {
    number: 2,
    code: 'AExE02',
    title: 'Digital Logic and Microprocessor',
    bookChapterId: 'book-ch2',
    subchapters: [
      { code: 'AExE0201', title: 'Digital Logic' },
      { code: 'AExE0202', title: 'Combinational and Arithmetic Circuits' },
      { code: 'AExE0203', title: 'Sequential Logic Circuits' },
      { code: 'AExE0204', title: 'Microprocessor' },
      { code: 'AExE0205', title: 'Microprocessor System' },
      { code: 'AExE0206', title: 'Interrupt Operations' },
    ],
  },
  {
    number: 3,
    code: 'ACtE03',
    title: 'Programming Language and Its Applications',
    bookChapterId: 'book-ch3',
    subchapters: [
      { code: 'ACtE0301', title: 'Introduction to C Programming' },
      { code: 'ACtE0302', title: 'Pointers, Structure and Data Files in C' },
      { code: 'ACtE0303', title: 'C++ with Objects and Classes' },
      { code: 'ACtE0304', title: 'Object-Oriented Programming Features' },
      { code: 'ACtE0305', title: 'Virtual Functions and File Handling' },
      { code: 'ACtE0306', title: 'Generic Programming and Exception Handling' },
    ],
  },
  {
    number: 4,
    code: 'ACtE04',
    title: 'Computer Organization and Embedded System',
    bookChapterId: 'book-ch4',
    subchapters: [
      { code: 'ACtE0401', title: 'Control and Central Processing Units' },
      { code: 'ACtE0402', title: 'Computer Arithmetic and Memory System' },
      { code: 'ACtE0403', title: 'Input-Output Organization and Multiprocessor' },
      { code: 'ACtE0404', title: 'Embedded System Design' },
      { code: 'ACtE0405', title: 'Real-Time OS and Control Systems' },
      { code: 'ACtE0406', title: 'HDL and IC Technology' },
    ],
  },
  {
    number: 5,
    code: 'ACtE05',
    title: 'Concept of Computer Network and Network Security System',
    bookChapterId: 'book-ch5',
    subchapters: [
      { code: 'ACtE0501', title: 'Introduction and Physical Layer' },
      { code: 'ACtE0502', title: 'Data Link Layer' },
      { code: 'ACtE0503', title: 'Network Layer' },
      { code: 'ACtE0504', title: 'Transport Layer' },
      { code: 'ACtE0505', title: 'Application Layer' },
      { code: 'ACtE0506', title: 'Network Security' },
    ],
  },
  {
    number: 6,
    code: 'ACtE06',
    title: 'Theory of Computation and Computer Graphics',
    bookChapterId: 'book-ch6',
    subchapters: [
      { code: 'ACtE0601', title: 'Finite Automata' },
      { code: 'ACtE0602', title: 'Context-Free Languages' },
      { code: 'ACtE0603', title: 'Turing Machines' },
      { code: 'ACtE0604', title: 'Introduction to Computer Graphics' },
      { code: 'ACtE0605', title: '2D Transformations' },
      { code: 'ACtE0606', title: '3D Transformations' },
    ],
  },
  {
    number: 7,
    code: 'ACtE07',
    title: 'Data Structures and Algorithm, Database System and Operating System',
    bookChapterId: 'book-ch7',
    subchapters: [
      { code: 'ACtE0701', title: 'Data Structures, Lists and Trees' },
      { code: 'ACtE0702', title: 'Sorting, Searching and Graphs' },
      { code: 'ACtE0703', title: 'Data Models, Normalization and SQL' },
      { code: 'ACtE0704', title: 'Transaction Processing and Concurrency Control' },
      { code: 'ACtE0705', title: 'Introduction to OS and Process Management' },
      { code: 'ACtE0706', title: 'Memory Management, File Systems and Administration' },
    ],
  },
  {
    number: 8,
    code: 'ACtE08',
    title: 'Software Engineering and Object-Oriented Analysis & Design',
    bookChapterId: 'book-ch8',
    subchapters: [
      { code: 'ACtE0801', title: 'Software Process and Requirements' },
      { code: 'ACtE0802', title: 'Software Design' },
      { code: 'ACtE0803', title: 'Testing, Cost Estimation and Quality Management' },
      { code: 'ACtE0804', title: 'OO Fundamentals and Analysis' },
      { code: 'ACtE0805', title: 'OO Design' },
      { code: 'ACtE0806', title: 'OO Design Implementation' },
    ],
  },
  {
    number: 9,
    code: 'ACtE09',
    title: 'Artificial Intelligence and Neural Networks',
    bookChapterId: 'book-ch9',
    subchapters: [
      { code: 'ACtE0901', title: 'Introduction to AI and Intelligent Agents' },
      { code: 'ACtE0902', title: 'Problem Solving and Searching Techniques' },
      { code: 'ACtE0903', title: 'Knowledge Representation' },
      { code: 'ACtE0904', title: 'Expert Systems and NLP' },
      { code: 'ACtE0905', title: 'Machine Learning' },
      { code: 'ACtE0906', title: 'Neural Networks' },
    ],
  },
  {
    number: 10,
    code: 'AALL10',
    title: 'Project Planning, Design and Implementation',
    bookChapterId: 'book-ch10',
    subchapters: [
      { code: 'AALL1001', title: 'Engineering Drawings and Concepts' },
      { code: 'AALL1002', title: 'Engineering Economics' },
      { code: 'AALL1003', title: 'Project Planning and Scheduling' },
      { code: 'AALL1004', title: 'Project Management' },
      { code: 'AALL1005', title: 'Engineering Professional Practice' },
      { code: 'AALL1006', title: 'Engineering Regulatory Body' },
    ],
  },
] as const satisfies Tuple10<ChapterSource>;

/* ------------------------------------------------------------------ *
 * Derived literal types — these narrow automatically with the data.
 * ------------------------------------------------------------------ */

/** One of the ten official chapter codes, e.g. `'ACtE03'`. */
export type ChapterCode = (typeof SYLLABUS_SOURCE)[number]['code'];

/** One of the sixty official sub-chapter codes, e.g. `'ACtE0304'`. */
export type SubchapterCode = (typeof SYLLABUS_SOURCE)[number]['subchapters'][number]['code'];

/** Chapter ordinal, 1-10. */
export type ChapterNumber = (typeof SYLLABUS_SOURCE)[number]['number'];

/** The shipped question-bank chapter ids, `'book-ch1'` .. `'book-ch10'`. */
export type BookChapterId = (typeof SYLLABUS_SOURCE)[number]['bookChapterId'];

/** Sub-chapter position within its chapter, 1-6. */
export type SubchapterIndex = 1 | 2 | 3 | 4 | 5 | 6;

/* ------------------------------------------------------------------ *
 * Type-level restatement of the structural invariants.
 * ------------------------------------------------------------------ */

type AssertTrue<T extends true> = T;
type Equals<A, B> = (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2
  ? true
  : false;

/** Fails to compile unless the syllabus has exactly 10 chapters. */
export type SyllabusHasTenChapters = AssertTrue<Equals<(typeof SYLLABUS_SOURCE)['length'], 10>>;

/** Fails to compile unless every chapter has exactly 6 sub-chapters. */
export type EverySyllabusChapterHasSixSubchapters = AssertTrue<
  Equals<(typeof SYLLABUS_SOURCE)[number]['subchapters']['length'], 6>
>;

/* ------------------------------------------------------------------ *
 * Public shapes.
 * ------------------------------------------------------------------ */

export interface SyllabusSubchapter {
  /** Official code, e.g. `'ACtE0304'`. */
  readonly code: SubchapterCode;
  /** Owning chapter's official code, e.g. `'ACtE03'`. */
  readonly chapterCode: ChapterCode;
  /** Owning chapter's ordinal, 1-10. */
  readonly chapterNumber: ChapterNumber;
  /** Position within the chapter, 1-6. */
  readonly index: SubchapterIndex;
  /** Human-facing dotted code, e.g. `'3.4'` — what BookPractice.tsx shows. */
  readonly displayCode: string;
  /** Official title, verbatim from the syllabus. */
  readonly title: string;
}

export interface SyllabusChapter {
  readonly code: ChapterCode;
  readonly number: ChapterNumber;
  readonly title: string;
  /** The `book-chN` id in `bookChapters.generated.ts` this chapter maps to. */
  readonly bookChapterId: BookChapterId;
  readonly subchapters: readonly SyllabusSubchapter[];
}

/** Number of chapters in the official syllabus. */
export const CHAPTER_COUNT = 10;
/** Sub-chapters per chapter in the official syllabus. */
export const SUBCHAPTERS_PER_CHAPTER = 6;
/** Total coded sub-chapters: `CHAPTER_COUNT * SUBCHAPTERS_PER_CHAPTER`. */
export const SUBCHAPTER_COUNT = 60;

/** 1-based index lookup — avoids casting `array.map` positions. */
const SUBCHAPTER_INDEXES: Tuple6<SubchapterIndex> = [1, 2, 3, 4, 5, 6];

function buildChapter(source: (typeof SYLLABUS_SOURCE)[number]): SyllabusChapter {
  const subchapters: SyllabusSubchapter[] = source.subchapters.map((sub, position) => {
    const index = SUBCHAPTER_INDEXES[position];
    return {
      code: sub.code,
      chapterCode: source.code,
      chapterNumber: source.number,
      index,
      displayCode: String(source.number) + '.' + String(index),
      title: sub.title,
    };
  });

  return {
    code: source.code,
    number: source.number,
    title: source.title,
    bookChapterId: source.bookChapterId,
    subchapters,
  };
}

/** All ten chapters, in official order. */
export const syllabusChapters: readonly SyllabusChapter[] = SYLLABUS_SOURCE.map(buildChapter);

/** All sixty sub-chapters, flattened in official order. */
export const syllabusSubchapters: readonly SyllabusSubchapter[] = syllabusChapters.flatMap(
  chapter => chapter.subchapters,
);

/** All ten chapter codes, in official order. */
export const chapterCodes: readonly ChapterCode[] = syllabusChapters.map(chapter => chapter.code);

/** All sixty sub-chapter codes, in official order. */
export const subchapterCodes: readonly SubchapterCode[] = syllabusSubchapters.map(sub => sub.code);

/* ------------------------------------------------------------------ *
 * Lookups. Built once; all helpers are O(1).
 * ------------------------------------------------------------------ */

const chaptersByCode = new Map<string, SyllabusChapter>(
  syllabusChapters.map(chapter => [chapter.code, chapter]),
);
const chaptersByNumber = new Map<number, SyllabusChapter>(
  syllabusChapters.map(chapter => [chapter.number, chapter]),
);
const chaptersByBookId = new Map<string, SyllabusChapter>(
  syllabusChapters.map(chapter => [chapter.bookChapterId, chapter]),
);
const subchaptersByCode = new Map<string, SyllabusSubchapter>(
  syllabusSubchapters.map(sub => [sub.code, sub]),
);

/** Look up a chapter by its official code. */
export function getChapterByCode(code: string): SyllabusChapter | undefined {
  return chaptersByCode.get(code);
}

/** Look up a chapter by its ordinal (1-10). */
export function getChapterByNumber(number: number): SyllabusChapter | undefined {
  return chaptersByNumber.get(number);
}

/** Look up a chapter by the shipped question-bank id, e.g. `'book-ch4'`. */
export function getChapterByBookChapterId(bookChapterId: string): SyllabusChapter | undefined {
  return chaptersByBookId.get(bookChapterId);
}

/** Look up a sub-chapter by its official code. */
export function getSubchapterByCode(code: string): SyllabusSubchapter | undefined {
  return subchaptersByCode.get(code);
}

/** The six sub-chapters of a chapter; empty for an unknown chapter code. */
export function getSubchaptersForChapter(chapterCode: string): readonly SyllabusSubchapter[] {
  return chaptersByCode.get(chapterCode)?.subchapters ?? [];
}

/** The chapter that owns a sub-chapter code. */
export function getChapterForSubchapter(subchapterCode: string): SyllabusChapter | undefined {
  const sub = subchaptersByCode.get(subchapterCode);
  return sub === undefined ? undefined : chaptersByCode.get(sub.chapterCode);
}

/** Type guard: is this string one of the ten official chapter codes? */
export function isValidChapterCode(code: string): code is ChapterCode {
  return chaptersByCode.has(code);
}

/** Type guard: is this string one of the sixty official sub-chapter codes? */
export function isValidSubchapterCode(code: string): code is SubchapterCode {
  return subchaptersByCode.has(code);
}

/**
 * The code a sub-chapter at `index` of `chapterCode` must have.
 * Used by the structural tests to prove prefix + zero-padding correctness.
 */
export function expectedSubchapterCode(chapterCode: string, index: SubchapterIndex): string {
  return chapterCode + String(index).padStart(2, '0');
}
