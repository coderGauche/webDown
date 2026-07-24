export type ConcurrentQueueWorker<TInput, TValue> = (
  input: TInput,
  index: number,
) => TValue | PromiseLike<TValue>;

export type FulfilledQueueItem<TInput, TValue> = {
  status: 'fulfilled';
  index: number;
  input: TInput;
  value: TValue;
};

export type RejectedQueueItem<TInput> = {
  status: 'rejected';
  index: number;
  input: TInput;
  reason: unknown;
};

export type ConcurrentQueueItemResult<TInput, TValue> =
  FulfilledQueueItem<TInput, TValue> | RejectedQueueItem<TInput>;

export function isConcurrencyLimit(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export async function runConcurrentQueue<TInput, TValue>(
  inputs: readonly TInput[],
  concurrency: number,
  worker: ConcurrentQueueWorker<TInput, TValue>,
): Promise<ConcurrentQueueItemResult<TInput, TValue>[]> {
  if (!isConcurrencyLimit(concurrency)) {
    throw new RangeError('Queue concurrency must be a positive safe integer.');
  }
  if (typeof worker !== 'function') {
    throw new TypeError('Queue worker must be a function.');
  }

  const inputSnapshot = [...inputs];
  const results = new Array<ConcurrentQueueItemResult<TInput, TValue>>(inputSnapshot.length);
  let nextIndex = 0;

  const consume = async (): Promise<void> => {
    while (nextIndex < inputSnapshot.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = inputSnapshot[index] as TInput;

      try {
        const value = await worker(input, index);
        results[index] = { status: 'fulfilled', index, input, value };
      } catch (reason) {
        results[index] = { status: 'rejected', index, input, reason };
      }
    }
  };

  const consumerCount = Math.min(concurrency, inputSnapshot.length);
  await Promise.all(Array.from({ length: consumerCount }, consume));
  return results;
}
