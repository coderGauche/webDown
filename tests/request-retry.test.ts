import {
  MAX_REQUEST_RETRIES,
  MAX_TIMER_DELAY_MS,
  calculateRetryDelayMs,
  isRetryableHttpStatus,
  parseRetryAfterMs,
  runRequestWithRetry,
  type RequestAttemptResult,
  type RetryDelayScheduler,
} from '@sitecapsule/download';
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

function rejectWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('request retry policy', () => {
  it('parses Retry-After delay-seconds and HTTP dates from RFC 9110', () => {
    const now = Date.parse('Wed, 21 Oct 2015 07:27:00 GMT');

    expect(parseRetryAfterMs('120', now)).toBe(120_000);
    expect(parseRetryAfterMs(' 0 ', now)).toBe(0);
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT', now)).toBe(60_000);
    expect(parseRetryAfterMs('Wed, 21 Oct 2015 07:26:00 GMT', now)).toBe(0);
    expect(
      parseRetryAfterMs('Sunday, 06-Nov-94 08:49:37 GMT', Date.parse('1994-11-06T08:49:00Z')),
    ).toBe(37_000);
    expect(parseRetryAfterMs('Sun Nov  6 08:49:37 1994', Date.parse('1994-11-06T08:49:00Z'))).toBe(
      37_000,
    );
  });

  it.each([null, '', '-1', '1.5', 'later', '9007199254740991'])(
    'rejects invalid Retry-After value %s',
    (value) => {
      expect(parseRetryAfterMs(value)).toBeNull();
    },
  );

  it('recognizes the explicit HTTP status retry allowlist', () => {
    expect([408, 425, 429, 500, 502, 503, 504].every(isRetryableHttpStatus)).toBe(true);
    expect([200, 301, 400, 401, 403, 404, 501].some(isRetryableHttpStatus)).toBe(false);
  });

  it('uses the greater local or server delay while enforcing the local maximum', () => {
    const now = Date.parse('Wed, 21 Oct 2015 07:27:00 GMT');

    expect(calculateRetryDelayMs(1, null, 500, 10_000, now)).toBe(500);
    expect(calculateRetryDelayMs(3, null, 500, 10_000, now)).toBe(2_000);
    expect(calculateRetryDelayMs(1, '3', 500, 10_000, now)).toBe(3_000);
    expect(calculateRetryDelayMs(1, 'Wed, 21 Oct 2015 07:27:02 GMT', 500, 10_000, now)).toBe(2_000);
    expect(calculateRetryDelayMs(1, '120', 500, 10_000, now)).toBe(10_000);
  });

  it('returns a first-attempt success with the attempt signal', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const operation = vi.fn(({ attempt, signal }) => {
      expect(attempt).toBe(1);
      expect(signal).not.toBe(controller.signal);
      expect(signal.aborted).toBe(false);
      return { status: 'succeeded', value: 'body' } as const;
    });

    await expect(
      runRequestWithRetry(operation, { signal: controller.signal, timeoutMs: 100 }),
    ).resolves.toEqual({ status: 'succeeded', value: 'body', attempts: 1 });
    expect(operation).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries explicit failures with deterministic exponential delays', async () => {
    const delays: number[] = [];
    const sleep: RetryDelayScheduler = async (delayMs) => {
      delays.push(delayMs);
    };
    const operation = vi.fn(({ attempt }): RequestAttemptResult<string, string> =>
      attempt < 3
        ? { status: 'failed', error: `failure-${attempt}`, retryable: true }
        : { status: 'succeeded', value: 'saved' },
    );

    await expect(
      runRequestWithRetry(operation, {
        timeoutMs: 100,
        maxRetries: 2,
        baseDelayMs: 100,
        maxDelayMs: 1_000,
        sleep,
      }),
    ).resolves.toEqual({ status: 'succeeded', value: 'saved', attempts: 3 });
    expect(delays).toEqual([100, 200]);
  });

  it('honors Retry-After but caps an untrusted server delay', async () => {
    const delays: number[] = [];
    const result = await runRequestWithRetry(
      ({ attempt }): RequestAttemptResult<string, string> =>
        attempt === 1
          ? { status: 'failed', error: 'busy', retryable: true, retryAfter: '120' }
          : { status: 'succeeded', value: 'ready' },
      {
        timeoutMs: 100,
        maxRetries: 1,
        baseDelayMs: 100,
        maxDelayMs: 3_000,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      },
    );

    expect(result).toEqual({ status: 'succeeded', value: 'ready', attempts: 2 });
    expect(delays).toEqual([3_000]);
  });

  it('does not retry an explicit non-retryable failure or a thrown error', async () => {
    const sleep = vi.fn<RetryDelayScheduler>();
    const nonRetryable = vi.fn(async (): Promise<RequestAttemptResult<string, string>> => ({
      status: 'failed',
      error: 'not found',
      retryable: false,
    }));
    await expect(
      runRequestWithRetry(nonRetryable, { timeoutMs: 100, maxRetries: 2, sleep }),
    ).resolves.toEqual({
      status: 'failed',
      error: 'not found',
      attempts: 1,
      retryable: false,
      exhausted: false,
      timedOut: false,
    });

    const thrown = new Error('programming failure');
    const throws = vi.fn(() => {
      throw thrown;
    });
    await expect(
      runRequestWithRetry(throws, { timeoutMs: 100, maxRetries: 2, sleep }),
    ).resolves.toEqual({
      status: 'failed',
      error: thrown,
      attempts: 1,
      retryable: false,
      exhausted: false,
      timedOut: false,
    });
    expect(nonRetryable).toHaveBeenCalledOnce();
    expect(throws).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('reports retry exhaustion with the final failure', async () => {
    const operation = vi.fn(({ attempt }): RequestAttemptResult<never, string> => ({
      status: 'failed',
      error: `failure-${attempt}`,
      retryable: true,
    }));

    await expect(
      runRequestWithRetry(operation, {
        timeoutMs: 100,
        maxRetries: 2,
        baseDelayMs: 0,
        maxDelayMs: 0,
      }),
    ).resolves.toEqual({
      status: 'failed',
      error: 'failure-3',
      attempts: 3,
      retryable: true,
      exhausted: true,
      timedOut: false,
    });
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('times out one attempt, aborts its signal, and can retry successfully', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const operation = vi.fn(({ attempt, signal }): Promise<RequestAttemptResult<string, never>> => {
      signals.push(signal);
      return attempt === 1
        ? rejectWhenAborted(signal)
        : Promise.resolve({ status: 'succeeded', value: 'retried' });
    });
    const execution = runRequestWithRetry(operation, {
      timeoutMs: 50,
      maxRetries: 1,
      baseDelayMs: 0,
      maxDelayMs: 0,
    });

    await vi.advanceTimersByTimeAsync(50);

    await expect(execution).resolves.toEqual({
      status: 'succeeded',
      value: 'retried',
      attempts: 2,
    });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[0]?.reason).toEqual({ code: 'request-timeout', timeoutMs: 50 });
    expect(Object.isFrozen(signals[0]?.reason)).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('returns an exhausted timeout when no retry remains', async () => {
    vi.useFakeTimers();
    const execution = runRequestWithRetry(({ signal }) => rejectWhenAborted(signal), {
      timeoutMs: 25,
      maxRetries: 0,
    });

    await vi.advanceTimersByTimeAsync(25);

    await expect(execution).resolves.toEqual({
      status: 'failed',
      error: { code: 'request-timeout', timeoutMs: 25 },
      attempts: 1,
      retryable: true,
      exhausted: true,
      timedOut: true,
    });
  });

  it('does not start when externally aborted and stops an active attempt', async () => {
    const beforeStart = new AbortController();
    beforeStart.abort('cancel-before-start');
    const neverStarted = vi.fn(async () => ({ status: 'succeeded', value: 'unexpected' }) as const);
    await expect(
      runRequestWithRetry(neverStarted, { signal: beforeStart.signal }),
    ).resolves.toEqual({ status: 'aborted', attempts: 0, reason: 'cancel-before-start' });
    expect(neverStarted).not.toHaveBeenCalled();

    const active = new AbortController();
    const execution = runRequestWithRetry(({ signal }) => rejectWhenAborted(signal), {
      signal: active.signal,
      timeoutMs: 1_000,
    });
    active.abort('cancel-active');
    await expect(execution).resolves.toEqual({
      status: 'aborted',
      attempts: 1,
      reason: 'cancel-active',
    });
  });

  it('stops during retry delay when externally aborted', async () => {
    const controller = new AbortController();
    const sleepStarted = deferred<void>();
    const sleep: RetryDelayScheduler = (_delayMs, signal) => {
      sleepStarted.resolve(undefined);
      return rejectWhenAborted(signal);
    };
    const operation = vi.fn(async (): Promise<RequestAttemptResult<string, string>> => ({
      status: 'failed',
      error: 'retry me',
      retryable: true,
    }));
    const execution = runRequestWithRetry(operation, {
      signal: controller.signal,
      timeoutMs: 100,
      maxRetries: 2,
      sleep,
    });

    await sleepStarted.promise;
    controller.abort('cancel-backoff');

    await expect(execution).resolves.toEqual({
      status: 'aborted',
      attempts: 1,
      reason: 'cancel-backoff',
    });
    expect(operation).toHaveBeenCalledOnce();
  });

  it('cleans the default retry timer when externally aborted during backoff', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const execution = runRequestWithRetry(
      (): RequestAttemptResult<never, string> => ({
        status: 'failed',
        error: 'busy',
        retryable: true,
      }),
      {
        signal: controller.signal,
        timeoutMs: 100,
        maxRetries: 1,
        baseDelayMs: 1_000,
        maxDelayMs: 1_000,
      },
    );

    await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
    controller.abort('cancel-default-backoff');

    await expect(execution).resolves.toEqual({
      status: 'aborted',
      attempts: 1,
      reason: 'cancel-default-backoff',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { timeoutMs: 0 },
    { timeoutMs: MAX_TIMER_DELAY_MS + 1 },
    { maxRetries: -1 },
    { maxRetries: MAX_REQUEST_RETRIES + 1 },
    { baseDelayMs: -1 },
    { maxDelayMs: MAX_TIMER_DELAY_MS + 1 },
    { baseDelayMs: 2, maxDelayMs: 1 },
  ])('rejects invalid retry options %o', async (options) => {
    const operation = vi.fn(async () => ({ status: 'succeeded', value: 'unused' }) as const);

    await expect(runRequestWithRetry(operation, options)).rejects.toThrow(RangeError);
    expect(operation).not.toHaveBeenCalled();
  });

  it('rejects an invalid retry clock before scheduling another attempt', async () => {
    const operation = vi.fn((): RequestAttemptResult<never, string> => ({
      status: 'failed',
      error: 'retry me',
      retryable: true,
    }));

    await expect(
      runRequestWithRetry(operation, { timeoutMs: 100, maxRetries: 1, now: () => Number.NaN }),
    ).rejects.toThrow('Retry clock');
    expect(operation).toHaveBeenCalledOnce();
    expect(() => calculateRetryDelayMs(1, null, 0, MAX_TIMER_DELAY_MS + 1)).toThrow(RangeError);
  });
});
