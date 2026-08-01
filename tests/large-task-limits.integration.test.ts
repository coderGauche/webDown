import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createArchiveLayoutZipSync,
  extractZipArchiveSync,
  type ZipArchiveEntry,
} from '@sitecapsule/archive';
import { type ResourceRecord } from '@sitecapsule/domain';
import {
  TaskByteBudget,
  consumeResourceBodyWithLimits,
  runResourceDownloadBatch,
  type ResourceDownloadWorker,
} from '@sitecapsule/download';
import { afterAll, describe, expect, it } from 'vitest';

import {
  LARGE_RESOURCE_CHUNK_BYTES,
  LargeResourceHttpFixture,
  type LargeResourceRoute,
} from './fixtures/large-resource-http';

const KIB = 1024;
const MIB = 1024 * KIB;
const FIXTURE_ORIGIN = 'https://large-fixture.test';
const audit: Record<string, unknown> = {};
const auditPath = resolve(process.cwd(), 'test-results/vitest/large-task-limit-audit.json');

function route(
  name: string,
  byteLength: number,
  declaredByteLength = byteLength,
  seed = 1,
): LargeResourceRoute {
  return {
    url: `${FIXTURE_ORIGIN}/${name}.bin`,
    byteLength,
    declaredByteLength,
    seed,
  };
}

function resource(input: LargeResourceRoute, index: number): ResourceRecord {
  return {
    id: index === 0 ? 'large-task:document' : `large-task:resource:${index}`,
    jobId: 'large-task',
    originalUrl: input.url,
    referrerUrl: `${FIXTURE_ORIGIN}/index.html`,
    type: index === 0 ? 'document' : 'other',
    discoverySources: ['dom'],
    state: 'queued',
  };
}

function createWorker(options: {
  fixture: LargeResourceHttpFixture;
  budget: TaskByteBudget;
  maxFileSizeBytes: number;
  retainedBodies?: Map<string, Uint8Array>;
}): ResourceDownloadWorker {
  return async (input, _index, signal) => {
    const response = options.fixture.fetch(input.originalUrl);
    const retainedChunks: Uint8Array[] = [];
    let byteLength = 0;
    const consumed = await consumeResourceBodyWithLimits(response, {
      budget: options.budget,
      maxFileSizeBytes: options.maxFileSizeBytes,
      signal,
      sink: {
        write: async (chunk) => {
          await Promise.resolve();
          if (options.retainedBodies) retainedChunks.push(chunk.slice());
          byteLength += chunk.byteLength;
          options.fixture.releaseChunk(chunk);
        },
        close: () => {
          if (!options.retainedBodies) return;
          const body = new Uint8Array(byteLength);
          let offset = 0;
          for (const chunk of retainedChunks) {
            body.set(chunk, offset);
            offset += chunk.byteLength;
          }
          options.retainedBodies.set(input.id, body);
          retainedChunks.length = 0;
        },
        abort: () => {
          retainedChunks.length = 0;
          byteLength = 0;
        },
      },
    });
    return {
      status: 'saved',
      resource: { ...input, state: 'saved', byteLength: consumed.byteLength },
    };
  };
}

function errorFields(result: Awaited<ReturnType<typeof runResourceDownloadBatch>>) {
  return result.results.flatMap((item) =>
    item.status === 'failed' ? [item.error.context?.field ?? 'unknown'] : [],
  );
}

afterAll(async () => {
  await mkdir(dirname(auditPath), { recursive: true });
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
});

