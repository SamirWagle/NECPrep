import { describe, it, expect } from 'vitest';
import {
  CHAPTER_COUNT,
  SUBCHAPTERS_PER_CHAPTER,
  SUBCHAPTER_COUNT,
  chapterCodes,
  expectedSubchapterCode,
  getChapterByBookChapterId,
  getChapterByCode,
  getChapterByNumber,
  getChapterForSubchapter,
  getSubchapterByCode,
  getSubchaptersForChapter,
  isValidChapterCode,
  isValidSubchapterCode,
  subchapterCodes,
  syllabusChapters,
  syllabusSubchapters,
} from '../syllabus';

/**
 * The official chapter code prefixes, in order. Chapters 1-2 are the shared
 * electrical/electronics core, 3-9 the Computer Engineering stream, 10 the
 * all-streams project chapter.
 */
const EXPECTED_CHAPTER_CODES = [
  'AExE01',
  'AExE02',
  'ACtE03',
  'ACtE04',
  'ACtE05',
  'ACtE06',
  'ACtE07',
  'ACtE08',
  'ACtE09',
  'AALL10',
] as const;

describe('syllabus structure (10 x 6 = 60)', () => {
  it('declares the structural constants the NEC syllabus uses', () => {
    expect(CHAPTER_COUNT).toBe(10);
    expect(SUBCHAPTERS_PER_CHAPTER).toBe(6);
    expect(SUBCHAPTER_COUNT).toBe(CHAPTER_COUNT * SUBCHAPTERS_PER_CHAPTER);
    expect(SUBCHAPTER_COUNT).toBe(60);
  });

  it('has exactly 10 chapters', () => {
    expect(syllabusChapters).toHaveLength(CHAPTER_COUNT);
    expect(chapterCodes).toHaveLength(CHAPTER_COUNT);
  });

  it('has exactly 6 sub-chapters in every chapter', () => {
    for (const chapter of syllabusChapters) {
      expect(chapter.subchapters, 'chapter ' + chapter.code).toHaveLength(SUBCHAPTERS_PER_CHAPTER);
    }
  });

  it('totals exactly 60 sub-chapters', () => {
    expect(syllabusSubchapters).toHaveLength(SUBCHAPTER_COUNT);
    expect(subchapterCodes).toHaveLength(SUBCHAPTER_COUNT);

    const summed = syllabusChapters.reduce((total, chapter) => total + chapter.subchapters.length, 0);
    expect(summed).toBe(SUBCHAPTER_COUNT);
  });

  it('numbers chapters 1..10 in order', () => {
    expect(syllabusChapters.map(chapter => chapter.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('indexes sub-chapters 1..6 within every chapter', () => {
    for (const chapter of syllabusChapters) {
      expect(chapter.subchapters.map(sub => sub.index), 'chapter ' + chapter.code).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
    }
  });
});

describe('code correctness', () => {
  it('uses the official chapter codes in official order', () => {
    expect(chapterCodes).toEqual([...EXPECTED_CHAPTER_CODES]);
  });

  it('prefixes every sub-chapter code with its chapter code and a padded index', () => {
    for (const chapter of syllabusChapters) {
      for (const sub of chapter.subchapters) {
        expect(sub.chapterCode).toBe(chapter.code);
        expect(sub.chapterNumber).toBe(chapter.number);
        expect(sub.code.startsWith(chapter.code)).toBe(true);
        expect(sub.code).toBe(expectedSubchapterCode(chapter.code, sub.index));
        expect(sub.code).toHaveLength(chapter.code.length + 2);
      }
    }
  });

  it('has no duplicate chapter codes', () => {
    expect(new Set(chapterCodes).size).toBe(CHAPTER_COUNT);
  });

  it('has no duplicate sub-chapter codes', () => {
    expect(new Set(subchapterCodes).size).toBe(SUBCHAPTER_COUNT);
  });

  it('maps each chapter to a distinct book-chN id', () => {
    const bookIds = syllabusChapters.map(chapter => chapter.bookChapterId);
    expect(bookIds).toEqual([
      'book-ch1',
      'book-ch2',
      'book-ch3',
      'book-ch4',
      'book-ch5',
      'book-ch6',
      'book-ch7',
      'book-ch8',
      'book-ch9',
      'book-ch10',
    ]);
    expect(new Set(bookIds).size).toBe(CHAPTER_COUNT);
  });

  it('renders a dotted display code matching chapter.index', () => {
    expect(getSubchapterByCode('ACtE0304')?.displayCode).toBe('3.4');
    expect(getSubchapterByCode('AALL1006')?.displayCode).toBe('10.6');

    for (const sub of syllabusSubchapters) {
      expect(sub.displayCode).toBe(String(sub.chapterNumber) + '.' + String(sub.index));
    }
  });

  it('gives every chapter and sub-chapter a non-empty title', () => {
    for (const chapter of syllabusChapters) {
      expect(chapter.title.trim().length).toBeGreaterThan(0);
      for (const sub of chapter.subchapters) {
        expect(sub.title.trim().length, sub.code).toBeGreaterThan(0);
      }
    }
  });
});

describe('lookups', () => {
  it('finds a chapter by code, number and book id', () => {
    expect(getChapterByCode('ACtE07')?.number).toBe(7);
    expect(getChapterByNumber(7)?.code).toBe('ACtE07');
    expect(getChapterByBookChapterId('book-ch7')?.code).toBe('ACtE07');
  });

  it('returns undefined for unknown chapter keys', () => {
    expect(getChapterByCode('ACtE99')).toBeUndefined();
    expect(getChapterByNumber(11)).toBeUndefined();
    expect(getChapterByBookChapterId('book-ch11')).toBeUndefined();
  });

  it('finds a sub-chapter by code', () => {
    const sub = getSubchapterByCode('ACtE0402');
    expect(sub?.title).toBe('Computer Arithmetic and Memory System');
    expect(sub?.chapterCode).toBe('ACtE04');
    expect(sub?.index).toBe(2);
    expect(getSubchapterByCode('ACtE0407')).toBeUndefined();
  });

  it('returns a chapter sub-chapter list, empty for unknown chapters', () => {
    expect(getSubchaptersForChapter('AExE02')).toHaveLength(6);
    expect(getSubchaptersForChapter('nope')).toEqual([]);
  });

  it('round-trips chapter-for-subchapter for all 60 codes', () => {
    for (const sub of syllabusSubchapters) {
      const chapter = getChapterForSubchapter(sub.code);
      expect(chapter?.code, sub.code).toBe(sub.chapterCode);
      expect(chapter?.subchapters).toContain(sub);
    }
    expect(getChapterForSubchapter('AExE0199')).toBeUndefined();
  });
});

describe('guards', () => {
  it('accepts all 60 official sub-chapter codes', () => {
    for (const code of subchapterCodes) {
      expect(isValidSubchapterCode(code), code).toBe(true);
    }
  });

  it('rejects anything that is not an official sub-chapter code', () => {
    for (const bad of ['', 'ACtE03', 'ACtE0307', 'ACtE0300', 'acte0301', 'AALL1007', '3.1']) {
      expect(isValidSubchapterCode(bad), bad).toBe(false);
    }
  });

  it('narrows chapter codes too', () => {
    expect(isValidChapterCode('AALL10')).toBe(true);
    expect(isValidChapterCode('AALL1001')).toBe(false);
  });
});
