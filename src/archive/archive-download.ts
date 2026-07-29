import { toSiteCapsuleError } from '@sitecapsule/domain';

import { sanitizeArchiveFileName } from './resource-file-name';

export const ARCHIVE_DOWNLOAD_MIME_TYPE = 'application/zip';
export const ARCHIVE_DOWNLOAD_CONFLICT_ACTION = 'uniquify' as const;
export const ARCHIVE_DOWNLOAD_FALLBACK_FILE_NAME = 'sitecapsule-archive.zip';

export interface ArchiveDownloadInput {
  archiveBytes: Uint8Array;
  fileName: string;
  saveAs: boolean;
}

export interface ArchiveDownloadRequest {
  url: string;
  filename: string;
  conflictAction: typeof ARCHIVE_DOWNLOAD_CONFLICT_ACTION;
  saveAs: boolean;
}

export interface ArchiveDownloadEnvironment {
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  download(request: ArchiveDownloadRequest): Promise<number>;
}

export interface ArchiveDownloadResult {
  downloadId: number;
  fileName: string;
  byteLength: number;
  saveAs: boolean;
  conflictAction: typeof ARCHIVE_DOWNLOAD_CONFLICT_ACTION;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateInput(input: ArchiveDownloadInput): void {
  if (!isRecord(input)) throw new TypeError('Archive download input must be an object.');

  const keys = Object.keys(input);
  const expectedKeys = ['archiveBytes', 'fileName', 'saveAs'];
  if (
    keys.length !== expectedKeys.length ||
    !expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(input, key))
  ) {
    throw new TypeError(
      'Archive download input must contain exactly archiveBytes, fileName, and saveAs.',
    );
  }
  if (!(input.archiveBytes instanceof Uint8Array)) {
    throw new TypeError('Archive download bytes must be a Uint8Array.');
  }
  if (input.archiveBytes.byteLength === 0) {
    throw new RangeError('Archive download bytes must not be empty.');
  }
  if (typeof input.fileName !== 'string' || input.fileName.trim().length === 0) {
    throw new TypeError('Archive download file name must be a non-empty string.');
  }
  if (typeof input.saveAs !== 'boolean') {
    throw new TypeError('Archive download saveAs must be a boolean.');
  }
}

function validateEnvironment(environment: ArchiveDownloadEnvironment): void {
  if (
    !isRecord(environment) ||
    typeof environment.createObjectUrl !== 'function' ||
    typeof environment.revokeObjectUrl !== 'function' ||
    typeof environment.download !== 'function'
  ) {
    throw new TypeError('Archive download environment is invalid.');
  }
}

function isBlobUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;

  try {
    return new URL(value).protocol === 'blob:';
  } catch {
    return false;
  }
}

export function createArchiveDownloadFileName(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('Archive download file name must be a non-empty string.');
  }

  const sanitized = sanitizeArchiveFileName(value, ARCHIVE_DOWNLOAD_FALLBACK_FILE_NAME);
  const stem = sanitized.toLowerCase().endsWith('.zip') ? sanitized.slice(0, -4) : sanitized;
  return sanitizeArchiveFileName(
    `${stem || 'sitecapsule-archive'}.zip`,
    ARCHIVE_DOWNLOAD_FALLBACK_FILE_NAME,
  );
}

export async function exportArchiveDownload(
  input: ArchiveDownloadInput,
  environment: ArchiveDownloadEnvironment,
): Promise<ArchiveDownloadResult> {
  validateInput(input);
  validateEnvironment(environment);

  const archiveBytes = new Uint8Array(input.archiveBytes);
  const fileName = createArchiveDownloadFileName(input.fileName);
  const blob = new Blob([archiveBytes], { type: ARCHIVE_DOWNLOAD_MIME_TYPE });
  let objectUrl: string | undefined;
  let downloadId: number | undefined;
  let failure: unknown;

  try {
    objectUrl = environment.createObjectUrl(blob);
    if (!isBlobUrl(objectUrl)) {
      throw new TypeError('Archive download environment returned a non-Blob URL.');
    }

    downloadId = await environment.download({
      url: objectUrl,
      filename: fileName,
      conflictAction: ARCHIVE_DOWNLOAD_CONFLICT_ACTION,
      saveAs: input.saveAs,
    });
    if (!Number.isSafeInteger(downloadId) || (downloadId as number) < 0) {
      throw new TypeError('Chrome Downloads API returned an invalid download id.');
    }
  } catch (error) {
    failure = error;
  }

  if (objectUrl !== undefined) {
    try {
      environment.revokeObjectUrl(objectUrl);
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure !== undefined) {
    throw toSiteCapsuleError(failure, 'archive-download-failed', {
      operation: 'archive-download',
    });
  }

  return {
    downloadId: downloadId as number,
    fileName,
    byteLength: archiveBytes.byteLength,
    saveAs: input.saveAs,
    conflictAction: ARCHIVE_DOWNLOAD_CONFLICT_ACTION,
  };
}

export function exportArchiveWithChromeDownloads(
  input: ArchiveDownloadInput,
): Promise<ArchiveDownloadResult> {
  return exportArchiveDownload(input, {
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    download: (request) => browser.downloads.download(request),
  });
}
