import {
  SiteCapsuleError,
  createCaptureError,
  type CaptureError,
  type ResourceRecord,
  type ResourceType,
} from '@sitecapsule/domain';
import {
  TaskByteBudget,
  applyResourceResponseMetadata,
  cancelConcurrentQueue,
  checkResourceNetworkAccess,
  checkResourceResponseNetworkPolicy,
  classifyResourceResponse,
  consumeResourceBodyWithLimits,
  createSecureResourceFetchInit,
  runRequestWithRetry,
  runResourceDownloadBatch,
  type ResourceDownloadWorker,
  type ResourceHttpFailure,
} from '@sitecapsule/download';
import { describe, expect, it } from 'vitest';

import {
  MULTI_ORIGIN_URLS,
  MultiOriginHttpFixture,
  type MultiOriginFixtureResponse,
} from './fixtures/multi-origin-http';

type PermissionContains = Parameters<typeof checkResourceNetworkAccess>[1];

function resource(id: string, url: string, type: ResourceType): ResourceRecord {
  return {
    id,
    jobId: 'integration-job',
    originalUrl: url,
    referrerUrl: MULTI_ORIGIN_URLS.primary,
    type,
    discoverySources: ['dom'],
    state: 'queued',
  };
}

function permissionChecker(patterns: readonly string[]): PermissionContains {
  const granted = new Set(patterns);
  return async ({ origins }) => origins.every((origin) => granted.has(origin));
}

function policyError(reason: string): CaptureError {
  return createCaptureError(
    reason === 'permission-denied' ? 'permission-denied' : 'network-request-failed',
  );
}

function memorySink(onClose: (bytes: Uint8Array) => void) {
  const chunks: Uint8Array[] = [];
  return {
    write: (chunk: Uint8Array) => {
      chunks.push(chunk.slice());
    },
    close: () => {
      const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      onClose(bytes);
    },
    abort: () => {
      chunks.length = 0;
    },
  };
}

function createIntegratedWorker(options: {
  fixture: MultiOriginHttpFixture;
  contains: PermissionContains;
  budget: TaskByteBudget;
  maxFileSizeBytes: number | null;
  savedBodies: Map<string, Uint8Array>;
  retryDelays: number[];
}): ResourceDownloadWorker {
  return async (input, _index, signal) => {
    const access = await checkResourceNetworkAccess(input.originalUrl, options.contains);
    if (access.status === 'blocked') {
      return { status: 'failed', error: policyError(access.reason) };
    }

    const request = await runRequestWithRetry(
      async ({ signal: attemptSignal }) => {
        const response = await options.fixture.fetch(
          access.url,
          createSecureResourceFetchInit(attemptSignal),
        );
        return classifyResourceResponse(access.url, response, {
          ...(response.redirectHops ? { redirectHops: response.redirectHops } : {}),
        });
      },
      {
        signal,
        timeoutMs: 1_000,
        maxRetries: 1,
        baseDelayMs: 1,
        maxDelayMs: 1_000,
        sleep: async (delayMs) => {
          options.retryDelays.push(delayMs);
        },
      },
    );

    if (request.status === 'aborted') throw request.reason;
    if (request.status === 'failed') {
      const failure = request.error as ResourceHttpFailure<MultiOriginFixtureResponse> | unknown;
      if (
        typeof failure === 'object' &&
        failure !== null &&
        'kind' in failure &&
        failure.kind === 'http-status' &&
        'metadata' in failure
      ) {
        const typedFailure = failure as ResourceHttpFailure<MultiOriginFixtureResponse>;
        return {
          status: 'failed',
          resource: applyResourceResponseMetadata(input, typedFailure.metadata),
          error: createCaptureError('network-request-failed', {
            httpStatus: typedFailure.metadata.httpStatus,
          }),
        };
      }
      return { status: 'failed', error: createCaptureError('network-request-failed') };
    }

    const inspected = request.value;
    const networkPolicy = await checkResourceResponseNetworkPolicy(
      inspected.metadata,
      options.contains,
    );
    if (networkPolicy.status === 'blocked') {
      return {
        status: 'failed',
        resource: applyResourceResponseMetadata(input, inspected.metadata),
        error: policyError(networkPolicy.target.reason),
      };
    }

    const responseRecord = applyResourceResponseMetadata(input, inspected.metadata);
    let savedBody: Uint8Array | undefined;
    const consumed = await consumeResourceBodyWithLimits(inspected.response, {
      budget: options.budget,
      maxFileSizeBytes: options.maxFileSizeBytes,
      signal,
      sink: memorySink((bytes) => {
        savedBody = bytes;
      }),
    });
    if (!savedBody) throw new Error('Fixture sink did not close.');
    options.savedBodies.set(input.id, savedBody);
    return {
      status: 'saved',
      resource: {
        ...responseRecord,
        state: 'saved',
        byteLength: consumed.byteLength,
      },
    };
  };
}

