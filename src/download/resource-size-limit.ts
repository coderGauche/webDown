import { SiteCapsuleError, createCaptureError } from '@sitecapsule/domain';

import type { ResponseHeadersSource } from './resource-response';

export type TaskByteBudgetSnapshot = {
  maxBytes: number | null;
  committedBytes: number;
  reservedBytes: number;
  availableBytes: number | null;
};

export type ResourceByteLease = {
  readonly reservedBytes: number;
  readonly active: boolean;
  ensureReserved(byteLength: number): boolean;
  commit(byteLength: number): void;
  release(): void;
};

export type ResourceBodyReader = {
  read(): PromiseLike<{ done: boolean; value?: Uint8Array }>;
  cancel?(reason?: unknown): void | PromiseLike<void>;
};

export type ResourceBodySource = {
  getReader(): ResourceBodyReader;
};

export type ResourceBodySink = {
  write(chunk: Uint8Array, signal: AbortSignal): void | PromiseLike<void>;
  close(): void | PromiseLike<void>;
  abort(reason: unknown): void | PromiseLike<void>;
};

export type ResourceBodyResponseSource = {
  headers: ResponseHeadersSource;
  body: ResourceBodySource | null;
};

export type ConsumeResourceBodyOptions = {
  budget: TaskByteBudget;
  maxFileSizeBytes: number | null;
  sink: ResourceBodySink;
  signal?: AbortSignal;
};

export type ConsumedResourceBody = {
  byteLength: number;
  declaredByteLength: number | null;
};

const NEVER_ABORTED_SIGNAL = new AbortController().signal;

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNullablePositiveSafeInteger(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) > 0);
}

function assertByteLength(value: unknown, field: string): asserts value is number {
  if (!isNonNegativeSafeInteger(value)) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}

function createLimitError(field: 'maxFileSizeBytes' | 'maxTotalSizeBytes'): SiteCapsuleError {
  return new SiteCapsuleError(
    createCaptureError('resource-limit-exceeded', {
      operation: 'resource-download',
      field,
    }),
  );
}

async function ignoreCleanupFailure(operation: (() => void | PromiseLike<void>) | undefined) {
  try {
    await operation?.();
  } catch {
    // Preserve the primary read, limit, cancellation, or sink failure.
  }
}

async function waitWithAbort<T>(operation: PromiseLike<T> | T, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  let removeAbortListener = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener('abort', onAbort);
  });
  try {
    return await Promise.race([Promise.resolve(operation), aborted]);
  } finally {
    removeAbortListener();
  }
}

export function parseContentLength(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!/^\d+$/.test(candidate)) return null;
  const byteLength = Number(candidate);
  return isNonNegativeSafeInteger(byteLength) ? byteLength : null;
}

export class TaskByteBudget {
  readonly maxBytes: number | null;
  #committedBytes: number;
  #reservedBytes = 0;

  constructor(maxBytes: number | null, committedBytes = 0) {
    if (!isNullablePositiveSafeInteger(maxBytes)) {
      throw new RangeError('Task byte limit must be null or a positive safe integer.');
    }
    assertByteLength(committedBytes, 'Committed byte length');
    if (maxBytes !== null && committedBytes > maxBytes) {
      throw new RangeError('Committed bytes cannot exceed the task byte limit.');
    }
    this.maxBytes = maxBytes;
    this.#committedBytes = committedBytes;
  }

  snapshot(): TaskByteBudgetSnapshot {
    return Object.freeze({
      maxBytes: this.maxBytes,
      committedBytes: this.#committedBytes,
      reservedBytes: this.#reservedBytes,
      availableBytes:
        this.maxBytes === null ? null : this.maxBytes - this.#committedBytes - this.#reservedBytes,
    });
  }

