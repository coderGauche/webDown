import type { ResourceRecord } from '@sitecapsule/domain';
import { normalizeResourceUrl } from '@sitecapsule/page';

import { createResourcePathMappings, type ResourcePathMapping } from './resource-path-mapping';

export type RuntimeResourcePathPlan = {
  resources: ResourceRecord[];
  mappings: ResourcePathMapping[];
};

function mappingKey(resourceType: ResourceRecord['type'], normalizedUrl: string): string {
  return `${resourceType}\u0000${normalizedUrl}`;
}

export async function createRuntimeResourcePathPlan(
  resources: readonly ResourceRecord[],
  primaryResourceId: string,
): Promise<RuntimeResourcePathPlan> {
  const savedAssets = resources.filter(
    (resource) => resource.state === 'saved' && resource.id !== primaryResourceId,
  );
  const mappings = await createResourcePathMappings(
    savedAssets.map((resource) => ({
      url: resource.finalUrl ?? resource.originalUrl,
      resourceType: resource.type,
    })),
  );
  const mappingsByIdentity = new Map(
    mappings.map((mapping) => [mappingKey(mapping.resourceType, mapping.normalizedUrl), mapping]),
  );
  const plannedResources = resources.map((resource) => {
    if (resource.state !== 'saved' || resource.id === primaryResourceId) return resource;
    const normalizedUrl = normalizeResourceUrl(resource.finalUrl ?? resource.originalUrl);
    const mapping = normalizedUrl
      ? mappingsByIdentity.get(mappingKey(resource.type, normalizedUrl))
      : undefined;
    if (!mapping) {
      throw new TypeError('Saved secondary resource requires a local path mapping.');
    }
    return { ...resource, localPath: mapping.relativePath };
  });

  return { resources: plannedResources, mappings };
}
