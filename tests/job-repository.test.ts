import 'fake-indexeddb/auto';

import type { CaptureSettings, ResourceRecord } from '@sitecapsule/domain';
import { JobRepository, SiteCapsuleDatabase } from '@sitecapsule/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

const createInput = {
  tabId: 7,
  startUrl: 'https://example.com/',
  mode: 'current-page',
  profile: 'standard',
  settings,
} as const;

function createResource(id: string, jobId: string): ResourceRecord {
  return {
    id,
    jobId,
    originalUrl: `https://cdn.example.com/${id}.css`,
    referrerUrl: createInput.startUrl,
    type: 'stylesheet',
    discoverySources: ['dom'],
    state: 'saved',
  };
}

let database: SiteCapsuleDatabase;
let repository: JobRepository;
let idSequence: number;
let timeSequence: number;

beforeEach(() => {
  database = new SiteCapsuleDatabase(`sitecapsule-repository-${crypto.randomUUID()}`);
  idSequence = 0;
  timeSequence = 0;
  repository = new JobRepository(database, {
    createId: () => `job-${++idSequence}`,
    now: () => `2026-07-23T00:00:0${timeSequence++}.000Z`,
  });
});

afterEach(async () => {
  await database.delete();
});

describe('JobRepository', () => {
  it('creates and retrieves a complete idle capture job', async () => {
    const created = await repository.createJob(createInput);

    expect(created).toMatchObject({
      id: 'job-1',
      status: 'idle',
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z',
      counters: {
        pagesDiscovered: 0,
        pagesCaptured: 0,
        resourcesDiscovered: 0,
        resourcesSaved: 0,
        resourcesFailed: 0,
        resourcesSkipped: 0,
        bytesWritten: 0,
      },
    });
    expect(await repository.getJob(created.id)).toEqual(created);
  });

  it('maps IndexedDB constraint failures to a structured storage conflict', async () => {
    repository = new JobRepository(database, {
      createId: () => 'duplicate-job',
      now: () => '2026-07-23T00:00:00.000Z',
    });
    await repository.createJob(createInput);

    await expect(repository.createJob(createInput)).rejects.toMatchObject({
      details: {
        code: 'storage-conflict',
        retryable: true,
        context: { operation: 'job-create', browserError: 'ConstraintError' },
      },
    });
  });

  it('updates counters and status atomically through legal transitions', async () => {
    const created = await repository.createJob(createInput);
    const preparing = await repository.updateJob(created.id, {
      status: 'preparing',
      counters: { pagesDiscovered: 1 },
    });
    const paused = await repository.updateJob(created.id, { status: 'paused' });
    const resumed = await repository.updateJob(created.id, {
      status: 'preparing',
      counters: { resourcesDiscovered: 4 },
    });

    expect(preparing).toMatchObject({
      status: 'preparing',
      updatedAt: '2026-07-23T00:00:01.000Z',
      counters: { pagesDiscovered: 1 },
    });
    expect(paused).toMatchObject({ status: 'paused', resumeStatus: 'preparing' });
    expect(resumed).toMatchObject({
      status: 'preparing',
      counters: { pagesDiscovered: 1, resourcesDiscovered: 4 },
    });
    expect('resumeStatus' in (resumed ?? {})).toBe(false);
  });

  it('rejects an illegal transition without changing the stored job', async () => {
    const created = await repository.createJob(createInput);

    await expect(repository.updateJob(created.id, { status: 'completed' })).rejects.toMatchObject({
      details: {
        code: 'invalid-job-transition',
        context: { operation: 'job-transition', stage: 'idle', targetStage: 'completed' },
      },
    });
    await expect(
      repository.updateJob(created.id, { counters: { resourcesSaved: -1 } }),
    ).rejects.toMatchObject({
      details: {
        code: 'invalid-job-counter',
        context: {
          operation: 'job-counter-update',
          jobId: created.id,
          field: 'resourcesSaved',
        },
      },
    });
    expect(await repository.getJob(created.id)).toEqual(created);
  });

  it('queries jobs by status and recovers non-terminal jobs after reopening', async () => {
    const first = await repository.createJob(createInput);
    const second = await repository.createJob({
      ...createInput,
      startUrl: 'https://second.example.com/',
    });
    await repository.updateJob(first.id, { status: 'preparing' });
    await repository.updateJob(second.id, { status: 'preparing' });
    await repository.updateJob(second.id, { status: 'discovering' });
    await repository.updateJob(second.id, { status: 'fetching' });
    await repository.updateJob(second.id, { status: 'rewriting' });
    await repository.updateJob(second.id, { status: 'packaging' });
    await repository.updateJob(second.id, { status: 'completed' });

    expect((await repository.listJobs({ statuses: ['preparing'] })).map((job) => job.id)).toEqual([
      first.id,
    ]);
    expect(await repository.listJobs({ limit: -1 })).toEqual([]);

    const databaseName = database.name;
    database.close();
    database = new SiteCapsuleDatabase(databaseName);
    repository = new JobRepository(database);

    expect((await repository.listRecoverableJobs()).map((job) => job.id)).toEqual([first.id]);
  });

  it('deletes one job together with its associated resources', async () => {
    const first = await repository.createJob(createInput);
    const second = await repository.createJob(createInput);
    await database.resources.bulkAdd([
      createResource('resource-1', first.id),
      createResource('resource-2', first.id),
      createResource('resource-3', second.id),
    ]);

    expect(await repository.deleteJob(first.id)).toBe(true);
    expect(await repository.deleteJob('missing-job')).toBe(false);
    expect(await repository.getJob(first.id)).toBeUndefined();
    expect(await database.resources.where('jobId').equals(first.id).count()).toBe(0);
    expect(await database.resources.where('jobId').equals(second.id).count()).toBe(1);
  });

  it('clears eligible terminal jobs and can clear all remaining records', async () => {
    const oldCompleted = await repository.createJob(createInput);
    const active = await repository.createJob(createInput);
    const recentCompleted = await repository.createJob(createInput);

    await database.jobs.update(oldCompleted.id, {
      status: 'completed',
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    await database.jobs.update(recentCompleted.id, {
      status: 'completed',
      updatedAt: '2026-07-23T00:00:00.000Z',
    });
    await database.resources.bulkAdd([
      createResource('resource-old', oldCompleted.id),
      createResource('resource-active', active.id),
      createResource('resource-recent', recentCompleted.id),
    ]);

    expect(await repository.clearTerminalJobs('2026-07-21T00:00:00.000Z')).toBe(1);
    expect(await repository.getJob(oldCompleted.id)).toBeUndefined();
    expect(await repository.getJob(active.id)).toBeDefined();
    expect(await repository.getJob(recentCompleted.id)).toBeDefined();
    expect(await database.resources.get('resource-old')).toBeUndefined();

    expect(await repository.clearAllJobs()).toBe(2);
    expect(await database.jobs.count()).toBe(0);
    expect(await database.resources.count()).toBe(0);
  });
});
