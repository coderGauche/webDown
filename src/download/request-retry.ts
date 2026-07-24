export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_REQUEST_RETRIES = 2;
export const DEFAULT_RETRY_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
export const MAX_REQUEST_RETRIES = 10;
export const MAX_TIMER_DELAY_MS = 2_147_483_647;
export const RETRYABLE_HTTP_STATUSES = [408, 425, 429, 500, 502, 503, 504] as const;

export type RequestAttemptContext = {
  attempt: number;
  signal: AbortSignal;
};

export type RequestAttemptResult<TValue, TError = unknown> =
  | { status: 'succeeded'; value: TValue }
  | {
      status: 'failed';
      error: TError;
      retryable: boolean;
      retryAfter?: string | null;
    };

export type RequestOperation<TValue, TError = unknown> = (
  context: RequestAttemptContext,
) => RequestAttemptResult<TValue, TError> | PromiseLike<RequestAttemptResult<TValue, TError>>;

export type RequestRetryResult<TValue> =
  | { status: 'succeeded'; value: TValue; attempts: number }
  | {
      status: 'failed';
      error: unknown;
      attempts: number;
      retryable: boolean;
      exhausted: boolean;
      timedOut: boolean;
    }
  | { status: 'aborted'; attempts: number; reason: unknown };

export type RetryDelayScheduler = (delayMs: number, signal: AbortSignal) => Promise<void>;

export type RequestRetryOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: RetryDelayScheduler;
};

export type RequestTimeoutReason = {
  code: 'request-timeout';
  timeoutMs: number;
};

type ResolvedRequestRetryOptions = {
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  signal: AbortSignal;
  now: () => number;
  sleep: RetryDelayScheduler;
};

type AttemptExecution<TValue, TError> =
  | { status: 'settled'; result: RequestAttemptResult<TValue, TError> }
  | { status: 'threw'; error: unknown }
  | { status: 'timed-out'; error: RequestTimeoutReason }
  | { status: 'aborted'; reason: unknown };

const NEVER_ABORTED_SIGNAL = new AbortController().signal;
const HTTP_DATE_PATTERN =
  /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4})$/;
const ASCTIME_DATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) {1,2}\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/;

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function createTimeoutReason(timeoutMs: number): RequestTimeoutReason {
  return Object.freeze({ code: 'request-timeout', timeoutMs });
}

function defaultSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (delayMs === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function resolveOptions(options: RequestRetryOptions): ResolvedRequestRetryOptions {
  const resolved = {
    timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_REQUEST_RETRIES,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
    signal: options.signal ?? NEVER_ABORTED_SIGNAL,
    now: options.now ?? Date.now,
    sleep: options.sleep ?? defaultSleep,
  };

  if (!isPositiveSafeInteger(resolved.timeoutMs) || resolved.timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new RangeError('Request timeout must be a positive safe integer.');
  }
  if (!isNonNegativeSafeInteger(resolved.maxRetries) || resolved.maxRetries > MAX_REQUEST_RETRIES) {
    throw new RangeError('Maximum retries must be a non-negative safe integer.');
  }
  if (
    !isNonNegativeSafeInteger(resolved.baseDelayMs) ||
    !isNonNegativeSafeInteger(resolved.maxDelayMs) ||
    resolved.maxDelayMs > MAX_TIMER_DELAY_MS ||
    resolved.baseDelayMs > resolved.maxDelayMs
  ) {
    throw new RangeError('Retry delays must be safe integers with base not exceeding maximum.');
  }
  if (typeof resolved.now !== 'function' || typeof resolved.sleep !== 'function') {
    throw new TypeError('Retry clock and delay scheduler must be functions.');
  }
  return resolved;
}

export function isRetryableHttpStatus(status: unknown): status is number {
  return RETRYABLE_HTTP_STATUSES.includes(status as (typeof RETRYABLE_HTTP_STATUSES)[number]);
}

export function parseRetryAfterMs(value: unknown, nowMs = Date.now()): number | null {
  if (typeof value !== 'string' || !Number.isFinite(nowMs)) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    const milliseconds = seconds * 1_000;
    return Number.isSafeInteger(seconds) && Number.isSafeInteger(milliseconds)
      ? milliseconds
      : null;
  }

  if (!HTTP_DATE_PATTERN.test(trimmed)) return null;
  const timestamp = Date.parse(ASCTIME_DATE_PATTERN.test(trimmed) ? `${trimmed} GMT` : trimmed);
  if (!Number.isFinite(timestamp)) return null;
  const milliseconds = Math.max(0, timestamp - nowMs);
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

export function calculateRetryDelayMs(
  failedAttempt: number,
  retryAfter: string | null | undefined,
  baseDelayMs: number,
  maxDelayMs: number,
  nowMs = Date.now(),
): number {
  if (
    !isPositiveSafeInteger(failedAttempt) ||
    !isNonNegativeSafeInteger(baseDelayMs) ||
    !isNonNegativeSafeInteger(maxDelayMs) ||
    maxDelayMs > MAX_TIMER_DELAY_MS ||
    baseDelayMs > maxDelayMs
  ) {
    throw new RangeError('Retry delay inputs are invalid.');
  }

  const exponent = Math.min(failedAttempt - 1, 52);
  const localDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** exponent);
  const serverDelay = parseRetryAfterMs(retryAfter, nowMs) ?? 0;
  return Math.min(maxDelayMs, Math.max(localDelay, serverDelay));
}

