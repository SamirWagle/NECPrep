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

  it('records a verifiedOn date and a provenance kind on every field', () => {
    for (const [key, field] of Object.entries(examFormat)) {
      expect(field.status, key).toBe('confirmed');
      expect(field.source.verifiedOn, key).toBe('2026-10-20');
      expect(field.source.kind, key).toBe('project-owner');
    }
  });

  it('carries a null sourceUrl, because no published document states these', () => {
    // The official syllabus PDF contains no marking scheme. Citing a URL here
    // would manufacture an authority that does not exist, so null is the
    // honest value and this test exists to stop a plausible-looking URL being
    // added later.
    for (const [key, field] of Object.entries(examFormat)) {
      expect(field.source.sourceUrl, key).toBeNull();
    }
  });

  it('holds the owner-confirmed exam format', () => {
    expect(readConfirmed(examFormat.questionCount)).toBe(100);
    expect(readConfirmed(examFormat.marksPerQuestion)).toBe(1);
    expect(readConfirmed(examFormat.durationMinutes)).toBe(120);
    expect(readConfirmed(examFormat.passMark)).toBe(50);
    expect(totalMarks()).toBe(100);
  });

  it('allows 72 seconds per question, not the 27 the old 45-minute default gave', () => {
    // Pacing analytics depend on this, and the app shipped 45 minutes against a
    // 120-minute exam - a 2.7x error in every per-question time budget.
    const seconds =
      (readConfirmed(examFormat.durationMinutes) * 60) /
      readConfirmed(examFormat.questionCount);
    expect(seconds).toBeCloseTo(72, 5);
  });
});

describe('unverified-field reporting', () => {
  it('reports nothing unverified now that the owner has confirmed all four', () => {
    expect(listUnverifiedFields()).toEqual([]);
    expect(formatUnverifiedFields()).toBe('');
    expect(isFormatFullyVerified()).toBe(true);
  });

  // The machinery stays tested against a synthetic field rather than a real one.
  // Negative marking and per-chapter weights are still unknown, so the next
  // field added is likelier to be a guess than a confirmation, and the refusal
  // path has to still work when it arrives.
  const syntheticUnverified = {
    value: 0.25,
    status: 'needs-verification',
    label: 'negativeMarkPerWrong',
    unit: 'marks',
    source: {
      kind: 'secondary-source',
      label: 'Not established',
      sourceUrl: null,
      verifiedOn: null,
      note: 'No source states whether NEC applies negative marking.',
    },
  } as const;

  it('still refuses to read an unverified value without acknowledgement', () => {
    expect(() => readBlueprintValue(syntheticUnverified)).toThrow(/needs-verification/);
  });

  it('still allows an acknowledged unverified read', () => {
    expect(
      readUnverified(syntheticUnverified, {
        acknowledgeUnverified: true,
        reason: 'test: displaying a best guess behind a warning banner',
      }),
    ).toBe(0.25);
  });
});

describe('reading values safely', () => {
  it('allows every confirmed value through without ceremony', () => {
    expect(readBlueprintValue(examFormat.questionCount)).toBe(100);
    expect(readBlueprintValue(examFormat.durationMinutes)).toBe(120);
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
