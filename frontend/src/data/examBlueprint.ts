/**
 * The NEC licence-exam format and question-selection blueprint, as data.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Exam constants were previously scattered as bare numbers (e.g. `duration: 45`
 * in `topics.ts`) with no record of where they came from. Several of them are
 * not actually known: the official NEC syllabus PDF for the Computer
 * Engineering stream lists the 10 chapters and their 60 sub-chapters but
 * contains **no marking scheme at all** - no duration, no pass mark, no
 * per-chapter weights. Shipping a guess as a bare number is how a guess becomes
 * folklore.
 *
 * So every exam constant lives here exactly once, wrapped in a
 * `BlueprintValue<T>` that carries its provenance and its verification status.
 * A `ConfirmedValue<T>` can be read with `readConfirmed()`. An
 * `UnverifiedValue<T>` *cannot* be passed to `readConfirmed()` (compile error)
 * and must be read through `readUnverified()`, which requires an explicit
 * acknowledgement object. Reading an unverified number by accident is
 * therefore not possible.
 *
 * WHAT IS CONFIRMED
 * -----------------
 * - `questionCount` = 100 and `marksPerQuestion` = 1 (so 100 marks total).
 *   Confirmed directly by the project owner on 2026-10-20.
 *
 * WHAT IS NOT
 * -----------
 * - `durationMinutes` - secondary sources say 120; the app's mock tests are
 *   currently configured at 45. The two disagree and neither is sourced from an
 *   official document.
 * - `passMark` - secondary sources say 50/100. Not in the official PDF.
 *
 * `listUnverifiedFields()` / `formatUnverifiedFields()` exist so the UI can say
 * "Blueprint: unverified fields: duration, passMark" rather than presenting a
 * guess as fact.
 */

import type { ChapterCode, SubchapterCode, SubchapterIndex } from './syllabus';
import { syllabusChapters, syllabusSubchapters } from './syllabus';

/* ------------------------------------------------------------------ *
 * Provenance
 * ------------------------------------------------------------------ */

export type VerificationStatus = 'confirmed' | 'needs-verification';

export type ProvenanceKind =
  /** The official NEC syllabus / notice PDF. */
  | 'official-document'
  /** Confirmed verbally or in writing by the project owner. */
  | 'project-owner'
  /** Coaching sites, forum posts, blog write-ups - plausible, unverified. */
  | 'secondary-source'
  /** A number the app already had in its code with no recorded origin. */
  | 'app-default';

export interface ProvenanceSource {
  readonly kind: ProvenanceKind;
  /** Short human-facing description of where the value came from. */
  readonly label: string;
  /**
   * Canonical URL for the claim, or `null` when none exists.
   * `null` is deliberate: the owner's confirmation and the app's historical
   * defaults have no public document behind them, and inventing a plausible
   * URL would be worse than admitting there isn't one.
   */
  readonly sourceUrl: string | null;
  /** ISO `YYYY-MM-DD` the value was last verified, or `null` if never. */
  readonly verifiedOn: string | null;
  /** Why this status, and what would have to happen to upgrade it. */
  readonly note: string;
}

/** A competing value for the same constant, recorded rather than discarded. */
export interface ValueConflict<T> {
  readonly value: T;
  readonly label: string;
  readonly sourceUrl: string | null;
}

export interface BlueprintValue<T> {
  readonly value: T;
  readonly status: VerificationStatus;
  /** Short stable label for UI listings, e.g. `'duration'`. */
  readonly label: string;
  readonly unit: string;
  readonly source: ProvenanceSource;
  /** Other values seen in the wild for this same constant. */
  readonly conflicts?: readonly ValueConflict<T>[];
}

/** A value whose correctness has been confirmed. Safe to read directly. */
export interface ConfirmedValue<T> extends BlueprintValue<T> {
  readonly status: 'confirmed';
  readonly source: ProvenanceSource & { readonly verifiedOn: string };
}

