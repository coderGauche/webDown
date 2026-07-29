import { ARCHIVE_METADATA_PATHS } from './archive-layout';
import { sanitizeArchiveFileName } from './resource-file-name';
import {
  ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION,
  type ArchiveRedirectTrace,
  type ArchiveResourceEntry,
  type ArchiveResourceManifest,
} from './resource-manifests';
import { validateArchivePath } from './rewrite-support';
import { createArchiveSha256Hex, SHA_256_HEX_LENGTH } from './sha256';
import type { ZipArchiveEntry } from './zip-codec';

export type ArchiveResourceSha256Input =
  | {
      enabled: false;
      resourceManifest: ArchiveResourceManifest;
      resourceEntries?: never;
    }
  | {
      enabled: true;
      resourceManifest: ArchiveResourceManifest;
      resourceEntries: readonly ZipArchiveEntry[];
    };

export interface ArchiveResourceSha256Result {
  enabled: boolean;
  hashedResources: number;
  resourceManifest: ArchiveResourceManifest;
  resourcesEntry: ZipArchiveEntry;
}

export class ArchiveResourceSha256Error extends Error {
  readonly localPath: string;
  override readonly cause: unknown;

  constructor(localPath: string, cause: unknown) {
    super(`Failed to compute SHA-256 for archive resource: ${localPath}`);
    this.name = 'ArchiveResourceSha256Error';
    this.localPath = localPath;
    this.cause = cause;
  }
}

