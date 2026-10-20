import { describe, it, expect } from 'vitest';
import {
  NO_SUBCHAPTER_TAGS,
  QUESTIONS_PER_CHAPTER,
  WEIGHTING_RULE,
  describeShortfall,
  examBlueprint,
  examFormat,
  formatUnverifiedFields,
  isFormatFullyVerified,
  listUnverifiedFields,
  planExam,
  readBlueprintValue,
  readConfirmed,
  readUnverified,
  selectionBlueprint,
  totalMarks,
} from '../examBlueprint';
import type { QuestionSupply } from '../examBlueprint';
import { SUBCHAPTER_COUNT, subchapterCodes, syllabusChapters } from '../syllabus';

/** Supply that exactly satisfies the blueprint: every quota met by tagged questions. */
function exactTaggedSupply(): QuestionSupply {
  const supply: Record<string, number> = {};
  for (const quota of selectionBlueprint.quotas) {
    supply[quota.subchapterCode] = quota.questions;
  }
  return supply;
}

/** Chapter pools large enough to cover any fallback. */
function generousChapterSupply(): QuestionSupply {
  const supply: Record<string, number> = {};
  for (const chapter of syllabusChapters) {
    supply[chapter.code] = 500;
  }
  return supply;
}

describe('exam format provenance', () => {
  it('carries the owner-confirmed 100 questions x 1 mark = 100 marks', () => {
    expect(readConfirmed(examFormat.questionCount)).toBe(100);
    expect(readConfirmed(examFormat.marksPerQuestion)).toBe(1);
    expect(totalMarks()).toBe(100);
  });

  it('records a verifiedOn date on every confirmed value', () => {
    expect(examFormat.questionCount.source.verifiedOn).toBe('2026-10-20');
    expect(examFormat.marksPerQuestion.source.verifiedOn).toBe('2026-10-20');
    expect(examFormat.questionCount.source.kind).toBe('project-owner');
  });

  it('never claims a verifiedOn date for an unverified value', () => {
    expect(examFormat.durationMinutes.source.verifiedOn).toBeNull();
    expect(examFormat.passMark.source.verifiedOn).toBeNull();
  });

  it('keeps the conflicting 45-minute app default on the record', () => {
    expect(examFormat.durationMinutes.value).toBe(120);
    expect(examFormat.durationMinutes.conflicts?.map(conflict => conflict.value)).toEqual([45]);
  });
});

describe('unverified-field reporting', () => {
  it('reports exactly duration and passMark as needing verification', () => {
    const reports = listUnverifiedFields();
    expect(reports.map(report => report.key)).toEqual(['durationMinutes', 'passMark']);
    expect(reports.map(report => report.label)).toEqual(['duration', 'passMark']);
  });

  it('formats a UI banner string', () => {
    expect(formatUnverifiedFields()).toBe('duration, passMark');
    expect('Blueprint: unverified fields: ' + formatUnverifiedFields()).toBe(
      'Blueprint: unverified fields: duration, passMark',
    );
  });

  it('knows the format is not fully verified yet', () => {
    expect(isFormatFullyVerified()).toBe(false);
  });

  it('attaches a source note to every unverified field', () => {
    for (const report of listUnverifiedFields()) {
      expect(report.source.note.length, report.key).toBeGreaterThan(0);
      expect(report.source.kind).toBe('secondary-source');
    }
  });
});

describe('reading values safely', () => {
  it('refuses an unverified value unless it is acknowledged', () => {
    expect(() => readBlueprintValue(examFormat.durationMinutes)).toThrow(/needs-verification/);
    expect(() => readBlueprintValue(examFormat.passMark)).toThrow(/needs-verification/);
  });

  it('allows a confirmed value through without ceremony', () => {
    expect(readBlueprintValue(examFormat.questionCount)).toBe(100);
  });

  it('allows an acknowledged unverified read', () => {
    const acknowledgement = {
      acknowledgeUnverified: true,
      reason: 'test: displaying the best current guess behind a warning banner',
    } as const;
    expect(readUnverified(examFormat.durationMinutes, acknowledgement)).toBe(120);
    expect(readBlueprintValue(examFormat.passMark, acknowledgement)).toBe(50);
  });
});

describe('selection blueprint weights', () => {
  it('has one quota per official sub-chapter', () => {
    expect(selectionBlueprint.quotas).toHaveLength(SUBCHAPTER_COUNT);
    expect(selectionBlueprint.quotas.map(quota => quota.subchapterCode)).toEqual([
      ...subchapterCodes,
    ]);
  });

  it('sums to exactly 100 questions', () => {
    const total = selectionBlueprint.quotas.reduce((sum, quota) => sum + quota.questions, 0);
    expect(total).toBe(100);
    expect(total).toBe(selectionBlueprint.totalQuestions);
    expect(total).toBe(readConfirmed(examFormat.questionCount));
  });

  it('gives every chapter an equal 10-question weight', () => {
    for (const chapter of syllabusChapters) {
      const chapterTotal = selectionBlueprint.quotas
        .filter(quota => quota.chapterCode === chapter.code)
        .reduce((sum, quota) => sum + quota.questions, 0);
      expect(chapterTotal, chapter.code).toBe(QUESTIONS_PER_CHAPTER);
    }
  });

  it('applies the documented largest-remainder tie-break on index', () => {
    for (const quota of selectionBlueprint.quotas) {
      const expected = quota.subchapterIndex <= 4 ? 2 : 1;
      expect(quota.questions, quota.subchapterCode).toBe(expected);
    }
  });

  it('ships non-strict with a documented chapter-level fallback', () => {
    expect(selectionBlueprint.strictBlueprint).toBe(false);
    expect(selectionBlueprint.fallback).toBe('chapter-level-sampling');
    expect(selectionBlueprint.weightingRule).toBe(WEIGHTING_RULE);
    expect(selectionBlueprint.notes.length).toBeGreaterThan(0);
  });

  it('is reachable from the top-level blueprint', () => {
    expect(examBlueprint.selection).toBe(selectionBlueprint);
    expect(examBlueprint.format).toBe(examFormat);
  });
});