/** A value that is still a guess. Cannot be read without acknowledgement. */
export interface UnverifiedValue<T> extends BlueprintValue<T> {
  readonly status: 'needs-verification';
}

/**
 * Caller's explicit statement that they know the number is unverified.
 * Required by `readUnverified()`; the literal `true` makes it impossible to
 * satisfy accidentally with a falsy default.
 */
export interface UnverifiedAcknowledgement {
  readonly acknowledgeUnverified: true;
  /** Why using an unverified value is acceptable here. */
  readonly reason: string;
}

/** Read a confirmed constant. Typed so unverified fields are rejected. */
export function readConfirmed<T>(field: ConfirmedValue<T>): T {
  return field.value;
}

/** Read an unverified constant, forcing the caller to acknowledge it. */
export function readUnverified<T>(
  field: UnverifiedValue<T>,
  acknowledgement: UnverifiedAcknowledgement,
): T {
  if (acknowledgement.acknowledgeUnverified !== true) {
    throw new Error(
      'readUnverified("' + field.label + '") requires acknowledgeUnverified: true',
    );
  }
  return field.value;
}

/**
 * Runtime escape hatch for code holding a `BlueprintValue<T>` of unknown
 * status. Throws on an unverified value unless acknowledged - so a forgotten
 * acknowledgement fails loudly instead of shipping a guess.
 */
export function readBlueprintValue<T>(
  field: BlueprintValue<T>,
  acknowledgement?: UnverifiedAcknowledgement,
): T {
  if (field.status === 'needs-verification' && acknowledgement?.acknowledgeUnverified !== true) {
    throw new Error(
      'Blueprint field "' +
        field.label +
        '" is marked needs-verification; pass an UnverifiedAcknowledgement to use it.',
    );
  }
  return field.value;
}

/* ------------------------------------------------------------------ *
 * Exam format
 * ------------------------------------------------------------------ */

const OWNER_CONFIRMATION: ProvenanceSource & { readonly verifiedOn: string } = {
  kind: 'project-owner',
  label: 'Project owner confirmation',
  sourceUrl: null,
  verifiedOn: '2026-10-20',
  note:
    'Owner confirmed the paper is 100 questions at 1 mark each (100 marks). ' +
    'The official NEC syllabus PDF carries no marking scheme, so there is no ' +
    'document URL to cite for this.',
};

export interface ExamFormatBlueprint {
  /** Questions on the paper. */
  readonly questionCount: ConfirmedValue<number>;
  /** Marks awarded per correct question. */
  readonly marksPerQuestion: ConfirmedValue<number>;
  /** Minutes allowed for the paper. NOT VERIFIED. */
  readonly durationMinutes: UnverifiedValue<number>;
  /** Marks required to pass, out of `totalMarks()`. NOT VERIFIED. */
  readonly passMark: UnverifiedValue<number>;
}

export const examFormat: ExamFormatBlueprint = {
  questionCount: {
    value: 100,
    status: 'confirmed',
    label: 'questionCount',
    unit: 'questions',
    source: OWNER_CONFIRMATION,
  },
  marksPerQuestion: {
    value: 1,
    status: 'confirmed',
    label: 'marksPerQuestion',
    unit: 'marks',
    source: OWNER_CONFIRMATION,
  },
  durationMinutes: {
    value: 120,
    status: 'needs-verification',
    label: 'duration',
    unit: 'minutes',
    source: {
      kind: 'secondary-source',
      label: 'Coaching-site and forum write-ups (unofficial)',
      sourceUrl: 'https://nec.gov.np/',
      verifiedOn: null,
      note:
        'Secondary sources quote 120 minutes. The app has historically ' +
        'configured 45 minutes for its mock tests (see mockTests in topics.ts), ' +
        'which conflicts. The official syllabus PDF states no duration. ' +
        'Resolve against an NEC exam notice or admit card before display.',
    },
    conflicts: [
      {
        value: 45,
        label: 'App mock-test default (mockTests in src/data/topics.ts)',
        sourceUrl: null,
      },
    ],
  },
  passMark: {
    value: 50,
    status: 'needs-verification',
    label: 'passMark',
    unit: 'marks',
    source: {
      kind: 'secondary-source',
      label: 'Coaching-site and forum write-ups (unofficial)',
      sourceUrl: 'https://nec.gov.np/',
      verifiedOn: null,
      note:
        'Secondary sources quote 50 out of 100 (50%). The official syllabus ' +
        'PDF states no pass mark. Resolve against an NEC regulation or result ' +
        'notice before display.',
    },
  },
};

