/**
 * What we can tell a student about a question without an explanation.
 *
 * No question in the bank has an explanation, and none will be generated here
 * — no live API is used in this project. That left the post-answer panel saying
 * "No explanation has been written for this question yet" and nothing else,
 * which is honest but useless: a student who got it wrong has no idea what to
 * revise.
 *
 * A syllabus reference is the honest thing that CAN be derived. The chapter is
 * a fact — it is which file the question shipped in — and the sub-chapter is a
 * deterministic keyword match that declines when it is not sure
 * (`subchapterClassifier`). So the panel can always say at least
 *
 *     Syllabus reference — Chapter 5: Computer Network and Network Security
 *
 * and about two thirds of the time it can say
 *
 *     Syllabus reference — 5.4 Transport Layer
 *
 * This is NOT an explanation and is never presented as one. It points at the
 * syllabus so revision has somewhere to start.
 */

import { getChapterByBookChapterId } from '../data/syllabus';
import { classifySubchapter, type SubchapterMatch } from './subchapterClassifier';

/**
 * Below this, a match is reported as tentative in the UI. 4000 bp is roughly
 * "one strong term and a clear runner-up gap" — enough to be worth showing,
 * not enough to state flatly.
 */
const TENTATIVE_BELOW_BP = 4000;

export interface QuestionReference {
  /** Always present: the chapter is known, not inferred. */
  readonly chapterNumber: number;
  readonly chapterTitle: string;
  /** The matched sub-chapter, or null when the classifier declined. */
  readonly subchapter: SubchapterMatch | null;
  /** True when a sub-chapter matched but only weakly. */
  readonly tentative: boolean;
  /**
   * One line fit to render, e.g. `'5.4 Transport Layer'` or
   * `'Chapter 5: Concept of Computer Network and Network Security System'`.
   */
  readonly label: string;
}

export interface ReferenceInput {
  /** The chapter id the question shipped under, e.g. `'book-ch5'`. */
  readonly topicId: string;
  readonly question: string;
  readonly options: readonly string[];
}

/**
 * Derive a syllabus reference for one question.
 *
 * Returns null only when the chapter itself is unrecognised — a custom or
 * synthetic topic id. Every real question yields at least a chapter.
 */
export function describeReference(input: ReferenceInput): QuestionReference | null {
  const chapter = getChapterByBookChapterId(input.topicId);
  if (!chapter) return null;

  const subchapter = classifySubchapter({
    bookChapterId: input.topicId,
    question: input.question,
    options: input.options,
  });

  return {
    chapterNumber: chapter.number,
    chapterTitle: chapter.title,
    subchapter,
    tentative: subchapter !== null && subchapter.confidenceBp < TENTATIVE_BELOW_BP,
    label: subchapter
      ? `${subchapter.displayCode} ${subchapter.title}`
      : `Chapter ${String(chapter.number)}: ${chapter.title}`,
  };
}

export { TENTATIVE_BELOW_BP };