describe('M5 multi-origin download integration', () => {
  it('runs permissions, policy, retries, metadata, limits, concurrency, and aggregation together', async () => {
    const fixture = new MultiOriginHttpFixture();
    const savedBodies = new Map<string, Uint8Array>();
    const retryDelays: number[] = [];
    const contains = permissionChecker([
      'https://fixture-main.test/*',
      'https://fixture-cdn.test/*',
    ]);
    const resources = [
      resource('primary', MULTI_ORIGIN_URLS.primary, 'document'),
      resource('stylesheet', MULTI_ORIGIN_URLS.stylesheet, 'stylesheet'),
      resource('redirect', MULTI_ORIGIN_URLS.redirect, 'script'),
      resource('retry-429', MULTI_ORIGIN_URLS.retry429, 'other'),
      resource('retry-503', MULTI_ORIGIN_URLS.retry503, 'image'),
      resource('oversized', MULTI_ORIGIN_URLS.oversized, 'other'),
      resource('missing', MULTI_ORIGIN_URLS.missing, 'image'),
      resource('unauthorized', MULTI_ORIGIN_URLS.unauthorized, 'image'),
      resource('local', MULTI_ORIGIN_URLS.local, 'other'),
      resource('unsupported', MULTI_ORIGIN_URLS.unsupported, 'data'),
    ];

    const result = await runResourceDownloadBatch(
      resources,
      3,
      createIntegratedWorker({
        fixture,
        contains,
        budget: new TaskByteBudget(100),
        maxFileSizeBytes: 6,
        savedBodies,
        retryDelays,
      }),
      { primaryResourceId: 'primary' },
    );

    expect(result.status).toBe('completed-with-errors');
    expect(result.fatalError).toBeNull();
    expect(result.counts).toEqual({
      total: 10,
      saved: 5,
      failed: 5,
      aborted: 0,
      notStarted: 0,
      bytesWritten: 19,
    });
    expect(result.jobCounterDelta).toEqual({
      resourcesSaved: 5,
      resourcesFailed: 5,
      resourcesSkipped: 0,
      bytesWritten: 19,
    });
    expect(result.results.map(({ status }) => status)).toEqual([
      'saved',
      'saved',
      'saved',
      'saved',
      'saved',
      'failed',
      'failed',
      'failed',
      'failed',
      'failed',
    ]);

    const byId = new Map(result.results.map((item) => [item.resource.id, item]));
    expect(byId.get('redirect')?.resource).toMatchObject({
      finalUrl: MULTI_ORIGIN_URLS.redirectFinal,
      redirectTrace: {
        complete: true,
        hops: [
          {
            fromUrl: MULTI_ORIGIN_URLS.redirect,
            toUrl: MULTI_ORIGIN_URLS.redirectFinal,
            httpStatus: 302,
          },
        ],
      },
      httpStatus: 200,
      mimeType: 'application/javascript',
      state: 'saved',
      byteLength: 2,
    });
    expect(byId.get('missing')).toMatchObject({
      status: 'failed',
      resource: { state: 'failed', httpStatus: 404, mimeType: 'image/png' },
      error: { code: 'network-request-failed', context: { httpStatus: 404 } },
    });
    expect(byId.get('oversized')).toMatchObject({
      status: 'failed',
      error: { code: 'resource-limit-exceeded' },
    });
    expect(byId.get('unauthorized')).toMatchObject({
      status: 'failed',
      error: { code: 'permission-denied' },
    });
    expect(byId.get('local')).toMatchObject({
      status: 'failed',
      error: { code: 'network-request-failed' },
    });
    expect(byId.get('unsupported')).toMatchObject({
      status: 'failed',
      error: { code: 'network-request-failed' },
    });

    expect(fixture.attempts.get(MULTI_ORIGIN_URLS.retry429)).toBe(2);
    expect(fixture.attempts.get(MULTI_ORIGIN_URLS.retry503)).toBe(2);
    expect([...retryDelays].sort((left, right) => left - right)).toEqual([1, 1_000]);
    expect(fixture.peakConcurrentRequests).toBeGreaterThan(1);
    expect(fixture.peakConcurrentRequests).toBeLessThanOrEqual(3);
    expect(fixture.requestedUrls).not.toContain(MULTI_ORIGIN_URLS.unauthorized);
    expect(fixture.requestedUrls).not.toContain(MULTI_ORIGIN_URLS.local);
    expect(fixture.requestedUrls).not.toContain(MULTI_ORIGIN_URLS.unsupported);
    expect(fixture.requestInits).not.toHaveLength(0);
    expect(
      fixture.requestInits.every(
        (init) =>
          init.credentials === 'omit' &&
          init.referrerPolicy === 'no-referrer' &&
          init.redirect === 'follow' &&
          init.cache === 'no-store',
      ),
    ).toBe(true);
    expect([...savedBodies.keys()].sort()).toEqual([
      'primary',
      'redirect',
      'retry-429',
      'retry-503',
      'stylesheet',
    ]);
    expect(savedBodies.has('oversized')).toBe(false);
    expect(
      result.results.every(
        (item) =>
          item.resource.state === (item.status === 'saved' ? 'saved' : 'failed') &&
          (item.status !== 'saved' ||
            savedBodies.get(item.resource.id)?.byteLength === item.resource.byteLength),
      ),
    ).toBe(true);
  });

  it('keeps concurrent shared-budget reservations within the task total limit', async () => {
    const fixture = new MultiOriginHttpFixture();
    const savedBodies = new Map<string, Uint8Array>();
    const budget = new TaskByteBudget(7);
    const resources = [
      resource('primary', MULTI_ORIGIN_URLS.primary, 'document'),
      resource('stylesheet', MULTI_ORIGIN_URLS.stylesheet, 'stylesheet'),
      resource('retry-429', MULTI_ORIGIN_URLS.retry429, 'other'),
    ];
    const result = await runResourceDownloadBatch(
      resources,
      3,
      createIntegratedWorker({
        fixture,
        contains: permissionChecker(['https://fixture-main.test/*', 'https://fixture-cdn.test/*']),
        budget,
        maxFileSizeBytes: null,
        savedBodies,
        retryDelays: [],
      }),
      { primaryResourceId: 'primary' },
    );

    expect(result.status).toBe('completed-with-errors');
    expect(result.counts).toMatchObject({ saved: 2, failed: 1, bytesWritten: 7 });
    expect(result.results.filter((item) => item.status === 'failed')).toHaveLength(1);
    expect(result.results.find((item) => item.status === 'failed')).toMatchObject({
      primary: false,
      error: {
        code: 'resource-limit-exceeded',
        context: { field: 'maxTotalSizeBytes' },
      },
    });
    expect(budget.snapshot()).toEqual({
      maxBytes: 7,
      committedBytes: 7,
      reservedBytes: 0,
      availableBytes: 0,
    });
    expect([...savedBodies.values()].reduce((total, bytes) => total + bytes.byteLength, 0)).toBe(7);
  });

  it('aborts the active fixture request and never starts queued resources after cancellation', async () => {
    const fixture = new MultiOriginHttpFixture();
    const releasePrimary = fixture.hold(MULTI_ORIGIN_URLS.primary);
    const controller = new AbortController();
    const budget = new TaskByteBudget(100);
    const resources = [
      resource('primary', MULTI_ORIGIN_URLS.primary, 'document'),
      resource('stylesheet', MULTI_ORIGIN_URLS.stylesheet, 'stylesheet'),
      resource('redirect', MULTI_ORIGIN_URLS.redirect, 'script'),
    ];
    const batch = runResourceDownloadBatch(
      resources,
      1,
      createIntegratedWorker({
        fixture,
        contains: permissionChecker(['https://fixture-main.test/*', 'https://fixture-cdn.test/*']),
        budget,
        maxFileSizeBytes: null,
        savedBodies: new Map(),
        retryDelays: [],
      }),
      { primaryResourceId: 'primary', signal: controller.signal },
    );

    await fixture.waitUntilRequested(MULTI_ORIGIN_URLS.primary);
    cancelConcurrentQueue(controller);
    const result = await batch;
    releasePrimary();

    expect(result.status).toBe('cancelled');
    expect(result.counts).toEqual({
      total: 3,
      saved: 0,
      failed: 0,
      aborted: 1,
      notStarted: 2,
      bytesWritten: 0,
    });
    expect(result.results.map((item) => item.status)).toEqual([
      'aborted',
      'not-started',
      'not-started',
    ]);
    expect(fixture.requestedUrls).toEqual([MULTI_ORIGIN_URLS.primary]);
    expect(budget.snapshot()).toMatchObject({ committedBytes: 0, reservedBytes: 0 });
  });
});
