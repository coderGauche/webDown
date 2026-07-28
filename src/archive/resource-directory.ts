import { RESOURCE_TYPES, type ResourceType } from '@sitecapsule/domain';
import { normalizeResourceUrl } from '@sitecapsule/page';

export const ARCHIVE_ASSET_ROOT = 'assets';

export const RESOURCE_TYPE_DIRECTORIES = {
  document: 'documents',
  stylesheet: 'css',
  image: 'images',
  font: 'fonts',
  script: 'js',
  video: 'media',
  audio: 'media',
  wasm: 'wasm',
  manifest: 'manifests',
  model: 'models',
  texture: 'textures',
  data: 'data',
  other: 'other',
} as const satisfies Record<ResourceType, string>;

export type ResourceTypeDirectory = (typeof RESOURCE_TYPE_DIRECTORIES)[ResourceType];

export type ResourceOriginDirectory = {
  normalizedUrl: string;
  origin: string;
  schemeDirectory: 'http' | 'https';
  hostDirectory: string;
  portDirectory: 'default' | `port-${number}`;
  originDirectory: string;
};

export type ResourceDirectoryMapping = ResourceOriginDirectory & {
  resourceType: ResourceType;
  typeDirectory: ResourceTypeDirectory;
  directoryPath: string;
};

function isResourceType(value: unknown): value is ResourceType {
  return RESOURCE_TYPES.includes(value as ResourceType);
}

function createHostDirectory(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return `ipv6-${hostname.slice(1, -1).replaceAll(':', '-')}`;
  }
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return `ipv4-${hostname}`;
  return `dns-${hostname}`;
}

export function createResourceOriginDirectory(value: string): ResourceOriginDirectory {
  const normalizedUrl = normalizeResourceUrl(value);
  if (normalizedUrl === null) {
    throw new TypeError('Resource directory requires an absolute URL.');
  }

  const url = new URL(normalizedUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RangeError('Resource directory only supports HTTP and HTTPS URLs.');
  }
  if (url.username || url.password) {
    throw new RangeError('Resource directory URL must not contain credentials.');
  }

  const schemeDirectory = url.protocol.slice(0, -1) as 'http' | 'https';
  const hostDirectory = createHostDirectory(url.hostname);
  const portDirectory = url.port === '' ? 'default' : (`port-${Number(url.port)}` as const);
  const originDirectory = `origins/${schemeDirectory}/${hostDirectory}/${portDirectory}`;

  return {
    normalizedUrl,
    origin: url.origin,
    schemeDirectory,
    hostDirectory,
    portDirectory,
    originDirectory,
  };
}

export function getResourceTypeDirectory(value: unknown): ResourceTypeDirectory {
  if (!isResourceType(value)) throw new TypeError('Resource type is not supported.');
  return RESOURCE_TYPE_DIRECTORIES[value];
}

export function createResourceDirectoryMapping(
  url: string,
  resourceType: ResourceType,
): ResourceDirectoryMapping {
  const origin = createResourceOriginDirectory(url);
  const typeDirectory = getResourceTypeDirectory(resourceType);
  return {
    ...origin,
    resourceType,
    typeDirectory,
    directoryPath: `${ARCHIVE_ASSET_ROOT}/${origin.originDirectory}/${typeDirectory}`,
  };
}
