import {
  createCaptureError,
  isCaptureError,
  type CaptureError,
  type CaptureJob,
  type ResourceRecord,
} from '@sitecapsule/domain';
import { sanitizeArchiveNetworkUrl } from '@sitecapsule/archive';
import {
  CAPTURE_RESULT_FAILURE_LIMIT,
  type CaptureJobResult,
  type CaptureResourceFailure,
} from '@sitecapsule/messaging/protocol';

function sanitizeDiagnosticUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return sanitizeArchiveNetworkUrl(value, 'Capture result resource URL', false);
    }
    return `${url.protocol}[redacted]`;
  } catch {
    return '[invalid URL]';
  }
}

function sanitizeResultError(error: CaptureError): CaptureError {
  const context = error.context;
  const browserError =
    context?.browserError && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(context.browserError)
      ? context.browserError
      : undefined;
  return createCaptureError(error.code, {
    ...(context?.operation ? { operation: context.operation } : {}),
    ...(context?.resourceType ? { resourceType: context.resourceType } : {}),
    ...(context?.stage ? { stage: context.stage } : {}),
    ...(context?.httpStatus ? { httpStatus: context.httpStatus } : {}),
    ...(browserError ? { browserError } : {}),
    ...(context?.affectsPrimaryVisual !== undefined
      ? { affectsPrimaryVisual: context.affectsPrimaryVisual }
      : {}),
  });
}

function createFailure(resource: ResourceRecord): CaptureResourceFailure {
  const error = isCaptureError(resource.error)
    ? sanitizeResultError(resource.error)
    : createCaptureError('unexpected-error', {
        operation: 'resource-download',
        resourceType: resource.type,
        ...(resource.httpStatus ? { httpStatus: resource.httpStatus } : {}),
        affectsPrimaryVisual: resource.type === 'document',
      });
  return {
    url: sanitizeDiagnosticUrl(resource.finalUrl ?? resource.originalUrl),
    resourceType: resource.type,
    httpStatus: resource.httpStatus ?? error.context?.httpStatus ?? null,
    affectsPrimaryVisual: error.context?.affectsPrimaryVisual ?? resource.type === 'document',
    error,
  };
}

function compareFailures(left: CaptureResourceFailure, right: CaptureResourceFailure): number {
  if (left.affectsPrimaryVisual !== right.affectsPrimaryVisual) {
    return left.affectsPrimaryVisual ? -1 : 1;
  }
  if (left.url !== right.url) return left.url < right.url ? -1 : 1;
  return left.resourceType < right.resourceType
    ? -1
    : left.resourceType > right.resourceType
      ? 1
      : 0;
}

export function buildCaptureJobResult(
  job: CaptureJob,
  resources: readonly ResourceRecord[],
  archiveBytes?: Uint8Array,
): CaptureJobResult {
  if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled') {
    throw new TypeError('Capture result is only available for terminal jobs.');
  }
  if (!Array.isArray(resources) || resources.some((resource) => resource.jobId !== job.id)) {
    throw new TypeError('Capture result resources must belong to the requested job.');
  }

  const failures = resources
    .filter((resource) => resource.state === 'failed')
    .map(createFailure)
    .sort(compareFailures);
  const archiveAvailable =
    job.status === 'completed' && archiveBytes instanceof Uint8Array && archiveBytes.byteLength > 0;

  return {
    jobId: job.id,
    status: job.status,
    fileName: job.settings.archiveFileName,
    archiveAvailable,
    archiveByteLength: archiveAvailable ? archiveBytes.byteLength : null,
    counters: { ...job.counters },
    error: job.error ? sanitizeResultError(job.error) : null,
    failures: failures.slice(0, CAPTURE_RESULT_FAILURE_LIMIT),
    omittedFailureCount: Math.max(0, failures.length - CAPTURE_RESULT_FAILURE_LIMIT),
  };
}