/**
 * Total marks for the paper. Derived, never stored, so it cannot drift from
 * `questionCount` x `marksPerQuestion`.
 */
export function totalMarks(format: ExamFormatBlueprint = examFormat): number {
  return readConfirmed(format.questionCount) * readConfirmed(format.marksPerQuestion);
}

/* ------------------------------------------------------------------ *
 * Unverified-field reporting
 * ------------------------------------------------------------------ */

export interface UnverifiedFieldReport {
  /** Key on `ExamFormatBlueprint`, e.g. `'durationMinutes'`. */
  readonly key: string;
  /** Short UI label, e.g. `'duration'`. */
  readonly label: string;
  /** The current best guess being carried. */
  readonly currentValue: number;
  readonly unit: string;
  readonly source: ProvenanceSource;
}

/**
 * Every format field currently marked `needs-verification`.
 * Today this is `duration` and `passMark`.
 */
export function listUnverifiedFields(
  format: ExamFormatBlueprint = examFormat,
): readonly UnverifiedFieldReport[] {
  const entries: readonly (readonly [string, BlueprintValue<number>])[] = [
    ['questionCount', format.questionCount],
    ['marksPerQuestion', format.marksPerQuestion],
    ['durationMinutes', format.durationMinutes],
    ['passMark', format.passMark],
  ];

  return entries
    .filter(([, field]) => field.status === 'needs-verification')
    .map(([key, field]) => ({
      key,
      label: field.label,
      currentValue: field.value,
      unit: field.unit,
      source: field.source,
    }));
}

/**
 * Comma-separated labels of the unverified fields, for a UI banner such as
 * `Blueprint: unverified fields: duration, passMark`. Empty string when
 * everything is confirmed.
 */
export function formatUnverifiedFields(format: ExamFormatBlueprint = examFormat): string {
  return listUnverifiedFields(format)
    .map(report => report.label)
    .join(', ');
}

/** True when nothing in the format blueprint is still a guess. */
export function isFormatFullyVerified(format: ExamFormatBlueprint = examFormat): boolean {
  return listUnverifiedFields(format).length === 0;
}

/* ------------------------------------------------------------------ *
 * Question-selection blueprint
 * ------------------------------------------------------------------ */

export type WeightingRuleId = 'equal-chapter-weight-largest-remainder';

/**
 * THE WEIGHTING RULE - `equal-chapter-weight-largest-remainder`
 *
 * 100 questions do not divide evenly across 60 sub-chapters (100 / 60 = 1.67),
 * so the split has to be defined rather than computed. The rule is:
 *
 * 1. **Equal chapter weight.** Each of the 10 chapters contributes
 *    100 / 10 = 10 questions. This is the only split the official syllabus
 *    supports: it lists 10 chapters with identical structure (6 sub-chapters
 *    each) and publishes no weights. Any uneven chapter weighting would be
 *    invented.
 * 2. **Within a chapter**, the 10 questions are spread over 6 sub-chapters by
 *    the largest-remainder (Hare quota) method on equal shares: each
 *    sub-chapter's ideal share is 10 / 6 = 1.667, giving a floor of 1
 *    (6 seats) and a remainder of 0.667 for all six. Four seats remain.
 * 3. **Tie-break.** All six remainders are equal, so the remaining seats are
 *    awarded in ascending sub-chapter index - the standard deterministic
 *    tie-break. Sub-chapters 1-4 get 2 questions, sub-chapters 5-6 get 1.
 *
 * Per chapter: 2 + 2 + 2 + 2 + 1 + 1 = 10. Across 10 chapters: exactly 100.
 *
 * The index tie-break is arbitrary in content terms and is *documented as
 * arbitrary*. It is stable and auditable, which a random tie-break would not
 * be. Replace it with real past-paper frequency weights the moment those
 * exist; that is a data change here, not a code change anywhere else.
 */
