import 'fake-indexeddb/auto';

import type { CaptureSettings, JobStatus } from '@sitecapsule/domain';
import { CAPTURE_PIPELINE_STAGES, runCapturePipeline } from '@sitecapsule/jobs';
import { JobRepository, SiteCapsuleDatabase } from '@sitecapsule/storage';
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
    expect(await repository.getJob(created.id)).toMatchObject({ status: 'failed' });
  });
});
