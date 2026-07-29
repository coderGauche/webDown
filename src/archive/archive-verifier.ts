import { RESOURCE_TYPES, type ResourceType } from '@sitecapsule/domain';

import {
  ARCHIVE_INDEX_PATH,
  ARCHIVE_METADATA_PATHS,
  ARCHIVE_METADATA_ROOT,
  ARCHIVE_PAGES_ROOT,
  ARCHIVE_SCREENSHOTS_ROOT,
  buildArchiveLayout,
  type ArchiveLayout,
  type ArchiveLayoutCounts,
} from './archive-layout';
import {
  validateArchiveFailureManifest,
  validateArchiveManifest,
  validateArchiveResourceManifest,
} from './archive-report';
import { ARCHIVE_ASSET_ROOT } from './resource-directory';
import { ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION } from './resource-manifests';
import { extractZipArchiveSync, type ZipArchiveEntry } from './zip-codec';

export const ARCHIVE_VERIFICATION_ERROR_CODES = [
  'invalid-zip-structure',
  'zip-crc-mismatch',
  'archive-path-mismatch',
  'archive-content-mismatch',
  'archive-manifest-invalid',
  'archive-count-mismatch',
] as const;

export type ArchiveVerificationErrorCode = (typeof ARCHIVE_VERIFICATION_ERROR_CODES)[number];

export class ArchiveVerificationError extends Error {
  readonly code: ArchiveVerificationErrorCode;
  readonly entryPath?: string;
  override readonly cause?: unknown;

  constructor(
    code: ArchiveVerificationErrorCode,
    options: { entryPath?: string; cause?: unknown } = {},
  ) {
    super(
      code === 'zip-crc-mismatch'
        ? 'ZIP entry CRC verification failed.'
        : code === 'archive-path-mismatch'
          ? 'ZIP entry paths do not match the expected archive layout.'
          : code === 'archive-content-mismatch'
            ? 'ZIP entry content does not match the expected archive layout.'
            : code === 'archive-manifest-invalid'
              ? 'ZIP archive manifests are invalid.'
              : code === 'archive-count-mismatch'
                ? 'ZIP archive counts do not match its manifests.'
                : 'ZIP structure is invalid or unsupported.',
    );
    this.name = 'ArchiveVerificationError';
    this.code = code;
    this.entryPath = options.entryPath;
    this.cause = options.cause;
  }
}

export interface VerifySiteCapsuleArchiveInput {
  archiveBytes: Uint8Array;
  expectedEntries: readonly ZipArchiveEntry[];
}

export interface ArchiveVerificationResult {
  entryCount: number;
  crcVerifiedEntries: number;
  paths: string[];
  layoutCounts: ArchiveLayoutCounts;
  manifestCounts: {
    pages: number;
    resources: number;
    failedResources: number;
    skippedResources: number;
  };
}

interface ZipCentralEntry {
  path: string;
  flags: number;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataStart: number;
  dataEnd: number;
}

interface ArchiveOriginalUrlMapping {
  originalUrl: string;
  finalUrl: string;
  localPath: string;
  resourceType: ResourceType;
}

const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_END_MIN_LENGTH = 22;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const ZIP_SUPPORTED_FLAGS = 0x0806;
const REQUIRED_METADATA_PATHS = new Set<string>(Object.values(ARCHIVE_METADATA_PATHS));
const JSON_DECODER = new TextDecoder('utf-8', { fatal: true });

