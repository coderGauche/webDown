import {
  RESOURCE_DISCOVERY_SOURCES,
  RESOURCE_TYPES,
  isCaptureError,
  type CaptureError,
  type CaptureErrorCode,
  type CaptureErrorOperation,
  type JobStatus,
  type ResourceDiscoverySource,
  type ResourceRecord,
  type ResourceRedirectTrace,
  type ResourceType,
} from '@sitecapsule/domain';

import { ARCHIVE_METADATA_PATHS } from './archive-layout';
import { sanitizeArchiveNetworkUrl } from './archive-manifest';
import {
  appendArchiveFileNameSuffix,
  createResourceFileName,
  sanitizeArchiveFileName,
} from './resource-file-name';
import { createResourceDirectoryMapping } from './resource-directory';
import type { ResourcePathMapping } from './resource-path-mapping';
import { validateArchivePath, validateNetworkUrl } from './rewrite-support';
import type { ZipArchiveEntry } from './zip-codec';

export const ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION = 1;

export interface ArchiveRedirectHop {
  fromUrl: string;
  toUrl: string;
  httpStatus: number | null;
}

export interface ArchiveRedirectTrace {
  complete: boolean;
  hops: ArchiveRedirectHop[];
}

export interface ArchiveResourceEntry {
  originalUrl: string;
  finalUrl: string;
  referrerUrl: string;
  localPath: string;
  resourceType: ResourceType;
  discoverySources: ResourceDiscoverySource[];
  redirectTrace: ArchiveRedirectTrace | null;
  mimeType: string | null;
  httpStatus: number | null;
  byteLength: number;
  sha256: string | null;
}

export interface ArchiveResourceError {
  code: CaptureErrorCode;
  message: string;
  retryable: boolean;
  suggestion: string | null;
  operation: CaptureErrorOperation | null;
  stage: JobStatus | null;
  httpStatus: number | null;
  browserError: string | null;
  affectsPrimaryVisual: boolean | null;
}

export interface ArchiveUnsavedResourceEntry {
  originalUrl: string;
  finalUrl: string | null;
  referrerUrl: string;
  resourceType: ResourceType;
  discoverySources: ResourceDiscoverySource[];
  redirectTrace: ArchiveRedirectTrace | null;
  mimeType: string | null;
  httpStatus: number | null;
  byteLength: number | null;
  error: ArchiveResourceError | null;
}

export interface ArchiveResourceManifest {
  formatVersion: typeof ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION;
  resources: ArchiveResourceEntry[];
}

export interface ArchiveFailureManifest {
  formatVersion: typeof ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION;
  failures: ArchiveUnsavedResourceEntry[];
  skipped: ArchiveUnsavedResourceEntry[];
}

export interface ArchiveOriginalUrlMapping {
  originalUrl: string;
  finalUrl: string;
  localPath: string;
  resourceType: ResourceType;
}

export interface ArchiveOriginalUrlsManifest {
  formatVersion: typeof ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION;
  mappings: ArchiveOriginalUrlMapping[];
}

export interface ArchiveResourceManifestsInput {
  jobId: string;
  resourceRecords: readonly ResourceRecord[];
  pathMappings: readonly ResourcePathMapping[];
}

export interface ArchiveResourceManifests {
  resources: ArchiveResourceManifest;
  failures: ArchiveFailureManifest;
  originalUrls: ArchiveOriginalUrlsManifest;
}

const INPUT_KEYS = ['jobId', 'resourceRecords', 'pathMappings'] as const;
const RECORD_KEYS = [
  'id',
  'jobId',
  'originalUrl',
  'finalUrl',
  'referrerUrl',
  'type',
  'discoverySources',
  'redirectTrace',
  'mimeType',
  'httpStatus',
  'localPath',
  'byteLength',
  'sha256',
  'state',
  'error',
] as const;
const MAPPING_KEYS = [
  'normalizedUrl',
  'originalUrls',
  'resourceType',
  'directoryPath',
  'baseFileName',
  'queryHash',
  'collisionHash',
  'fileName',
  'relativePath',
] as const;
const TERMINAL_RESOURCE_STATES = new Set(['saved', 'failed', 'skipped']);
// Keep this in lockstep with the RFC token grammar accepted by the download
// response normalizer. Packaging must not reject metadata that fetching accepted.
const MIME_TYPE_PATTERN = /^[!#$%&'*+.^_`|~0-9a-z-]+\/[!#$%&'*+.^_`|~0-9a-z-]+$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const UTF8_ENCODER = new TextEncoder();

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function validateOptionalHttpStatus(value: unknown, label: string): number | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < 100 || (value as number) > 599) {
    throw new RangeError(`${label} must be an HTTP status from 100 through 599.`);
  }
  return value as number;
}

