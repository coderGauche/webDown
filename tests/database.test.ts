import 'fake-indexeddb/auto';

import type { CaptureJob, CaptureSettings, ResourceRecord } from '@sitecapsule/domain';
import {
  DATABASE_SCHEMA,
  DATABASE_SCHEMA_VERSION,
  SiteCapsuleDatabase,
} from '@sitecapsule/storage';
import { afterEach, describe, expect, it } from 'vitest';

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

function createJob(
  id: string,
  status: Exclude<CaptureJob['status'], 'paused'>,
  updatedAt: string,
): CaptureJob {
  return {
    id,
    tabId: 7,
    startUrl: `https://${id}.example.com/`,
    mode: 'current-page',
    profile: 'standard',
    status,
    settings,
    counters: {
      pagesDiscovered: 1,
      pagesCaptured: 0,
      resourcesDiscovered: 1,
      resourcesSaved: 0,
      resourcesFailed: 0,
      resourcesSkipped: 0,
      bytesWritten: 0,
    },
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt,
  };
}

function createResource(id: string, jobId: string, state: ResourceRecord['state']): ResourceRecord {
  return {
    id,
    jobId,
    originalUrl: `https://cdn.example.com/${id}.css`,
    referrerUrl: `https://${jobId}.example.com/`,
    type: 'stylesheet',
    discoverySources: ['dom'],
    state,
  };
}

let database: SiteCapsuleDatabase | undefined;

afterEach(async () => {
  if (database) {
    await database.delete();
    database = undefined;
  }
});

describe('SiteCapsule IndexedDB schema', () => {
  it('opens schema v1 with the expected tables and indexes', async () => {
    database = new SiteCapsuleDatabase(`sitecapsule-schema-${crypto.randomUUID()}`);
    await database.open();

    expect(database.verno).toBe(DATABASE_SCHEMA_VERSION);
    expect(database.tables.map((table) => table.name).sort()).toEqual(['jobs', 'resources']);
    expect(database.jobs.schema.primKey.name).toBe('id');
    expect(database.jobs.schema.indexes.map((index) => index.name)).toEqual([
      'status',
      'createdAt',
      'updatedAt',
      '[status+updatedAt]',
    ]);
    expect(database.resources.schema.primKey.name).toBe('id');
    expect(database.resources.schema.indexes.map((index) => index.name)).toEqual([
      'jobId',
      'state',
      'type',
      'originalUrl',
      '[jobId+state]',
      '[jobId+originalUrl]',
    ]);
    expect(DATABASE_SCHEMA).toEqual({
      jobs: 'id,status,createdAt,updatedAt,[status+updatedAt]',
      resources: 'id,jobId,state,type,originalUrl,[jobId+state],[jobId+originalUrl]',
    });
  });

  it('stores typed records and supports recovery-oriented indexes', async () => {
    const databaseName = `sitecapsule-records-${crypto.randomUUID()}`;
    database = new SiteCapsuleDatabase(databaseName);

    await database.jobs.bulkAdd([
      createJob('job-1', 'fetching', '2026-07-23T00:00:02.000Z'),
      createJob('job-2', 'completed', '2026-07-23T00:00:03.000Z'),
    ]);
    await database.resources.bulkAdd([
      createResource('resource-1', 'job-1', 'saved'),
      createResource('resource-2', 'job-1', 'failed'),
      createResource('resource-3', 'job-2', 'saved'),
    ]);

    expect(await database.jobs.where('status').equals('fetching').primaryKeys()).toEqual(['job-1']);
    expect(
      await database.resources.where('[jobId+state]').equals(['job-1', 'saved']).primaryKeys(),
    ).toEqual(['resource-1']);

    database.close();
    database = new SiteCapsuleDatabase(databaseName);

    expect((await database.jobs.get('job-1'))?.status).toBe('fetching');
    expect(await database.resources.where('jobId').equals('job-1').count()).toBe(2);
  });
});
