import {
  createCaptureError,
  type CaptureJob,
  type CaptureSettings,
  type ResourceRecord,
} from '@sitecapsule/domain';
import { CAPTURE_RESULT_FAILURE_LIMIT } from '@sitecapsule/messaging/protocol';
import { buildCaptureJobResult } from '@sitecapsule/jobs';
import { describe, expect, it } from 'vitest';

const settings: CaptureSettings = {
  archiveFileName: 'result.zip',
  renderWaitMs: 0,
  maxConcurrentRequests: 4,
  includeMedia: false,
  includeScripts: true,
  includeThirdPartyResources: true,
  autoScroll: false,
  maxDepth: 0,
  maxPages: 1,
  allowedUrlPatterns: [],
  blockedUrlPatterns: [],
  maxFileSizeBytes: null,
  maxTotalSizeBytes: null,
};

function createJob(status: 'completed' | 'failed' | 'cancelled' | 'fetching'): CaptureJob {
  return {
    id: 'job-result',
    tabId: 7,
    startUrl: 'https://example.com/',
    mode: 'current-page',
    profile: 'standard',
    status,
    settings,
    counters: {
      pagesDiscovered: 1,
      pagesCaptured: 1,
      resourcesDiscovered: 2,
      resourcesSaved: 1,
      resourcesFailed: 1,
      resourcesSkipped: 0,
      bytesWritten: 512,
    },
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:01.000Z',
    ...(status === 'failed'
      ? {
          error: createCaptureError('network-request-failed', {
            operation: 'resource-download',
            jobId: 'job-result',
            resourceId: 'private-resource-id',
            url: 'https://example.com/?token=private',
            stage: 'fetching',
          }),
        }
      : {}),
  };
}

function createFailedResource(index = 0): ResourceRecord {
  return {
    id: `resource-${index}`,
    jobId: 'job-result',
    originalUrl: `https://cdn.example.com/image-${index}.png?token=private#secret`,
    finalUrl: `https://cdn.example.com/image-${index}.png?token=private#secret`,
    referrerUrl: 'https://example.com/',
    type: 'image',
    discoverySources: ['dom'],
    httpStatus: 503,
    state: 'failed',
    error: createCaptureError('network-request-failed', {
      operation: 'resource-download',
      jobId: 'job-result',
      resourceId: `resource-${index}`,
      url: 'https://private.example/token',
      resourceType: 'image',
      httpStatus: 503,
      affectsPrimaryVisual: true,
    }),
  };
}

describe('capture job result', () => {
  it('reports a real session artifact and sanitizes resource diagnostics', () => {
    const result = buildCaptureJobResult(
      createJob('completed'),
      [createFailedResource()],
      new Uint8Array([1, 2, 3]),
    );

    expect(result).toMatchObject({
      status: 'completed',
      fileName: 'result.zip',
      archiveAvailable: true,
      archiveByteLength: 3,
      omittedFailureCount: 0,
    });
    expect(result.failures[0]).toMatchObject({
      url: 'https://cdn.example.com/image-0.png?token=REDACTED#secret',
      resourceType: 'image',
      httpStatus: 503,
      affectsPrimaryVisual: true,
      error: {
        context: {
          operation: 'resource-download',
          resourceType: 'image',
          httpStatus: 503,
          affectsPrimaryVisual: true,
        },
      },
    });
    expect(result.failures[0]?.error.context).not.toHaveProperty('jobId');
    expect(result.failures[0]?.error.context).not.toHaveProperty('resourceId');
    expect(result.failures[0]?.error.context).not.toHaveProperty('url');
  });

  it('does not claim a completed artifact is downloadable after session loss', () => {
    expect(buildCaptureJobResult(createJob('completed'), [])).toMatchObject({
      archiveAvailable: false,
      archiveByteLength: null,
    });
  });

  it('returns a sanitized task failure and never exposes an artifact for failed jobs', () => {
    const result = buildCaptureJobResult(createJob('failed'), [], new Uint8Array([1, 2, 3]));
    expect(result).toMatchObject({
      status: 'failed',
      archiveAvailable: false,
      archiveByteLength: null,
      error: {
        code: 'network-request-failed',
        context: { operation: 'resource-download', stage: 'fetching' },
      },
    });
    expect(result.error?.context).not.toHaveProperty('jobId');
  });

  it('caps transmitted failures and reports the omitted count', () => {
    const resources = Array.from({ length: CAPTURE_RESULT_FAILURE_LIMIT + 2 }, (_, index) =>
      createFailedResource(index),
    );
    const result = buildCaptureJobResult(createJob('completed'), resources);
    expect(result.failures).toHaveLength(CAPTURE_RESULT_FAILURE_LIMIT);
    expect(result.omittedFailureCount).toBe(2);
  });

  it('rejects active jobs and cross-job resources', () => {
    expect(() => buildCaptureJobResult(createJob('fetching'), [])).toThrow(/terminal jobs/i);
    expect(() =>
      buildCaptureJobResult(createJob('completed'), [
        { ...createFailedResource(), jobId: 'another-job' },
      ]),
    ).toThrow(/requested job/i);
  });
});