function validateOptionalByteLength(value: unknown, label: string): number | null {
  if (value === undefined) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function validateOptionalMimeType(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !MIME_TYPE_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a normalized MIME type essence.`);
  }
  return value;
}

function validateOptionalSha256(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !SHA_256_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 hex digest.`);
  }
  return value;
}

function normalizeDiscoverySources(value: unknown, label: string): ResourceDiscoverySource[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array.`);
  }
  const sources = value.map((source, index) => {
    if (!RESOURCE_DISCOVERY_SOURCES.includes(source as ResourceDiscoverySource)) {
      throw new TypeError(`${label} at index ${index} is not supported.`);
    }
    return source as ResourceDiscoverySource;
  });
  return Array.from(new Set(sources)).sort(
    (left, right) =>
      RESOURCE_DISCOVERY_SOURCES.indexOf(left) - RESOURCE_DISCOVERY_SOURCES.indexOf(right),
  );
}

function sanitizeDiagnosticUrl(value: unknown, label: string): string {
  const raw = requireNonEmptyString(value, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError(`${label} must be an absolute URL.`);
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return sanitizeArchiveNetworkUrl(raw, label, true);
  }
  if (url.protocol === 'data:') return 'data:REDACTED';
  if (url.protocol === 'blob:') {
    try {
      const innerUrl = new URL(raw.slice('blob:'.length));
      if (innerUrl.protocol === 'http:' || innerUrl.protocol === 'https:') {
        return `blob:${innerUrl.origin}/REDACTED`;
      }
    } catch {
      // The scheme is still useful while the opaque value remains private.
    }
    return 'blob:REDACTED';
  }
  return `${url.protocol}REDACTED`;
}

function normalizeRedirectTrace(
  value: unknown,
  record: ResourceRecord,
  label: string,
): ArchiveRedirectTrace | null {
  if (value === undefined) return null;
  if (!isRecord(value) || !hasExactKeys(value, ['complete', 'hops'])) {
    throw new TypeError(`${label} must contain exactly complete and hops.`);
  }
  if (typeof value.complete !== 'boolean' || !Array.isArray(value.hops)) {
    throw new TypeError(`${label} must contain a boolean and a hop array.`);
  }
  if (!value.complete && value.hops.length !== 1) {
    throw new TypeError(`${label} incomplete traces must contain exactly one hop.`);
  }

  let previousTarget: string | null = null;
  const hops = value.hops.map((hop, index): ArchiveRedirectHop => {
    if (!isRecord(hop) || !hasOnlyKeys(hop, ['fromUrl', 'toUrl', 'httpStatus'])) {
      throw new TypeError(`${label} hop ${index} contains unsupported fields.`);
    }
    const fromIdentity = validateNetworkUrl(
      requireNonEmptyString(hop.fromUrl, `${label} hop ${index} from URL`),
      `${label} hop ${index} from URL`,
    );
    const toIdentity = validateNetworkUrl(
      requireNonEmptyString(hop.toUrl, `${label} hop ${index} to URL`),
      `${label} hop ${index} to URL`,
    );
    if (previousTarget !== null && previousTarget !== fromIdentity) {
      throw new Error(`${label} hops must form a continuous redirect chain.`);
    }
    previousTarget = toIdentity;
    const httpStatus = validateOptionalHttpStatus(hop.httpStatus, `${label} hop ${index} status`);
    if (httpStatus !== null && (httpStatus < 300 || httpStatus > 399)) {
      throw new RangeError(`${label} hop ${index} status must be a redirect status.`);
    }
    return {
      fromUrl: sanitizeArchiveNetworkUrl(hop.fromUrl, `${label} hop ${index} from URL`, true),
      toUrl: sanitizeArchiveNetworkUrl(hop.toUrl, `${label} hop ${index} to URL`, true),
      httpStatus,
    };
  });

  if (hops.length > 0) {
    const originalIdentity = validateNetworkUrl(record.originalUrl, `${label} original URL`);
    const finalIdentity = validateNetworkUrl(
      record.finalUrl ?? record.originalUrl,
      `${label} final URL`,
    );
    const rawTrace = value as unknown as ResourceRedirectTrace;
    const firstIdentity = validateNetworkUrl(rawTrace.hops[0]!.fromUrl, `${label} first URL`);
    const lastIdentity = validateNetworkUrl(
      rawTrace.hops[rawTrace.hops.length - 1]!.toUrl,
      `${label} last URL`,
    );
    if (firstIdentity !== originalIdentity || lastIdentity !== finalIdentity) {
      throw new Error(`${label} endpoints must match the resource URLs.`);
    }
  }
  return { complete: value.complete, hops };
}

function normalizeResourceError(
  error: CaptureError,
  record: ResourceRecord,
  httpStatus: number | null,
  label: string,
): ArchiveResourceError {
  if (!isCaptureError(error)) throw new TypeError(`${label} must be a valid CaptureError.`);
  const context = error.context;
  if (context?.jobId !== undefined && context.jobId !== record.jobId) {
    throw new Error(`${label} job does not match its resource.`);
  }
  if (context?.resourceId !== undefined && context.resourceId !== record.id) {
    throw new Error(`${label} resource ID does not match its resource.`);
  }
  if (context?.resourceType !== undefined && context.resourceType !== record.type) {
    throw new Error(`${label} resource type does not match its resource.`);
  }
  if (
    context?.httpStatus !== undefined &&
    httpStatus !== null &&
    context.httpStatus !== httpStatus
  ) {
    throw new Error(`${label} HTTP status does not match its resource.`);
  }
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    suggestion: error.suggestion ?? null,
    operation: context?.operation ?? null,
    stage: context?.stage ?? null,
    httpStatus: context?.httpStatus ?? httpStatus,
    browserError: context?.browserError ?? null,
    affectsPrimaryVisual: context?.affectsPrimaryVisual ?? null,
  };
}

function validatePathMapping(mapping: unknown, index: number): ResourcePathMapping {
  const label = `Resource path mapping at index ${index}`;
  if (!isRecord(mapping) || !hasExactKeys(mapping, MAPPING_KEYS)) {
    throw new TypeError(`${label} must contain exactly the supported fields.`);
  }
  if (!RESOURCE_TYPES.includes(mapping.resourceType as ResourceType)) {
    throw new TypeError(`${label} resource type is not supported.`);
  }
  const normalizedUrl = validateNetworkUrl(
    requireNonEmptyString(mapping.normalizedUrl, `${label} normalized URL`),
    `${label} normalized URL`,
  );
  if (normalizedUrl !== mapping.normalizedUrl) {
    throw new TypeError(`${label} URL must already be normalized.`);
  }
  const directoryPath = requireNonEmptyString(mapping.directoryPath, `${label} directory`);
  const fileName = requireNonEmptyString(mapping.fileName, `${label} file name`);
  const relativePath = requireNonEmptyString(mapping.relativePath, `${label} relative path`);
  const pathSegments = validateArchivePath(relativePath, `${label} relative path`);
  if (pathSegments.some((segment) => sanitizeArchiveFileName(segment) !== segment)) {
    throw new TypeError(`${label} relative path must be portable.`);
  }
  if (!relativePath.startsWith('assets/') || relativePath !== `${directoryPath}/${fileName}`) {
    throw new Error(`${label} relative path is inconsistent with its directory and file name.`);
  }
  const baseFileName = requireNonEmptyString(mapping.baseFileName, `${label} base file name`);
  const expectedDirectory = createResourceDirectoryMapping(
    normalizedUrl,
    mapping.resourceType as ResourceType,
  );
  if (directoryPath !== expectedDirectory.directoryPath) {
    throw new Error(`${label} directory does not match its URL and resource type.`);
  }
  if (
    baseFileName !== createResourceFileName(normalizedUrl, mapping.resourceType as ResourceType)
  ) {
    throw new Error(`${label} base file name does not match its URL and resource type.`);
  }
  if (!Array.isArray(mapping.originalUrls) || mapping.originalUrls.length === 0) {
    throw new TypeError(`${label} original URLs must be a non-empty array.`);
  }
  for (const [urlIndex, originalUrl] of mapping.originalUrls.entries()) {
    const originalIdentity = validateNetworkUrl(
      requireNonEmptyString(originalUrl, `${label} original URL ${urlIndex}`),
      `${label} original URL ${urlIndex}`,
    );
    if (originalIdentity !== normalizedUrl) {
      throw new Error(`${label} original URL ${urlIndex} does not match its normalized URL.`);
    }
  }
  if (
    mapping.queryHash !== null &&
    (typeof mapping.queryHash !== 'string' || !/^[a-f0-9]{12}$/.test(mapping.queryHash))
  ) {
    throw new TypeError(`${label} query hash is invalid.`);
  }
  if ((new URL(normalizedUrl).search === '') !== (mapping.queryHash === null)) {
    throw new Error(`${label} query hash presence does not match its URL.`);
  }
  if (
    mapping.collisionHash !== null &&
    (typeof mapping.collisionHash !== 'string' ||
      !/^[a-f0-9]{12,64}$/.test(mapping.collisionHash) ||
      (mapping.collisionHash.length - 12) % 4 !== 0)
  ) {
    throw new TypeError(`${label} collision hash is invalid.`);
  }
  let expectedFileName = baseFileName;
  if (mapping.queryHash !== null) {
    expectedFileName = appendArchiveFileNameSuffix(
      expectedFileName,
      `q-${mapping.queryHash as string}`,
    );
  }
  if (mapping.collisionHash !== null) {
    expectedFileName = appendArchiveFileNameSuffix(
      expectedFileName,
      `c-${mapping.collisionHash as string}`,
    );
  }
  if (fileName !== expectedFileName) {
    throw new Error(`${label} file name does not match its hashes.`);
  }
  return mapping as unknown as ResourcePathMapping;
}

function validateResourceRecord(
  value: unknown,
  index: number,
  jobId: string,
  seenIds: Set<string>,
): ResourceRecord {
  const label = `Resource record at index ${index}`;
  if (!isRecord(value) || !hasOnlyKeys(value, RECORD_KEYS)) {
    throw new TypeError(`${label} contains unsupported fields.`);
  }
  const id = requireNonEmptyString(value.id, `${label} ID`);
  if (seenIds.has(id)) throw new Error(`${label} duplicates resource ID ${id}.`);
  seenIds.add(id);
  if (value.jobId !== jobId) throw new Error(`${label} belongs to a different job.`);
  requireNonEmptyString(value.originalUrl, `${label} original URL`);
  requireNonEmptyString(value.referrerUrl, `${label} referrer URL`);
  if (!RESOURCE_TYPES.includes(value.type as ResourceType)) {
    throw new TypeError(`${label} resource type is not supported.`);
  }
  if (!TERMINAL_RESOURCE_STATES.has(value.state as string)) {
    throw new Error(`${label} must be in a terminal resource state.`);
  }
  normalizeDiscoverySources(value.discoverySources, `${label} discovery sources`);
  return value as unknown as ResourceRecord;
}

function normalizeSavedPath(record: ResourceRecord, label: string): string {
  const localPath = requireNonEmptyString(record.localPath, `${label} local path`);
  const pathSegments = validateArchivePath(localPath, `${label} local path`);
  if (pathSegments.some((segment) => sanitizeArchiveFileName(segment) !== segment)) {
    throw new TypeError(`${label} local path must be portable.`);
  }
  const isPagePath = localPath === 'index.html' || localPath.startsWith('pages/');
  if (isPagePath && record.type !== 'document') {
    throw new Error(`${label} only documents may use page archive paths.`);
  }
  if (!isPagePath && !localPath.startsWith('assets/')) {
    throw new Error(`${label} local path must be index.html, pages/, or assets/.`);
  }
  return localPath;
}

function encodeManifest(value: unknown): Uint8Array {
  return UTF8_ENCODER.encode(`${JSON.stringify(value, null, 2)}\n`);
}

export function buildArchiveResourceManifests(
  input: ArchiveResourceManifestsInput,
): ArchiveResourceManifests {
  if (!isRecord(input) || !hasExactKeys(input, INPUT_KEYS)) {
    throw new TypeError(
      'Archive resource manifest input must contain exactly the supported fields.',
    );
  }
  const jobId = requireNonEmptyString(input.jobId, 'Archive resource manifest job ID');
  if (!Array.isArray(input.resourceRecords) || !Array.isArray(input.pathMappings)) {
    throw new TypeError('Archive resource records and path mappings must be arrays.');
  }

  const mappingsByPath = new Map<string, ResourcePathMapping>();
  const mappingPathKeys = new Set<string>();
  for (const [index, candidate] of input.pathMappings.entries()) {
    const mapping = validatePathMapping(candidate, index);
    const portablePathKey = mapping.relativePath.normalize('NFC').toLowerCase();
    if (mappingPathKeys.has(portablePathKey)) {
      throw new Error('Resource path mappings contain a portable path collision.');
    }
    mappingPathKeys.add(portablePathKey);
    mappingsByPath.set(mapping.relativePath, mapping);
  }

  const resources: ArchiveResourceEntry[] = [];
  const failures: ArchiveUnsavedResourceEntry[] = [];
  const skipped: ArchiveUnsavedResourceEntry[] = [];
  const mappings: ArchiveOriginalUrlMapping[] = [];
  const usedMappingPaths = new Set<string>();
  const seenIds = new Set<string>();
  const seenSavedPaths = new Set<string>();

  for (const [index, candidate] of input.resourceRecords.entries()) {
    const record = validateResourceRecord(candidate, index, jobId, seenIds);
    const label = `Resource record at index ${index}`;
    const resourceType = record.type;
    const discoverySources = normalizeDiscoverySources(
      record.discoverySources,
      `${label} discovery sources`,
    );
    const mimeType = validateOptionalMimeType(record.mimeType, `${label} MIME type`);
    const httpStatus = validateOptionalHttpStatus(record.httpStatus, `${label} HTTP status`);
    const byteLength = validateOptionalByteLength(record.byteLength, `${label} byte length`);
    const redirectTrace = normalizeRedirectTrace(record.redirectTrace, record, `${label} redirect`);
    const referrerUrl = sanitizeArchiveNetworkUrl(
      record.referrerUrl,
      `${label} referrer URL`,
      true,
    );

    if (record.state === 'saved') {
      if (record.error !== undefined)
        throw new Error(`${label} saved resources cannot have errors.`);
      if (byteLength === null) throw new Error(`${label} saved resources require a byte length.`);
      if (httpStatus !== null && (httpStatus < 200 || httpStatus > 299)) {
        throw new Error(`${label} saved resources require a successful HTTP status.`);
      }
      const localPath = normalizeSavedPath(record, label);
      const portablePathKey = localPath.normalize('NFC').toLowerCase();
      if (seenSavedPaths.has(portablePathKey)) {
        throw new Error(`${label} duplicates a saved archive path.`);
      }
      seenSavedPaths.add(portablePathKey);
      validateNetworkUrl(record.originalUrl, `${label} original URL`);
      const rawFinalUrl = record.finalUrl ?? record.originalUrl;
      const finalIdentity = validateNetworkUrl(rawFinalUrl, `${label} final URL`);
      const pathMapping = mappingsByPath.get(localPath);
      if (localPath.startsWith('assets/')) {
        if (!pathMapping) throw new Error(`${label} has no matching resource path mapping.`);
        if (
          pathMapping.resourceType !== resourceType ||
          pathMapping.normalizedUrl !== finalIdentity
        ) {
          throw new Error(`${label} does not match its resource path mapping.`);
        }
        usedMappingPaths.add(localPath);
      } else if (pathMapping) {
        throw new Error(`${label} page paths cannot use asset path mappings.`);
      }

      const originalUrl = sanitizeArchiveNetworkUrl(
        record.originalUrl,
        `${label} original URL`,
        true,
      );
      const finalUrl = sanitizeArchiveNetworkUrl(rawFinalUrl, `${label} final URL`, true);
      resources.push({
        originalUrl,
        finalUrl,
        referrerUrl,
        localPath,
        resourceType,
        discoverySources,
        redirectTrace,
        mimeType,
        httpStatus,
        byteLength,
        sha256: validateOptionalSha256(record.sha256, `${label} SHA-256`),
      });

      const mappingUrls = pathMapping
        ? [...pathMapping.originalUrls, record.originalUrl]
        : [record.originalUrl];
      for (const mappingUrl of mappingUrls) {
        mappings.push({
          originalUrl: sanitizeArchiveNetworkUrl(mappingUrl, `${label} mapped original URL`, true),
          finalUrl,
          localPath,
          resourceType,
        });
      }
      continue;
    }

    if (record.localPath !== undefined || record.sha256 !== undefined) {
      throw new Error(`${label} unsaved resources cannot have local paths or hashes.`);
    }
    const error =
      record.error === undefined
        ? null
        : normalizeResourceError(record.error, record, httpStatus, `${label} error`);
    if (record.state === 'failed' && error === null) {
      throw new Error(`${label} failed resources require a structured error.`);
    }
    const unsaved: ArchiveUnsavedResourceEntry = {
      originalUrl: sanitizeDiagnosticUrl(record.originalUrl, `${label} original URL`),
      finalUrl:
        record.finalUrl === undefined
          ? null
          : sanitizeDiagnosticUrl(record.finalUrl, `${label} final URL`),
      referrerUrl,
      resourceType,
      discoverySources,
      redirectTrace,
      mimeType,
      httpStatus,
      byteLength,
      error,
    };
    if (record.state === 'failed') failures.push(unsaved);
    else skipped.push(unsaved);
  }

  for (const mappingPath of mappingsByPath.keys()) {
    if (!usedMappingPaths.has(mappingPath)) {
      throw new Error(`Resource path mapping ${mappingPath} has no saved resource record.`);
    }
  }

  resources.sort((left, right) =>
    compareText(
      `${left.localPath}\u0000${left.resourceType}\u0000${left.originalUrl}`,
      `${right.localPath}\u0000${right.resourceType}\u0000${right.originalUrl}`,
    ),
  );
  const compareUnsaved = (left: ArchiveUnsavedResourceEntry, right: ArchiveUnsavedResourceEntry) =>
    compareText(
      `${left.originalUrl}\u0000${left.resourceType}\u0000${left.finalUrl ?? ''}`,
      `${right.originalUrl}\u0000${right.resourceType}\u0000${right.finalUrl ?? ''}`,
    );
  failures.sort(compareUnsaved);
  skipped.sort(compareUnsaved);

  const uniqueMappings = new Map<string, ArchiveOriginalUrlMapping>();
  for (const mapping of mappings) {
    const key = `${mapping.originalUrl}\u0000${mapping.finalUrl}\u0000${mapping.localPath}\u0000${mapping.resourceType}`;
    uniqueMappings.set(key, mapping);
  }
  const originalUrlMappings = [...uniqueMappings.values()].sort((left, right) =>
    compareText(
      `${left.originalUrl}\u0000${left.localPath}\u0000${left.resourceType}`,
      `${right.originalUrl}\u0000${right.localPath}\u0000${right.resourceType}`,
    ),
  );

  return {
    resources: { formatVersion: ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION, resources },
    failures: { formatVersion: ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION, failures, skipped },
    originalUrls: {
      formatVersion: ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION,
      mappings: originalUrlMappings,
    },
  };
}

export function createArchiveResourceManifestEntries(
  input: ArchiveResourceManifestsInput,
): ZipArchiveEntry[] {
  const manifests = buildArchiveResourceManifests(input);
  return [
    { path: ARCHIVE_METADATA_PATHS.resources, bytes: encodeManifest(manifests.resources) },
    { path: ARCHIVE_METADATA_PATHS.failures, bytes: encodeManifest(manifests.failures) },
    { path: ARCHIVE_METADATA_PATHS.originalUrls, bytes: encodeManifest(manifests.originalUrls) },
  ];
}
