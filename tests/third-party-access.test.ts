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

function domResource(resolvedUrl: string): DomResourceCandidate {
  return {
    source: 'dom',
    tagName: 'img',
    attributeName: 'src',
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
      },
    ]);
    expect(contains.mock.calls).toEqual([
      [{ origins: ['https://cdn.example.test/*'] }],
      [{ origins: ['http://cdn.example.test/*'] }],
      [{ origins: ['https://assets.example.test/*'] }],
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
