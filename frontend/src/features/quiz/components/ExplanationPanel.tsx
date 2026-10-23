/**
 * ExplanationPanel — why the right answer is right.
 *
 * Explanations carry provenance, because most of them are AI-generated drafts
 * that no human has read. Three rules follow from that, and all three are
 * enforced here rather than left to each caller:
 *
 *  1. An unreviewed draft is always labelled. The badge is a visible row above
 *     the text, not an asterisk — a student reading an engineering-licence
 *     explanation is entitled to know whether a person checked it. A caller
 *     that forgets to pass `origin` gets the badge anyway (see the default),
 *     because the failure mode of a missing label is worse than a redundant one.
 *
 *  2. A draft is never shown during a timed mock test. `context` must be set to
 *     `'exam'` there. A wrong explanation mid-exam is worse than no explanation:
 *     it can talk a student out of a correct answer on a later question, and
 *     there is no opportunity to check it. Reviewed and human-written
 *     explanations are withheld in an exam too, for a different reason — they
 *     name the answer.
 *
 *  3. Every draft offers a report link. The students are the only large-scale
 *     readers these drafts will have, so they are the review capacity that
 *     actually exists.
 *
 * It never invents an explanation. Where there is none — which today is every
 * question in the bank — it shows the derived syllabus reference instead, so a
 * student who got it wrong knows what to revise. A reference is not an
 * explanation and is labelled as a reference; see `services/questionReference`.
 */

import styles from './ExplanationPanel.module.css';
import type { QuestionReference } from '../../../services/questionReference';

/** Mirrors `explanations.origin` in the database. */
export type ExplanationOrigin = 'ai_draft' | 'ai_reviewed' | 'human';

/** Where the panel is being rendered, which decides what may be shown. */
export type ExplanationContext = 'practice' | 'review' | 'exam';

export interface DistractorRationale {
  /** Option id this rationale is about. */
  optionId: string;
  /** The option's text, so the rationale reads without relying on position. */
  optionText: string;
  why: string;
}

export interface ExplanationPanelProps {
  /** Authored or generated explanation. Undefined or blank renders the empty state. */
  explanation?: string | null;
  /**
   * Provenance. Defaults to `'ai_draft'` so an omitted value fails safe: an
   * unlabelled draft is the one outcome this component exists to prevent.
   */
  origin?: ExplanationOrigin;
  /**
   * Render context. Defaults to `'exam'` — the most restrictive — so a caller
   * that forgets to set it shows nothing rather than leaking the answer into a
   * timed paper.
   */
  context?: ExplanationContext;
  /** Hide entirely until the answer is revealed. */
  revealed?: boolean;
  /** Reference the student can follow instead, e.g. a chapter name. */
  sourceLabel?: string;
  /**
   * Derived syllabus reference. Shown in place of a missing explanation, and
   * as a footer alongside one that exists. Omit it and the panel degrades to
   * the plain empty state rather than failing.
   */
  reference?: QuestionReference | null;
  /** Why each wrong option is wrong. Often where the real teaching is. */
  distractors?: readonly DistractorRationale[];
  /** Called when the student reports a problem with this explanation. */
  onReport?: () => void;
}

export function ExplanationPanel({
  explanation,
  origin = 'ai_draft',
  context = 'exam',
  revealed = true,
  sourceLabel,
  reference,
  distractors,
  onReport,
}: ExplanationPanelProps) {
  if (!revealed) return null;

  // Rule 2. No explanation of any provenance is shown during a timed paper,
  // because the explanation names the answer.
  if (context === 'exam') return null;

  const text = explanation?.trim();
  const isUnreviewed = origin === 'ai_draft';
  const rationales = (distractors ?? []).filter((d) => d.why.trim().length > 0);

  if (!text && rationales.length === 0) {
    return (
      <section className={styles.panel} aria-label="Explanation">
        <h3 className={styles.heading}>Explanation</h3>
        <p className={styles.empty}>
          No explanation has been written for this question yet.
          {sourceLabel ? ` Refer to ${sourceLabel}.` : ''}
        </p>
        {/* The useful half of the empty state: a student who got this wrong
            still learns where in the syllabus to revise. */}
        <ReferenceLine reference={reference} />
      </section>
    );
  }

  return (
    <section
      className={`${styles.panel} ${isUnreviewed ? styles.unreviewed : ''}`}
      aria-label={isUnreviewed ? 'Explanation, AI-generated and unreviewed' : 'Explanation'}
    >
      <div className={styles.headerRow}>
        <h3 className={styles.heading}>Explanation</h3>
        {isUnreviewed ? (
          // Not a tooltip and not an asterisk: the label has to survive being
          // skim-read on a phone.
          <span className={styles.badge}>
            <span aria-hidden="true">⚠</span> AI draft &middot; not yet reviewed
          </span>
        ) : origin === 'ai_reviewed' ? (
          <span className={`${styles.badge} ${styles.badgeReviewed}`}>AI draft, reviewed</span>
        ) : null}
      </div>

      {isUnreviewed && (
        <p className={styles.disclaimer}>
          This explanation was generated by AI and has not been checked by a person. Treat it as a
          starting point, not as authority, and verify anything you plan to rely on.
        </p>
      )}

      {text && <p className={styles.body}>{text}</p>}

      {rationales.length > 0 && (
        <div className={styles.distractors}>
          <h4 className={styles.subheading}>Why the other options are wrong</h4>
          <ul className={styles.distractorList}>
            {rationales.map((d) => (
              <li key={d.optionId} className={styles.distractorItem}>
                <span className={styles.distractorOption}>{d.optionText}</span>
                <span className={styles.distractorWhy}>{d.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ReferenceLine reference={reference} />

      {onReport && (
        <button type="button" className={styles.report} onClick={onReport}>
          {isUnreviewed ? 'This explanation looks wrong' : 'Report a problem'}
        </button>
      )}
    </section>
  );
}

/**
 * The syllabus reference line.
 *
 * Phrasing carries the confidence rather than a number: a sub-chapter the
 * classifier is sure of is stated ("Syllabus reference: 5.4 Transport Layer"),
 * a weak match is hedged ("likely 5.4..."), and a declined match falls back to
 * the chapter, which is always exact. A percentage here would imply a
 * precision this heuristic does not have.
 */
function ReferenceLine({ reference }: { reference?: QuestionReference | null }) {
  if (!reference) return null;

  const { subchapter, tentative, label, chapterNumber, chapterTitle } = reference;

  return (
    <p className={styles.reference}>
      <span className={styles.referenceLabel}>Syllabus reference</span>
      <span className={styles.referenceValue}>
        {subchapter && tentative ? 'likely ' : ''}
        {label}
      </span>
      {/* When a sub-chapter was matched, name the chapter too — the dotted code
          alone is meaningless to someone who has not memorised the syllabus. */}
      {subchapter && (
        <span className={styles.referenceChapter}>
          Chapter {chapterNumber}: {chapterTitle}
        </span>
      )}
    </p>
  );
}
