export type ConcurrentQueueWorker<TInput, TValue> = (
  input: TInput,
  index: number,
  signal: AbortSignal,
) => TValue | PromiseLike<TValue>;

export const QUEUE_INTERRUPTION_KINDS = ['pause', 'cancel'] as const;

export type QueueInterruptionKind = (typeof QUEUE_INTERRUPTION_KINDS)[number];

export type ConcurrentQueueOptions = {
  signal?: AbortSignal;
};

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

export type AbortedQueueItem<TInput> = {
  status: 'aborted';
  index: number;
  input: TInput;
  interruption: QueueInterruptionKind;
  reason: unknown;
};

export type NotStartedQueueItem<TInput> = {
  status: 'not-started';
  index: number;
  input: TInput;
  interruption: QueueInterruptionKind;
  reason: unknown;
};

export type ConcurrentQueueItemResult<TInput, TValue> =
  | FulfilledQueueItem<TInput, TValue>
  | RejectedQueueItem<TInput>
  | AbortedQueueItem<TInput>
  | NotStartedQueueItem<TInput>;

type QueueInterruptionReason = {
  name: 'SiteCapsuleQueueInterruption';
  kind: QueueInterruptionKind;
};

const NEVER_ABORTED_SIGNAL = new AbortController().signal;

function isQueueInterruptionReason(value: unknown): value is QueueInterruptionReason {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    value.name === 'SiteCapsuleQueueInterruption' &&
    'kind' in value &&
    QUEUE_INTERRUPTION_KINDS.includes(value.kind as QueueInterruptionKind)
  );
}

function interruptionKind(signal: AbortSignal): QueueInterruptionKind {
  return isQueueInterruptionReason(signal.reason) ? signal.reason.kind : 'cancel';
}

export function interruptConcurrentQueue(
  controller: AbortController,
  kind: QueueInterruptionKind,
): boolean {
  if (!QUEUE_INTERRUPTION_KINDS.includes(kind)) {
    throw new TypeError('Queue interruption kind must be pause or cancel.');
  }
  if (controller.signal.aborted) return false;
  controller.abort(
    Object.freeze({
      name: 'SiteCapsuleQueueInterruption',
      kind,
    } satisfies QueueInterruptionReason),
  );
  return true;
}

export function pauseConcurrentQueue(controller: AbortController): boolean {
  return interruptConcurrentQueue(controller, 'pause');
}

export function cancelConcurrentQueue(controller: AbortController): boolean {
  return interruptConcurrentQueue(controller, 'cancel');
}

export function isConcurrencyLimit(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export async function runConcurrentQueue<TInput, TValue>(
  inputs: readonly TInput[],
  concurrency: number,
  worker: ConcurrentQueueWorker<TInput, TValue>,
  options: ConcurrentQueueOptions = {},
): Promise<ConcurrentQueueItemResult<TInput, TValue>[]> {
  if (!isConcurrencyLimit(concurrency)) {
    throw new RangeError('Queue concurrency must be a positive safe integer.');
  }
  if (typeof worker !== 'function') {
    throw new TypeError('Queue worker must be a function.');
  }

  const inputSnapshot = [...inputs];
  const signal = options.signal ?? NEVER_ABORTED_SIGNAL;
  const results = new Array<ConcurrentQueueItemResult<TInput, TValue>>(inputSnapshot.length);
  let nextIndex = 0;

  const consume = async (): Promise<void> => {
    while (!signal.aborted && nextIndex < inputSnapshot.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = inputSnapshot[index] as TInput;

      try {
        const value = await worker(input, index, signal);
        results[index] = { status: 'fulfilled', index, input, value };
      } catch (reason) {
        results[index] = signal.aborted
          ? {
              status: 'aborted',
              index,
              input,
              interruption: interruptionKind(signal),
              reason,
            }
          : { status: 'rejected', index, input, reason };
      }
    }
  };

  const consumerCount = Math.min(concurrency, inputSnapshot.length);
  await Promise.all(Array.from({ length: consumerCount }, consume));

  if (signal.aborted) {
    const interruption = interruptionKind(signal);
    for (let index = 0; index < inputSnapshot.length; index += 1) {
      if (results[index] !== undefined) continue;
      results[index] = {
        status: 'not-started',
        index,
        input: inputSnapshot[index] as TInput,
        interruption,
        reason: signal.reason,
      };
    }
  }

  return results;
}