const CRC32_TABLE = new Uint32Array(256);
for (let value = 0; value < CRC32_TABLE.length; value += 1) {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current >>> 1) ^ (current & 1 ? 0xedb88320 : 0);
  }
  CRC32_TABLE[value] = current >>> 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUint16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) {
    throw new ArchiveVerificationError('invalid-zip-structure');
  }
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) {
    throw new ArchiveVerificationError('invalid-zip-structure');
  }
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView): number {
  const minimumOffset = Math.max(0, bytes.byteLength - ZIP_END_MIN_LENGTH - ZIP_MAX_COMMENT_LENGTH);
  for (let offset = bytes.byteLength - ZIP_END_MIN_LENGTH; offset >= minimumOffset; offset -= 1) {
    if (readUint32(view, offset) !== ZIP_END_SIGNATURE) continue;
    const commentLength = readUint16(view, offset + 20);
    if (offset + ZIP_END_MIN_LENGTH + commentLength === bytes.byteLength) return offset;
  }
  throw new ArchiveVerificationError('invalid-zip-structure');
}

function decodeZipPath(bytes: Uint8Array, usesUtf8: boolean): string {
  if (!usesUtf8 && bytes.some((byte) => byte > 0x7f)) {
    throw new ArchiveVerificationError('invalid-zip-structure');
  }
  try {
    return JSON_DECODER.decode(bytes);
  } catch (cause) {
    throw new ArchiveVerificationError('invalid-zip-structure', { cause });
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function calculateCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parseZipCentralDirectory(bytes: Uint8Array): ZipCentralEntry[] {
  if (bytes.byteLength < ZIP_END_MIN_LENGTH) {
    throw new ArchiveVerificationError('invalid-zip-structure');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endOffset = findEndOfCentralDirectory(bytes, view);
  const diskNumber = readUint16(view, endOffset + 4);
  const centralDiskNumber = readUint16(view, endOffset + 6);
  const diskEntryCount = readUint16(view, endOffset + 8);
  const totalEntryCount = readUint16(view, endOffset + 10);
  const centralSize = readUint32(view, endOffset + 12);
  const centralOffset = readUint32(view, endOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDiskNumber !== 0 ||
    diskEntryCount !== totalEntryCount ||
    totalEntryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    centralOffset + centralSize !== endOffset
  ) {
    throw new ArchiveVerificationError('invalid-zip-structure');
  }

  const entries: ZipCentralEntry[] = [];
  const exactPaths = new Set<string>();
  const portablePaths = new Set<string>();
  let offset = centralOffset;
  for (let index = 0; index < totalEntryCount; index += 1) {
    if (readUint32(view, offset) !== ZIP_CENTRAL_HEADER_SIGNATURE) {
      throw new ArchiveVerificationError('invalid-zip-structure');
    }
    const flags = readUint16(view, offset + 8);
    const compressionMethod = readUint16(view, offset + 10);
    const crc32 = readUint32(view, offset + 16);
    const compressedSize = readUint32(view, offset + 20);
    const uncompressedSize = readUint32(view, offset + 24);
    const fileNameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localDiskNumber = readUint16(view, offset + 34);
    const localHeaderOffset = readUint32(view, offset + 42);
    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength;
    if (
      nextOffset > endOffset ||
      (flags & ~ZIP_SUPPORTED_FLAGS) !== 0 ||
      (compressionMethod !== 0 && compressionMethod !== 8) ||
      localDiskNumber !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new ArchiveVerificationError('invalid-zip-structure');
    }

    const fileNameBytes = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
    const path = decodeZipPath(fileNameBytes, (flags & 0x0800) !== 0);
    const portablePath = path.normalize('NFC').toLowerCase();
    if (!path || path.endsWith('/') || exactPaths.has(path) || portablePaths.has(portablePath)) {
      throw new ArchiveVerificationError('invalid-zip-structure', { entryPath: path || undefined });
    }
    exactPaths.add(path);
    portablePaths.add(portablePath);

    if (readUint32(view, localHeaderOffset) !== ZIP_LOCAL_HEADER_SIGNATURE) {
      throw new ArchiveVerificationError('invalid-zip-structure', { entryPath: path });
    }
    const localFlags = readUint16(view, localHeaderOffset + 6);
    const localCompressionMethod = readUint16(view, localHeaderOffset + 8);
    const localCrc32 = readUint32(view, localHeaderOffset + 14);
    const localCompressedSize = readUint32(view, localHeaderOffset + 18);
    const localUncompressedSize = readUint32(view, localHeaderOffset + 22);
    const localFileNameLength = readUint16(view, localHeaderOffset + 26);
    const localExtraLength = readUint16(view, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    const localFileNameBytes = bytes.subarray(
      localHeaderOffset + 30,
      localHeaderOffset + 30 + localFileNameLength,
    );
    if (
      localFlags !== flags ||
      localCompressionMethod !== compressionMethod ||
      localCrc32 !== crc32 ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize ||
      !bytesEqual(localFileNameBytes, fileNameBytes) ||
      dataEnd > centralOffset
    ) {
      throw new ArchiveVerificationError('invalid-zip-structure', { entryPath: path });
    }
    entries.push({
      path,
      flags,
      compressionMethod,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataStart,
      dataEnd,
    });
    offset = nextOffset;
  }
  if (offset !== endOffset) throw new ArchiveVerificationError('invalid-zip-structure');

  const localRanges = [...entries].sort(
    (left, right) => left.localHeaderOffset - right.localHeaderOffset,
  );
  let expectedOffset = 0;
  for (const entry of localRanges) {
    if (entry.localHeaderOffset !== expectedOffset) {
      throw new ArchiveVerificationError('invalid-zip-structure', { entryPath: entry.path });
    }
    expectedOffset = entry.dataEnd;
  }
  if (expectedOffset !== centralOffset) {
    throw new ArchiveVerificationError('invalid-zip-structure');
  }
  return entries;
}

function buildExpectedLayout(entries: readonly ZipArchiveEntry[]): ArchiveLayout {
  if (!Array.isArray(entries)) throw new TypeError('Expected archive entries must be an array.');
  const indexEntries = entries.filter(({ path }) => path === ARCHIVE_INDEX_PATH);
  if (indexEntries.length !== 1) {
    throw new TypeError('Expected archive entries must contain exactly one index.html.');
  }
  const pages: ZipArchiveEntry[] = [];
  const assets: ZipArchiveEntry[] = [];
  const metadata: ZipArchiveEntry[] = [];
  const screenshots: ZipArchiveEntry[] = [];
  for (const entry of entries) {
    if (entry.path === ARCHIVE_INDEX_PATH) continue;
    if (entry.path.startsWith(`${ARCHIVE_PAGES_ROOT}/`)) pages.push(entry);
    else if (entry.path.startsWith(`${ARCHIVE_ASSET_ROOT}/`)) assets.push(entry);
    else if (entry.path.startsWith(`${ARCHIVE_METADATA_ROOT}/`)) metadata.push(entry);
    else if (entry.path.startsWith(`${ARCHIVE_SCREENSHOTS_ROOT}/`)) screenshots.push(entry);
    else
      throw new TypeError(
        `Expected archive entry is outside the SiteCapsule layout: ${entry.path}`,
      );
  }
  const layout = buildArchiveLayout({
    indexHtml: indexEntries[0]!.bytes,
    pages,
    assets,
    metadata,
    screenshots,
  });
  const metadataPaths = new Set(metadata.map(({ path }) => path));
  if (
    metadataPaths.size !== REQUIRED_METADATA_PATHS.size ||
    [...REQUIRED_METADATA_PATHS].some((path) => !metadataPaths.has(path))
  ) {
    throw new TypeError('Expected archive entries must contain every required metadata file.');
  }
  return layout;
}

function parseJsonEntry(entries: Map<string, Uint8Array>, path: string): unknown {
  const bytes = entries.get(path);
  if (!bytes) throw new ArchiveVerificationError('archive-manifest-invalid', { entryPath: path });
  try {
    return JSON.parse(JSON_DECODER.decode(bytes));
  } catch (cause) {
    throw new ArchiveVerificationError('archive-manifest-invalid', { entryPath: path, cause });
  }
}

function validateOriginalUrlManifest(
  value: unknown,
  resourcePaths: Map<string, { finalUrl: string; resourceType: ResourceType }>,
): void {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    value.formatVersion !== ARCHIVE_RESOURCE_MANIFEST_FORMAT_VERSION ||
    !Array.isArray(value.mappings)
  ) {
    throw new ArchiveVerificationError('archive-manifest-invalid', {
      entryPath: ARCHIVE_METADATA_PATHS.originalUrls,
    });
  }
  const mappedPaths = new Set<string>();
  const identities = new Set<string>();
  for (const candidate of value.mappings) {
    if (
      !isRecord(candidate) ||
      Object.keys(candidate).length !== 4 ||
      !['originalUrl', 'finalUrl', 'localPath', 'resourceType'].every((key) =>
        Object.hasOwn(candidate, key),
      ) ||
      typeof candidate.originalUrl !== 'string' ||
      typeof candidate.finalUrl !== 'string' ||
      typeof candidate.localPath !== 'string' ||
      !RESOURCE_TYPES.includes(candidate.resourceType as ResourceType)
    ) {
      throw new ArchiveVerificationError('archive-manifest-invalid', {
        entryPath: ARCHIVE_METADATA_PATHS.originalUrls,
      });
    }
    const mapping = candidate as unknown as ArchiveOriginalUrlMapping;
    const resource = resourcePaths.get(mapping.localPath);
    const identity = `${mapping.originalUrl}\u0000${mapping.finalUrl}\u0000${mapping.localPath}\u0000${mapping.resourceType}`;
    if (
      !resource ||
      resource.finalUrl !== mapping.finalUrl ||
      resource.resourceType !== mapping.resourceType ||
      identities.has(identity)
    ) {
      throw new ArchiveVerificationError('archive-manifest-invalid', {
        entryPath: ARCHIVE_METADATA_PATHS.originalUrls,
      });
    }
    identities.add(identity);
    mappedPaths.add(mapping.localPath);
  }
  if ([...resourcePaths.keys()].some((path) => !mappedPaths.has(path))) {
    throw new ArchiveVerificationError('archive-manifest-invalid', {
      entryPath: ARCHIVE_METADATA_PATHS.originalUrls,
    });
  }
}

function verifyManifests(
  entries: readonly ZipArchiveEntry[],
): ArchiveVerificationResult['manifestCounts'] {
  const byPath = new Map(entries.map(({ path, bytes }) => [path, bytes]));
  let archiveManifest;
  let resourceManifest;
  let failureManifest;
  try {
    archiveManifest = validateArchiveManifest(
      parseJsonEntry(byPath, ARCHIVE_METADATA_PATHS.archive),
    );
    resourceManifest = validateArchiveResourceManifest(
      parseJsonEntry(byPath, ARCHIVE_METADATA_PATHS.resources),
    );
    failureManifest = validateArchiveFailureManifest(
      parseJsonEntry(byPath, ARCHIVE_METADATA_PATHS.failures),
    );
  } catch (cause) {
    if (cause instanceof ArchiveVerificationError) throw cause;
    throw new ArchiveVerificationError('archive-manifest-invalid', { cause });
  }

  const resourcePaths = new Map<string, { finalUrl: string; resourceType: ResourceType }>();
  for (const resource of resourceManifest.resources) {
    const bytes = byPath.get(resource.localPath);
    if (
      bytes === undefined ||
      bytes.byteLength !== resource.byteLength ||
      resourcePaths.has(resource.localPath)
    ) {
      throw new ArchiveVerificationError('archive-count-mismatch', {
        entryPath: resource.localPath,
      });
    }
    resourcePaths.set(resource.localPath, {
      finalUrl: resource.finalUrl,
      resourceType: resource.resourceType,
    });
  }

  const actualResourcePaths = entries
    .map(({ path }) => path)
    .filter(
      (path) =>
        path === ARCHIVE_INDEX_PATH ||
        path.startsWith(`${ARCHIVE_PAGES_ROOT}/`) ||
        path.startsWith(`${ARCHIVE_ASSET_ROOT}/`),
    );
  if (
    actualResourcePaths.length !== resourcePaths.size ||
    actualResourcePaths.some((path) => !resourcePaths.has(path))
  ) {
    throw new ArchiveVerificationError('archive-count-mismatch');
  }
  const pageCount = actualResourcePaths.filter(
    (path) => path === ARCHIVE_INDEX_PATH || path.startsWith(`${ARCHIVE_PAGES_ROOT}/`),
  ).length;
  if (
    archiveManifest.pages !== pageCount ||
    archiveManifest.resources !== resourceManifest.resources.length ||
    archiveManifest.failedResources !== failureManifest.failures.length
  ) {
    throw new ArchiveVerificationError('archive-count-mismatch');
  }

  validateOriginalUrlManifest(
    parseJsonEntry(byPath, ARCHIVE_METADATA_PATHS.originalUrls),
    resourcePaths,
  );
  return {
    pages: pageCount,
    resources: resourceManifest.resources.length,
    failedResources: failureManifest.failures.length,
    skippedResources: failureManifest.skipped.length,
  };
}

/** Verifies trusted SiteCapsule output; it is not a sandbox for arbitrary third-party ZIP files. */
export function verifySiteCapsuleArchiveSync(
  input: VerifySiteCapsuleArchiveInput,
): ArchiveVerificationResult {
  if (
    !isRecord(input) ||
    Object.keys(input).length !== 2 ||
    !Object.hasOwn(input, 'archiveBytes') ||
    !Object.hasOwn(input, 'expectedEntries')
  ) {
    throw new TypeError(
      'Archive verification input must contain archiveBytes and expectedEntries.',
    );
  }
  if (!(input.archiveBytes instanceof Uint8Array)) {
    throw new TypeError('Archive verification bytes must be a Uint8Array.');
  }
  const archiveBytes = new Uint8Array(input.archiveBytes);
  const expectedLayout = buildExpectedLayout(input.expectedEntries);
  const expectedByPath = new Map(expectedLayout.entries.map((entry) => [entry.path, entry.bytes]));
  const centralEntries = parseZipCentralDirectory(archiveBytes);
  if (
    centralEntries.length !== expectedByPath.size ||
    centralEntries.some((entry) => {
      const expected = expectedByPath.get(entry.path);
      return expected === undefined || expected.byteLength !== entry.uncompressedSize;
    })
  ) {
    throw new ArchiveVerificationError('archive-path-mismatch');
  }

  let extracted: ZipArchiveEntry[];
  try {
    extracted = extractZipArchiveSync(archiveBytes);
  } catch (cause) {
    throw new ArchiveVerificationError('invalid-zip-structure', { cause });
  }
  const centralByPath = new Map(centralEntries.map((entry) => [entry.path, entry]));
  for (const entry of extracted) {
    const central = centralByPath.get(entry.path);
    const expected = expectedByPath.get(entry.path);
    if (!central || !expected) throw new ArchiveVerificationError('archive-path-mismatch');
    if (
      entry.bytes.byteLength !== central.uncompressedSize ||
      calculateCrc32(entry.bytes) !== central.crc32
    ) {
      throw new ArchiveVerificationError('zip-crc-mismatch', { entryPath: entry.path });
    }
    if (!bytesEqual(entry.bytes, expected)) {
      throw new ArchiveVerificationError('archive-content-mismatch', { entryPath: entry.path });
    }
  }
  if (extracted.length !== centralEntries.length) {
    throw new ArchiveVerificationError('archive-path-mismatch');
  }

  return {
    entryCount: extracted.length,
    crcVerifiedEntries: extracted.length,
    paths: extracted.map(({ path }) => path),
    layoutCounts: { ...expectedLayout.counts },
    manifestCounts: verifyManifests(extracted),
  };
}
