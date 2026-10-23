/**
 * The privacy policy.
 *
 * Every factual claim here was written by reading the code, and each one names
 * where it comes from so the next person can check it rather than trust it:
 *
 *   stored columns       worker/migrations/0001_identity.sql, 0004, 0005
 *   retention windows    worker/src/jobs/retention.ts, sweep.ts
 *   cookie flags         worker/src/lib/cookies.ts
 *   IP handling          worker/src/handlers/auth.ts#hashIp
 *   absence of trackers  verified by searching the whole frontend
 *
 * A privacy policy that misdescribes the system is worse than none: it is a
 * statement to users that happens to be false. So when the code changes, this
 * page changes with it — the honest things it currently says (no analytics, a
 * truncated salted hash instead of the IP, a 90-day answer window) are only
 * true while they are true.
 *
 * The operator-specific values live in `legalMeta.ts`, which is the one file
 * that needs editing.
 */

import { Link } from 'react-router-dom';
import { legalMeta, hasPlaceholders } from './legalMeta';
import styles from './Legal.module.css';

export default function Privacy() {
  return (
    <main className={styles.page}>
      <article className={styles.doc}>
        <Link to="/" className={styles.back}>
          ← NECPrep
        </Link>

        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated {legalMeta.lastUpdated}</p>

        {hasPlaceholders() && (
          // Visible on purpose. A policy with REPLACE_WITH_A_REAL_EMAIL in it
          // is not ready to be the page Google shows every person who signs
          // in, and a quiet TODO in a source file would not stop it shipping.
          <p className={styles.warning} role="status">
            This page is not finished: the operator has not yet filled in a contact
            address. Until then, requests about your data have no route. See
            <code> src/pages/legal/legalMeta.ts</code>.
          </p>
        )}

        <p className={styles.lede}>
          {legalMeta.operator} is a study tool for the Nepal Engineering Council licence
          examination. This page describes exactly what it stores, why, for how long, and
          who else can see it. It describes the software as it is built, not as a general
          statement of intent.
        </p>

        <h2>The short version</h2>
        <ul>
          <li>You can use it without an account. A guest identity stores no email and no name.</li>
          <li>There are <strong>no analytics, no advertising trackers and no third-party scripts</strong>. Nothing on this site reports your behaviour to anyone.</li>
          <li>Your IP address is <strong>never stored</strong>. A salted, truncated hash of it is, which can flag a session that suddenly moves country but cannot be turned back into an address.</li>
          <li>Your individual answers are deleted after 90 days. Your scores are kept.</li>
          <li>Nothing is sold, rented, or shared for advertising.</li>
        </ul>

        <h2>What is stored</h2>

        <h3>If you continue as a guest</h3>
        <p>
          A user record with no email and no name, and a session cookie. That is the whole
          identity. If you clear the cookie and do not create an account, that record becomes
          unreachable — to you and to us — because nothing else links it to you.
        </p>

        <h3>If you create an account</h3>
        <ul>
          <li>Your email address, and a display name if you give one. The name is optional.</li>
          <li>
            A <strong>hash</strong> of your password, never the password. It is PBKDF2 with
            SHA-256, salted per account, with the iteration count stored alongside so it can
            be raised later without locking anyone out.
          </li>
        </ul>

        <h3>If you sign in with Google</h3>
        <p>
          Google tells us an immutable account identifier, your email address and your profile
          name. We store the identifier, the email and the name. We do not receive or store
          your Google password, and we ask for no access to anything else in your Google
          account — the permissions requested are <code>openid</code>, <code>email</code> and{' '}
          <code>profile</code>, which are the minimum needed to know who you are.
        </p>

        <h3>While you are signed in</h3>
        <p>
          One session record, holding: a hash of the session cookie's value (so the cookie
          itself is not stored), when the session expires, your browser's user-agent string,
          and a salted hash of your IP address truncated to 32 characters. That last one
          exists so a session appearing suddenly from another country can be spotted; it is
          not reversible to an address, and the raw address is never written down.
        </p>

        <h3>As you study</h3>
        <ul>
          <li>Each attempt: which paper, when you started, when you submitted, your score.</li>
          <li>Each answer: which question, which option you chose, whether it was right, how long you took.</li>
          <li>Derived progress: per-question history, revision scheduling, bookmarks and streaks.</li>
        </ul>

        <h2>How long it is kept</h2>
        <table className={styles.table}>
          <thead>
            <tr><th>What</th><th>How long</th></tr>
          </thead>
          <tbody>
            <tr><td>Individual answers from a submitted paper</td><td>90 days, then deleted</td></tr>
            <tr><td>Answers from a paper you abandoned</td><td>7 days, then deleted</td></tr>
            <tr><td>Attempt summaries and scores</td><td>Kept, so your history survives</td></tr>
            <tr><td>Progress, revision scheduling, bookmarks</td><td>Kept while your account exists</td></tr>
            <tr><td>Sessions</td><td>Deleted after 90 days at the latest; sooner if idle for 14 days or if you sign out</td></tr>
          </tbody>
        </table>
        <p className={styles.note}>
          Deleting old answers means a paper older than 90 days can show you the score but not
          the question-by-question review. That is a deliberate trade: keeping every answer
          forever would grow without bound, and the score is the part that is still useful a
          year later.
        </p>

        <h2>Who else can see it</h2>
        <p>Two companies, both because the software runs on them:</p>
        <ul>
          <li>
            <strong>Cloudflare</strong> hosts the site, the API and the database. The database
            is in the Asia-Pacific region. Cloudflare processes requests on our behalf.
          </li>
          <li>
            <strong>Google</strong> — only if you choose to sign in with Google, and only for
            that sign-in.
          </li>
        </ul>
        <p>
          Nobody else. Your data is not sold, rented, or shared for advertising, and there is
          no analytics provider to share it with.
        </p>

        <h2>Cookies</h2>
        <p>
          One cookie, <code>necprep_session</code>. It identifies your session and nothing
          else. It is <code>HttpOnly</code>, so no JavaScript on the page can read it —
          including any script an attacker managed to inject — and <code>SameSite=Lax</code>,
          so another site cannot use it to act as you. Over HTTPS it is also{' '}
          <code>Secure</code>.
        </p>
        <p>There are no advertising, analytics or preference cookies, because there is nothing that would set one.</p>

        <h2>Your choices</h2>
        <ul>
          <li><strong>Use it without an account.</strong> Continue as a guest and give no email at all.</li>
          <li><strong>Get a copy of your data, or have it deleted.</strong> Email {' '}
            <a href={`mailto:${legalMeta.contactEmail}`}>{legalMeta.contactEmail}</a>.
          </li>
          <li><strong>Sign out everywhere.</strong> Signing out revokes the session on the server, not just in your browser.</li>
        </ul>

        <h2>What this software cannot do yet</h2>
        <p className={styles.note}>
          Stated plainly rather than left for you to discover:
        </p>
        <ul>
          <li>
            <strong>There is no password reset.</strong> No email is sent by this platform at
            all yet. If you forget your password, email the address above — it cannot be
            recovered automatically.
          </li>
          <li>
            <strong>Email addresses are not verified.</strong> Nothing confirms that an address
            you enter is yours.
          </li>
          <li>
            <strong>Deletion is by request, not a button.</strong> There is no self-service
            delete yet, so it is handled manually at the address above.
          </li>
        </ul>

        <h2>Children</h2>
        <p>
          This is a tool for candidates sitting a professional engineering licence examination.
          It is not aimed at children and collects nothing that would identify one.
        </p>

        <h2>Changes</h2>
        <p>
          When the software changes what it stores, this page changes with it, and the date at
          the top moves. There is no version of this page that describes a system we do not run.
        </p>

        <h2>Contact</h2>
        <p>
          <a href={`mailto:${legalMeta.contactEmail}`}>{legalMeta.contactEmail}</a>
        </p>

        <p className={styles.footerLinks}>
          <Link to="/terms">Terms of Use</Link> · <Link to="/">Home</Link>
        </p>
      </article>
    </main>
  );
}
