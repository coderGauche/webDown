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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function createRuntimeResourcePathPlan(
  resources: readonly ResourceRecord[],
  primaryResourceId: string,
): Promise<RuntimeResourcePathPlan> {
  const savedAssets = resources.filter(
    (resource) => resource.state === 'saved' && resource.id !== primaryResourceId,
  );
  const baseMappings = await createResourcePathMappings(
    savedAssets.map((resource) => ({
      url: resource.finalUrl ?? resource.originalUrl,
      resourceType: resource.type,
    })),
  );
  const aliasesByIdentity = new Map<string, Set<string>>();
  for (const resource of savedAssets) {
    const normalizedUrl = normalizeResourceUrl(resource.finalUrl ?? resource.originalUrl);
    if (!normalizedUrl) continue;
    const identity = mappingKey(resource.type, normalizedUrl);
    const aliases = aliasesByIdentity.get(identity) ?? new Set<string>();
    aliases.add(resource.originalUrl);
    if (resource.finalUrl) aliases.add(resource.finalUrl);
    aliasesByIdentity.set(identity, aliases);
  }
  const mappings = baseMappings.map((mapping): ResourcePathMapping => ({
    ...mapping,
    originalUrls: [
      ...new Set([
        ...mapping.originalUrls,
        ...(aliasesByIdentity.get(mappingKey(mapping.resourceType, mapping.normalizedUrl)) ?? []),
      ]),
    ].sort(compareText),
  }));
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
