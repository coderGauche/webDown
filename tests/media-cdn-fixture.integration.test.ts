// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCaptureError, type CaptureError, type ResourceRecord } from '@sitecapsule/domain';
import {
  TaskByteBudget,
  applyResourceResponseMetadata,
  checkResourceNetworkAccess,
  checkResourceResponseNetworkPolicy,
  classifyResourceResponse,
  consumeResourceBodyWithLimits,
  createSecureResourceFetchInit,
  runResourceDownloadBatch,
  type ResourceDownloadWorker,
  type ResourceHttpFailure,
} from '@sitecapsule/download';
import { summarizeThirdPartySiteAccess, type PageAccessRequest } from '@sitecapsule/permissions';
import { capturePageSnapshot, type PerformanceResourceRecord } from '@sitecapsule/page';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MEDIA_CDN_URLS,
  MediaCdnHttpFixture,
  type MediaCdnFixtureResponse,
} from './fixtures/media-cdn-http';

const GRANTED_PATTERNS = new Set([
  'https://fixture-main.test/*',
  'https://fixture-cdn.test/*',
  'https://fixture-edge.test/*',
  'https://fixture-media.test/*',
]);
const PAGE_URL = `${window.location.origin}/fixtures/media-cdn/index.html`;
const FIXTURE_PATH = resolve(process.cwd(), 'tests/fixtures/media-cdn-page/index.html');

function loadFixture(): void {
  window.history.replaceState({}, '', PAGE_URL);
  document.open();
  document.write(readFileSync(FIXTURE_PATH, 'utf8'));
  document.close();
}

function timing(
  url: string,
  initiatorType: PerformanceResourceRecord['initiatorType'],
  startTimeMs: number,
): PerformanceResourceTiming {
  return {
    name: url,
    entryType: 'resource',
    initiatorType,
    startTime: startTimeMs,
    duration: 2,
    transferSize: 128,
    encodedBodySize: 96,
    decodedBodySize: 160,
  } as PerformanceResourceTiming;
}

function contains({ origins }: PageAccessRequest): Promise<boolean> {
  return Promise.resolve(origins.every((origin) => GRANTED_PATTERNS.has(origin)));
}

function networkError(reason: string): CaptureError {
  return createCaptureError(
    reason === 'permission-denied' ? 'permission-denied' : 'network-request-failed',
  );
}

function createWorker(fixture: MediaCdnHttpFixture): ResourceDownloadWorker {
  const budget = new TaskByteBudget(1_024);

  return async (input, _index, signal) => {
    const access = await checkResourceNetworkAccess(input.originalUrl, contains);
    if (access.status === 'blocked') {
      return { status: 'failed', error: networkError(access.reason) };
    }

    const response = await fixture.fetch(access.url, createSecureResourceFetchInit(signal));
    const inspected = classifyResourceResponse(access.url, response, {
      ...(response.redirectHops ? { redirectHops: response.redirectHops } : {}),
    });
    if (inspected.status === 'failed') {
      const failure = inspected.error as ResourceHttpFailure<MediaCdnFixtureResponse>;
      return {
        status: 'failed',
        resource: applyResourceResponseMetadata(input, failure.metadata),
        error: createCaptureError('network-request-failed', {
          httpStatus: failure.metadata.httpStatus,
        }),
      };
    }

    const responsePolicy = await checkResourceResponseNetworkPolicy(
      inspected.value.metadata,
      contains,
    );
    if (responsePolicy.status === 'blocked') {
      return {
        status: 'failed',
        resource: applyResourceResponseMetadata(input, inspected.value.metadata),
        error: networkError(responsePolicy.target.reason),
      };
    }

    let savedBytes = 0;
    const consumed = await consumeResourceBodyWithLimits(inspected.value.response, {
      budget,
      maxFileSizeBytes: 256,
      signal,
      sink: {
        write: (chunk) => {
          savedBytes += chunk.byteLength;
        },
        close: () => {},
        abort: () => {
          savedBytes = 0;
        },
      },
    });
    expect(savedBytes).toBe(consumed.byteLength);
    return {
      status: 'saved',
      resource: {
        ...applyResourceResponseMetadata(input, inspected.value.metadata),
        state: 'saved',
        byteLength: consumed.byteLength,
      },
    };
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.open();
  document.write('<!doctype html><html><head></head><body></body></html>');
  document.close();
});

