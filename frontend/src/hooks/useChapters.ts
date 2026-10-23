import { useEffect, useState } from 'react';
import { bookChapters } from '../data/bookChapters.generated';
import type { Topic } from '../data/topics';
import { api, isBackendConfigured } from '../services/api';

/**
 * The book chapters, with question counts corrected by the API when it answers.
 *
 * WHY IT STARTS LOCAL AND REFINES
 * -------------------------------
 * Ten callers use this and all of them are synchronous. Making it `Promise`-
 * shaped would push a loading state into the dashboard, the practice hub,
 * progress, flashcards, every quiz page and the study hub, for a value that is
 * already known well enough to render. So the first return is the generated
 * manifest - instant, offline, correct about everything except one number -
 * and the API's counts land on a later render.
 *
 * It previously re-fetched all ten chapter JSONs at runtime (roughly 1 MB,
 * cache-busted with `?t=${Date.now()}` so it could never be served from cache)
 * purely to read `data.length`. The generated manifest replaced that.
 *
 * WHY THE API'S COUNT IS DIFFERENT, AND RIGHT
 * -------------------------------------------
 * `bookChapters.generated.ts` counts rows in the chapter JSON. The API counts
 * PUBLISHED questions, which excludes the 118 withheld for answer-key defects
 * and anything flagged since. Chapter 1 is 525 locally and 483 from the server,
 * and 483 is the number a candidate can actually be asked. Showing 525 next to
 * a practice set that can only ever serve 483 is a promise the app cannot keep.
 *
 * WHAT IS NOT TAKEN FROM THE API
 * ------------------------------
 * Only `questionCount` is adopted. `dataFile` has no server equivalent and is
 * what `loadQuestionsSlice` reads, so it must survive; name, colour and icon
 * are presentation that the manifest already owns and that `sync-chapters.mjs`
 * regenerates. Taking the minimum keeps this from becoming a second, divergent
 * source of truth for chapter metadata.
 *
 * An unrecognised chapter id from the server is ignored rather than appended:
 * a chapter with no `dataFile` would break every local load path, and a server
 * that has grown a chapter the client does not know about is a deploy-order
 * problem to fix, not a shape to render.
 */
export function useChapters(): Topic[] {
  const [chapters, setChapters] = useState<Topic[]>(bookChapters);

  useEffect(() => {
    if (!isBackendConfigured()) return;
    let cancelled = false;

    void (async () => {
      const result = await api.getChapters();
      if (cancelled || !result.ok) return;

      const counts = new Map(result.data.chapters.map((c) => [c.id, c.questionCount]));
      setChapters((prev) => {
        let changed = false;
        const next = prev.map((topic) => {
          const count = counts.get(topic.id);
          if (count === undefined || count === topic.questionCount) return topic;
          changed = true;
          return { ...topic, questionCount: count };
        });
        // Returning `prev` unchanged keeps the array identity stable, so the
        // ten callers do not re-render for a response that said nothing new.
        return changed ? next : prev;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return chapters;
}