const DISABLED_INPUT_KEYS = ['enabled', 'resourceManifest'] as const;
const ENABLED_INPUT_KEYS = ['enabled', 'resourceManifest', 'resourceEntries'] as const;
const MANIFEST_KEYS = ['formatVersion', 'resources'] as const;
const RESOURCE_KEYS = [
  'originalUrl',
  'finalUrl',
  'referrerUrl',
  'localPath',
  'resourceType',
  'discoverySources',
  'redirectTrace',
  'mimeType',
  'httpStatus',
  'byteLength',
  'sha256',
] as const;
const UTF8_ENCODER = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validatePortablePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty archive path.`);
  }
  const segments = validateArchivePath(value, label);
  if (segments.some((segment) => sanitizeArchiveFileName(segment) !== segment)) {
    throw new TypeError(`${label} must be portable.`);
  }
  return value;
}

function cloneRedirectTrace(value: ArchiveRedirectTrace | null): ArchiveRedirectTrace | null {
  if (value === null) return null;
  return {
    complete: value.complete,
    hops: value.hops.map((hop) => ({ ...hop })),
  };
}

function cloneResource(value: unknown, index: number): ArchiveResourceEntry {
  const label = `Archive integrity resource at index ${index}`;
  if (!isRecord(value) || !hasExactKeys(value, RESOURCE_KEYS)) {
    throw new TypeError(`${label} must contain exactly the supported fields.`);
  }
  const localPath = validatePortablePath(value.localPath, `${label} local path`);
  if (!Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 0) {
    throw new TypeError(`${label} byte length must be a non-negative safe integer.`);
  }
  if (
    value.sha256 !== null &&
    (typeof value.sha256 !== 'string' ||
      !new RegExp(`^[a-f0-9]{${SHA_256_HEX_LENGTH}}$`).test(value.sha256))
  ) {
    throw new TypeError(`${label} SHA-256 must be null or a lowercase digest.`);
  }
  if (!Array.isArray(value.discoverySources)) {
    throw new TypeError(`${label} discovery sources must be an array.`);
  }

  const resource = value as unknown as ArchiveResourceEntry;
  return {
    originalUrl: resource.originalUrl,
    finalUrl: resource.finalUrl,
    referrerUrl: resource.referrerUrl,
    localPath,
    resourceType: resource.resourceType,
    discoverySources: [...resource.discoverySources],
    redirectTrace: cloneRedirectTrace(resource.redirectTrace),
    mimeType: resource.mimeType,
    httpStatus: resource.httpStatus,
    byteLength: resource.byteLength,
    sha256: resource.sha256,
  };
}

function cloneManifest(value: unknown): ArchiveResourceManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, MANIFEST_KEYS) ||
    value.formatVersion !== ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION ||
    !Array.isArray(value.resources)
  ) {
    throw new TypeError('Archive integrity resourceManifest is not a supported manifest.');
  }
  const resources = value.resources.map(cloneResource);
  const seenPaths = new Set<string>();
  for (const resource of resources) {
    const key = resource.localPath.normalize('NFC').toLowerCase();
    if (seenPaths.has(key)) {
      throw new Error(`Archive integrity resource path is not unique: ${resource.localPath}`);
    }
    seenPaths.add(key);
  }
  return { formatVersion: ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION, resources };
}

function encodeResourceManifest(manifest: ArchiveResourceManifest): Uint8Array {
  return UTF8_ENCODER.encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

function createResult(
  enabled: boolean,
  manifest: ArchiveResourceManifest,
  hashedResources: number,
): ArchiveResourceSha256Result {
  return {
    enabled,
    hashedResources,
    resourceManifest: manifest,
    resourcesEntry: {
      path: ARCHIVE_METADATA_PATHS.resources,
      bytes: encodeResourceManifest(manifest),
    },
  };
}

function validateResourceEntries(
  value: unknown,
  resources: readonly ArchiveResourceEntry[],
): Map<string, Uint8Array> {
  if (!Array.isArray(value)) {
    throw new TypeError('Archive integrity resourceEntries must be an array when enabled.');
  }
  const entries = new Map<string, Uint8Array>();
  const portablePaths = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const label = `Archive integrity entry at index ${index}`;
    if (!isRecord(entry) || !hasExactKeys(entry, ['path', 'bytes'])) {
      throw new TypeError(`${label} must contain exactly path and bytes.`);
    }
    const path = validatePortablePath(entry.path, `${label} path`);
    if (!(entry.bytes instanceof Uint8Array)) {
      throw new TypeError(`${label} bytes must be a Uint8Array.`);
    }
    const portableKey = path.normalize('NFC').toLowerCase();
    if (portablePaths.has(portableKey)) {
      throw new Error(`Archive integrity entry path is not unique: ${path}`);
    }
    portablePaths.add(portableKey);
    entries.set(path, new Uint8Array(entry.bytes));
  }

  const resourcePaths = new Set(resources.map(({ localPath }) => localPath));
  for (const entryPath of entries.keys()) {
    if (!resourcePaths.has(entryPath)) {
      throw new Error(`Archive integrity entry has no saved resource: ${entryPath}`);
    }
  }
  for (const resource of resources) {
    const bytes = entries.get(resource.localPath);
    if (!bytes) {
      throw new Error(`Archive integrity bytes are missing for resource: ${resource.localPath}`);
    }
    if (bytes.byteLength !== resource.byteLength) {
      throw new Error(`Archive integrity byte length does not match: ${resource.localPath}`);
    }
  }
  return entries;
}

export async function applyArchiveResourceSha256(
  input: ArchiveResourceSha256Input,
): Promise<ArchiveResourceSha256Result> {
  if (!isRecord(input) || typeof input.enabled !== 'boolean') {
    throw new TypeError('Archive resource SHA-256 input must be an object with an enabled flag.');
  }
  const expectedKeys = input.enabled ? ENABLED_INPUT_KEYS : DISABLED_INPUT_KEYS;
  if (!hasExactKeys(input, expectedKeys)) {
    throw new TypeError(
      'Archive resource SHA-256 input must contain exactly the supported fields.',
    );
  }
  const manifest = cloneManifest(input.resourceManifest);

  if (!input.enabled) {
    return createResult(
      false,
      {
        formatVersion: manifest.formatVersion,
        resources: manifest.resources.map((resource) => ({ ...resource, sha256: null })),
      },
      0,
    );
  }
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable.');

  const entries = validateResourceEntries(input.resourceEntries, manifest.resources);
  const resources: ArchiveResourceEntry[] = [];
  for (const resource of manifest.resources) {
    try {
      resources.push({
        ...resource,
        sha256: await createArchiveSha256Hex(entries.get(resource.localPath)!),
      });
    } catch (cause) {
      throw new ArchiveResourceSha256Error(resource.localPath, cause);
    }
  }
  return createResult(
    true,
    { formatVersion: ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION, resources },
    resources.length,
  );
}
