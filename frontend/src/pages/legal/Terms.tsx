/**
 * Terms of use.
 *
 * Written to be true rather than defensive. Two sections exist because the
 * product genuinely requires them, and leaving them out would be the dishonest
 * choice:
 *
 *   * The question bank has known defects. 118 questions are withheld for
 *     answer-key contradictions, and the explanations that exist are AI drafts
 *     badged as unreviewed. A student relying on this to pass a licence exam
 *     is entitled to know that before they start, not after a question misled
 *     them.
 *   * It is not affiliated with the Nepal Engineering Council. A preparation
 *     tool that lets that ambiguity stand is trading on an endorsement it does
 *     not have.
 *
 * No governing-law clause, no arbitration clause, no limitation-of-liability
 * boilerplate copied from elsewhere. Those are legal positions, not facts
 * about the software, and inventing them would make this page a liability
 * rather than a disclosure. Add them on advice.
 */

import { Link } from 'react-router-dom';
import { legalMeta, hasPlaceholders } from './legalMeta';
import styles from './Legal.module.css';

export default function Terms() {
  return (
    <main className={styles.page}>
      <article className={styles.doc}>
        <Link to="/" className={styles.back}>
          ← NECPrep
        </Link>

        <h1 className={styles.title}>Terms of Use</h1>
        <p className={styles.updated}>Last updated {legalMeta.lastUpdated}</p>

        {hasPlaceholders() && (
          <p className={styles.warning} role="status">
            This page is not finished: the operator has not yet filled in a contact
            address. See <code>src/pages/legal/legalMeta.ts</code>.
          </p>
        )}

        <p className={styles.lede}>
          {legalMeta.operator} is a free study tool for the Nepal Engineering Council licence
          examination, Computer Engineering stream. By using it you accept what is below.
        </p>

        <h2>Not affiliated with the Nepal Engineering Council</h2>
        <p>
          This is an independent study tool. It is <strong>not</strong> produced, endorsed,
          reviewed or approved by the Nepal Engineering Council or by any examination
          authority. The syllabus structure it follows is public; the questions, the practice
          papers and the scoring are ours, and carry no official status.
        </p>
        <p>
          Nothing here is a prediction of what the real examination will ask, and passing a
          mock test is not an indication that you will pass the examination.
        </p>

        <h2>The question bank is imperfect, and we say which parts</h2>
        <p>
          The questions come from published preparation material and have been checked by
          machine, not by a subject expert. That check found real defects, and rather than
          hide them:
        </p>
        <ul>
          <li>
            <strong>118 questions are withheld</strong> from practice because their answer
            keys contradict themselves or duplicate an option. You will not be served them.
          </li>
          <li>
            <strong>Explanations, where they exist, are AI-generated drafts</strong> that no
            person has checked. They are labelled as such wherever they appear, with a report
            button. Treat them as a starting point, not as authority.
          </li>
          <li>
            <strong>Sub-chapter labels are derived automatically</strong> by keyword matching,
            not assigned by a person. They are a navigation aid and are sometimes wrong.
          </li>
        </ul>
        <p className={styles.note}>
          If a question looks wrong, report it. That is the only mechanism by which the bank
          improves, and reports are read.
        </p>

        <h2>Use it for study</h2>
        <p>You may use this for your own examination preparation. You may not:</p>
        <ul>
          <li>Scrape, bulk-download or republish the question bank.</li>
          <li>Resell access, or present it as your own or as officially endorsed material.</li>
          <li>Attempt to extract answer keys other than by answering questions normally.</li>
          <li>Interfere with the service, other users' accounts, or the integrity of anyone else's attempts.</li>
        </ul>

        <h2>Your account</h2>
        <ul>
          <li>You are responsible for keeping your password to yourself.</li>
          <li>
            A guest account is tied to a browser cookie. Clear it without creating an account
            and that progress is gone — there is no way for anyone, including us, to recover it.
          </li>
          <li>
            <strong>There is no password reset yet.</strong> This platform sends no email at
            all. If you lose your password, contact us at the address below.
          </li>
          <li>
            Accounts used to attack the service or other users may be suspended.
          </li>
        </ul>

        <h2>Availability</h2>
        <p>
          It is free and provided as-is. There is no uptime guarantee and no commitment that a
          feature available today will exist tomorrow. Data is kept per the{' '}
          <Link to="/privacy">Privacy Policy</Link>, which includes deleting individual answers
          after 90 days — so download anything you want to keep.
        </p>

        <h2>No warranty</h2>
        <p>
          This tool is provided without warranty of any kind. Your examination result is yours:
          we do not guarantee that using this will improve it, and we are not responsible for
          an outcome that depends on your preparation, the real examination's content, and the
          examining authority's decisions.
        </p>
        <p className={styles.note}>
          Said concretely rather than in capital letters: a question in this bank may be wrong,
          an AI-drafted explanation may be wrong, and you should verify anything you intend to
          rely on against your textbook or your lecturer.
        </p>

        <h2>Changes</h2>
        <p>
          These terms change when the product does. The date at the top moves when the meaning
          changes.
        </p>

        <h2>Contact</h2>
        <p>
          <a href={`mailto:${legalMeta.contactEmail}`}>{legalMeta.contactEmail}</a>
        </p>

        <p className={styles.footerLinks}>
          <Link to="/privacy">Privacy Policy</Link> · <Link to="/">Home</Link>
        </p>
      </article>
    </main>
  );
}
