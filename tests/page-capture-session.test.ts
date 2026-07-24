import {
  PAGE_CAPTURE_TIMEOUT_GRACE_MS,
  getPageCaptureTimeoutMs,
  runPageCaptureSession,
  type PageCaptureLifecycleEvent,
} from '@sitecapsule/page';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function lifecycleHarness() {
  let listener: ((event: PageCaptureLifecycleEvent) => void) | undefined;
  const unsubscribe = vi.fn();

  return {
    emit(event: PageCaptureLifecycleEvent) {
      listener?.(event);
    },
    subscribe(nextListener: (event: PageCaptureLifecycleEvent) => void) {
      listener = nextListener;
      return unsubscribe;
    },
    unsubscribe,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('page capture session', () => {
  const startUrl = 'https://example.com/start';

  it('returns a completed capture only after the tab URL is revalidated', async () => {
    const lifecycle = lifecycleHarness();

    await expect(
      runPageCaptureSession({
        startUrl,
        timeoutMs: 5_000,
        capture: async () => 'snapshot',
        getCurrentUrl: async () => startUrl,
        subscribe: lifecycle.subscribe,
      }),
    ).resolves.toEqual({ ok: true, value: 'snapshot' });
    expect(lifecycle.unsubscribe).toHaveBeenCalledOnce();
  });

  it('returns a stable timeout error at render wait plus the processing grace period', async () => {
    vi.useFakeTimers();
    const lifecycle = lifecycleHarness();
    const pendingCapture = deferred<string>();
    const result = runPageCaptureSession({
      startUrl,
      timeoutMs: getPageCaptureTimeoutMs(1_000),
      capture: () => pendingCapture.promise,
      getCurrentUrl: async () => startUrl,
      subscribe: lifecycle.subscribe,
    });

    await vi.advanceTimersByTimeAsync(1_000 + PAGE_CAPTURE_TIMEOUT_GRACE_MS);

    await expect(result).resolves.toMatchObject({
      ok: false,
      error: { code: 'page-capture-timeout', retryable: true },
    });
    expect(lifecycle.unsubscribe).toHaveBeenCalledOnce();
  });

  it('stops when the tab starts navigating', async () => {
    const lifecycle = lifecycleHarness();
    const pendingCapture = deferred<string>();
    const result = runPageCaptureSession({
      startUrl,
      timeoutMs: 5_000,
      capture: () => pendingCapture.promise,
      getCurrentUrl: async () => startUrl,
      subscribe: lifecycle.subscribe,
    });

    lifecycle.emit('navigation');

    await expect(result).resolves.toMatchObject({
      ok: false,
      error: { code: 'page-navigation-changed', retryable: true },
    });
  });

  it('distinguishes a closed tab from navigation', async () => {
    const lifecycle = lifecycleHarness();
    const pendingCapture = deferred<string>();
    const result = runPageCaptureSession({
      startUrl,
      timeoutMs: 5_000,
      capture: () => pendingCapture.promise,
      getCurrentUrl: async () => startUrl,
      subscribe: lifecycle.subscribe,
    });

    lifecycle.emit('tab-closed');

    await expect(result).resolves.toMatchObject({
      ok: false,
      error: { code: 'tab-closed', retryable: false },
    });
  });

  it('rejects a changed URL during final verification and ignores a late response', async () => {
    vi.useFakeTimers();
    const lifecycle = lifecycleHarness();
    const changedUrlResult = await runPageCaptureSession({
      startUrl,
      timeoutMs: 5_000,
      capture: async () => 'wrong snapshot',
      getCurrentUrl: async () => 'https://example.com/next',
      subscribe: lifecycle.subscribe,
    });
    expect(changedUrlResult).toMatchObject({
      ok: false,
      error: { code: 'page-navigation-changed' },
    });

    const lateLifecycle = lifecycleHarness();
    const pendingCapture = deferred<string>();
    const lateResult = runPageCaptureSession({
      startUrl,
      timeoutMs: 10,
      capture: () => pendingCapture.promise,
      getCurrentUrl: async () => startUrl,
      subscribe: lateLifecycle.subscribe,
    });
    await vi.advanceTimersByTimeAsync(10);
    const timedOut = await lateResult;

    pendingCapture.resolve('late snapshot');
    await Promise.resolve();

    expect(timedOut).toMatchObject({
      ok: false,
      error: { code: 'page-capture-timeout' },
    });
    expect(lateLifecycle.unsubscribe).toHaveBeenCalledOnce();
  });
});
