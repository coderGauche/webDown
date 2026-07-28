import { unzipSync, zipSync, type Zippable } from 'fflate';

import { validateArchivePath } from './rewrite-support';

export const ZIP_DEFAULT_COMPRESSION_LEVEL = 6;

export type ZipCompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface ZipArchiveEntry {
  path: string;
  bytes: Uint8Array;
}

export interface CreateZipArchiveOptions {
  compressionLevel?: ZipCompressionLevel;
}

export type ZipCodecOperation = 'encode' | 'decode';

export class ZipCodecError extends Error {
  readonly operation: ZipCodecOperation;
  override readonly cause: unknown;

  constructor(operation: ZipCodecOperation, cause: unknown) {
    super(`Failed to ${operation} ZIP archive.`);
    this.name = 'ZipCodecError';
    this.operation = operation;
    this.cause = cause;
  }
}

function compareArchivePaths(left: ZipArchiveEntry, right: ZipArchiveEntry): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function validateCompressionLevel(value: number): asserts value is ZipCompressionLevel {
  if (!Number.isSafeInteger(value) || value < 0 || value > 9) {
    throw new RangeError('ZIP compression level must be a safe integer from 0 to 9.');
  }
}

function normalizeEntries(entries: readonly ZipArchiveEntry[]): ZipArchiveEntry[] {
  if (!Array.isArray(entries)) throw new TypeError('ZIP entries must be an array.');

  const normalized = entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError(`ZIP entry at index ${index} must be an object.`);
    }
    validateArchivePath(entry.path, `ZIP entry path at index ${index}`);
    if (!(entry.bytes instanceof Uint8Array)) {
      throw new TypeError(`ZIP entry bytes at index ${index} must be a Uint8Array.`);
    }
    return { path: entry.path, bytes: new Uint8Array(entry.bytes) };
  });

  normalized.sort(compareArchivePaths);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]?.path === normalized[index]?.path) {
      throw new Error(`Duplicate ZIP entry path: ${normalized[index]?.path}`);
    }
  }
  return normalized;
}

function deterministicZipMtime(): Date {
  // ZIP stores local calendar fields with two-second precision and cannot represent dates before 1980.
  return new Date(1980, 0, 1, 0, 0, 0, 0);
}

export function createZipArchiveSync(
  entries: readonly ZipArchiveEntry[],
  options: CreateZipArchiveOptions = {},
): Uint8Array {
  const compressionLevel = options.compressionLevel ?? ZIP_DEFAULT_COMPRESSION_LEVEL;
  validateCompressionLevel(compressionLevel);
  const normalizedEntries = normalizeEntries(entries);
  const input = Object.create(null) as Zippable;

  for (const entry of normalizedEntries) input[entry.path] = entry.bytes;

  try {
    return zipSync(input, {
      level: compressionLevel,
      mtime: deterministicZipMtime(),
    });
  } catch (cause) {
    throw new ZipCodecError('encode', cause);
  }
}

/** Reads trusted SiteCapsule output; eager decompression is not a sandbox for untrusted ZIP data. */
export function extractZipArchiveSync(archiveBytes: Uint8Array): ZipArchiveEntry[] {
  if (!(archiveBytes instanceof Uint8Array)) {
    throw new TypeError('ZIP archive bytes must be a Uint8Array.');
  }

  try {
    const unzipped = unzipSync(archiveBytes);
    return normalizeEntries(
      Object.entries(unzipped).map(([path, bytes]) => ({
        path,
        bytes,
      })),
    );
  } catch (cause) {
    if (cause instanceof ZipCodecError) throw cause;
    throw new ZipCodecError('decode', cause);
  }
}
