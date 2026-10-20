import { bookChapters } from '../data/bookChapters.generated';
import type { Topic } from '../data/topics';

/**
 * Returns the book chapters.
 *
 * Question counts come straight from `bookChapters.generated.ts`, which
 * `scripts/sync-chapters.mjs` regenerates from the JSON files on every dev
 * start and every build. This previously re-fetched all ten chapter JSONs at
 * runtime — roughly 1 MB, cache-busted with `?t=${Date.now()}` so it could
 * never be served from cache — purely to read `data.length`. The generated
 * manifest is the source of truth; if it drifts, the build is wrong.
 */
export function useChapters(): Topic[] {
  return bookChapters;
}
