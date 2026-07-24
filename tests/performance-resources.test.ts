import { collectPerformanceResources, type PerformanceResourceSource } from '@sitecapsule/page';
import { describe, expect, it, vi } from 'vitest';

function resourceEntry(overrides: Partial<PerformanceResourceTiming> = {}): PerformanceEntry {
  return {
    name: 'https://cdn.example.com/app.js',
    entryType: 'resource',
    initiatorType: 'script',
    startTime: 10,
    duration: 25,
    transferSize: 1_024,
    encodedBodySize: 900,
    decodedBodySize: 1_500,
    ...overrides,
  } as PerformanceResourceTiming;
}

function source(entries: PerformanceEntry[]): PerformanceResourceSource {
  return {
    getEntriesByType: vi.fn(() => entries),
  };
}

describe('Performance Resource Timing collection', () => {
  it('returns an empty list when timing data is unavailable', () => {
    expect(collectPerformanceResources(null)).toEqual([]);
    expect(
      collectPerformanceResources({
        getEntriesByType: () => {
          throw new Error('Performance buffer unavailable');
        },
      }),
    ).toEqual([]);
  });

  it('normalizes URLs and deterministically keeps the earliest duplicate observation', () => {
    const performance = source([
      resourceEntry({
        name: 'https://cdn.example.com/app.js#late',
        initiatorType: 'fetch',
        startTime: 40,
        transferSize: 2_048,
      }),
      resourceEntry({
        name: 'https://cdn.example.com/app.js#early',
        initiatorType: 'script',
        startTime: 10,
        transferSize: 1_024,
      }),
      resourceEntry({
        name: 'https://cdn.example.com/theme.css?v=2#sheet',
        initiatorType: 'future-css-loader',
        startTime: 20,
      }),
      resourceEntry({
        name: 'https://cdn.example.com/icons/%7eprint%2f.svg#symbol',
        initiatorType: 'img',
        startTime: 30,
      }),
    ]);

    expect(collectPerformanceResources(performance)).toEqual([
      {
        url: 'https://cdn.example.com/app.js',
        initiatorType: 'script',
        startTimeMs: 10,
        durationMs: 25,
        transferSize: 1_024,
        encodedBodySize: 900,
        decodedBodySize: 1_500,
      },
      {
        url: 'https://cdn.example.com/theme.css?v=2',
        initiatorType: 'other',
        startTimeMs: 20,
        durationMs: 25,
        transferSize: 1_024,
        encodedBodySize: 900,
        decodedBodySize: 1_500,
      },
      {
        url: 'https://cdn.example.com/icons/%7Eprint%2F.svg',
        initiatorType: 'img',
        startTimeMs: 30,
        durationMs: 25,
        transferSize: 1_024,
        encodedBodySize: 900,
        decodedBodySize: 1_500,
      },
    ]);
    expect(performance.getEntriesByType).toHaveBeenCalledWith('resource');
  });

  it('preserves cross-origin observations whose restricted size fields are zero', () => {
    expect(
      collectPerformanceResources(
        source([
          resourceEntry({
            name: 'https://third-party.example.net/font.woff2',
            initiatorType: 'css',
            transferSize: 0,
            encodedBodySize: 0,
            decodedBodySize: 0,
          }),
        ]),
      ),
    ).toEqual([
      {
        url: 'https://third-party.example.net/font.woff2',
        initiatorType: 'css',
        startTimeMs: 10,
        durationMs: 25,
        transferSize: 0,
        encodedBodySize: 0,
        decodedBodySize: 0,
      },
    ]);
  });

  it('rejects malformed, unsafe, and unsupported timing entries', () => {
    const entries = [
      resourceEntry(),
      resourceEntry({ entryType: 'navigation' }),
      resourceEntry({ name: 'data:text/plain,private' }),
      resourceEntry({ name: 'https://user:password@example.com/private' }),
      resourceEntry({ name: 'not a URL' }),
      resourceEntry({ duration: -1 }),
      resourceEntry({ startTime: Number.NaN }),
      resourceEntry({ transferSize: 1.5 }),
      resourceEntry({ encodedBodySize: -1 }),
      resourceEntry({ decodedBodySize: Number.POSITIVE_INFINITY }),
    ];

    expect(collectPerformanceResources(source(entries))).toEqual([
      {
        url: 'https://cdn.example.com/app.js',
        initiatorType: 'script',
        startTimeMs: 10,
        durationMs: 25,
        transferSize: 1_024,
        encodedBodySize: 900,
        decodedBodySize: 1_500,
      },
    ]);
  });
});
