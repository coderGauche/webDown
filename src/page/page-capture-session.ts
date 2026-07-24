import { createCaptureError, type CaptureError } from '@sitecapsule/domain';

export const PAGE_CAPTURE_TIMEOUT_GRACE_MS = 5_000;

export type PageCaptureLifecycleEvent = 'navigation' | 'tab-closed';

export type PageCaptureSessionResult<T> =
  { ok: true; value: T } | { ok: false; error: CaptureError };

export type PageCaptureSessionOptions<T> = {
  startUrl: string;
  timeoutMs: number;
  capture: () => Promise<T>;
  getCurrentUrl: () => Promise<string | null>;
  subscribe: (listener: (event: PageCaptureLifecycleEvent) => void) => () => void;
};

export function getPageCaptureTimeoutMs(renderWaitMs: number): number {
  return renderWaitMs + PAGE_CAPTURE_TIMEOUT_GRACE_MS;
}

function lifecycleError(event: PageCaptureLifecycleEvent, startUrl: string): CaptureError {
  return createCaptureError(event === 'tab-closed' ? 'tab-closed' : 'page-navigation-changed', {
    operation: 'page-capture',
    url: startUrl,
  });
}

export function runPageCaptureSession<T>(
  options: PageCaptureSessionOptions<T>,
): Promise<PageCaptureSessionResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;

    const timeoutId = setTimeout(() => {
      finish({
        ok: false,
        error: createCaptureError('page-capture-timeout', {
          operation: 'page-capture',
          url: options.startUrl,
        }),
      });
    }, options.timeoutMs);

    const finish = (result: PageCaptureSessionResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      unsubscribe();
      resolve(result);
    };

    try {
      unsubscribe = options.subscribe((event) =>
        finish({ ok: false, error: lifecycleError(event, options.startUrl) }),
      );
      if (settled) unsubscribe();
    } catch {
      finish({
        ok: false,
        error: createCaptureError('unexpected-error', { operation: 'page-capture' }),
      });
      return;
    }

    void options.capture().then(
      async (value) => {
        if (settled) return;

        let currentUrl: string | null;
        try {
          currentUrl = await options.getCurrentUrl();
        } catch {
          finish({ ok: false, error: lifecycleError('tab-closed', options.startUrl) });
          return;
        }

        if (settled) return;
        if (currentUrl === null) {
          finish({ ok: false, error: lifecycleError('tab-closed', options.startUrl) });
          return;
        }
        if (currentUrl !== options.startUrl) {
          finish({ ok: false, error: lifecycleError('navigation', options.startUrl) });
          return;
        }

        finish({ ok: true, value });
      },
      () => {
        finish({
          ok: false,
          error: createCaptureError('unexpected-error', { operation: 'page-capture' }),
        });
      },
    );
  });
}