describe('planExam', () => {
  it('builds a 100-question plan from an exactly sufficient tagged supply', () => {
    const result = planExam(exactTaggedSupply());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.totalQuestions).toBe(100);
    expect(result.plan.draws).toHaveLength(SUBCHAPTER_COUNT);
    expect(result.plan.approximatedSubchapterCodes).toEqual([]);
    expect(result.plan.unknownSupplyCodes).toEqual([]);
    const tagged = result.plan.draws.reduce((sum, draw) => sum + draw.fromSubchapterTagged, 0);
    expect(tagged).toBe(100);
  });

  it('succeeds under strict mode only when tagged supply covers every quota', () => {
    const strict = planExam(exactTaggedSupply(), { strictBlueprint: true });
    expect(strict.ok).toBe(true);
  });

  it('reports all 60 sub-chapters as approximated when nothing is tagged', () => {
    const result = planExam(NO_SUBCHAPTER_TAGS, { chapterSupply: generousChapterSupply() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.totalQuestions).toBe(100);
    expect(result.plan.approximatedSubchapterCodes).toHaveLength(SUBCHAPTER_COUNT);
    expect(result.plan.draws.every(draw => draw.fromSubchapterTagged === 0)).toBe(true);
    expect(result.plan.draws.every(draw => draw.approximated)).toBe(true);
  });

  it('fails strictly when nothing is tagged, naming every missing sub-chapter', () => {
    const result = planExam(NO_SUBCHAPTER_TAGS, {
      strictBlueprint: true,
      chapterSupply: generousChapterSupply(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.report.shortfalls).toHaveLength(SUBCHAPTER_COUNT);
    expect(result.report.totalRequested).toBe(100);
    expect(result.report.totalPlanned).toBe(0);
    expect(result.report.totalMissing).toBe(100);
  });

  it('returns a structured shortfall for a deliberately under-supplied input', () => {
    const supply: Record<string, number> = { ...exactTaggedSupply() };
    // ACtE0301 needs 2, give it 0. ACtE0305 needs 1, give it 0.
    supply['ACtE0301'] = 0;
    supply['ACtE0305'] = 0;
    // Chapter 3's pool can only absorb one of the three missing questions.
    const result = planExam(supply, { chapterSupply: { ACtE03: 8 } });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const byCode = new Map(result.report.shortfalls.map(entry => [entry.subchapterCode, entry]));
    expect([...byCode.keys()]).toEqual(['ACtE0301', 'ACtE0305']);

    const first = byCode.get('ACtE0301');
    expect(first?.requested).toBe(2);
    expect(first?.availableTagged).toBe(0);
    expect(first?.planned).toBe(1);
    expect(first?.missing).toBe(1);
    expect(first?.chapterCode).toBe('ACtE03');

    const second = byCode.get('ACtE0305');
    expect(second?.requested).toBe(1);
    expect(second?.planned).toBe(0);
    expect(second?.missing).toBe(1);

    expect(result.report.totalRequested).toBe(100);
    expect(result.report.totalPlanned).toBe(98);
    expect(result.report.totalMissing).toBe(2);
    expect(describeShortfall(result.report)).toBe(
      'Short 2 of 100 questions across 2 sub-chapters: ACtE0301 (-1), ACtE0305 (-1)',
    );
  });

  it('fails when no chapter fallback pool is supplied either', () => {
    const result = planExam(NO_SUBCHAPTER_TAGS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.report.totalMissing).toBe(100);
    expect(result.report.strictBlueprint).toBe(false);
  });

  it('flags supply keys that are not official sub-chapter codes', () => {
    const supply: Record<string, number> = { ...exactTaggedSupply(), ACtE0399: 5, 'book-ch3': 9 };
    const result = planExam(supply);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.plan.unknownSupplyCodes].sort()).toEqual(['ACtE0399', 'book-ch3']);
  });

  it('ignores negative and non-finite supply counts rather than trusting them', () => {
    const supply: Record<string, number> = { ...exactTaggedSupply() };
    supply['AExE0101'] = -5;
    supply['AExE0102'] = Number.NaN;
    const result = planExam(supply, { chapterSupply: { AExE01: 100 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.plan.approximatedSubchapterCodes]).toEqual(['AExE0101', 'AExE0102']);
  });
});
