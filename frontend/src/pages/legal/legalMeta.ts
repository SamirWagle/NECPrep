/**
 * The handful of facts in the legal pages that only the operator can supply.
 *
 * EDIT THIS FILE, NOT THE PAGES.
 *
 * Everything else in `Privacy.tsx` and `Terms.tsx` describes what the software
 * actually does, and was written by reading the schema and the handlers — the
 * retention windows come from `worker/src/jobs/retention.ts`, the cookie flags
 * from `worker/src/lib/cookies.ts`, the stored columns from
 * `worker/migrations/0001_identity.sql`. Those statements stay true as long as
 * the code does, and if the code changes the pages have to change with it.
 *
 * The values below are different: they are about you, not about the software,
 * and nothing in the repository can derive them.
 *
 * WHAT IS NOT HERE, DELIBERATELY
 * ------------------------------
 * No company registration number, no registered office, no data-protection
 * officer, no governing-law clause. Those are claims about legal status that
 * would be false if invented, and a privacy policy that misdescribes who is
 * responsible is worse than one that does not exist. Add them when they are
 * true, and say so in the pages when you do.
 *
 * NOT LEGAL ADVICE. These pages describe the system accurately, which is the
 * part engineering can get right. Whether they satisfy any particular law is a
 * question for a lawyer in the relevant jurisdiction.
 */

export interface LegalMeta {
  /** The name that appears as the operator. */
  readonly operator: string;
  /**
   * Where a student writes about their data — deletion, export, a correction.
   * There is no self-serve deletion endpoint yet, so this address is the ONLY
   * route a student has. It must be monitored.
   */
  readonly contactEmail: string;
  /**
   * Last substantive change, `YYYY-MM-DD`. Bump it when the meaning changes,
   * not when a typo is fixed.
   */
  readonly lastUpdated: string;
  /**
   * Country whose law the operator considers itself under, for the one line
   * that mentions it. Leave as-is until you have taken advice.
   */
  readonly jurisdiction: string;
}

export const legalMeta: LegalMeta = {
  operator: 'NECPrep',
  // TODO: replace with a real, monitored address before publishing the Google
  // consent screen. Google shows this page to every person who signs in.
  contactEmail: 'REPLACE_WITH_A_REAL_EMAIL',
  lastUpdated: '2026-10-22',
  jurisdiction: 'Nepal',
};

/** True when the operator still has placeholders to fill in. */
export function hasPlaceholders(meta: LegalMeta = legalMeta): boolean {
  return Object.values(meta).some((value) => value.startsWith('REPLACE_WITH'));
}