describe('M9 large task limits', () => {
  it('bounds a concurrent lazy-stream workload by file, task, and active-chunk bytes', async () => {
    const maxFileSizeBytes = 1 * MIB;
    const maxTotalSizeBytes = 8 * MIB;
    const concurrency = 6;
    const regularRoutes = Array.from({ length: 32 }, (_, index) =>
      route(`regular-${index}`, 512 * KIB, 512 * KIB, index),
    );
    const underreported = route(
      'underreported',
      maxFileSizeBytes + LARGE_RESOURCE_CHUNK_BYTES,
      64 * KIB,
      201,
    );
    const declaredOversized = route(
      'declared-oversized',
      maxFileSizeBytes + 1,
      maxFileSizeBytes + 1,
      202,
    );
    const routes = [regularRoutes[0]!, underreported, declaredOversized, ...regularRoutes.slice(1)];
    const fixture = new LargeResourceHttpFixture(routes);
    const budget = new TaskByteBudget(maxTotalSizeBytes);
    const resources = routes.map(resource);

    const result = await runResourceDownloadBatch(
      resources,
      concurrency,
      createWorker({ fixture, budget, maxFileSizeBytes }),
      { primaryResourceId: resources[0]!.id },
    );

    const snapshot = fixture.snapshot();
    const fields = errorFields(result);
    expect(result.status).toBe('completed-with-errors');
    expect(result.fatalError).toBeNull();
    expect(result.counts).toEqual({
      total: 34,
      saved: 16,
      failed: 18,
      aborted: 0,
      notStarted: 0,
      bytesWritten: maxTotalSizeBytes,
    });
    expect(fields.filter((field) => field === 'maxFileSizeBytes')).toHaveLength(2);
    expect(fields.filter((field) => field === 'maxTotalSizeBytes')).toHaveLength(16);
    expect(snapshot.openedReaderUrls).not.toContain(declaredOversized.url);
    expect(snapshot.cancelledReaderUrls).toEqual([underreported.url]);
    expect(snapshot.bytesProduced).toBe(
      maxTotalSizeBytes + maxFileSizeBytes + LARGE_RESOURCE_CHUNK_BYTES,
    );
    expect(snapshot.activeChunkBytes).toBe(0);
    expect(snapshot.peakActiveChunkBytes).toBeLessThanOrEqual(
      concurrency * LARGE_RESOURCE_CHUNK_BYTES,
    );
    expect(budget.snapshot()).toEqual({
      maxBytes: maxTotalSizeBytes,
      committedBytes: maxTotalSizeBytes,
      reservedBytes: 0,
      availableBytes: 0,
    });

    audit.streaming = {
      concurrency,
      maxFileSizeBytes,
      maxTotalSizeBytes,
      counts: result.counts,
      failureFields: {
        maxFileSizeBytes: 2,
        maxTotalSizeBytes: 16,
      },
      budget: budget.snapshot(),
      fixture: snapshot,
      memoryEvidence: {
        kind: 'active-chunk-bytes',
        boundBytes: concurrency * LARGE_RESOURCE_CHUNK_BYTES,
        measuredPeakBytes: snapshot.peakActiveChunkBytes,
        processRssClaimed: false,
      },
    };
  });

  it('packages only budget-committed bodies and preserves the exact uncompressed byte ceiling', async () => {
    const maxFileSizeBytes = 256 * KIB;
    const maxTotalSizeBytes = 2 * MIB;
    const concurrency = 4;
    const routes = Array.from({ length: 9 }, (_, index) =>
      route(`archive-${index}`, maxFileSizeBytes, maxFileSizeBytes, 100 + index),
    );
    const fixture = new LargeResourceHttpFixture(routes);
    const budget = new TaskByteBudget(maxTotalSizeBytes);
    const retainedBodies = new Map<string, Uint8Array>();
    const resources = routes.map(resource);

    const result = await runResourceDownloadBatch(
      resources,
      concurrency,
      createWorker({ fixture, budget, maxFileSizeBytes, retainedBodies }),
      { primaryResourceId: resources[0]!.id },
    );
    const failedIndexes = result.results.flatMap((item) =>
      item.status === 'failed' ? [item.index] : [],
    );
    const primaryBytes = retainedBodies.get(resources[0]!.id);
    if (!primaryBytes) throw new Error('Large archive fixture did not retain the primary body.');
    const assets: ZipArchiveEntry[] = result.results.flatMap((item) => {
      if (item.status !== 'saved' || item.primary) return [];
      const bytes = retainedBodies.get(item.resource.id);
      if (!bytes) throw new Error(`Saved large fixture body is missing: ${item.resource.id}`);
      return [
        {
          path: `assets/origins/https/dns-large-fixture.test/default/other/${item.index}.bin`,
          bytes,
        },
      ];
    });
    const archiveBytes = createArchiveLayoutZipSync(
      { indexHtml: primaryBytes, assets },
      { compressionLevel: 0 },
    );
    const extracted = extractZipArchiveSync(archiveBytes);
    const extractedBytes = extracted.reduce((total, entry) => total + entry.bytes.byteLength, 0);
    const retainedBytes = [...retainedBodies.values()].reduce(
      (total, bytes) => total + bytes.byteLength,
      0,
    );

    expect(result.status).toBe('completed-with-errors');
    expect(result.counts).toMatchObject({
      total: 9,
      saved: 8,
      failed: 1,
      bytesWritten: maxTotalSizeBytes,
    });
    expect(errorFields(result)).toEqual(['maxTotalSizeBytes']);
    expect(retainedBodies.size).toBe(8);
    expect(retainedBytes).toBe(maxTotalSizeBytes);
    expect(extracted).toHaveLength(8);
    expect(extractedBytes).toBe(maxTotalSizeBytes);
    expect(failedIndexes).toEqual([8]);
    expect(extracted.some((entry) => entry.path.endsWith('/8.bin'))).toBe(false);
    expect(budget.snapshot()).toMatchObject({
      committedBytes: maxTotalSizeBytes,
      reservedBytes: 0,
      availableBytes: 0,
    });
    expect(fixture.snapshot().activeChunkBytes).toBe(0);

    audit.archive = {
      concurrency,
      maxFileSizeBytes,
      maxTotalSizeBytes,
      counts: result.counts,
      failedIndexes,
      retainedBodyCount: retainedBodies.size,
      retainedBytes,
      archiveBytes: archiveBytes.byteLength,
      extractedEntryCount: extracted.length,
      extractedBytes,
      zipOverheadExcludedFromResourceBudget: true,
      budget: budget.snapshot(),
      fixture: fixture.snapshot(),
    };
  });
});
