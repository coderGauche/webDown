import {
  createCaptureError,
  isCaptureError,
  toCaptureError,
  type CaptureError,
  type JobCounters,
  type ResourceRecord,
} from '@sitecapsule/domain';

import {
  runConcurrentQueue,
  type ConcurrentQueueItemResult,
  type QueueInterruptionKind,
} from './concurrent-queue';

export const RESOURCE_DOWNLOAD_BATCH_STATUSES = [
  'completed',
  'completed-with-errors',
  'failed',
  'paused',
  'cancelled',
] as const;

export type ResourceDownloadBatchStatus = (typeof RESOURCE_DOWNLOAD_BATCH_STATUSES)[number];

export type ResourceDownloadWorkerResult =
  | { status: 'saved'; resource: ResourceRecord }
  | { status: 'failed'; error: CaptureError; resource?: ResourceRecord };

export type ResourceDownloadWorker = (
  resource: ResourceRecord,
  index: number,
  signal: AbortSignal,
) => ResourceDownloadWorkerResult | PromiseLike<ResourceDownloadWorkerResult>;

export type SavedResourceDownloadResult = {
  status: 'saved';
  index: number;
  resource: ResourceRecord;
  primary: boolean;
};

export type FailedResourceDownloadResult = {
  status: 'failed';
  index: number;
  resource: ResourceRecord;
  error: CaptureError;
  primary: boolean;
  fatal: boolean;
};

export type InterruptedResourceDownloadResult = {
  status: 'aborted' | 'not-started';
  index: number;
  resource: ResourceRecord;
  primary: boolean;
  interruption: QueueInterruptionKind;
};

export type ResourceDownloadResult =
  SavedResourceDownloadResult | FailedResourceDownloadResult | InterruptedResourceDownloadResult;

export type ResourceDownloadBatchCounts = {
  total: number;
  saved: number;
  failed: number;
  aborted: number;
  notStarted: number;
  bytesWritten: number;
};

export type ResourceDownloadBatchResult = {
  status: ResourceDownloadBatchStatus;
  results: ResourceDownloadResult[];
  counts: ResourceDownloadBatchCounts;
  jobCounterDelta: Pick<
    JobCounters,
    'resourcesSaved' | 'resourcesFailed' | 'resourcesSkipped' | 'bytesWritten'
  >;
  fatalError: CaptureError | null;
};

export type ResourceDownloadBatchOptions = {
  primaryResourceId: string;
  signal?: AbortSignal;
};

function assertBatchInput(resources: readonly ResourceRecord[], primaryResourceId: string): void {
  if (typeof primaryResourceId !== 'string' || primaryResourceId.trim() === '') {
    throw new TypeError('Primary resource ID must be a non-empty string.');
  }

  const ids = new Set<string>();
  let primaryCount = 0;
  let jobId: string | undefined;
  for (const resource of resources) {
    if (ids.has(resource.id)) throw new RangeError('Resource batch contains duplicate IDs.');
    ids.add(resource.id);
    if (resource.id === primaryResourceId) primaryCount += 1;
    jobId ??= resource.jobId;
    if (resource.jobId !== jobId) {
      throw new RangeError('Resource batch must belong to one capture job.');
    }
  }

  if (primaryCount !== 1) {
    throw new RangeError('Resource batch must contain the primary resource exactly once.');
  }
}

function isSameResourceIdentity(expected: ResourceRecord, actual: ResourceRecord): boolean {
  return (
    actual.id === expected.id &&
    actual.jobId === expected.jobId &&
    actual.originalUrl === expected.originalUrl
  );
}

function normalizedFailure(
  reason: unknown,
  resource: ResourceRecord,
  primary: boolean,
): CaptureError {
  const source = isCaptureError(reason)
    ? reason
    : toCaptureError(reason, 'network-request-failed', {
        operation: 'resource-download',
      });

  return createCaptureError(source.code, {
    ...source.context,
    operation: 'resource-download',
    jobId: resource.jobId,
    resourceId: resource.id,
    url: resource.originalUrl,
    resourceType: resource.type,
    affectsPrimaryVisual: source.context?.affectsPrimaryVisual ?? primary,
  });
}

function failedResource(
  original: ResourceRecord,
  candidate: ResourceRecord | undefined,
  error: CaptureError,
): ResourceRecord {
  const base = candidate && isSameResourceIdentity(original, candidate) ? candidate : original;
  return { ...base, state: 'failed', error };
}

