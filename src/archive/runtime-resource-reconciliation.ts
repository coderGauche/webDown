import {
  RESOURCE_DISCOVERY_SOURCES,
  createCaptureError,
  type ResourceDiscoverySource,
  type ResourceRecord,
} from '@sitecapsule/domain';
import { normalizeResourceUrl } from '@sitecapsule/page';

export type RuntimeResourceReconciliation = {
  resources: ResourceRecord[];
  rejectedResourceIds: string[];
};

function discoverySourceOrder(source: ResourceDiscoverySource): number {
  return RESOURCE_DISCOVERY_SOURCES.indexOf(source);
}

function mergeDiscoverySources(group: readonly ResourceRecord[]): ResourceDiscoverySource[] {
  return Array.from(new Set(group.flatMap((resource) => resource.discoverySources))).sort(
    (left, right) => discoverySourceOrder(left) - discoverySourceOrder(right),
  );
}

function rejectSavedResource(resource: ResourceRecord, field: string): ResourceRecord {
  const { localPath: _localPath, sha256: _sha256, ...base } = resource;
  return {
    ...base,
    state: 'failed',
    error: createCaptureError('unexpected-error', {
      operation: 'archive-package',
      jobId: resource.jobId,
      resourceId: resource.id,
      url: resource.originalUrl,
      resourceType: resource.type,
      stage: 'rewriting',
      field,
      affectsPrimaryVisual: false,
    }),
  };
}

/**
 * Redirects can make distinct discoveries resolve to one final URL. The archive
 * must store that byte resource once, otherwise URL rewriting becomes ambiguous
 * and the ZIP would contain duplicate paths.
 */
export function reconcileRuntimeArchiveResources(
  resources: readonly ResourceRecord[],
): RuntimeResourceReconciliation {
  const groups = new Map<string, ResourceRecord[]>();
  const invalidIds = new Set<string>();

  for (const resource of resources) {
    if (resource.state !== 'saved' || resource.type === 'document') continue;
    const normalizedUrl = normalizeResourceUrl(resource.finalUrl ?? resource.originalUrl);
    if (!normalizedUrl || !/^https?:\/\//.test(normalizedUrl)) {
      invalidIds.add(resource.id);
      continue;
    }
    const group = groups.get(normalizedUrl);
    if (group) group.push(resource);
    else groups.set(normalizedUrl, [resource]);
  }

  const winnerById = new Map<string, ResourceRecord>();
  const duplicateIds = new Set<string>();
  for (const group of groups.values()) {
    group.sort((left, right) => left.id.localeCompare(right.id));
    const winner = group[0]!;
    winnerById.set(winner.id, {
      ...winner,
      discoverySources: mergeDiscoverySources(group),
    });
    for (const duplicate of group.slice(1)) duplicateIds.add(duplicate.id);
  }

  const rejectedResourceIds = [...invalidIds, ...duplicateIds].sort((left, right) =>
    left.localeCompare(right),
  );
  return {
    resources: resources.map((resource) => {
      if (invalidIds.has(resource.id)) return rejectSavedResource(resource, 'finalUrl');
      if (duplicateIds.has(resource.id)) return rejectSavedResource(resource, 'duplicateFinalUrl');
      return winnerById.get(resource.id) ?? resource;
    }),
    rejectedResourceIds,
  };
}
