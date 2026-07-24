import type { ResourceType } from '@sitecapsule/domain';
import {
  isResourceGraph,
  type MergedResourceDiscoverySource,
  type ResourceGraph,
} from '@sitecapsule/page';

import {
  resolveSiteAccessTarget,
  type PageAccessContains,
  type PageAccessRequest,
} from './page-access';

export type ThirdPartySiteAccessStatus = 'granted' | 'not-granted';

export type ThirdPartySiteAccessSummary = {
  status: ThirdPartySiteAccessStatus;
  permissionPattern: string;
  scheme: 'http:' | 'https:';
  hostname: string;
  origins: string[];
  resourceCount: number;
  provenanceCount: number;
  discoverySources: MergedResourceDiscoverySource[];
  resourceTypes: ResourceType[];
};

type MutableThirdPartySummary = Omit<ThirdPartySiteAccessSummary, 'status'>;

function appendUnique<T>(values: T[], additions: readonly T[]): void {
  for (const addition of additions) {
    if (!values.includes(addition)) values.push(addition);
  }
}

export async function summarizeThirdPartySiteAccess(
  graph: ResourceGraph,
  contains: PageAccessContains,
): Promise<ThirdPartySiteAccessSummary[]> {
  if (!isResourceGraph(graph)) {
    throw new TypeError('Third-party access summary requires a valid resource graph.');
  }

  const rootTarget = resolveSiteAccessTarget(graph.rootUrl);
  if ('reason' in rootTarget) {
    throw new TypeError('Third-party access summary requires an HTTP or HTTPS root URL.');
  }
  const rootHostname = new URL(rootTarget.pageUrl).hostname;
  const edgeCountByTarget = new Map<string, number>();
  for (const edge of graph.edges) {
    edgeCountByTarget.set(edge.targetUrl, (edgeCountByTarget.get(edge.targetUrl) ?? 0) + 1);
  }

  const grouped = new Map<string, MutableThirdPartySummary>();
  for (const node of graph.nodes) {
    if (node.classification.kind !== 'network' || !node.classification.networkFetchEligible) {
      continue;
    }

    const target = resolveSiteAccessTarget(node.url);
    if ('reason' in target) continue;
    const parsedUrl = new URL(target.pageUrl);
    if (parsedUrl.hostname === rootHostname) continue;

    const existing = grouped.get(target.permissionPattern);
    if (existing) {
      appendUnique(existing.origins, [target.origin]);
      appendUnique(existing.discoverySources, node.discoverySources);
      appendUnique(existing.resourceTypes, [node.inference.resourceType]);
      existing.resourceCount += 1;
      existing.provenanceCount += edgeCountByTarget.get(node.url) ?? 0;
      continue;
    }

    grouped.set(target.permissionPattern, {
      permissionPattern: target.permissionPattern,
      scheme: node.classification.protocol,
      hostname: parsedUrl.hostname,
      origins: [target.origin],
      resourceCount: 1,
      provenanceCount: edgeCountByTarget.get(node.url) ?? 0,
      discoverySources: [...node.discoverySources],
      resourceTypes: [node.inference.resourceType],
    });
  }

  const summaries: ThirdPartySiteAccessSummary[] = [];
  for (const summary of grouped.values()) {
    const granted = await contains({ origins: [summary.permissionPattern] });
    summaries.push({ ...summary, status: granted ? 'granted' : 'not-granted' });
  }
  return summaries;
}

export function createThirdPartyAccessRequest(
  summaries: readonly ThirdPartySiteAccessSummary[],
  selectedPatterns: readonly string[],
): PageAccessRequest | null {
  const pendingPatterns = new Set(
    summaries
      .filter((summary) => summary.status === 'not-granted')
      .map((summary) => summary.permissionPattern),
  );
  const origins = Array.from(
    new Set(selectedPatterns.filter((pattern) => pendingPatterns.has(pattern))),
  );
  return origins.length > 0 ? { origins } : null;
}
