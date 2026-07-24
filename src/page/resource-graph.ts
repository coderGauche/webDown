import {
  isMergedResourceCandidates,
  isResourceDiscoveryEvidence,
  MERGED_RESOURCE_DISCOVERY_SOURCES,
  type MergedResourceCandidate,
  type MergedResourceDiscoverySource,
  type ResourceDiscoveryChannel,
  type ResourceDiscoveryEvidence,
} from './resource-discovery';
import {
  inferResourceMetadata,
  isResourceMetadataInference,
  matchesResourceMetadataInference,
  type ResourceMetadataInference,
} from './resource-inference';
import {
  classifyResourceUrl,
  matchesResourceUrlClassification,
  type ResourceUrlClassification,
} from './resource-protocol';
import { isNormalizedResourceUrl, normalizeResourceUrl } from './resource-url';

export type ResourceGraphNode = {
  ordinal: number;
  url: string;
  discoverySources: MergedResourceDiscoverySource[];
  classification: ResourceUrlClassification;
  inference: ResourceMetadataInference;
};

export type ResourceGraphEdge = {
  ordinal: number;
  sourceUrl: string;
  targetUrl: string;
  source: MergedResourceDiscoverySource;
  channel: ResourceDiscoveryChannel;
  sourceOrdinal: number;
  evidence: ResourceDiscoveryEvidence;
};

export type ResourceGraph = {
  rootUrl: string;
  nodes: ResourceGraphNode[];
  edges: ResourceGraphEdge[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => actualKeys.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function evidenceSourceUrl(evidence: ResourceDiscoveryEvidence, rootUrl: string): string {
  if (evidence.source === 'performance') return rootUrl;
  return normalizeResourceUrl(evidence.candidate.documentUrl) ?? evidence.candidate.documentUrl;
}

function evidenceTargetUrl(evidence: ResourceDiscoveryEvidence): string | null {
  const observedUrl =
    evidence.source === 'performance' ? evidence.candidate.url : evidence.candidate.resolvedUrl;
  return normalizeResourceUrl(observedUrl);
}

export function buildResourceGraph(
  rootUrl: string,
  resources: readonly MergedResourceCandidate[],
): ResourceGraph {
  const normalizedRootUrl = normalizeResourceUrl(rootUrl);
  if (!normalizedRootUrl) throw new TypeError('Resource graph root URL must be an absolute URL.');
  if (!isMergedResourceCandidates(resources)) {
    throw new TypeError('Resource graph input must contain valid merged resources.');
  }

  const nodes: ResourceGraphNode[] = resources.map((resource, index) => {
    const classification = classifyResourceUrl(resource.url);
    if (!classification) throw new TypeError('Resource graph node URL cannot be classified.');
    return {
      ordinal: index + 1,
      url: resource.url,
      discoverySources: [...resource.discoverySources],
      classification,
      inference: inferResourceMetadata(resource.url, resource.evidence),
    };
  });
  const edges: ResourceGraphEdge[] = [];

  for (const resource of resources) {
    for (const evidence of resource.evidence) {
      edges.push({
        ordinal: edges.length + 1,
        sourceUrl: evidenceSourceUrl(evidence, normalizedRootUrl),
        targetUrl: resource.url,
        source: evidence.source,
        channel: evidence.channel,
        sourceOrdinal: evidence.sourceOrdinal,
        evidence,
      });
    }
  }

  return { rootUrl: normalizedRootUrl, nodes, edges };
}

export function isResourceGraphNode(value: unknown): value is ResourceGraphNode {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['ordinal', 'url', 'discoverySources', 'classification', 'inference']) &&
    isPositiveSafeInteger(value.ordinal) &&
    isNormalizedResourceUrl(value.url) &&
    Array.isArray(value.discoverySources) &&
    value.discoverySources.length > 0 &&
    value.discoverySources.every((source) =>
      MERGED_RESOURCE_DISCOVERY_SOURCES.includes(source as MergedResourceDiscoverySource),
    ) &&
    new Set(value.discoverySources).size === value.discoverySources.length &&
    matchesResourceUrlClassification(value.classification, value.url) &&
    isResourceMetadataInference(value.inference)
  );
}

export function isResourceGraphEdge(value: unknown): value is ResourceGraphEdge {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'ordinal',
      'sourceUrl',
      'targetUrl',
      'source',
      'channel',
      'sourceOrdinal',
      'evidence',
    ]) ||
    !isPositiveSafeInteger(value.ordinal) ||
    !isNormalizedResourceUrl(value.sourceUrl) ||
    !isNormalizedResourceUrl(value.targetUrl) ||
    !isPositiveSafeInteger(value.sourceOrdinal) ||
    !isResourceDiscoveryEvidence(value.evidence)
  ) {
    return false;
  }

  const evidence = value.evidence;
  return (
    value.source === evidence.source &&
    value.channel === evidence.channel &&
    value.sourceOrdinal === evidence.sourceOrdinal &&
    value.targetUrl === evidenceTargetUrl(evidence)
  );
}

export function isResourceGraph(value: unknown): value is ResourceGraph {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['rootUrl', 'nodes', 'edges']) ||
    !isNormalizedResourceUrl(value.rootUrl) ||
    !Array.isArray(value.nodes) ||
    !value.nodes.every(isResourceGraphNode) ||
    !Array.isArray(value.edges) ||
    !value.edges.every(isResourceGraphEdge)
  ) {
    return false;
  }

  const graph = value as ResourceGraph;
  if (
    new Set(graph.nodes.map((node) => node.url)).size !== graph.nodes.length ||
    !graph.nodes.every((node, index) => node.ordinal === index + 1) ||
    !graph.edges.every((edge, index) => edge.ordinal === index + 1)
  ) {
    return false;
  }

  const nodeByUrl = new Map(graph.nodes.map((node) => [node.url, node]));
  const edgeKeys = new Set<string>();
  for (const edge of graph.edges) {
    const node = nodeByUrl.get(edge.targetUrl);
    if (!node || edge.sourceUrl !== evidenceSourceUrl(edge.evidence, graph.rootUrl)) return false;
    const key = `${edge.targetUrl}\u0000${edge.channel}\u0000${edge.sourceOrdinal}`;
    if (edgeKeys.has(key)) return false;
    edgeKeys.add(key);
  }

  return graph.nodes.every((node) => {
    const nodeEdges = graph.edges.filter((edge) => edge.targetUrl === node.url);
    const sources = Array.from(new Set(nodeEdges.map((edge) => edge.source)));
    return (
      sources.length === node.discoverySources.length &&
      sources.every((source, index) => source === node.discoverySources[index]) &&
      matchesResourceMetadataInference(
        node.inference,
        node.url,
        nodeEdges.map((edge) => edge.evidence),
      )
    );
  });
}

export function matchesResourceGraph(
  value: unknown,
  rootUrl: string,
  resources: readonly MergedResourceCandidate[],
): value is ResourceGraph {
  return (
    isResourceGraph(value) &&
    JSON.stringify(value) === JSON.stringify(buildResourceGraph(rootUrl, resources))
  );
}
