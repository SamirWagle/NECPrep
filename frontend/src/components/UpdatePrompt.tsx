/**
 * "A new version is available" — the component the PWA config has been waiting
 * for.
 *
 * THE BUG THIS FIXES
 * ------------------
 * `vite.config.ts` sets `registerType: 'prompt'`, which means a newly deployed
 * service worker installs, then WAITS in the `installed` state until something
 * calls `updateServiceWorker()`. `src/pwa.ts` exports the hook for that and
 * says, in its own comment, that the component belongs to another workstream.
 * No such component was ever written and nothing imported the hook.
 *
 * The result: anyone who had opened the site once kept being served the cached
 * old build forever. Deploys were invisible to exactly the people who use the
 * app most. That is how a sign-in page could be live, correct, and reachable
 * on the server while a returning visitor still saw the version from before it
 * existed.
 *
 * WHY NOT JUST SWITCH TO autoUpdate
 * ---------------------------------
 * Because `registerType: 'prompt'` is the right choice here and the comment
 * explaining it is right: `autoUpdate` activates a new worker and reloads the
 * page on its own, and doing that during a 120-minute mock test is how a
 * candidate loses a paper. The engine autosaves, so it would probably survive
 * — "probably" is not good enough for someone sitting a licence rehearsal.
 *
 * So the fix is to build the missing half, not to remove the safeguard.
 *
 * WHAT IT DOES
 * ------------
 *  * `needRefresh` → an offer to update, never an automatic reload. The student
 *    chooses when.
 *  * `offlineReady` → a one-off confirmation on first install, auto-dismissed.
 *    This app is genuinely useful offline and that is worth telling someone
 *    once.
 *  * Neither is a modal and neither traps focus: an interruption that blocks
 *    the page is worse than a stale asset.
 */

import { useEffect, useState } from 'react';
import { useRegisterSW } from '../pwa';
import styles from './UpdatePrompt.module.css';

/** How long the "works offline" confirmation stays up. */
const OFFLINE_NOTICE_MS = 6000;

export default function UpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Browsers only check for a new worker on navigation, so a tab left open
      // for hours never notices a deploy. An hourly poll is cheap — a
      // conditional request for one file — and means a long-lived session is
      // not stuck on a build from this morning.
      const HOUR = 60 * 60 * 1000;
      setInterval(() => {
        void registration.update();
      }, HOUR);
    },
  });

  // The offline confirmation is information, not a decision, so it does not
  // need to sit there until dismissed.
  const [dismissedOffline, setDismissedOffline] = useState(false);
  useEffect(() => {
    if (!offlineReady) return;
    const id = setTimeout(() => {
      setOfflineReady(false);
      setDismissedOffline(true);
    }, OFFLINE_NOTICE_MS);
    return () => {
      clearTimeout(id);
    };
  }, [offlineReady, setOfflineReady]);

  if (needRefresh) {
    return (
      // `polite`, not `assertive`: this is worth knowing, not worth
      // interrupting a screen reader mid-sentence for.
      <div className={styles.bar} role="status" aria-live="polite">
        <span className={styles.text}>A new version of NECPrep is available.</span>
        <span className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            // `true` reloads the page once the new worker has taken over.
            onClick={() => void updateServiceWorker(true)}
          >
            Reload
          </button>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => setNeedRefresh(false)}
          >
            Later
          </button>
        </span>
      </div>
    );
  }

  if (offlineReady && !dismissedOffline) {
    return (
      <div className={styles.bar} role="status" aria-live="polite">
        <span className={styles.text}>NECPrep is ready to work offline.</span>
        <span className={styles.actions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => {
              setOfflineReady(false);
              setDismissedOffline(true);
            }}
          >
            Dismiss
          </button>
        </span>
      </div>
    );
  }

  return null;
}
