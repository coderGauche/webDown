import {
  DEFAULT_RENDER_WAIT_MS,
  createCaptureError,
  type CaptureJob,
  type CaptureSettings,
} from '@sitecapsule/domain';
import {
  CAPTURE_JOB_COMMANDS,
  createCaptureArchiveChunkGetRequest,
  createCaptureArchiveChunkResponse,
  MESSAGE_PROTOCOL_VERSION,
  createCaptureJobError,
  createCaptureJobControlRequest,
  createCaptureJobCreateRequest,
  createCaptureJobGetRequest,
  createCaptureJobResultGetRequest,
  createCaptureJobResultResponse,
  createCaptureJobResponse,
  createCaptureJobUpdatedEvent,
  createCorrelationId,
  createPageInfoCollectRequest,
  createPageInfoError,
  createPageInfoRequest,
  createPageInfoResponse,
  createPageArchiveRewriteError,
  createPageArchiveRewriteRequest,
  createPageArchiveRewriteResponse,
  type PageInfo,
} from '@sitecapsule/messaging/protocol';
import {
  isPageArchiveRewriteRequest,
  isPageArchiveRewriteResponse,
  isPageInfoRequest,
  isPageInfoResponse,
} from '@sitecapsule/messaging/validators';
import { describe, expect, it } from 'vitest';

describe('page info messaging protocol', () => {
  const page: PageInfo = {
    title: 'Example',
    tabUrl: 'https://example.com/requested',
    baseUrl: 'https://cdn.example.com/assets/',
    finalUrl: 'https://example.com/final',
    serializedDom: '<!DOCTYPE html>\n<html><body>Example</body></html>',
    domResources: [],
    cssSources: [],
    cssResources: [],
    svgResources: [],
    regionDiagnostics: {
      regions: [],
      limitations: ['closed-shadow-roots-unobservable'],
    },
    performanceResources: [],
    mergedResources: [],
    resourceGraph: {
      rootUrl: 'https://example.com/final',
      nodes: [],
      edges: [],
    },
  };

  it('round-trips a versioned DOM rewrite request and structured response', () => {
    const request = createPageArchiveRewriteRequest(
      {
        html: page.serializedDom,
        documentUrl: page.finalUrl,
        baseUrl: page.baseUrl,
        savedResourceMappings: [
          {
            normalizedUrl: 'https://cdn.example.com/assets/app.css',
            originalUrls: ['https://cdn.example.com/assets/app.css'],
            resourceType: 'stylesheet',
            directoryPath: 'assets/cdn.example.com/css',
            baseFileName: 'app.css',
            queryHash: null,
            collisionHash: null,
            fileName: 'app.css',
            relativePath: 'assets/cdn.example.com/css/app.css',
          },
        ],
      },
      'rewrite-1',
    );
    const success = createPageArchiveRewriteResponse('<html>offline</html>', 3, 'rewrite-1');
    const failure = createPageArchiveRewriteError(
      createCaptureError('unexpected-error'),
      'rewrite-2',
    );

    expect(isPageArchiveRewriteRequest(request)).toBe(true);
    expect(isPageArchiveRewriteResponse(success)).toBe(true);
    expect(isPageArchiveRewriteResponse(failure)).toBe(true);
    expect(success).toMatchObject({ payload: { ok: true, rewrittenCount: 3 } });
  });

  it('adds protocol v18 and a correlation ID to requests', () => {
    const request = createPageInfoRequest(42, 1_500, 'request-42');

    expect(request).toEqual({
      protocolVersion: MESSAGE_PROTOCOL_VERSION,
      correlationId: 'request-42',
      type: 'page-info/request',
      payload: { tabId: 42, renderWaitMs: 1_500 },
    });
    expect(isPageInfoRequest(request)).toBe(true);
  });

  it('passes the browser tab URL to content and creates unique default correlation IDs', () => {
    expect(
      createPageInfoCollectRequest('https://example.com/requested', 1_500, 'collect-1'),
    ).toEqual({
      protocolVersion: MESSAGE_PROTOCOL_VERSION,
      correlationId: 'collect-1',
      type: 'page-info/collect',
      payload: { tabUrl: 'https://example.com/requested', renderWaitMs: 1_500 },
    });

    expect(createPageInfoRequest(42).payload.renderWaitMs).toBe(DEFAULT_RENDER_WAIT_MS);

    const correlationIds = Array.from({ length: 20 }, () => createCorrelationId());
    expect(correlationIds.every((correlationId) => correlationId.length > 0)).toBe(true);
    expect(new Set(correlationIds).size).toBe(correlationIds.length);
  });

  it('rejects unsupported versions and malformed payloads', () => {
    expect(
      isPageInfoRequest({
        ...createPageInfoRequest(42),
        protocolVersion: MESSAGE_PROTOCOL_VERSION + 1,
      }),
    ).toBe(false);
    expect(
      isPageInfoRequest({
        ...createPageInfoRequest(42),
        payload: { tabId: '42' },
      }),
    ).toBe(false);
  });

  it('preserves correlation IDs across successful and failed responses', () => {
    const success = createPageInfoResponse(page, 'request-success');
    const failure = createPageInfoError(
      createCaptureError('content-script-unresponsive'),
      'request-failure',
    );

    expect(success.correlationId).toBe('request-success');
    expect(failure.correlationId).toBe('request-failure');
    expect(failure.payload).toMatchObject({
      ok: false,
      error: { code: 'content-script-unresponsive', retryable: true },
    });
    expect(isPageInfoResponse(success)).toBe(true);
    expect(isPageInfoResponse(failure)).toBe(true);
    expect(
      isPageInfoResponse({
        ...success,
        payload: { ok: true, page: { ...page, title: 1 } },
      }),
    ).toBe(false);
  });
});

