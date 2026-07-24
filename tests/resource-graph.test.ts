import type { DomResourceCandidate } from '@sitecapsule/discovery';
import {
  buildResourceGraph,
  isResourceGraph,
  isResourceGraphEdge,
  isResourceGraphNode,
  matchesResourceGraph,
  mergeResourceCandidates,
  type PerformanceResourceRecord,
} from '@sitecapsule/page';
import { describe, expect, it } from 'vitest';

const ROOT_URL = 'https://example.test/page#section';
const DOCUMENT_URL = 'https://example.test/page';
const BASE_URL = 'https://cdn.example.test/assets/';

function domResource(resolvedUrl: string, rawUrl = resolvedUrl): DomResourceCandidate {
  return {
    source: 'dom',
    tagName: 'img',
    attributeName: 'src',
    attributeValue: rawUrl,
    rawUrl,
    resolvedUrl,
    documentUrl: DOCUMENT_URL,
    baseUrl: BASE_URL,
  };
}

function performanceResource(url: string): PerformanceResourceRecord {
  return {
    url,
    initiatorType: 'img',
    startTimeMs: 5,
    durationMs: 10,
    transferSize: 100,
    encodedBodySize: 90,
    decodedBodySize: 120,
  };
}

function createGraphFixture() {
  const sharedUrl = 'https://cdn.example.test/shared.png?v=2';
  const runtimeUrl = 'https://cdn.example.test/runtime.js';
  const resources = mergeResourceCandidates({
    domResources: [domResource(`${sharedUrl}#hero`, './shared.png?v=2#hero')],
    svgResources: [],
    cssResources: [],
    performanceResources: [performanceResource(sharedUrl), performanceResource(runtimeUrl)],
  });
  return { resources, graph: buildResourceGraph(ROOT_URL, resources), sharedUrl, runtimeUrl };
}

describe('resource graph', () => {
  it('uses normalized resource URLs as unique nodes and retains every provenance edge', () => {
    const { graph, sharedUrl, runtimeUrl } = createGraphFixture();

    expect(graph.rootUrl).toBe(DOCUMENT_URL);
    expect(graph.nodes).toEqual([
      { ordinal: 1, url: sharedUrl, discoverySources: ['dom', 'performance'] },
      { ordinal: 2, url: runtimeUrl, discoverySources: ['performance'] },
    ]);
    expect(
      graph.edges.map(({ ordinal, sourceUrl, targetUrl, source, channel, sourceOrdinal }) => ({
        ordinal,
        sourceUrl,
        targetUrl,
        source,
        channel,
        sourceOrdinal,
      })),
    ).toEqual([
      {
        ordinal: 1,
        sourceUrl: DOCUMENT_URL,
        targetUrl: sharedUrl,
        source: 'dom',
        channel: 'dom-attribute',
        sourceOrdinal: 1,
      },
      {
        ordinal: 2,
        sourceUrl: DOCUMENT_URL,
        targetUrl: sharedUrl,
        source: 'performance',
        channel: 'performance',
        sourceOrdinal: 1,
      },
      {
        ordinal: 3,
        sourceUrl: DOCUMENT_URL,
        targetUrl: runtimeUrl,
        source: 'performance',
        channel: 'performance',
        sourceOrdinal: 2,
      },
    ]);
    expect(graph.edges[0]?.evidence).toMatchObject({
      candidate: { rawUrl: './shared.png?v=2#hero', resolvedUrl: `${sharedUrl}#hero` },
    });
  });

  it('builds nodes and edges in deterministic first-seen order', () => {
    const { resources, graph } = createGraphFixture();

    expect(buildResourceGraph(ROOT_URL, resources)).toEqual(graph);
    expect(isResourceGraph(graph)).toBe(true);
    expect(matchesResourceGraph(graph, ROOT_URL, resources)).toBe(true);
    expect(graph.nodes.every(isResourceGraphNode)).toBe(true);
    expect(graph.edges.every(isResourceGraphEdge)).toBe(true);
  });

  it('supports a valid empty graph and rejects an invalid root URL', () => {
    const graph = buildResourceGraph(DOCUMENT_URL, []);

    expect(graph).toEqual({ rootUrl: DOCUMENT_URL, nodes: [], edges: [] });
    expect(isResourceGraph(graph)).toBe(true);
    expect(() => buildResourceGraph('not a URL', [])).toThrow(TypeError);
    expect(() =>
      buildResourceGraph(DOCUMENT_URL, [
        {
          ordinal: 2,
          url: 'https://cdn.example.test/invalid.png',
          discoverySources: ['dom'],
          evidence: [],
        },
      ]),
    ).toThrow(TypeError);
  });

  it('rejects duplicate nodes, unstable edges, mismatched sources, and dangling targets', () => {
    const { graph } = createGraphFixture();
    const firstNode = graph.nodes[0];
    const firstEdge = graph.edges[0];
    if (!firstNode || !firstEdge) throw new Error('Missing resource graph fixture data.');

    expect(isResourceGraph({ ...graph, nodes: [...graph.nodes, firstNode] })).toBe(false);
    expect(
      isResourceGraph({
        ...graph,
        edges: [{ ...firstEdge, ordinal: 2 }, ...graph.edges.slice(1)],
      }),
    ).toBe(false);
    expect(
      isResourceGraph({
        ...graph,
        edges: [{ ...firstEdge, source: 'css' }, ...graph.edges.slice(1)],
      }),
    ).toBe(false);
    expect(
      isResourceGraph({
        ...graph,
        edges: [
          { ...firstEdge, targetUrl: 'https://cdn.example.test/missing.png' },
          ...graph.edges.slice(1),
        ],
      }),
    ).toBe(false);
    expect(isResourceGraph({ ...graph, unexpected: true })).toBe(false);
  });

  it('rejects duplicate provenance and graphs that no longer match merged resources', () => {
    const { graph, resources } = createGraphFixture();
    const firstEdge = graph.edges[0];
    if (!firstEdge) throw new Error('Missing resource graph fixture edge.');

    expect(
      isResourceGraph({
        ...graph,
        edges: [...graph.edges, { ...firstEdge, ordinal: graph.edges.length + 1 }],
      }),
    ).toBe(false);
    expect(
      matchesResourceGraph({ ...graph, edges: graph.edges.slice(0, -1) }, ROOT_URL, resources),
    ).toBe(false);
  });
});
