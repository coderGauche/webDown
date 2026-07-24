import { SiteCapsuleError, createCaptureError, type ResourceRecord } from '@sitecapsule/domain';
import {
  cancelConcurrentQueue,
  pauseConcurrentQueue,
  runResourceDownloadBatch,
  type ResourceDownloadWorkerResult,
} from '@sitecapsule/download';
import { describe, expect, it, vi } from 'vitest';

function resource(id: string, type: ResourceRecord['type'] = 'image'): ResourceRecord {
  return {
    id,
    jobId: 'job-1',
    originalUrl: `https://cdn.example.com/${id}`,
    referrerUrl: 'https://example.com/',
    type,
    discoverySources: ['dom'],
    state: 'queued',
  };
}

function saved(input: ResourceRecord, byteLength = 1): ResourceDownloadWorkerResult {
  return {
    status: 'saved',
    resource: {
      ...input,
      state: 'saved',
      localPath: `assets/${input.id}`,
      byteLength,
    },
  };
}

describe('resource download batch', () => {
  it('completes an all-success batch and returns job counter deltas', async () => {
    const resources = [resource('document', 'document'), resource('image')];
    const result = await runResourceDownloadBatch(
      resources,
      2,
      (input, index) => saved(input, index + 2),
      { primaryResourceId: 'document' },
    );

    expect(result.status).toBe('completed');
    expect(result.fatalError).toBeNull();
    expect(result.counts).toEqual({
      total: 2,
      saved: 2,
      failed: 0,
      aborted: 0,
      notStarted: 0,
      bytesWritten: 5,
    });
    expect(result.jobCounterDelta).toEqual({
      resourcesSaved: 2,
      resourcesFailed: 0,
      resourcesSkipped: 0,
      bytesWritten: 5,
    });
    expect(result.results.map((item) => item.status)).toEqual(['saved', 'saved']);
  });

  it('continues after secondary returned, synchronous, and asynchronous failures', async () => {
    const resources = [
      resource('document', 'document'),
      resource('returned'),
      resource('sync'),
      resource('async'),
      resource('last'),
    ];
    const started: string[] = [];
    const result = await runResourceDownloadBatch(
      resources,
      2,
      async (input) => {
        started.push(input.id);
        if (input.id === 'returned') {
          return {
            status: 'failed',
            error: createCaptureError('permission-denied'),
          };
        }
        if (input.id === 'sync') throw new Error('must not leak');
        if (input.id === 'async') return Promise.reject(new TypeError('must not leak'));
        return saved(input, 10);
      },
      { primaryResourceId: 'document' },
    );

    expect(started).toHaveLength(resources.length);
    expect(result.status).toBe('completed-with-errors');
    expect(result.counts).toMatchObject({ saved: 2, failed: 3, aborted: 0, notStarted: 0 });
    expect(result.results.map((item) => item.status)).toEqual([
      'saved',
      'failed',
      'failed',
      'failed',
      'saved',
    ]);
    const failures = result.results.filter((item) => item.status === 'failed');
    expect(failures.map(({ error }) => error.code)).toEqual([
      'permission-denied',
      'network-request-failed',
      'network-request-failed',
    ]);
    expect(JSON.stringify(failures)).not.toContain('must not leak');
    expect(failures.every((failure) => failure.fatal === false)).toBe(true);
  });

  it('keeps resource identity and counters stable when concurrent work finishes out of order', async () => {
    const resources = [resource('primary', 'document'), resource('fast'), resource('last')];
    let releasePrimary!: () => void;
    const primaryGate = new Promise<void>((resolve) => {
      releasePrimary = resolve;
    });
    const completionOrder: string[] = [];

    const result = await runResourceDownloadBatch(
      resources,
      2,
      async (input) => {
        if (input.id === 'primary') await primaryGate;
        if (input.id === 'fast') releasePrimary();
        completionOrder.push(input.id);
        return saved(input, input.id === 'fast' ? 4 : 3);
      },
      { primaryResourceId: 'primary' },
    );

    expect(completionOrder[0]).toBe('fast');
    expect(result.results.map(({ resource: item }) => item.id)).toEqual([
      'primary',
      'fast',
      'last',
    ]);
    expect(result.results.map((item) => item.primary)).toEqual([true, false, false]);
    expect(result.counts).toMatchObject({ saved: 3, failed: 0, bytesWritten: 10 });
  });

  it('marks primary failure as fatal while retaining completed secondary results', async () => {
    const resources = [resource('secondary'), resource('primary', 'document')];
    const result = await runResourceDownloadBatch(
      resources,
      2,
      (input) => {
        if (input.id === 'primary') {
          throw new SiteCapsuleError(
            createCaptureError('resource-limit-exceeded', {
              httpStatus: 413,
              field: 'maxFileSizeBytes',
            }),
          );
        }
        return saved(input, 12);
      },
      { primaryResourceId: 'primary' },
    );

    expect(result.status).toBe('failed');
    expect(result.counts).toMatchObject({ saved: 1, failed: 1 });
    expect(result.fatalError).toMatchObject({
      code: 'resource-limit-exceeded',
      context: {
        operation: 'resource-download',
        jobId: 'job-1',
        resourceId: 'primary',
        resourceType: 'document',
        httpStatus: 413,
        field: 'maxFileSizeBytes',
        affectsPrimaryVisual: true,
      },
    });
    expect(result.results[0]).toMatchObject({ status: 'saved', primary: false });
    expect(result.results[1]).toMatchObject({ status: 'failed', primary: true, fatal: true });
  });

  it('retains response metadata from a structured failed worker result', async () => {
    const primary = resource('primary', 'document');
    const result = await runResourceDownloadBatch(
      [primary],
      1,
      (input) => ({
        status: 'failed',
        resource: {
          ...input,
          state: 'fetching',
          finalUrl: 'https://static.example.com/final',
          httpStatus: 503,
          mimeType: 'text/html',
        },
        error: createCaptureError('network-request-failed', { httpStatus: 503 }),
      }),
      { primaryResourceId: primary.id },
    );

    expect(result.results[0]).toMatchObject({
      status: 'failed',
      resource: {
        state: 'failed',
        finalUrl: 'https://static.example.com/final',
        httpStatus: 503,
        mimeType: 'text/html',
        error: { code: 'network-request-failed' },
      },
    });
  });

  it('does not overwrite explicit visual impact on a secondary resource error', async () => {
    const resources = [resource('primary', 'document'), resource('stylesheet', 'stylesheet')];
    const result = await runResourceDownloadBatch(
      resources,
      1,
      (input) =>
        input.id === 'stylesheet'
          ? {
              status: 'failed',
              error: createCaptureError('network-request-failed', {
                affectsPrimaryVisual: true,
              }),
            }
          : saved(input),
      { primaryResourceId: 'primary' },
    );

    expect(result.results[1]).toMatchObject({
      status: 'failed',
      fatal: false,
      error: { context: { affectsPrimaryVisual: true } },
    });
  });

  it.each([
    ['pause', pauseConcurrentQueue, 'paused'],
    ['cancel', cancelConcurrentQueue, 'cancelled'],
  ] as const)(
    'keeps %s interruption distinct from resource failures',
    async (_kind, stop, status) => {
      const controller = new AbortController();
      const resources = [resource('primary', 'document'), resource('active'), resource('waiting')];
      const result = await runResourceDownloadBatch(
        resources,
        1,
        async (input, index, signal) => {
          if (index === 0) return saved(input);
          stop(controller);
          if (signal.aborted) throw signal.reason;
          return saved(input);
        },
        { primaryResourceId: 'primary', signal: controller.signal },
      );

      expect(result.status).toBe(status);
      expect(result.counts).toEqual({
        total: 3,
        saved: 1,
        failed: 0,
        aborted: 1,
        notStarted: 1,
        bytesWritten: 1,
      });
      expect(result.jobCounterDelta.resourcesFailed).toBe(0);
      expect(result.results.map((item) => item.status)).toEqual([
        'saved',
        'aborted',
        'not-started',
      ]);
      expect(result.results[1]?.resource.state).toBe('queued');
      expect(result.results[2]?.resource.state).toBe('queued');
    },
  );

  it('normalizes invalid worker output into an isolated unexpected failure', async () => {
    const resources = [resource('primary', 'document'), resource('bad')];
    const result = await runResourceDownloadBatch(
      resources,
      1,
      (input) =>
        input.id === 'bad'
          ? {
              status: 'saved',
              resource: { ...input, id: 'other', state: 'saved', byteLength: -1 },
            }
          : saved(input),
      { primaryResourceId: 'primary' },
    );

    expect(result.status).toBe('completed-with-errors');
    expect(result.results[1]).toMatchObject({
      status: 'failed',
      error: { code: 'unexpected-error' },
      fatal: false,
    });
  });

  it('rejects missing primary, duplicate IDs, and mixed-job input before starting work', async () => {
    const worker = vi.fn(() => saved(resource('unused')));
    await expect(
      runResourceDownloadBatch([resource('one')], 1, worker, { primaryResourceId: 'missing' }),
    ).rejects.toThrow('primary resource exactly once');
    await expect(
      runResourceDownloadBatch([resource('one'), resource('one')], 1, worker, {
        primaryResourceId: 'one',
      }),
    ).rejects.toThrow('duplicate IDs');
    await expect(
      runResourceDownloadBatch(
        [resource('one'), { ...resource('two'), jobId: 'job-2' }],
        1,
        worker,
        { primaryResourceId: 'one' },
      ),
    ).rejects.toThrow('one capture job');
    expect(worker).not.toHaveBeenCalled();
  });

  it('rejects unsafe aggregate byte counts rather than corrupting job counters', async () => {
    const resources = [resource('primary', 'document'), resource('other')];
    await expect(
      runResourceDownloadBatch(resources, 2, (input) => saved(input, Number.MAX_SAFE_INTEGER), {
        primaryResourceId: 'primary',
      }),
    ).rejects.toThrow('byte count exceeds');
  });
});
