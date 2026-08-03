import type { DomResourceCandidate } from '@sitecapsule/discovery';
import {
  createThirdPartyAccessRequest,
  summarizeThirdPartySiteAccess,
  type PageAccessRequest,
} from '@sitecapsule/permissions';
import {
  buildResourceGraph,
  mergeResourceCandidates,
  type PerformanceResourceRecord,
  type ResourceGraph,
} from '@sitecapsule/page';
import { describe, expect, it, vi } from 'vitest';

const ROOT_URL = 'https://www.example.test/page';

function domResource(
  resolvedUrl: string,
  tagName = 'img',
  attributeName: DomResourceCandidate['attributeName'] = 'src',
): DomResourceCandidate {
  return {
    source: 'dom',
    tagName,
    attributeName,
    attributeValue: resolvedUrl,
    rawUrl: resolvedUrl,
    resolvedUrl,
    documentUrl: ROOT_URL,
    baseUrl: ROOT_URL,
  };
}

function performanceResource(
  url: string,
  initiatorType: PerformanceResourceRecord['initiatorType'] = 'img',
): PerformanceResourceRecord {
  return {
    url,
    initiatorType,
    startTimeMs: 1,
    durationMs: 2,
    transferSize: 3,
    encodedBodySize: 3,
    decodedBodySize: 4,
  };
}

function createGraph(): ResourceGraph {
  const sharedCdnUrl = 'https://cdn.example.test/hero.png?size=2';
  return buildResourceGraph(
    ROOT_URL,
    mergeResourceCandidates({
      domResources: [
        domResource('https://www.example.test/local.png'),
        domResource(sharedCdnUrl),
        domResource('data:image/png;base64,AAAA'),
        domResource('blob:https://www.example.test/runtime-id'),
        domResource('chrome-extension://abcdefghijklmnop/icon.png'),
      ],
      svgResources: [],
      cssResources: [],
      performanceResources: [
        performanceResource(sharedCdnUrl),
        performanceResource('https://cdn.example.test:8443/runtime.js', 'script'),
        performanceResource('http://cdn.example.test/legacy.css', 'link'),
        performanceResource('https://assets.example.test/font.woff2', 'css'),
        performanceResource('http://www.example.test/cross-scheme.png'),
      ],
    }),
  );
}