function normalizeFulfilledResult(
  queueResult: Extract<
    ConcurrentQueueItemResult<ResourceRecord, ResourceDownloadWorkerResult>,
    {
      status: 'fulfilled';
    }
  >,
  primaryResourceId: string,
): SavedResourceDownloadResult | FailedResourceDownloadResult {
  const { input, value, index } = queueResult;
  const primary = input.id === primaryResourceId;

  if (
    value.status === 'saved' &&
    isSameResourceIdentity(input, value.resource) &&
    value.resource.state === 'saved' &&
    (value.resource.byteLength === undefined ||
      (Number.isSafeInteger(value.resource.byteLength) && value.resource.byteLength >= 0))
  ) {
    const { error: _error, ...saved } = value.resource;
    return { status: 'saved', index, resource: saved, primary };
  }

  const suppliedFailure =
    value.status === 'failed' &&
    isCaptureError(value.error) &&
    (value.resource === undefined || isSameResourceIdentity(input, value.resource));
  const error = normalizedFailure(
    suppliedFailure
      ? value.error
      : createCaptureError('unexpected-error', { operation: 'resource-download' }),
    input,
    primary,
  );
  const resource = failedResource(
    input,
    suppliedFailure && value.status === 'failed' ? value.resource : undefined,
    error,
  );
  return { status: 'failed', index, resource, error, primary, fatal: primary };
}

function normalizeQueueResult(
  queueResult: ConcurrentQueueItemResult<ResourceRecord, ResourceDownloadWorkerResult>,
  primaryResourceId: string,
): ResourceDownloadResult {
  const primary = queueResult.input.id === primaryResourceId;
  if (queueResult.status === 'fulfilled') {
    return normalizeFulfilledResult(queueResult, primaryResourceId);
  }
  if (queueResult.status === 'rejected') {
    const error = normalizedFailure(queueResult.reason, queueResult.input, primary);
    return {
      status: 'failed',
      index: queueResult.index,
      resource: failedResource(queueResult.input, undefined, error),
      error,
      primary,
      fatal: primary,
    };
  }
  return {
    status: queueResult.status,
    index: queueResult.index,
    resource: queueResult.input,
    primary,
    interruption: queueResult.interruption,
  };
}

function batchStatus(
  results: readonly ResourceDownloadResult[],
  fatalError: CaptureError | null,
): ResourceDownloadBatchStatus {
  if (fatalError) return 'failed';
  if (
    results.some(
      (result) =>
        (result.status === 'aborted' || result.status === 'not-started') &&
        result.interruption === 'cancel',
    )
  ) {
    return 'cancelled';
  }
  if (
    results.some(
      (result) =>
        (result.status === 'aborted' || result.status === 'not-started') &&
        result.interruption === 'pause',
    )
  ) {
    return 'paused';
  }
  return results.some((result) => result.status === 'failed')
    ? 'completed-with-errors'
    : 'completed';
}

function countResults(results: readonly ResourceDownloadResult[]): ResourceDownloadBatchCounts {
  const counts: ResourceDownloadBatchCounts = {
    total: results.length,
    saved: 0,
    failed: 0,
    aborted: 0,
    notStarted: 0,
    bytesWritten: 0,
  };

  for (const result of results) {
    if (result.status === 'saved') {
      counts.saved += 1;
      counts.bytesWritten += result.resource.byteLength ?? 0;
    } else if (result.status === 'failed') {
      counts.failed += 1;
    } else if (result.status === 'aborted') {
      counts.aborted += 1;
    } else {
      counts.notStarted += 1;
    }
    if (!Number.isSafeInteger(counts.bytesWritten)) {
      throw new RangeError('Resource batch byte count exceeds the safe integer range.');
    }
  }
  return counts;
}

export async function runResourceDownloadBatch(
  resources: readonly ResourceRecord[],
  concurrency: number,
  worker: ResourceDownloadWorker,
  options: ResourceDownloadBatchOptions,
): Promise<ResourceDownloadBatchResult> {
  assertBatchInput(resources, options.primaryResourceId);
  const queueResults = await runConcurrentQueue(resources, concurrency, worker, {
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const results = queueResults.map((result) =>
    normalizeQueueResult(result, options.primaryResourceId),
  );
  const counts = countResults(results);
  const fatalError =
    results.find(
      (result): result is FailedResourceDownloadResult =>
        result.status === 'failed' && result.fatal,
    )?.error ?? null;

  return {
    status: batchStatus(results, fatalError),
    results,
    counts,
    jobCounterDelta: {
      resourcesSaved: counts.saved,
      resourcesFailed: counts.failed,
      resourcesSkipped: 0,
      bytesWritten: counts.bytesWritten,
    },
    fatalError,
  };
}
