import type { ResourceRecord } from '@sitecapsule/domain';
import {
  applyResourceResponseMetadata,
  classifyResourceResponse,
  inspectResourceResponse,
  normalizeResponseMimeType,
  type ResourceResponseSource,
} from '@sitecapsule/download';
import { describe, expect, it, vi } from 'vitest';

type TestResponse = ResourceResponseSource & {
  bodyMarker: object;
};

function response(
  overrides: Partial<Omit<TestResponse, 'headers'>> & {
    headers?: Record<string, string>;
  } = {},
): TestResponse {
  const { headers: headerValues = {}, ...responseOverrides } = overrides;
  const headers = new Map(
    Object.entries(headerValues).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    url: 'https://cdn.example.com/assets/site.css',
    redirected: false,
    status: 200,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
    bodyMarker: {},
    ...responseOverrides,
  };
}

function resource(overrides: Partial<ResourceRecord> = {}): ResourceRecord {
  return {
    id: 'resource-1',
    jobId: 'job-1',
    originalUrl: 'https://cdn.example.com/assets/site.css',
    referrerUrl: 'https://example.com/',
    type: 'stylesheet',
    discoverySources: ['dom'],
    state: 'fetching',
    ...overrides,
  };
}

describe('resource response metadata', () => {
  it.each([
    ['text/html', 'text/html'],
    [' Text/CSS ; charset=UTF-8', 'text/css'],
    ['application/manifest+json; charset=utf-8', 'application/manifest+json'],
    ["application/vnd.example-v1+json; profile='archive'", 'application/vnd.example-v1+json'],
  ])('normalizes Content-Type %s to MIME essence %s', (contentType, expected) => {
    expect(normalizeResponseMimeType(contentType)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    '   ',
    'text',
    '/plain',
    'text/',
    'text/plain/extra',
    'text/(plain)',
    'text /plain',
    'text/plain, application/json',
  ])('returns null for missing or invalid Content-Type %s', (contentType) => {
    expect(normalizeResponseMimeType(contentType)).toBeNull();
  });

  it('records a direct successful response without consuming or replacing it', () => {
    const source = response({ headers: { 'Content-Type': 'Text/CSS; charset=utf-8' } });
    const inspected = inspectResourceResponse(source.url, source);

    expect(inspected.response).toBe(source);
    expect(inspected.response.bodyMarker).toBe(source.bodyMarker);
    expect(inspected.metadata).toEqual({
      originalUrl: 'https://cdn.example.com/assets/site.css',
      finalUrl: 'https://cdn.example.com/assets/site.css',
      redirected: false,
      redirectTrace: { complete: true, hops: [] },
      httpStatus: 200,
      ok: true,
      mimeType: 'text/css',
    });
  });

  it('records the effective redirect relation and normalized final URL', () => {
    const source = response({
      url: 'HTTPS://STATIC.EXAMPLE.COM:443/a/../assets/app.js#ignored',
      redirected: true,
      status: 206,
      headers: { 'content-type': 'Application/JavaScript' },
    });

    expect(
      inspectResourceResponse('https://cdn.example.com/start.js#source', source).metadata,
    ).toEqual({
      originalUrl: 'https://cdn.example.com/start.js',
      finalUrl: 'https://static.example.com/assets/app.js',
      redirected: true,
      redirectTrace: {
        complete: false,
        hops: [
          {
            fromUrl: 'https://cdn.example.com/start.js',
            toUrl: 'https://static.example.com/assets/app.js',
          },
        ],
      },
      httpStatus: 206,
      ok: true,
      mimeType: 'application/javascript',
    });
  });

  it('keeps a differing final URL without claiming an unreported redirect', () => {
    const inspected = inspectResourceResponse(
      'https://cdn.example.com/original.css',
      response({ url: 'https://cdn.example.com/effective.css', redirected: false }),
    );

    expect(inspected.metadata.finalUrl).toBe('https://cdn.example.com/effective.css');
    expect(inspected.metadata.redirected).toBe(false);
    expect(inspected.metadata.redirectTrace).toEqual({ complete: true, hops: [] });
  });

  it('records a complete single-hop or multi-hop redirect chain when observations exist', () => {
    const single = inspectResourceResponse(
      'https://example.com/old.css',
      response({ url: 'https://example.com/new.css', redirected: true }),
      {
        redirectHops: [
          {
            fromUrl: 'https://example.com/old.css',
            toUrl: 'https://example.com/new.css',
            httpStatus: 301,
          },
        ],
      },
    );
    expect(single.metadata.redirectTrace).toEqual({
      complete: true,
      hops: [
        {
          fromUrl: 'https://example.com/old.css',
          toUrl: 'https://example.com/new.css',
          httpStatus: 301,
        },
      ],
    });

    const multiple = inspectResourceResponse(
      'https://example.com/one.js',
      response({ url: 'https://cdn.example.com/three.js', redirected: true }),
      {
        redirectHops: [
          {
            fromUrl: 'https://example.com/one.js',
            toUrl: 'https://static.example.com/two.js',
            httpStatus: 302,
          },
          {
            fromUrl: 'https://static.example.com/two.js',
            toUrl: 'https://cdn.example.com/three.js',
            httpStatus: 307,
          },
        ],
      },
    );
    expect(multiple.metadata.redirectTrace).toMatchObject({ complete: true });
    expect(multiple.metadata.redirectTrace.hops).toHaveLength(2);
  });

  it.each([
    [199, false],
    [200, true],
    [299, true],
    [300, false],
    [599, false],
  ])('derives ok=%s from HTTP status %i', (status, ok) => {
    expect(inspectResourceResponse('https://example.com/a', response({ status })).metadata.ok).toBe(
      ok,
    );
  });

  it('classifies successful and failed HTTP responses for the retry policy', () => {
    const successful = response({ status: 204, headers: {} });
    expect(classifyResourceResponse(successful.url, successful)).toEqual({
      status: 'succeeded',
      value: { response: successful, metadata: expect.objectContaining({ httpStatus: 204 }) },
    });

    const busy = response({
      status: 503,
      headers: { 'Retry-After': '12', 'Content-Type': 'text/plain' },
    });
    const failure = classifyResourceResponse(busy.url, busy);
    expect(failure).toEqual({
      status: 'failed',
      error: {
        kind: 'http-status',
        response: busy,
        metadata: expect.objectContaining({ httpStatus: 503, mimeType: 'text/plain' }),
      },
      retryable: true,
      retryAfter: '12',
    });

    expect(classifyResourceResponse(busy.url, response({ status: 404, headers: {} }))).toEqual(
      expect.objectContaining({ status: 'failed', retryable: false, retryAfter: null }),
    );
  });

  it('writes response fields to ResourceRecord and clears a stale MIME value when absent', () => {
    const initial = resource({
      finalUrl: 'https://stale.example.com/',
      httpStatus: 500,
      mimeType: 'text/plain',
      localPath: 'assets/site.css',
    });
    const metadata = inspectResourceResponse(
      initial.originalUrl,
      response({
        url: 'https://cdn.example.com/assets/final.css',
        redirected: true,
        status: 304,
        headers: {},
      }),
    ).metadata;
    const updated = applyResourceResponseMetadata(initial, metadata);

    expect(updated).toEqual({
      ...initial,
      finalUrl: 'https://cdn.example.com/assets/final.css',
      redirectTrace: {
        complete: false,
        hops: [
          {
            fromUrl: 'https://cdn.example.com/assets/site.css',
            toUrl: 'https://cdn.example.com/assets/final.css',
          },
        ],
      },
      httpStatus: 304,
      mimeType: undefined,
    });
    expect('mimeType' in updated).toBe(false);
    expect(updated.localPath).toBe(initial.localPath);
    expect(updated.redirectTrace).not.toBe(metadata.redirectTrace);
    expect(updated.redirectTrace?.hops).not.toBe(metadata.redirectTrace.hops);
  });

  it('rejects invalid response boundaries and mismatched resource ownership', () => {
    expect(() => inspectResourceResponse('data:text/plain,x', response())).toThrow(RangeError);
    expect(() =>
      inspectResourceResponse('https://example.com/a', response({ url: 'blob:x' })),
    ).toThrow(RangeError);
    expect(() =>
      inspectResourceResponse('https://example.com/a', response({ status: 99 })),
    ).toThrow(RangeError);
    expect(() =>
      inspectResourceResponse('https://example.com/a', response({ redirected: 1 as never })),
    ).toThrow(TypeError);
    expect(() =>
      applyResourceResponseMetadata(
        resource(),
        inspectResourceResponse('https://other.example.com/site.css', response()).metadata,
      ),
    ).toThrow('does not belong');
  });

  it('rejects incomplete, discontinuous, or non-3xx observed redirect chains', () => {
    const redirected = response({ url: 'https://example.com/final', redirected: true });
    expect(() =>
      inspectResourceResponse('https://example.com/start', redirected, { redirectHops: [] }),
    ).toThrow('redirected flag');
    expect(() =>
      inspectResourceResponse('https://example.com/start', redirected, {
        redirectHops: [
          {
            fromUrl: 'https://example.com/wrong',
            toUrl: 'https://example.com/final',
            httpStatus: 301,
          },
        ],
      }),
    ).toThrow('endpoints');
    expect(() =>
      inspectResourceResponse('https://example.com/start', redirected, {
        redirectHops: [
          {
            fromUrl: 'https://example.com/start',
            toUrl: 'https://example.com/middle',
            httpStatus: 302,
          },
          {
            fromUrl: 'https://example.com/other',
            toUrl: 'https://example.com/final',
            httpStatus: 307,
          },
        ],
      }),
    ).toThrow('continuous');
    expect(() =>
      inspectResourceResponse('https://example.com/start', redirected, {
        redirectHops: [
          {
            fromUrl: 'https://example.com/start',
            toUrl: 'https://example.com/final',
            httpStatus: 200,
          },
        ],
      }),
    ).toThrow('3xx');
  });

  it('reads each metadata header without touching response body APIs', () => {
    const get = vi.fn((name: string) => (name === 'content-type' ? 'image/png' : null));
    const source = { ...response(), headers: { get } };

    inspectResourceResponse(source.url, source);

    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith('content-type');
  });
});
