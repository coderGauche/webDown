import {
  CAPTURE_MODES,
  CAPTURE_PROFILES,
  JOB_STATUSES,
  RESOURCE_DISCOVERY_SOURCES,
  RESOURCE_STATES,
  RESOURCE_TYPES,
  type CaptureJob,
  type CaptureSettings,
  type ResourceRecord,
} from '@sitecapsule/domain';
import { describe, expect, expectTypeOf, it } from 'vitest';

const settings: CaptureSettings = {
  archiveFileName: 'sitecapsule-example.com.zip',
  renderWaitMs: 1_500,
  maxConcurrentRequests: 6,
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

const job: CaptureJob = {
  id: 'job-1',
  tabId: 42,
  startUrl: 'https://example.com/',
  mode: 'current-page',
  profile: 'standard',
  status: 'idle',
  settings,
  counters: {
    pagesDiscovered: 1,
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

const resource: ResourceRecord = {
  id: 'resource-1',
  jobId: job.id,
  originalUrl: 'https://example.com/styles.css',
  referrerUrl: job.startUrl,
  type: 'stylesheet',
  discoverySources: ['dom'],
  state: 'discovered',
};

describe('capture domain model', () => {
  it('publishes the supported capture vocabulary', () => {
    expect(CAPTURE_MODES).toEqual(['current-page', 'site-crawl']);
    expect(CAPTURE_PROFILES).toEqual(['standard', 'deep']);
    expect(JOB_STATUSES).toContain('packaging');
    expect(RESOURCE_TYPES).toContain('wasm');
    expect(RESOURCE_STATES).toEqual([
      'discovered',
      'queued',
      'fetching',
      'saved',
      'failed',
      'skipped',
    ]);
    expect(RESOURCE_DISCOVERY_SOURCES).toContain('performance');
  });

  it('keeps job settings, counters, and resource ownership explicit', () => {
    expectTypeOf(job).toMatchTypeOf<CaptureJob>();
    expectTypeOf(resource).toMatchTypeOf<ResourceRecord>();
    expect(job.settings.maxConcurrentRequests).toBe(6);
    expect(resource.jobId).toBe(job.id);
    expect(resource.discoverySources).toEqual(['dom']);
  });
});