export const WEIGHTING_RULE: WeightingRuleId = 'equal-chapter-weight-largest-remainder';

/** Questions drawn from each chapter under the equal-chapter-weight rule. */
export const QUESTIONS_PER_CHAPTER = 10;

/** Sub-chapter indexes awarded a largest-remainder bonus seat. */
const BONUS_SEAT_INDEXES: readonly SubchapterIndex[] = [1, 2, 3, 4];

function quotaForIndex(index: SubchapterIndex): number {
  return BONUS_SEAT_INDEXES.includes(index) ? 2 : 1;
}

export interface SubchapterQuota {
  readonly subchapterCode: SubchapterCode;
  readonly chapterCode: ChapterCode;
  readonly subchapterIndex: SubchapterIndex;
  /** Questions this sub-chapter must contribute to a 100-question paper. */
  readonly questions: number;
}

export interface SelectionBlueprint {
  readonly totalQuestions: number;
  readonly weightingRule: WeightingRuleId;
  /** One entry per official sub-chapter - always 60 of them. */
  readonly quotas: readonly SubchapterQuota[];
  /**
   * When `true`, a sub-chapter with too few tagged questions is a hard
   * failure. When `false`, the planner falls back to chapter-level sampling
   * and reports which sub-chapters it had to approximate.
   *
   * Ships `false`, because **no question in the bank currently carries a
   * sub-chapter tag** - a strict run today would fail on all 60. Flip to
   * `true` once tagging coverage is real.
   */
  readonly strictBlueprint: boolean;
  /** What happens to an under-supplied sub-chapter when not strict. */
  readonly fallback: 'chapter-level-sampling';
  readonly notes: readonly string[];
}

const quotas: readonly SubchapterQuota[] = syllabusSubchapters.map(sub => ({
  subchapterCode: sub.code,
  chapterCode: sub.chapterCode,
  subchapterIndex: sub.index,
  questions: quotaForIndex(sub.index),
}));

export const selectionBlueprint: SelectionBlueprint = {
  totalQuestions: 100,
  weightingRule: WEIGHTING_RULE,
  quotas,
  strictBlueprint: false,
  fallback: 'chapter-level-sampling',
  notes: [
    'Sub-chapter tagging coverage in the question bank is currently zero, so ' +
      'every sub-chapter is satisfied by chapter-level fallback sampling. ' +
      'ExamPlan.approximatedSubchapterCodes reports exactly which ones.',
    'Chapter weights are equal (10 questions each) because the official ' +
      'syllabus publishes no per-chapter marks.',
    'Within a chapter, sub-chapters 1-4 contribute 2 questions and 5-6 ' +
      'contribute 1, by documented largest-remainder tie-break on index.',
  ],
};

export interface ExamBlueprint {
  readonly format: ExamFormatBlueprint;
  readonly selection: SelectionBlueprint;
}

export const examBlueprint: ExamBlueprint = {
  format: examFormat,
  selection: selectionBlueprint,
};

/* ------------------------------------------------------------------ *
 * Planning
 * ------------------------------------------------------------------ */

/**
 * Available question counts keyed by code. Passed in by the caller so this
 * module never touches the question files and stays pure and testable.
 */
