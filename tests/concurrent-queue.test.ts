import {
  cancelConcurrentQueue,
  interruptConcurrentQueue,
  isConcurrencyLimit,
  pauseConcurrentQueue,
  runConcurrentQueue,
  type ConcurrentQueueItemResult,
} from '@sitecapsule/download';
import { describe, expect, it, vi } from 'vitest';

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

describe('controlled concurrent queue', () => {
  it('returns an empty result without starting a worker', async () => {
    const worker = vi.fn<(input: number, index: number) => Promise<number>>();

    await expect(runConcurrentQueue([], 3, worker)).resolves.toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  it('never exceeds the configured concurrency and schedules every input once', async () => {
    let active = 0;
    let maximumActive = 0;
    const starts: number[] = [];
    const results = await runConcurrentQueue(
      Array.from({ length: 12 }, (_, index) => index),
      4,
      async (input, index) => {
        starts.push(index);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return input * 2;
      },
    );

    expect(maximumActive).toBe(4);
    expect(active).toBe(0);
    expect(starts).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(results).toEqual(
      Array.from({ length: 12 }, (_, index) => ({
        status: 'fulfilled',
        index,
        input: index,
        value: index * 2,
      })),
    );
  });

  it('keeps results aligned with inputs when tasks finish out of order', async () => {
    const releases = [deferred<string>(), deferred<string>(), deferred<string>()];
    const execution = runConcurrentQueue(['first', 'second', 'third'], 3, (_input, index) => {
      const release = releases[index];
      if (!release) throw new Error('Missing deferred result.');
      return release.promise;
    });

    releases[2]?.resolve('third result');
    releases[0]?.resolve('first result');
    releases[1]?.resolve('second result');

    await expect(execution).resolves.toEqual([
      { status: 'fulfilled', index: 0, input: 'first', value: 'first result' },
      { status: 'fulfilled', index: 1, input: 'second', value: 'second result' },
      { status: 'fulfilled', index: 2, input: 'third', value: 'third result' },
    ]);
  });

  it('records synchronous and asynchronous failures without stopping other work', async () => {
    const syncFailure = new Error('sync failure');
    const asyncFailure = new Error('async failure');
    const results = await runConcurrentQueue(['ok-1', 'sync', 'async', 'ok-2'], 2, (input) => {
      if (input === 'sync') throw syncFailure;
      if (input === 'async') return Promise.reject(asyncFailure);
      return Promise.resolve(input.toUpperCase());
    });

    expect(results).toEqual([
      { status: 'fulfilled', index: 0, input: 'ok-1', value: 'OK-1' },
      { status: 'rejected', index: 1, input: 'sync', reason: syncFailure },
      { status: 'rejected', index: 2, input: 'async', reason: asyncFailure },
      { status: 'fulfilled', index: 3, input: 'ok-2', value: 'OK-2' },
    ] satisfies ConcurrentQueueItemResult<string, string>[]);
  });

  it('snapshots inputs before work can mutate the source array', async () => {
    const inputs = [1, 2];
    const blocker = deferred<number>();
    const execution = runConcurrentQueue(inputs, 1, async (input, index) =>
      index === 0 ? blocker.promise : input,
    );

    inputs.push(3);
    blocker.resolve(1);

    await expect(execution).resolves.toEqual([
      { status: 'fulfilled', index: 0, input: 1, value: 1 },
      { status: 'fulfilled', index: 1, input: 2, value: 2 },
    ]);
  });

  it('does not start any item when the queue is already paused', async () => {
    const controller = new AbortController();
    expect(pauseConcurrentQueue(controller)).toBe(true);
    const worker = vi.fn(async (input: number) => input);

    const results = await runConcurrentQueue([1, 2], 2, worker, {
      signal: controller.signal,
    });

    expect(worker).not.toHaveBeenCalled();
    expect(results).toEqual([
      {
        status: 'not-started',
        index: 0,
        input: 1,
        interruption: 'pause',
        reason: controller.signal.reason,
      },
      {
        status: 'not-started',
        index: 1,
        input: 2,
        interruption: 'pause',
        reason: controller.signal.reason,
      },
    ]);
  });

  it('aborts active work and leaves queued inputs unstarted when cancelled', async () => {
    const controller = new AbortController();
    const starts: number[] = [];
    const execution = runConcurrentQueue(
      ['active-1', 'active-2', 'queued-1', 'queued-2'],
      2,
      (_input, index, signal) => {
        expect(signal).toBe(controller.signal);
        starts.push(index);
        return rejectWhenAborted(signal);
      },
      { signal: controller.signal },
    );

    expect(starts).toEqual([0, 1]);
    expect(cancelConcurrentQueue(controller)).toBe(true);
    const results = await execution;

    expect(starts).toEqual([0, 1]);
    expect(results.map(({ status }) => status)).toEqual([
      'aborted',
      'aborted',
      'not-started',
      'not-started',
    ]);
    expect(
      results.every(
        (result) =>
          (result.status !== 'aborted' && result.status !== 'not-started') ||
          result.interruption === 'cancel',
      ),
    ).toBe(true);
  });

  it('preserves completed work while pausing active and unstarted items', async () => {
    const controller = new AbortController();
    const firstResult = deferred<string>();
    const secondStarted = deferred<void>();
    const starts: number[] = [];
    const execution = runConcurrentQueue(
      ['completed', 'active', 'queued'],
      1,
      (_input, index, signal) => {
        starts.push(index);
        if (index === 0) return firstResult.promise;
        secondStarted.resolve(undefined);
        return rejectWhenAborted(signal);
      },
      { signal: controller.signal },
    );

    firstResult.resolve('saved');
    await secondStarted.promise;
    expect(pauseConcurrentQueue(controller)).toBe(true);

    const results = await execution;
    expect(starts).toEqual([0, 1]);
    expect(results).toEqual([
      { status: 'fulfilled', index: 0, input: 'completed', value: 'saved' },
      {
        status: 'aborted',
        index: 1,
        input: 'active',
        interruption: 'pause',
        reason: controller.signal.reason,
      },
      {
        status: 'not-started',
        index: 2,
        input: 'queued',
        interruption: 'pause',
        reason: controller.signal.reason,
      },
    ]);
  });

  it('keeps a late successful side effect fulfilled while stopping subsequent work', async () => {
    const controller = new AbortController();
    const lateSuccess = deferred<string>();
    const starts: number[] = [];
    const execution = runConcurrentQueue(
      ['active', 'queued'],
      1,
      (_input, index) => {
        starts.push(index);
        return lateSuccess.promise;
      },
      { signal: controller.signal },
    );

    expect(cancelConcurrentQueue(controller)).toBe(true);
    lateSuccess.resolve('saved despite cancellation');

    await expect(execution).resolves.toEqual([
      {
        status: 'fulfilled',
        index: 0,
        input: 'active',
        value: 'saved despite cancellation',
      },
      {
        status: 'not-started',
        index: 1,
        input: 'queued',
        interruption: 'cancel',
        reason: controller.signal.reason,
      },
    ]);
    expect(starts).toEqual([0]);
  });

  it('treats a raw AbortController abort as cancellation and keeps interruption idempotent', async () => {
    const rawController = new AbortController();
    rawController.abort();
    const [rawResult] = await runConcurrentQueue([1], 1, async (input) => input, {
      signal: rawController.signal,
    });
    expect(rawResult).toMatchObject({ status: 'not-started', interruption: 'cancel' });

    const controlled = new AbortController();
    expect(pauseConcurrentQueue(controlled)).toBe(true);
    expect(cancelConcurrentQueue(controlled)).toBe(false);
    expect(controlled.signal.reason).toMatchObject({ kind: 'pause' });
    expect(Object.isFrozen(controlled.signal.reason)).toBe(true);
    expect(() => interruptConcurrentQueue(new AbortController(), 'invalid' as never)).toThrow(
      TypeError,
    );
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid concurrency %s before starting work',
    async (concurrency) => {
      const worker = vi.fn(async (input: number) => input);

      expect(isConcurrencyLimit(concurrency)).toBe(false);
      await expect(runConcurrentQueue([1], concurrency, worker)).rejects.toThrow(RangeError);
      expect(worker).not.toHaveBeenCalled();
    },
  );

  it('accepts positive safe integer concurrency limits', () => {
    expect(isConcurrencyLimit(1)).toBe(true);
    expect(isConcurrencyLimit(Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});