describe('third-party site access', () => {
  it('groups eligible resources by scheme and hostname while retaining provenance', async () => {
    const contains = vi
      .fn<(request: PageAccessRequest) => Promise<boolean>>()
      .mockImplementation(async ({ origins }) => origins.includes('https://assets.example.test/*'));

    const summaries = await summarizeThirdPartySiteAccess(createGraph(), contains);

    expect(summaries).toEqual([
      {
        status: 'not-granted',
        permissionPattern: 'https://cdn.example.test/*',
        scheme: 'https:',
        hostname: 'cdn.example.test',
        origins: ['https://cdn.example.test', 'https://cdn.example.test:8443'],
        resourceCount: 2,
        provenanceCount: 3,
        discoverySources: ['dom', 'performance'],
        resourceTypes: ['image', 'script'],
        criticalResourceCount: 2,
        excludedResourceCount: 0,
        defaultSelected: true,
        policyReasons: ['critical-resource-type'],
      },
      {
        status: 'not-granted',
        permissionPattern: 'http://cdn.example.test/*',
        scheme: 'http:',
        hostname: 'cdn.example.test',
        origins: ['http://cdn.example.test'],
        resourceCount: 1,
        provenanceCount: 1,
        discoverySources: ['performance'],
        resourceTypes: ['stylesheet'],
        criticalResourceCount: 1,
        excludedResourceCount: 0,
        defaultSelected: true,
        policyReasons: ['critical-resource-type'],
      },
      {
        status: 'granted',
        permissionPattern: 'https://assets.example.test/*',
        scheme: 'https:',
        hostname: 'assets.example.test',
        origins: ['https://assets.example.test'],
        resourceCount: 1,
        provenanceCount: 1,
        discoverySources: ['performance'],
        resourceTypes: ['font'],
        criticalResourceCount: 1,
        excludedResourceCount: 0,
        defaultSelected: true,
        policyReasons: ['critical-resource-type'],
      },
      {
        status: 'not-granted',
        permissionPattern: 'http://www.example.test/*',
        scheme: 'http:',
        hostname: 'www.example.test',
        origins: ['http://www.example.test'],
        resourceCount: 1,
        provenanceCount: 1,
        discoverySources: ['performance'],
        resourceTypes: ['image'],
        criticalResourceCount: 1,
        excludedResourceCount: 0,
        defaultSelected: true,
        policyReasons: ['critical-resource-type'],
      },
    ]);
    expect(contains.mock.calls).toEqual([
      [{ origins: ['https://cdn.example.test/*'] }],
      [{ origins: ['http://cdn.example.test/*'] }],
      [{ origins: ['https://assets.example.test/*'] }],
      [{ origins: ['http://www.example.test/*'] }],
    ]);
  });

  it('requests only explicitly selected pending patterns in selection order', async () => {
    const summaries = await summarizeThirdPartySiteAccess(createGraph(), async ({ origins }) =>
      origins.includes('https://assets.example.test/*'),
    );

    expect(
      createThirdPartyAccessRequest(summaries, [
        'http://cdn.example.test/*',
        'https://assets.example.test/*',
        'https://unknown.example.test/*',
        'http://cdn.example.test/*',
        'https://cdn.example.test/*',
      ]),
    ).toEqual({
      origins: ['http://cdn.example.test/*', 'https://cdn.example.test/*'],
    });
    expect(createThirdPartyAccessRequest(summaries, [])).toBeNull();
    expect(createThirdPartyAccessRequest(summaries, ['https://assets.example.test/*'])).toBeNull();
  });

  it('supports pages without third-party network resources', async () => {
    const contains = vi.fn<(request: PageAccessRequest) => Promise<boolean>>();
    const graph = buildResourceGraph(
      ROOT_URL,
      mergeResourceCandidates({
        domResources: [domResource('https://www.example.test/local.png')],
        svgResources: [],
        cssResources: [],
        performanceResources: [],
      }),
    );

    await expect(summarizeThirdPartySiteAccess(graph, contains)).resolves.toEqual([]);
    expect(contains).not.toHaveBeenCalled();
  });

  it('defaults only archive-critical hosts and excludes tracking, payment, iframe, and beacons', async () => {
    const graph = buildResourceGraph(
      ROOT_URL,
      mergeResourceCandidates({
        domResources: [
          domResource('https://images.cdn.test/hero.webp'),
          domResource('https://analytics.vendor.test/collect.js', 'script'),
          domResource('https://payments.vendor.test/controller.js', 'script'),
          domResource('https://frames.vendor.test/checkout', 'iframe'),
        ],
        svgResources: [],
        cssResources: [],
        performanceResources: [performanceResource('https://runtime.vendor.test/beacon', 'beacon')],
      }),
    );
    const summaries = await summarizeThirdPartySiteAccess(graph, async () => false);

    expect(
      summaries.map(({ hostname, defaultSelected, policyReasons }) => ({
        hostname,
        defaultSelected,
        policyReasons,
      })),
    ).toEqual([
      {
        hostname: 'images.cdn.test',
        defaultSelected: true,
        policyReasons: ['critical-resource-type'],
      },
      {
        hostname: 'analytics.vendor.test',
        defaultSelected: false,
        policyReasons: ['tracking-runtime'],
      },
      {
        hostname: 'payments.vendor.test',
        defaultSelected: false,
        policyReasons: ['payment-runtime'],
      },
      {
        hostname: 'frames.vendor.test',
        defaultSelected: false,
        policyReasons: ['iframe-document'],
      },
      {
        hostname: 'runtime.vendor.test',
        defaultSelected: false,
        policyReasons: ['tracking-runtime'],
      },
    ]);
    expect(
      createThirdPartyAccessRequest(
        summaries,
        summaries.map(({ permissionPattern }) => permissionPattern),
      ),
    ).toEqual({ origins: ['https://images.cdn.test/*'] });
  });

  it('rejects invalid graphs, non-network roots, and permission API failures', async () => {
    await expect(
      summarizeThirdPartySiteAccess({ ...createGraph(), nodes: [] }, async () => false),
    ).rejects.toThrow(TypeError);
    await expect(
      summarizeThirdPartySiteAccess(
        buildResourceGraph('data:text/html,hello', []),
        async () => false,
      ),
    ).rejects.toThrow('HTTP or HTTPS root URL');
    await expect(
      summarizeThirdPartySiteAccess(createGraph(), async () => {
        throw new Error('permissions API unavailable');
      }),
    ).rejects.toThrow('permissions API unavailable');
  });
});