describe('capture job messaging protocol', () => {
  const settings: CaptureSettings = {
    archiveFileName: 'example.zip',
    renderWaitMs: 1_000,
    maxConcurrentRequests: 4,
    includeMedia: true,
    includeScripts: true,
    includeThirdPartyResources: false,
    autoScroll: false,
    maxDepth: 0,
    maxPages: 1,
    allowedUrlPatterns: [],
    blockedUrlPatterns: [],
    maxFileSizeBytes: null,
    maxTotalSizeBytes: null,
  };
  const job: CaptureJob = {
    id: 'job-1',
    tabId: 7,
    startUrl: 'https://example.com/',
    mode: 'current-page',
    profile: 'standard',
    status: 'idle',
    settings,
    counters: {
      pagesDiscovered: 0,
      pagesCaptured: 0,
      resourcesDiscovered: 0,
      resourcesSaved: 0,
      resourcesFailed: 0,
      resourcesSkipped: 0,
      bytesWritten: 0,
    },
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };

  it('defines versioned create, control, and query requests', () => {
    const createRequest = createCaptureJobCreateRequest(
      {
        tabId: 7,
        startUrl: 'https://example.com',
        mode: 'current-page',
        profile: 'standard',
        settings,
      },
      'create-1',
    );
    const controlRequest = createCaptureJobControlRequest('job-1', 'pause', 'control-1');
    const getRequest = createCaptureJobGetRequest('job-1', 'get-1');

    expect(createRequest.protocolVersion).toBe(MESSAGE_PROTOCOL_VERSION);
    expect(createRequest.payload.mode).toBe('current-page');
    expect(controlRequest).toMatchObject({
      protocolVersion: MESSAGE_PROTOCOL_VERSION,
      correlationId: 'control-1',
      type: 'capture-job/control',
      payload: { jobId: 'job-1', command: 'pause' },
    });
    expect(getRequest.payload).toEqual({ jobId: 'job-1' });
  });

  it('supports every capture job control command', () => {
    for (const command of CAPTURE_JOB_COMMANDS) {
      expect(createCaptureJobControlRequest(job.id, command, `control-${command}`)).toMatchObject({
        protocolVersion: MESSAGE_PROTOCOL_VERSION,
        correlationId: `control-${command}`,
        type: 'capture-job/control',
        payload: { jobId: job.id, command },
      });
    }
  });

  it('preserves correlation IDs across job responses and update events', () => {
    const success = createCaptureJobResponse(job, 'job-success');
    const failure = createCaptureJobError(createCaptureError('job-not-found'), 'job-failure');
    const update = createCaptureJobUpdatedEvent(job, 'job-update');

    expect(success).toMatchObject({
      protocolVersion: MESSAGE_PROTOCOL_VERSION,
      correlationId: 'job-success',
      type: 'capture-job/response',
      payload: { ok: true, job },
    });
    expect(failure).toMatchObject({
      correlationId: 'job-failure',
      type: 'capture-job/response',
      payload: { ok: false, error: { code: 'job-not-found', retryable: false } },
    });
    expect(update).toEqual({
      protocolVersion: MESSAGE_PROTOCOL_VERSION,
      correlationId: 'job-update',
      type: 'capture-job/updated',
      payload: { job },
    });
  });

  it('defines terminal result and chunk transfer messages', () => {
    const resultRequest = createCaptureJobResultGetRequest(job.id, 'result-get');
    const resultResponse = createCaptureJobResultResponse(
      {
        jobId: job.id,
        status: 'completed',
        fileName: job.settings.archiveFileName,
        archiveAvailable: true,
        archiveByteLength: 3,
        counters: job.counters,
        error: null,
        failures: [],
        omittedFailureCount: 0,
      },
      'result-get',
    );
    const chunkRequest = createCaptureArchiveChunkGetRequest(job.id, 0, 'chunk-get');
    const chunkResponse = createCaptureArchiveChunkResponse(
      {
        jobId: job.id,
        offset: 0,
        totalByteLength: 3,
        base64: 'AQID',
        done: true,
      },
      'chunk-get',
    );

    expect(resultRequest.type).toBe('capture-job/result-get');
    expect(resultResponse).toMatchObject({
      payload: { ok: true, result: { archiveByteLength: 3 } },
    });
    expect(chunkRequest.payload).toEqual({ jobId: job.id, offset: 0 });
    expect(chunkResponse).toMatchObject({ payload: { ok: true, base64: 'AQID', done: true } });
  });
});