describe('M9 font, media, and third-party CDN fixture', () => {
  it('preserves discovery provenance, permission groups, response metadata, and partial success', async () => {
    loadFixture();
    vi.spyOn(window.performance, 'getEntriesByType').mockImplementation((type) =>
      type === 'resource'
        ? [
            timing(MEDIA_CDN_URLS.font, 'css', 1),
            timing(MEDIA_CDN_URLS.hero, 'img', 2),
            timing(MEDIA_CDN_URLS.poster, 'img', 3),
            timing(MEDIA_CDN_URLS.videoMp4, 'video', 4),
            timing(MEDIA_CDN_URLS.audio, 'audio', 5),
            timing(MEDIA_CDN_URLS.captions, 'track', 6),
            timing(MEDIA_CDN_URLS.privateImage, 'img', 7),
          ]
        : [],
    );

    const snapshot = capturePageSnapshot(document, PAGE_URL);
    const nodeByUrl = new Map(snapshot.resourceGraph.nodes.map((node) => [node.url, node]));

    expect(snapshot.resourceGraph.nodes).toHaveLength(10);
    expect(nodeByUrl.get(MEDIA_CDN_URLS.font)?.inference).toMatchObject({
      resourceType: 'font',
      mimeTypeHint: 'font/woff2',
    });
    expect(nodeByUrl.get(MEDIA_CDN_URLS.videoMp4)?.inference).toMatchObject({
      resourceType: 'video',
      mimeTypeHint: 'video/mp4',
    });
    expect(nodeByUrl.get(MEDIA_CDN_URLS.audio)?.inference).toMatchObject({
      resourceType: 'audio',
      mimeTypeHint: 'audio/mpeg',
    });
    expect(nodeByUrl.get(MEDIA_CDN_URLS.captions)?.inference).toMatchObject({
      resourceType: 'data',
      mimeTypeHint: 'text/vtt',
    });
    expect(nodeByUrl.get(MEDIA_CDN_URLS.hero)?.discoverySources).toEqual([
      'dom',
      'css',
      'performance',
    ]);
    expect(
      snapshot.resourceGraph.edges
        .filter((edge) => edge.targetUrl === MEDIA_CDN_URLS.hero)
        .map((edge) => edge.channel),
    ).toEqual(['dom-attribute', 'dom-attribute', 'css-ast', 'performance']);

    const access = await summarizeThirdPartySiteAccess(snapshot.resourceGraph, contains);
    expect(
      access.map(({ hostname, status, resourceCount, resourceTypes }) => ({
        hostname,
        status,
        resourceCount,
        resourceTypes,
      })),
    ).toEqual([
      {
        hostname: 'fixture-cdn.test',
        status: 'granted',
        resourceCount: 4,
        resourceTypes: ['image', 'stylesheet', 'font'],
      },
      {
        hostname: 'fixture-edge.test',
        status: 'granted',
        resourceCount: 1,
        resourceTypes: ['image'],
      },
      {
        hostname: 'fixture-media.test',
        status: 'granted',
        resourceCount: 4,
        resourceTypes: ['video', 'data', 'audio'],
      },
      {
        hostname: 'fixture-private.test',
        status: 'not-granted',
        resourceCount: 1,
        resourceTypes: ['image'],
      },
    ]);

    const records: ResourceRecord[] = [
      {
        id: 'primary',
        jobId: 'm9-media-cdn',
        originalUrl: MEDIA_CDN_URLS.page,
        referrerUrl: MEDIA_CDN_URLS.page,
        type: 'document',
        discoverySources: ['dom'],
        state: 'queued',
      },
      ...snapshot.resourceGraph.nodes.map((node) => ({
        id: `resource-${node.ordinal}`,
        jobId: 'm9-media-cdn',
        originalUrl: node.url,
        referrerUrl: PAGE_URL,
        type: node.inference.resourceType,
        discoverySources: [...node.discoverySources],
        state: 'queued' as const,
      })),
    ];
    const fixture = new MediaCdnHttpFixture();
    const result = await runResourceDownloadBatch(records, 4, createWorker(fixture), {
      primaryResourceId: 'primary',
    });

    expect(result.status).toBe('completed-with-errors');
    expect(result.fatalError).toBeNull();
    expect(result.counts).toMatchObject({ total: 11, saved: 9, failed: 2 });
    expect(result.results.filter((item) => item.status === 'failed')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource: expect.objectContaining({ originalUrl: MEDIA_CDN_URLS.privateImage }),
          error: expect.objectContaining({ code: 'permission-denied' }),
        }),
        expect.objectContaining({
          resource: expect.objectContaining({
            originalUrl: MEDIA_CDN_URLS.missingImage,
            httpStatus: 404,
            mimeType: 'image/png',
          }),
          error: expect.objectContaining({ code: 'network-request-failed' }),
        }),
      ]),
    );
    expect(
      result.results.find((item) => item.resource.originalUrl === MEDIA_CDN_URLS.poster)?.resource,
    ).toMatchObject({
      state: 'saved',
      finalUrl: MEDIA_CDN_URLS.posterFinal,
      httpStatus: 200,
      mimeType: 'image/webp',
      redirectTrace: {
        complete: true,
        hops: [
          {
            fromUrl: MEDIA_CDN_URLS.poster,
            toUrl: MEDIA_CDN_URLS.posterFinal,
            httpStatus: 302,
          },
        ],
      },
    });
    const metadataByUrl = new Map(
      result.results.map((item) => [item.resource.originalUrl, item.resource]),
    );
    expect(metadataByUrl.get(MEDIA_CDN_URLS.font)).toMatchObject({
      type: 'font',
      mimeType: 'font/woff2',
      httpStatus: 200,
    });
    expect(metadataByUrl.get(MEDIA_CDN_URLS.videoMp4)).toMatchObject({
      type: 'video',
      mimeType: 'video/mp4',
      httpStatus: 200,
    });
    expect(metadataByUrl.get(MEDIA_CDN_URLS.audio)).toMatchObject({
      type: 'audio',
      mimeType: 'audio/mpeg',
      httpStatus: 200,
    });
    expect(metadataByUrl.get(MEDIA_CDN_URLS.captions)).toMatchObject({
      type: 'data',
      mimeType: 'text/vtt',
      httpStatus: 200,
    });
    expect(fixture.requestedUrls).not.toContain(MEDIA_CDN_URLS.privateImage);
    expect(
      result.results.some((item) => item.resource.type === 'font' && item.status === 'saved'),
    ).toBe(true);
    expect(
      result.results.some((item) => item.resource.type === 'video' && item.status === 'saved'),
    ).toBe(true);
    expect(
      result.results.some((item) => item.resource.type === 'audio' && item.status === 'saved'),
    ).toBe(true);
  });

  it('contains no public-network dependency', () => {
    const markup = readFileSync(FIXTURE_PATH, 'utf8');
    const urls = [...markup.matchAll(/https?:\/\/[^"'\s<)]+/g)].map(([url]) => url);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => new URL(url).hostname.endsWith('.test'))).toBe(true);
  });
});
