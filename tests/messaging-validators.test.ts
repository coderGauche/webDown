import { createCaptureError, type CaptureJob, type CaptureSettings } from '@sitecapsule/domain';
import {
  MESSAGE_PROTOCOL_VERSION,
  createCaptureJobControlRequest,
  createCaptureJobCreateRequest,
  createCaptureJobError,
  createCaptureJobGetRequest,
  createCaptureJobResponse,
  createCaptureJobUpdatedEvent,
  createPageInfoCollectRequest,
  createPageInfoError,
  createPageInfoRequest,
  createPageInfoResponse,
} from '@sitecapsule/messaging/protocol';
import {
  isCaptureJob,
  isCaptureJobControlRequest,
  isCaptureJobCreateRequest,
  isCaptureJobGetRequest,
  isCaptureJobResponse,
  isCaptureJobUpdatedEvent,
  isPageInfoCollectRequest,
  isPageInfoRequest,
  isPageInfoResponse,
  isProtocolMessageEnvelope,
  isSiteCapsuleEvent,
  isSiteCapsuleMessage,
  isSiteCapsuleRequest,
  isSiteCapsuleResponse,
} from '@sitecapsule/messaging/validators';
import { describe, expect, it } from 'vitest';

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
    pagesDiscovered: 1,
    pagesCaptured: 0,
    resourcesDiscovered: 3,
    resourcesSaved: 0,
    resourcesFailed: 0,
    resourcesSkipped: 0,
    bytesWritten: 0,
  },
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:01.000Z',
};

const createInput = {
  tabId: job.tabId,
  startUrl: job.startUrl,
  mode: job.mode,
  profile: job.profile,
  settings,
};

const pageInfo = {
  title: 'Example',
  tabUrl: 'https://example.com/requested',
  baseUrl: 'https://cdn.example.com/assets/',
  finalUrl: job.startUrl,
};