  createLease(initialReservationBytes = 0): ResourceByteLease | null {
    assertByteLength(initialReservationBytes, 'Initial reservation');
    if (!this.#tryReserve(initialReservationBytes)) return null;

    let reservedBytes = initialReservationBytes;
    let active = true;
    const assertActive = () => {
      if (!active) throw new Error('Resource byte lease is no longer active.');
    };

    return {
      get reservedBytes() {
        return reservedBytes;
      },
      get active() {
        return active;
      },
      ensureReserved: (byteLength) => {
        assertActive();
        assertByteLength(byteLength, 'Resource byte length');
        if (byteLength <= reservedBytes) return true;
        const additionalBytes = byteLength - reservedBytes;
        if (!this.#tryReserve(additionalBytes)) return false;
        reservedBytes = byteLength;
        return true;
      },
      commit: (byteLength) => {
        assertActive();
        assertByteLength(byteLength, 'Committed resource byte length');
        if (byteLength > reservedBytes) {
          throw new RangeError('Committed resource bytes exceed the reservation.');
        }
        this.#reservedBytes -= reservedBytes;
        this.#committedBytes += byteLength;
        reservedBytes = 0;
        active = false;
      },
      release: () => {
        if (!active) return;
        this.#reservedBytes -= reservedBytes;
        reservedBytes = 0;
        active = false;
      },
    };
  }

  #tryReserve(byteLength: number): boolean {
    const nextReservedBytes = this.#reservedBytes + byteLength;
    const nextUsedBytes = this.#committedBytes + nextReservedBytes;
    if (!Number.isSafeInteger(nextReservedBytes) || !Number.isSafeInteger(nextUsedBytes)) {
      throw new RangeError('Task byte accounting exceeds the safe integer range.');
    }
    if (this.maxBytes !== null && nextUsedBytes > this.maxBytes) return false;
    this.#reservedBytes = nextReservedBytes;
    return true;
  }
}

export async function consumeResourceBodyWithLimits(
  response: ResourceBodyResponseSource,
  options: ConsumeResourceBodyOptions,
): Promise<ConsumedResourceBody> {
  if (!(options.budget instanceof TaskByteBudget)) {
    throw new TypeError('Resource body consumption requires a task byte budget.');
  }
  if (!isNullablePositiveSafeInteger(options.maxFileSizeBytes)) {
    throw new RangeError('File byte limit must be null or a positive safe integer.');
  }
  if (
    typeof options.sink?.write !== 'function' ||
    typeof options.sink.close !== 'function' ||
    typeof options.sink.abort !== 'function'
  ) {
    throw new TypeError('Resource body sink must provide write(), close(), and abort().');
  }
  if (typeof response.headers?.get !== 'function') {
    throw new TypeError('Response headers must provide get().');
  }

  const signal = options.signal ?? NEVER_ABORTED_SIGNAL;
  throwIfAborted(signal);
  const declaredByteLength = parseContentLength(response.headers.get('content-length'));
  if (
    options.maxFileSizeBytes !== null &&
    declaredByteLength !== null &&
    declaredByteLength > options.maxFileSizeBytes
  ) {
    throw createLimitError('maxFileSizeBytes');
  }

  const lease = options.budget.createLease(declaredByteLength ?? 0);
  if (lease === null) throw createLimitError('maxTotalSizeBytes');

  let reader: ResourceBodyReader | undefined;
  let byteLength = 0;
  try {
    throwIfAborted(signal);
    if (response.body !== null) {
      reader = response.body.getReader();
      while (true) {
        throwIfAborted(signal);
        const chunk = await waitWithAbort(reader.read(), signal);
        throwIfAborted(signal);
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) {
          throw new TypeError('Resource body chunks must be Uint8Array values.');
        }

        const nextByteLength = byteLength + chunk.value.byteLength;
        if (!Number.isSafeInteger(nextByteLength)) {
          throw new RangeError('Resource byte length exceeds the safe integer range.');
        }
        if (options.maxFileSizeBytes !== null && nextByteLength > options.maxFileSizeBytes) {
          throw createLimitError('maxFileSizeBytes');
        }
        if (!lease.ensureReserved(nextByteLength)) {
          throw createLimitError('maxTotalSizeBytes');
        }

        await waitWithAbort(options.sink.write(chunk.value, signal), signal);
        byteLength = nextByteLength;
      }
    }

    await waitWithAbort(options.sink.close(), signal);
    lease.commit(byteLength);
    return { byteLength, declaredByteLength };
  } catch (error) {
    await ignoreCleanupFailure(reader?.cancel ? () => reader?.cancel?.(error) : undefined);
    await ignoreCleanupFailure(() => options.sink.abort(error));
    lease.release();
    throw error;
  }
}
