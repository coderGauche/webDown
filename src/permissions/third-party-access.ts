import type { ResourceType } from '@sitecapsule/domain';
import {
  isResourceGraph,
  type MergedResourceDiscoverySource,
  type ResourceGraph,
  type ResourceGraphEdge,
  type ResourceGraphNode,
} from '@sitecapsule/page';

import {
  resolveSiteAccessTarget,
  type PageAccessContains,
  type PageAccessRequest,
} from './page-access';

export type ThirdPartySiteAccessStatus = 'granted' | 'not-granted';
export const THIRD_PARTY_RESOURCE_POLICIES = ['archive-critical', 'runtime-excluded'] as const;
export type ThirdPartyResourcePolicy = (typeof THIRD_PARTY_RESOURCE_POLICIES)[number];
export const THIRD_PARTY_RESOURCE_POLICY_REASONS = [
  'critical-resource-type',
  'iframe-document',
  'tracking-runtime',
  'payment-runtime',
  'unsupported-runtime-type',
] as const;
export type ThirdPartyResourcePolicyReason = (typeof THIRD_PARTY_RESOURCE_POLICY_REASONS)[number];

export type ThirdPartyResourcePolicyResult = {
  policy: ThirdPartyResourcePolicy;
  reason: ThirdPartyResourcePolicyReason;
};

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
  criticalResourceCount: number;
  excludedResourceCount: number;
  defaultSelected: boolean;
  policyReasons: ThirdPartyResourcePolicyReason[];
};

type MutableThirdPartySummary = Omit<ThirdPartySiteAccessSummary, 'status'>;

function appendUnique<T>(values: T[], additions: readonly T[]): void {
  for (const addition of additions) {
    if (!values.includes(addition)) values.push(addition);
  }
}

const CRITICAL_RESOURCE_TYPES = new Set<ResourceType>([
  'stylesheet',
  'image',
  'font',
  'script',
  'video',
  'audio',
  'data',
  'model',
  'texture',
  'wasm',
]);
const TRACKING_RUNTIME_TOKEN =
  /(?:^|[./_?&=-])(analytics?|tracking|tracker|telemetry|beacon|collect|pixel|doubleclick|googletagmanager|google-analytics|clarity|hotjar|segment|amplitude|mixpanel)(?:[./_?&=-]|$)/i;
const PAYMENT_RUNTIME_TOKEN =
  /(?:^|[./_?&=-])(payments?|checkout|billing|stripe|paypal|adyen|braintree|klarna)(?:[./_?&=-]|$)/i;

export function classifyThirdPartyResourcePolicy(
  node: ResourceGraphNode,
  edges: readonly ResourceGraphEdge[],
): ThirdPartyResourcePolicyResult {
  if (node.inference.resourceType === 'document') {
    return { policy: 'runtime-excluded', reason: 'iframe-document' };
  }
  if (TRACKING_RUNTIME_TOKEN.test(node.url)) {
    return { policy: 'runtime-excluded', reason: 'tracking-runtime' };
  }
  if (PAYMENT_RUNTIME_TOKEN.test(node.url)) {
    return { policy: 'runtime-excluded', reason: 'payment-runtime' };
  }

  const nodeEdges = edges.filter(({ targetUrl }) => targetUrl === node.url);
  if (
    nodeEdges.length > 0 &&
    nodeEdges.every(
      ({ evidence }) =>
        evidence.source === 'performance' &&
        (evidence.candidate.initiatorType === 'beacon' ||
          evidence.candidate.initiatorType === 'ping'),
    )
  ) {
    return { policy: 'runtime-excluded', reason: 'tracking-runtime' };
  }
  return CRITICAL_RESOURCE_TYPES.has(node.inference.resourceType)
    ? { policy: 'archive-critical', reason: 'critical-resource-type' }
    : { policy: 'runtime-excluded', reason: 'unsupported-runtime-type' };
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
  const rootOrigin = rootTarget.origin;
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
    if (target.origin === rootOrigin) continue;
    const policy = classifyThirdPartyResourcePolicy(node, graph.edges);

    const existing = grouped.get(target.permissionPattern);
    if (existing) {
      appendUnique(existing.origins, [target.origin]);
      appendUnique(existing.discoverySources, node.discoverySources);
      appendUnique(existing.resourceTypes, [node.inference.resourceType]);
      appendUnique(existing.policyReasons, [policy.reason]);
      existing.resourceCount += 1;
      existing.provenanceCount += edgeCountByTarget.get(node.url) ?? 0;
      if (policy.policy === 'archive-critical') existing.criticalResourceCount += 1;
      else existing.excludedResourceCount += 1;
      existing.defaultSelected = existing.criticalResourceCount > 0;
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
      criticalResourceCount: policy.policy === 'archive-critical' ? 1 : 0,
      excludedResourceCount: policy.policy === 'runtime-excluded' ? 1 : 0,
      defaultSelected: policy.policy === 'archive-critical',
      policyReasons: [policy.reason],
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
      .filter((summary) => summary.status === 'not-granted' && summary.defaultSelected)
      .map((summary) => summary.permissionPattern),
  );
  const origins = Array.from(
    new Set(selectedPatterns.filter((pattern) => pendingPatterns.has(pattern))),
  );
  return origins.length > 0 ? { origins } : null;
}