describe('message runtime validation', () => {
  it('accepts every v3 request, response, and event shape', () => {
    const requests = [
      createPageInfoRequest(7, 'page-request'),
      createPageInfoCollectRequest(pageInfo.tabUrl, 'page-collect'),
      createCaptureJobCreateRequest(createInput, 'job-create'),
      createCaptureJobControlRequest(job.id, 'pause', 'job-control'),
      createCaptureJobGetRequest(job.id, 'job-get'),
    ];
    const responses = [
      createPageInfoResponse(pageInfo, 'page-success'),
      createPageInfoError(createCaptureError('content-script-unresponsive'), 'page-error'),
      createCaptureJobResponse(job, 'job-success'),
      createCaptureJobError(createCaptureError('job-not-found'), 'job-error'),
    ];
    const events = [createCaptureJobUpdatedEvent(job, 'job-updated')];

    expect(requests.every(isSiteCapsuleRequest)).toBe(true);
    expect(responses.every(isSiteCapsuleResponse)).toBe(true);
    expect(events.every(isSiteCapsuleEvent)).toBe(true);
    expect([...requests, ...responses, ...events].every(isSiteCapsuleMessage)).toBe(true);

    expect(isPageInfoRequest(requests[0])).toBe(true);
    expect(isPageInfoCollectRequest(requests[1])).toBe(true);
    expect(isCaptureJobCreateRequest(requests[2])).toBe(true);
    expect(isCaptureJobControlRequest(requests[3])).toBe(true);
    expect(isCaptureJobGetRequest(requests[4])).toBe(true);
    expect(isPageInfoResponse(responses[0])).toBe(true);
    expect(isCaptureJobResponse(responses[2])).toBe(true);
    expect(isCaptureJobUpdatedEvent(events[0])).toBe(true);
  });

  it('rejects invalid protocol envelopes before inspecting payloads', () => {
    const valid = createPageInfoRequest(7, 'request-7');
    const invalidEnvelopes = [
      null,
      [],
      { ...valid, protocolVersion: MESSAGE_PROTOCOL_VERSION + 1 },
      { ...valid, correlationId: '   ' },
      { ...valid, type: 'unknown/request' },
      { ...valid, unexpected: true },
      { protocolVersion: MESSAGE_PROTOCOL_VERSION, correlationId: 'missing-fields' },
    ];

    for (const message of invalidEnvelopes) {
      expect(isProtocolMessageEnvelope(message)).toBe(false);
      expect(isSiteCapsuleMessage(message)).toBe(false);
    }
  });

  it('rejects malformed or over-posted request payloads', () => {
    const invalidRequests = [
      { ...createPageInfoRequest(7), payload: { tabId: -1 } },
      { ...createPageInfoRequest(7), payload: { tabId: 7, url: 'https://attacker.test' } },
      {
        ...createPageInfoCollectRequest(pageInfo.tabUrl),
        payload: { tabUrl: 'not-an-absolute-url' },
      },
      {
        ...createPageInfoCollectRequest(pageInfo.tabUrl),
        payload: { tabUrl: pageInfo.tabUrl, unexpected: true },
      },
      {
        ...createCaptureJobCreateRequest(createInput),
        payload: { ...createInput, mode: 'unrestricted-crawl' },
      },
      {
        ...createCaptureJobCreateRequest(createInput),
        payload: {
          ...createInput,
          settings: { ...settings, maxConcurrentRequests: 0 },
        },
      },
      {
        ...createCaptureJobControlRequest(job.id, 'pause'),
        payload: { jobId: job.id, command: 'start' },
      },
      { ...createCaptureJobGetRequest(job.id), payload: { jobId: '' } },
    ];

    for (const message of invalidRequests) {
      expect(isSiteCapsuleRequest(message)).toBe(false);
      expect(isSiteCapsuleMessage(message)).toBe(false);
    }
  });

  it('rejects invalid response unions and damaged capture jobs', () => {
    const pausedJob = { ...job, status: 'paused', resumeStatus: 'fetching' };
    expect(isCaptureJob(pausedJob)).toBe(true);

    const invalidJobs = [
      { ...job, status: 'unknown' },
      { ...job, status: 'paused' },
      { ...job, resumeStatus: 'fetching' },
      { ...pausedJob, resumeStatus: 'idle' },
      { ...job, counters: { ...job.counters, resourcesSaved: -1 } },
      { ...job, settings: { ...settings, maxTotalSizeBytes: 0 } },
      { ...job, updatedAt: 'not-a-timestamp' },
      { ...job, unexpected: true },
    ];

    for (const invalidJob of invalidJobs) {
      expect(isCaptureJob(invalidJob)).toBe(false);
      expect(
        isCaptureJobResponse({
          ...createCaptureJobResponse(job),
          payload: { ok: true, job: invalidJob },
        }),
      ).toBe(false);
    }

    expect(
      isPageInfoResponse({
        ...createPageInfoResponse(pageInfo),
        payload: { ok: true, page: pageInfo, error: 'mixed' },
      }),
    ).toBe(false);
    expect(
      isPageInfoResponse({
        ...createPageInfoResponse(pageInfo),
        payload: {
          ok: true,
          page: { title: 'Legacy', url: job.startUrl },
        },
      }),
    ).toBe(false);
    expect(
      isPageInfoResponse({
        ...createPageInfoResponse(pageInfo),
        payload: {
          ok: true,
          page: { ...pageInfo, baseUrl: './assets/' },
        },
      }),
    ).toBe(false);
    expect(
      isCaptureJobResponse({
        ...createCaptureJobError(createCaptureError('job-not-found')),
        payload: {
          ok: false,
          error: { ...createCaptureError('job-not-found'), message: '' },
        },
      }),
    ).toBe(false);
    expect(
      isCaptureJobUpdatedEvent({
        ...createCaptureJobUpdatedEvent(job),
        payload: { job: invalidJobs[0] },
      }),
    ).toBe(false);
  });
});
