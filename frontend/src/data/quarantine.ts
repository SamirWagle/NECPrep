/**
 * Questions withheld from practice until a human adjudicates them.
 *
 * Each entry is a question the app would mis-grade. `scripts/validate-questions.mjs`
 * found them, and they are listed explicitly rather than filtered by rule so that
 * every exclusion is a visible, reviewable decision — and so that a newly
 * introduced bad question fails the build instead of silently joining the list.
 *
 * The failure modes represented here:
 *
 *   KEY_CONFLICT      `correct_option_index` and `correct_option` disagree. In every
 *                     case in this list the text named by `correct_option` is not
 *                     among the four options at all. The app trusts the index, so
 *                     these would mark the wrong option correct.
 *   INDEX_RANGE       `correct_option_index` is 5 with only 4 options present, so
 *                     there is no reachable correct answer.
 *   OPTION_DUPLICATE  Two options carry identical text, so two options can be
 *                     simultaneously correct.
 *
 * To clear an entry: fix the row in `frontend/public/data/books/`, re-run
 * `node scripts/validate-questions.mjs`, and remove the id from quarantine.json.
 *
 * Ids are the synthetic `{topicId}_{arrayIndex}` form and are therefore tied to
 * array position — reordering a chapter JSON invalidates this list. That is one of
 * several reasons the bank is moving to content-hash ids.
 */
import entries from './quarantine.json';

export interface QuarantinedQuestion {
  /** Synthetic question id: `{topicId}_{arrayIndex}`. */
  id: string;
  /** Validator codes that caused the exclusion. */
  codes: string[];
  /** Human-readable detail, enough to adjudicate the question from. */
  notes: string[];
}

export const quarantinedQuestions: QuarantinedQuestion[] = entries;

/** Fast membership test used by the question loader. */
export const quarantinedIds: ReadonlySet<string> = new Set(
  quarantinedQuestions.map((q) => q.id)
);