export interface QuestionSupply {
  readonly [code: string]: number;
}

/**
 * Today's reality: not one question in the bank carries a sub-chapter tag.
 * Exported so callers can be explicit about it instead of hand-rolling `{}`.
 */
export const NO_SUBCHAPTER_TAGS: QuestionSupply = {};

export interface SubchapterDraw {
  readonly subchapterCode: SubchapterCode;
  readonly chapterCode: ChapterCode;
  readonly requested: number;
  /** Drawn from questions actually tagged with this sub-chapter. */
  readonly fromSubchapterTagged: number;
  /** Drawn from the chapter pool because tagged questions ran out. */
  readonly fromChapterFallback: number;
  /** True when any part of this draw was approximated at chapter level. */
  readonly approximated: boolean;
}

export interface ExamPlan {
  /** Always equals `selectionBlueprint.totalQuestions` when `ok` is true. */
  readonly totalQuestions: number;
  readonly draws: readonly SubchapterDraw[];
  /** Sub-chapters whose quota was partly or wholly chapter-level sampled. */
  readonly approximatedSubchapterCodes: readonly SubchapterCode[];
  readonly strictBlueprint: boolean;
  readonly weightingRule: WeightingRuleId;
  /** Supply keys that are not official sub-chapter codes - likely typos. */
  readonly unknownSupplyCodes: readonly string[];
}

export interface SubchapterShortfall {
  readonly subchapterCode: SubchapterCode;
  readonly chapterCode: ChapterCode;
  readonly requested: number;
  /** Questions tagged with this sub-chapter. */
  readonly availableTagged: number;
  /** Questions it could raise, tagged plus chapter fallback. */
  readonly planned: number;
  /** `requested - planned`, always greater than 0 for an entry in this list. */
  readonly missing: number;
}

export interface ShortfallReport {
  readonly totalRequested: number;
  readonly totalPlanned: number;
  readonly totalMissing: number;
  readonly shortfalls: readonly SubchapterShortfall[];
  readonly strictBlueprint: boolean;
  readonly unknownSupplyCodes: readonly string[];
}

export type ExamPlanResult =
  | { readonly ok: true; readonly plan: ExamPlan }
  | { readonly ok: false; readonly report: ShortfallReport };

export interface PlanExamOptions {
  /**
   * Override `selectionBlueprint.strictBlueprint`. When strict, chapter-level
   * fallback is disabled and any under-supplied sub-chapter is a shortfall.
   */
  readonly strictBlueprint?: boolean;
  /**
   * Total questions available per chapter, keyed by chapter code
   * (e.g. `{ ACtE03: 398 }`). Used only for fallback sampling. Tagged
   * questions are assumed to be a subset of their chapter's pool, so a
   * chapter's fallback capacity is its supply minus the questions already
   * drawn from that chapter.
   */
  readonly chapterSupply?: QuestionSupply;
  readonly blueprint?: SelectionBlueprint;
}

