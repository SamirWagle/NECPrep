import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The component that makes a deploy visible.
 *
 * `vite.config.ts` uses `registerType: 'prompt'`, so a newly deployed service
 * worker installs and then WAITS until something calls `updateServiceWorker()`.
 * Nothing did — `src/pwa.ts` exported the hook and no component imported it —
 * so every returning visitor was served the cached old build indefinitely. A
 * sign-in page could be live, correct and reachable on the server while the
 * person who most wanted it kept seeing the version from before it existed.
 *
 * These tests cover the two things that bug turns on: that an available update
 * is OFFERED, and that it is never taken without the student saying so.
 */

const updateServiceWorker = vi.fn();
let needRefresh = false;
let offlineReady = false;
const setNeedRefresh = vi.fn((v: boolean) => {
  needRefresh = v;
});
const setOfflineReady = vi.fn((v: boolean) => {
  offlineReady = v;
});
let onRegisteredSW: ((url: string, r?: ServiceWorkerRegistration) => void) | undefined;

vi.mock('../../pwa', () => ({
  useRegisterSW: (options?: {
    onRegisteredSW?: (url: string, r?: ServiceWorkerRegistration) => void;
  }) => {
    onRegisteredSW = options?.onRegisteredSW;
    return {
      needRefresh: [needRefresh, setNeedRefresh],
      offlineReady: [offlineReady, setOfflineReady],
      updateServiceWorker,
    };
  },
}));

const UpdatePrompt = (await import('../UpdatePrompt')).default;

beforeEach(() => {
  needRefresh = false;
  offlineReady = false;
  onRegisteredSW = undefined;
  updateServiceWorker.mockReset();
  setNeedRefresh.mockReset();
  setOfflineReady.mockReset();
});

describe('UpdatePrompt', () => {
  it('renders nothing when there is no update and no first install', () => {
    const { container } = render(<UpdatePrompt />);
    // It sits in the app shell on every page; it must cost nothing visually
    // when it has nothing to say.
    expect(container).toBeEmptyDOMElement();
  });

  it('offers an update when a new build is waiting', () => {
    needRefresh = true;
    render(<UpdatePrompt />);

    expect(screen.getByText(/new version of NECPrep is available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
  });

  it('does NOT reload on its own', () => {
    needRefresh = true;
    render(<UpdatePrompt />);
    // The whole reason registerType is 'prompt': an automatic reload during a
    // 120-minute mock test is how a candidate loses a paper.
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });

  it('activates the new worker only when the student asks', async () => {
    needRefresh = true;
    const user = userEvent.setup();
    render(<UpdatePrompt />);

    await user.click(screen.getByRole('button', { name: /reload/i }));
    // `true` tells the plugin to reload once the new worker has taken over.
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('can be dismissed without updating', async () => {
    needRefresh = true;
    const user = userEvent.setup();
    render(<UpdatePrompt />);

    await user.click(screen.getByRole('button', { name: /later/i }));
    expect(setNeedRefresh).toHaveBeenCalledWith(false);
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });

  it('announces politely rather than interrupting', () => {
    needRefresh = true;
    render(<UpdatePrompt />);
    const region = screen.getByRole('status');
    // Worth knowing; not worth cutting off a screen reader mid-sentence.
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('confirms offline readiness once, then gets out of the way', async () => {
    vi.useFakeTimers();
    offlineReady = true;
    render(<UpdatePrompt />);

    expect(screen.getByText(/ready to work offline/i)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(6500);
    expect(setOfflineReady).toHaveBeenCalledWith(false);
    vi.useRealTimers();
  });

  it('polls for a new build, so a long-lived tab is not stuck', async () => {
    vi.useFakeTimers();
    render(<UpdatePrompt />);

    const update = vi.fn();
    // Browsers only check for a new worker on navigation. A tab left open all
    // day would otherwise never notice a deploy.
    onRegisteredSW?.('/sw.js', { update } as unknown as ServiceWorkerRegistration);
    expect(update).not.toHaveBeenCalled();

    // Assert straight after advancing rather than through `waitFor`, which
    // polls on real timers and therefore deadlocks against fake ones.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 1000);
    expect(update).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('survives a registration that never resolves', () => {
    render(<UpdatePrompt />);
    // `registration` is optional in the plugin's callback signature, and a
    // failed registration must not take the whole app down with it.
    expect(() => onRegisteredSW?.('/sw.js', undefined)).not.toThrow();
  });
});
