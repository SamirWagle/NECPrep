import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * `useChapters` has to stay synchronous for its ten callers while still
 * preferring the server's question counts.
 *
 * The counts genuinely differ: the generated manifest counts rows in the
 * chapter JSON, the API counts PUBLISHED questions. Chapter 1 is 525 locally
 * and 483 from the server, because 42 are withheld for answer-key defects.
 * Showing 525 beside a practice set that can only serve 483 is a promise the
 * app cannot keep.
 */

const mockApi = { getChapters: vi.fn() };
let backendConfigured = true;

vi.mock('../../services/api', () => ({
  api: mockApi,
  isBackendConfigured: () => backendConfigured,
  apiBaseUrl: () => 'https://api.test',
  newIdempotencyKey: () => 'k',
}));

const { useChapters } = await import('../useChapters');
const { bookChapters } = await import('../../data/bookChapters.generated');

beforeEach(() => {
  backendConfigured = true;
  mockApi.getChapters.mockReset();
});

/** A server chapter row, shaped like ChapterSummary. */
function serverChapter(id: string, questionCount: number) {
  return {
    id,
    slug: id,
    name: 'ignored',
    shortName: 'ignored',
    description: 'ignored',
    questionCount,
    icon: 'book' as const,
    color: '#000000',
    orderIndex: 1,
  };
}

describe('useChapters', () => {
  it('returns the generated manifest on the first render, with no await', () => {
    mockApi.getChapters.mockResolvedValue({ ok: true, data: { chapters: [] } });
    const { result } = renderHook(() => useChapters());
    // Synchronous and complete: no loading state reaches the ten callers.
    expect(result.current).toHaveLength(bookChapters.length);
    expect(result.current[0].id).toBe('book-ch1');
  });

  it('adopts the server question count when it arrives', async () => {
    mockApi.getChapters.mockResolvedValue({
      ok: true,
      data: { chapters: [serverChapter('book-ch1', 483)] },
    });

    const { result } = renderHook(() => useChapters());
    await waitFor(() => expect(result.current[0].questionCount).toBe(483));
  });

  it('keeps dataFile and presentation from the manifest, not the server', async () => {
    mockApi.getChapters.mockResolvedValue({
      ok: true,
      data: { chapters: [serverChapter('book-ch1', 483)] },
    });

    const { result } = renderHook(() => useChapters());
    await waitFor(() => expect(result.current[0].questionCount).toBe(483));

    // `dataFile` has no server equivalent and every local load path reads it.
    expect(result.current[0].dataFile).toBe(bookChapters[0].dataFile);
    // The server's placeholder name must not overwrite the real one.
    expect(result.current[0].name).toBe(bookChapters[0].name);
    expect(result.current[0].name).not.toBe('ignored');
  });

  it('ignores a chapter the client does not know about', async () => {
    mockApi.getChapters.mockResolvedValue({
      ok: true,
      data: { chapters: [serverChapter('book-ch99', 10)] },
    });

    const { result } = renderHook(() => useChapters());
    // Appending it would produce a Topic with no dataFile and break every
    // local load path.
    await waitFor(() => expect(result.current).toHaveLength(bookChapters.length));
    expect(result.current.some((c) => c.id === 'book-ch99')).toBe(false);
  });

  it('keeps the manifest when the request fails', async () => {
    mockApi.getChapters.mockResolvedValue({
      ok: false,
      error: { code: 'NETWORK_UNAVAILABLE', message: 'Could not reach the server.' },
    });

    const { result } = renderHook(() => useChapters());
    await waitFor(() => expect(mockApi.getChapters).toHaveBeenCalled());
    expect(result.current[0].questionCount).toBe(bookChapters[0].questionCount);
  });

  it('makes no request at all when no backend is configured', () => {
    backendConfigured = false;
    const { result } = renderHook(() => useChapters());
    expect(result.current).toEqual(bookChapters);
    expect(mockApi.getChapters).not.toHaveBeenCalled();
  });

  it('keeps array identity when the server agrees, so callers do not re-render', async () => {
    mockApi.getChapters.mockResolvedValue({
      ok: true,
      data: {
        chapters: bookChapters.map((c) => serverChapter(c.id, c.questionCount)),
      },
    });

    const { result } = renderHook(() => useChapters());
    const first = result.current;
    await waitFor(() => expect(mockApi.getChapters).toHaveBeenCalled());
    expect(result.current).toBe(first);
  });
});