function supplyFor(supply: QuestionSupply, code: string): number {
  const count = supply[code];
  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/**
 * Turn per-sub-chapter availability into a 100-question plan, or a structured
 * report of what is missing and by how much.
 *
 * Pure: it reads nothing but its arguments and the static blueprint.
 */
export function planExam(
  subchapterSupply: QuestionSupply,
  options: PlanExamOptions = {},
): ExamPlanResult {
  const blueprint = options.blueprint ?? selectionBlueprint;
  const strict = options.strictBlueprint ?? blueprint.strictBlueprint;
  const chapterSupply = options.chapterSupply ?? {};

  const validCodes = new Set<string>(blueprint.quotas.map(quota => quota.subchapterCode));
  const unknownSupplyCodes = Object.keys(subchapterSupply).filter(code => !validCodes.has(code));

  // Pass 1 - satisfy what the sub-chapter tags can actually cover. Done first
  // and in full so the result does not depend on quota iteration order.
  interface TaggedDraw {
    readonly quotaIndex: number;
    readonly availableTagged: number;
    readonly fromSubchapterTagged: number;
  }

  const taggedDraws: TaggedDraw[] = blueprint.quotas.map((quota, quotaIndex) => {
    const availableTagged = supplyFor(subchapterSupply, quota.subchapterCode);
    return {
      quotaIndex,
      availableTagged,
      fromSubchapterTagged: Math.min(quota.questions, availableTagged),
    };
  });

  const taggedPerChapter = new Map<string, number>();
  for (const tagged of taggedDraws) {
    const quota = blueprint.quotas[tagged.quotaIndex];
    taggedPerChapter.set(
      quota.chapterCode,
      (taggedPerChapter.get(quota.chapterCode) ?? 0) + tagged.fromSubchapterTagged,
    );
  }

  // Pass 2 - a chapter's fallback capacity is whatever is left of its pool once
  // the tagged questions it already yielded are set aside, because tagged
  // questions are a subset of their chapter's pool.
  const fallbackCapacity = new Map<string, number>(
    syllabusChapters.map(chapter => [
      chapter.code,
      strict
        ? 0
        : Math.max(
            0,
            supplyFor(chapterSupply, chapter.code) - (taggedPerChapter.get(chapter.code) ?? 0),
          ),
    ]),
  );

  const draws: SubchapterDraw[] = [];
  const shortfalls: SubchapterShortfall[] = [];
  const approximatedSubchapterCodes: SubchapterCode[] = [];
  let totalPlanned = 0;
  let totalRequested = 0;

  for (const tagged of taggedDraws) {
    const quota = blueprint.quotas[tagged.quotaIndex];
    const requested = quota.questions;
    totalRequested += requested;

    const deficit = requested - tagged.fromSubchapterTagged;
    const capacity = fallbackCapacity.get(quota.chapterCode) ?? 0;
    const fromChapterFallback = deficit > 0 ? Math.min(deficit, capacity) : 0;
    fallbackCapacity.set(quota.chapterCode, capacity - fromChapterFallback);

    const planned = tagged.fromSubchapterTagged + fromChapterFallback;
    totalPlanned += planned;

    const approximated = fromChapterFallback > 0;
    if (approximated) {
      approximatedSubchapterCodes.push(quota.subchapterCode);
    }

    draws.push({
      subchapterCode: quota.subchapterCode,
      chapterCode: quota.chapterCode,
      requested,
      fromSubchapterTagged: tagged.fromSubchapterTagged,
      fromChapterFallback,
      approximated,
    });

    if (planned < requested) {
      shortfalls.push({
        subchapterCode: quota.subchapterCode,
        chapterCode: quota.chapterCode,
        requested,
        availableTagged: tagged.availableTagged,
        planned,
        missing: requested - planned,
      });
    }
  }

  if (shortfalls.length > 0) {
    return {
      ok: false,
      report: {
        totalRequested,
        totalPlanned,
        totalMissing: totalRequested - totalPlanned,
        shortfalls,
        strictBlueprint: strict,
        unknownSupplyCodes,
      },
    };
  }

  return {
    ok: true,
    plan: {
      totalQuestions: totalPlanned,
      draws,
      approximatedSubchapterCodes,
      strictBlueprint: strict,
      weightingRule: blueprint.weightingRule,
      unknownSupplyCodes,
    },
  };
}

/** Human-readable one-liner for a shortfall report, for logs and dev UI. */
export function describeShortfall(report: ShortfallReport): string {
  const detail = report.shortfalls
    .map(entry => entry.subchapterCode + ' (-' + String(entry.missing) + ')')
    .join(', ');
  return (
    'Short ' +
    String(report.totalMissing) +
    ' of ' +
    String(report.totalRequested) +
    ' questions across ' +
    String(report.shortfalls.length) +
    ' sub-chapters: ' +
    detail
  );
}
