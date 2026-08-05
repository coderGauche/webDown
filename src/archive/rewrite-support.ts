import { normalizeResourceUrl } from '@sitecapsule/page';

import type { ResourcePathMapping } from './resource-path-mapping';

const NETWORK_PROTOCOLS = new Set(['http:', 'https:']);

export function validateArchivePath(value: string, label: string): string[] {
  if (typeof value !== 'string' || value === '' || value.startsWith('/') || value.includes('\\')) {
    throw new TypeError(`${label} must be a relative POSIX archive path.`);
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError(`${label} must not contain empty or dot path segments.`);
  }
  return segments;
}

export function createRelativeArchivePath(fromFile: string, toFile: string): string {
  const fromSegments = validateArchivePath(fromFile, 'Source archive path');
  const toSegments = validateArchivePath(toFile, 'Target archive path');
  const fromDirectory = fromSegments.slice(0, -1);
  let commonLength = 0;

  while (
    commonLength < fromDirectory.length &&
    commonLength < toSegments.length &&
    fromDirectory[commonLength] === toSegments[commonLength]
  ) {
    commonLength += 1;
  }

  return [
    ...Array.from({ length: fromDirectory.length - commonLength }, () => '..'),
    ...toSegments.slice(commonLength),
  ].join('/');
}

function encodeRelativeArchiveReference(relativePath: string): string {
  return relativePath
    .split('/')
    .map((segment) => (segment === '..' ? segment : encodeURIComponent(segment)))
    .join('/');
}

export function createLocalArchiveReference(
  fromFile: string,
  toFile: string,
  fragment = '',
): string {
  if (fragment !== '' && !fragment.startsWith('#')) {
    throw new TypeError('Archive reference fragment must start with #.');
  }
  return `${encodeRelativeArchiveReference(createRelativeArchivePath(fromFile, toFile))}${fragment}`;
}

export function validateNetworkUrl(value: string, label: string): string {
  const normalized = normalizeResourceUrl(value);
  if (normalized === null) throw new TypeError(`${label} must be an absolute URL.`);

  const url = new URL(normalized);
  if (!NETWORK_PROTOCOLS.has(url.protocol)) {
    throw new RangeError(`${label} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password) throw new RangeError(`${label} must not contain credentials.`);
  return normalized;
}

export function isNetworkProtocol(protocol: string): boolean {
  return NETWORK_PROTOCOLS.has(protocol);
}

export function buildSavedResourceLookup(
  mappings: readonly ResourcePathMapping[],
): Map<string, ResourcePathMapping> {
  if (!Array.isArray(mappings)) throw new TypeError('Saved resource mappings must be an array.');

  const lookup = new Map<string, ResourcePathMapping>();
  for (const mapping of mappings) {
    if (!mapping || typeof mapping !== 'object') {
      throw new TypeError('Saved resource mapping must be an object.');
    }
    validateArchivePath(mapping.relativePath, 'Saved resource path');
    const normalizedUrl = validateNetworkUrl(mapping.normalizedUrl, 'Saved resource URL');
    if (normalizedUrl !== mapping.normalizedUrl) {
      throw new TypeError('Saved resource URL must be normalized.');
    }

    const aliases = [mapping.normalizedUrl, ...mapping.originalUrls];
    for (const alias of aliases) {
      const normalizedAlias = validateNetworkUrl(alias, 'Saved resource URL alias');
      const existing = lookup.get(normalizedAlias);
      if (existing && existing.relativePath !== mapping.relativePath) {
        throw new Error('Saved resource URL has ambiguous archive paths.');
      }
      lookup.set(normalizedAlias, mapping);
    }
  }
  return lookup;
}
