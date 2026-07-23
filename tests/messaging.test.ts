import {
  MESSAGE_PROTOCOL_VERSION,
  createCaptureJobControlRequest,
  createCaptureJobCreateRequest,
  createCaptureJobGetRequest,
  createPageInfoError,
  createPageInfoRequest,
  createPageInfoResponse,
  isPageInfoRequest,
  isPageInfoResponse,
} from '@sitecapsule/messaging/protocol';
import { describe, expect, it } from 'vitest';

describe('page info messaging protocol', () => {
  it('adds the protocol version and correlation ID to requests', () => {
    const request = createPageInfoRequest(42, 'request-42');

    expect(request).toEqual({
      protocolVersion: MESSAGE_PROTOCOL_VERSION,
      correlationId: 'request-42',
      type: 'page-info/request',
      payload: { tabId: 42 },
    });
    expect(isPageInfoRequest(request)).toBe(true);
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
    const success = createPageInfoResponse(
      { title: 'Example', url: 'https://example.com' },
      'request-success',
    );
    const failure = createPageInfoError('Unavailable', 'request-failure');

    expect(success.correlationId).toBe('request-success');
    expect(failure.correlationId).toBe('request-failure');
    expect(isPageInfoResponse(success)).toBe(true);
    expect(isPageInfoResponse(failure)).toBe(true);
    expect(
      isPageInfoResponse({
        ...success,
        payload: { ok: true, page: { title: 1, url: 'https://example.com' } },
      }),
    ).toBe(false);
  });
});

describe('capture job messaging protocol', () => {
  const settings = {
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
});
