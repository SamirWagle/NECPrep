import { useState, useEffect } from 'react';
import { bookChapters as staticChapters } from '../data/bookChapters.generated';
import type { Topic } from '../data/topics';

let cachedChapters: Topic[] | null = null;
let fetchPromise: Promise<Topic[]> | null = null;

async function fetchCounts(): Promise<Topic[]> {
  if (!fetchPromise) {
    fetchPromise = Promise.all(
      staticChapters.map(async (c) => {
        try {
          const res = await fetch(`/data/${c.dataFile}?t=${Date.now()}`);
          if (res.ok) {
            const data = await res.json();
            return { ...c, questionCount: data.length };
          }
        } catch {
          // Silently fall back to static count
        }
        return c;
      })
    ).then(updated => {
      cachedChapters = updated;
      return updated;
    });
  }
  return fetchPromise;
}

/**
 * Returns book chapters with dynamically-fetched question counts.
 * On first call, counts are fetched from the JSON files.
 * Subsequent calls return the cached result immediately (no re-fetch).
 */
export function useChapters(): Topic[] {
  const [chapters, setChapters] = useState<Topic[]>(cachedChapters || staticChapters);

  useEffect(() => {
    let mounted = true;

    fetchCounts().then(updated => {
      if (mounted) setChapters(updated);
    });

    return () => { mounted = false; };
  }, []);

  return chapters;
}