async function executeAttempt<TValue, TError>(
  operation: RequestOperation<TValue, TError>,
  attempt: number,
  options: ResolvedRequestRetryOptions,
): Promise<AttemptExecution<TValue, TError>> {
  if (options.signal.aborted) {
    return { status: 'aborted', reason: options.signal.reason };
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeExternalAbort = () => {};
  const interruption = new Promise<AttemptExecution<TValue, TError>>((resolve) => {
    const onExternalAbort = () => {
      controller.abort(options.signal.reason);
      resolve({ status: 'aborted', reason: options.signal.reason });
    };
    options.signal.addEventListener('abort', onExternalAbort, { once: true });
    removeExternalAbort = () => options.signal.removeEventListener('abort', onExternalAbort);

    timeout = setTimeout(() => {
      const error = createTimeoutReason(options.timeoutMs);
      controller.abort(error);
      resolve({ status: 'timed-out', error });
    }, options.timeoutMs);
  });
  const operationResult: Promise<AttemptExecution<TValue, TError>> = Promise.resolve()
    .then(() => operation({ attempt, signal: controller.signal }))
    .then(
      (result): AttemptExecution<TValue, TError> => ({ status: 'settled', result }),
      (error: unknown): AttemptExecution<TValue, TError> => ({ status: 'threw', error }),
    );

  const result = await Promise.race([operationResult, interruption]);
  if (timeout !== undefined) clearTimeout(timeout);
  removeExternalAbort();
  return result;
}

export async function runRequestWithRetry<TValue, TError = unknown>(
  operation: RequestOperation<TValue, TError>,
  options: RequestRetryOptions = {},
): Promise<RequestRetryResult<TValue>> {
  if (typeof operation !== 'function') throw new TypeError('Request operation must be a function.');
  const resolved = resolveOptions(options);
  let attempts = 0;

  while (attempts <= resolved.maxRetries) {
    if (resolved.signal.aborted) {
      return { status: 'aborted', attempts, reason: resolved.signal.reason };
    }

    attempts += 1;
    const execution = await executeAttempt(operation, attempts, resolved);
    if (execution.status === 'aborted') {
      return { status: 'aborted', attempts, reason: execution.reason };
    }
    if (execution.status === 'threw') {
      return {
        status: 'failed',
        error: execution.error,
        attempts,
        retryable: false,
        exhausted: false,
        timedOut: false,
      };
    }
    if (execution.status === 'settled' && execution.result.status === 'succeeded') {
      return { status: 'succeeded', value: execution.result.value, attempts };
    }

    const timedOut = execution.status === 'timed-out';
    const failure = execution.status === 'settled' ? execution.result : null;
    const retryable = timedOut || (failure?.status === 'failed' && failure.retryable);
    const error = timedOut ? execution.error : failure?.status === 'failed' ? failure.error : null;
    const retryAfter = failure?.status === 'failed' ? failure.retryAfter : null;
    const exhausted = retryable && attempts > resolved.maxRetries;
    if (!retryable || exhausted) {
      return { status: 'failed', error, attempts, retryable, exhausted, timedOut };
    }

    const nowMs = resolved.now();
    if (!Number.isFinite(nowMs)) throw new RangeError('Retry clock must return a finite value.');
    const delayMs = calculateRetryDelayMs(
      attempts,
      retryAfter,
      resolved.baseDelayMs,
      resolved.maxDelayMs,
      nowMs,
    );
    try {
      await resolved.sleep(delayMs, resolved.signal);
    } catch (sleepError) {
      if (resolved.signal.aborted) {
        return { status: 'aborted', attempts, reason: resolved.signal.reason };
      }
      throw sleepError;
    }
  }

  throw new Error('Retry loop ended without a terminal result.');
}
