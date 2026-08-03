import 'fake-indexeddb/auto';

import { createZipArchiveSync, enforceArchiveOfflineIntegritySync } from '@sitecapsule/archive';
import { createCaptureError, type CaptureSettings, type JobStatus } from '@sitecapsule/domain';
import { cancelConcurrentQueue, pauseConcurrentQueue } from '@sitecapsule/download';
import { CAPTURE_PIPELINE_STAGES, runCapturePipeline } from '@sitecapsule/jobs';
import { JobRepository, SiteCapsuleDatabase } from '@sitecapsule/storage';
import { DOMParser as LinkedomDOMParser } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const settings: CaptureSettings = {
  archiveFileName: 'pipeline.zip',
  renderWaitMs: 0,
  maxConcurrentRequests: 3,
  includeMedia: false,
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

let database: SiteCapsuleDatabase;
let repository: JobRepository;

beforeEach(() => {
  database = new SiteCapsuleDatabase(`sitecapsule-pipeline-${crypto.randomUUID()}`);
  let time = 0;
  repository = new JobRepository(database, {
    createId: () => 'pipeline-job',
    now: () => new Date(Date.UTC(2026, 6, 29, 0, 0, time++)).toISOString(),
  });
});

afterEach(async () => {
  await database.delete();
});

describe('capture pipeline coordinator', () => {
  it('persists and publishes real stage work in order without timers', async () => {
    const created = await repository.createJob({
      tabId: 7,
      startUrl: 'https://example.com/',
      mode: 'current-page',
      profile: 'standard',
      settings,
    });
    const handled: string[] = [];
    const published: JobStatus[] = [];
    const final = await runCapturePipeline({
      jobId: created.id,
      context: { discovered: 0 },
      repository,
      handlers: {
        preparing: ({ context }) => {
          handled.push('preparing');
          context.discovered = 1;
        },
        discovering: async ({ context, report }) => {
          handled.push('discovering');
          await report({
            pagesDiscovered: context.discovered,
            pagesCaptured: 1,
            resourcesDiscovered: 4,
          });
        },
        fetching: async ({ report }) => {
          handled.push('fetching');
          await report({ resourcesSaved: 3, resourcesFailed: 1, bytesWritten: 512 });
        },
        rewriting: () => {
          handled.push('rewriting');
        },
        packaging: () => {
          handled.push('packaging');
        },
      },
      onJobUpdated: (job) => {
        published.push(job.status);
      },
    });

    expect(handled).toEqual(CAPTURE_PIPELINE_STAGES);
    expect(published.filter((status, index) => status !== published[index - 1])).toEqual([
      ...CAPTURE_PIPELINE_STAGES,
      'completed',
    ]);
    expect(final).toMatchObject({
      status: 'completed',
      counters: {
        pagesDiscovered: 1,
        pagesCaptured: 1,
        resourcesDiscovered: 4,
        resourcesSaved: 3,
        resourcesFailed: 1,
        bytesWritten: 512,
      },
    });
    expect(await repository.getJob(created.id)).toEqual(final);
  });

  it('persists failed and returns a structured stage error', async () => {
    const created = await repository.createJob({
      tabId: 7,
      startUrl: 'https://example.com/',
      mode: 'current-page',
      profile: 'standard',
      settings,
    });

    await expect(
      runCapturePipeline({
        jobId: created.id,
        context: {},
        repository,
        handlers: {
          preparing: () => undefined,
          discovering: () => undefined,
          fetching: () => undefined,
          rewriting: () => {
            throw new Error('raw implementation detail');
          },
          packaging: () => undefined,
        },
      }),
    ).rejects.toMatchObject({
      details: {
        code: 'unexpected-error',
        context: {
          operation: 'job-update',
          jobId: created.id,
          stage: 'rewriting',
        },
      },
    });
    expect(await repository.getJob(created.id)).toMatchObject({
      status: 'failed',
      error: {
        code: 'unexpected-error',
        context: {
          operation: 'job-update',
          jobId: created.id,
          stage: 'rewriting',
        },
      },
    });
  });

  it('cannot transition from packaging to completed when the final ZIP fails offline integrity', async () => {
    const created = await repository.createJob({
      tabId: 7,
      startUrl: 'https://example.com/',
      mode: 'current-page',
      profile: 'standard',
      settings,
    });
    const archiveBytes = createZipArchiveSync([
      {
        path: 'index.html',
        bytes: new TextEncoder().encode('<img src="assets/images/missing.png">'),
      },
    ]);

    await expect(
      runCapturePipeline({
        jobId: created.id,
        context: {},
        repository,
        handlers: {
          preparing: () => undefined,
          discovering: () => undefined,
          fetching: () => undefined,
          rewriting: () => undefined,
          packaging: () => {
            enforceArchiveOfflineIntegritySync({
              archiveBytes,
              jobId: created.id,
              parser: {
                parseFromString(input, mimeType) {
                  return new LinkedomDOMParser().parseFromString(
                    input,
                    mimeType,
                  ) as unknown as Document;
                },
              },
            });
          },
        },
      }),
    ).rejects.toMatchObject({
      details: { code: 'archive-integrity-failed' },
    });
    expect(await repository.getJob(created.id)).toMatchObject({
      status: 'failed',
      error: { code: 'archive-integrity-failed' },
    });
  });

  it('pauses cooperatively and resumes from the persisted interrupted stage', async () => {
    const created = await repository.createJob({
      tabId: 7,
      startUrl: 'https://example.com/',
      mode: 'current-page',
      profile: 'standard',
      settings,
    });
    const pauseController = new AbortController();
    const firstRunStages: string[] = [];
    const paused = await runCapturePipeline({
      jobId: created.id,
      context: {},
      repository,
      signal: pauseController.signal,
      handlers: {
        preparing: () => {
          firstRunStages.push('preparing');
        },
        discovering: () => {
          firstRunStages.push('discovering');
        },
        fetching: () => {
          firstRunStages.push('fetching');
          pauseConcurrentQueue(pauseController);
        },
        rewriting: () => {
          firstRunStages.push('rewriting');
        },
        packaging: () => {
          firstRunStages.push('packaging');
        },
      },
    });

    expect(firstRunStages).toEqual(['preparing', 'discovering', 'fetching']);
    expect(paused).toMatchObject({ status: 'paused', resumeStatus: 'fetching' });

    const resumedStages: string[] = [];
    const resumed = await runCapturePipeline({
      jobId: created.id,
      context: {},
      repository,
      handlers: {
        preparing: () => {
          resumedStages.push('preparing');
        },
        discovering: () => {
          resumedStages.push('discovering');
        },
        fetching: () => {
          resumedStages.push('fetching');
        },
        rewriting: () => {
          resumedStages.push('rewriting');
        },
        packaging: () => {
          resumedStages.push('packaging');
        },
      },
    });

    expect(resumedStages).toEqual(['fetching', 'rewriting', 'packaging']);
    expect(resumed.status).toBe('completed');
  });

  it('persists cancelling and cancelled instead of converting an abort to failed', async () => {
    const created = await repository.createJob({
      tabId: 7,
      startUrl: 'https://example.com/',
      mode: 'current-page',
      profile: 'standard',
      settings,
    });
    const controller = new AbortController();
    const published: JobStatus[] = [];
    const cancelled = await runCapturePipeline({
      jobId: created.id,
      context: {},
      repository,
      signal: controller.signal,
      handlers: {
        preparing: () => {
          cancelConcurrentQueue(controller);
        },
        discovering: () => undefined,
        fetching: () => undefined,
        rewriting: () => undefined,
        packaging: () => undefined,
      },
      onJobUpdated: (job) => {
        published.push(job.status);
      },
    });

    expect(cancelled.status).toBe('cancelled');
    expect(published).toEqual(['preparing', 'cancelling', 'cancelled']);
    expect(await repository.getJob(created.id)).toMatchObject({ status: 'cancelled' });
  });

  it('restarts a persisted retrying job from preparing', async () => {
    const created = await repository.createJob({
      tabId: 7,
      startUrl: 'https://example.com/',
      mode: 'current-page',
      profile: 'standard',
      settings,
    });
    await repository.updateJob(created.id, { status: 'preparing' });
    await repository.updateJob(created.id, {
      status: 'failed',
      error: createCaptureError('network-request-failed', { operation: 'resource-download' }),
    });
    const retrying = await repository.updateJob(created.id, { status: 'retrying' });
    expect(retrying).not.toHaveProperty('error');
    const handled: string[] = [];

    const completed = await runCapturePipeline({
      jobId: created.id,
      context: {},
      repository,
      handlers: {
        preparing: () => {
          handled.push('preparing');
        },
        discovering: () => {
          handled.push('discovering');
        },
        fetching: () => {
          handled.push('fetching');
        },
        rewriting: () => {
          handled.push('rewriting');
        },
        packaging: () => {
          handled.push('packaging');
        },
      },
    });

    expect(handled).toEqual(CAPTURE_PIPELINE_STAGES);
    expect(completed.status).toBe('completed');
  });
});
