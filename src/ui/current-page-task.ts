import { createArchiveDownloadFileName } from '@sitecapsule/archive';
import { DEFAULT_RENDER_WAIT_MS, type CaptureSettings } from '@sitecapsule/domain';
import type { CaptureJobCreateInput } from '@sitecapsule/messaging/protocol';

export const DEFAULT_CURRENT_PAGE_ARCHIVE_FILE_NAME = 'sitecapsule-archive.zip';
export const DEFAULT_CURRENT_PAGE_CONCURRENCY = 4;

export type ArchiveFileNameValidation =
  | { valid: true; fileName: string; message: null; suggestion: null }
  | { valid: false; fileName: null; message: string; suggestion: string | null };

export type CurrentPageArchiveNameState = {
  value: string;
  edited: boolean;
};

export type BuildCurrentPageTaskInput = {
  tabId: number;
  pageUrl: string;
  archiveFileName: string;
  renderWaitMs?: number;
};

function formatLocalDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}${month}${day}`;
}

function requireWebPageUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Current page URL must use HTTP or HTTPS.');
  }
  return url;
}

export function createDefaultCurrentPageArchiveFileName(
  pageUrl: string,
  date = new Date(),
): string {
  const url = requireWebPageUrl(pageUrl);
  const host = url.hostname.replace(/^www\./i, '') || 'archive';
  return createArchiveDownloadFileName(`sitecapsule-${host}-${formatLocalDate(date)}.zip`);
}

export function validateCurrentPageArchiveFileName(value: string): ArchiveFileNameValidation {
  const trimmed = value.trim();
  if (!trimmed) {
    return {
      valid: false,
      fileName: null,
      message: 'Enter a name for the ZIP file.',
      suggestion: null,
    };
  }

  const normalized = createArchiveDownloadFileName(trimmed);
  if (!trimmed.toLowerCase().endsWith('.zip')) {
    return {
      valid: false,
      fileName: null,
      message: 'The file name must end in .zip.',
      suggestion: normalized,
    };
  }
  if (value !== normalized) {
    return {
      valid: false,
      fileName: null,
      message: 'Use a portable file name without path separators or reserved characters.',
      suggestion: normalized,
    };
  }

  return { valid: true, fileName: normalized, message: null, suggestion: null };
}

export function createInitialCurrentPageArchiveName(): CurrentPageArchiveNameState {
  return { value: DEFAULT_CURRENT_PAGE_ARCHIVE_FILE_NAME, edited: false };
}

export function editCurrentPageArchiveName(value: string): CurrentPageArchiveNameState {
  return { value, edited: true };
}

export function applyCurrentPageToArchiveName(
  state: CurrentPageArchiveNameState,
  pageUrl: string,
  date = new Date(),
): CurrentPageArchiveNameState {
  if (state.edited) return state;
  return {
    value: createDefaultCurrentPageArchiveFileName(pageUrl, date),
    edited: false,
  };
}

export function createDefaultCurrentPageSettings(
  archiveFileName: string,
  renderWaitMs = DEFAULT_RENDER_WAIT_MS,
): CaptureSettings {
  const fileName = validateCurrentPageArchiveFileName(archiveFileName);
  if (!fileName.valid) throw new TypeError(fileName.message);

  return {
    archiveFileName: fileName.fileName,
    renderWaitMs,
    maxConcurrentRequests: DEFAULT_CURRENT_PAGE_CONCURRENCY,
    includeMedia: true,
    includeScripts: true,
    includeThirdPartyResources: false,
    autoScroll: false,
    maxDepth: 0,
    maxPages: 1,
    allowedUrlPatterns: [],
    blockedUrlPatterns: [],
    maxFileSizeBytes: null,
    maxTotalSizeBytes: null,
  };
}

export function buildCurrentPageTaskInput(input: BuildCurrentPageTaskInput): CaptureJobCreateInput {
  if (!Number.isSafeInteger(input.tabId) || input.tabId < 0) {
    throw new TypeError('Current page tab ID must be a non-negative safe integer.');
  }
  const pageUrl = requireWebPageUrl(input.pageUrl).href;

  return {
    tabId: input.tabId,
    startUrl: pageUrl,
    mode: 'current-page',
    profile: 'standard',
    settings: createDefaultCurrentPageSettings(input.archiveFileName, input.renderWaitMs),
  };
}
